import {
  AGENT_PROFILES,
  chooseAgentCli,
  type CliTool,
  type CliToolId,
  type DispatchDecision,
  type StudioProject,
} from "@gameaistudio/shared";
import { collectTurn } from "../ai/adapter-contract";
import type { CliService } from "./cli-service";
import { getProjectLogger } from "./logger";

/**
 * Routes a user message to the right agent (or the team pipeline) so the user
 * never has to know "修 bug 找程序、改画风找美术".
 *
 * Three layers, each a graceful degradation of the previous:
 *  1. Heuristics — free and instant for unambiguous phrasing.
 *  2. Classifier turn — one cheap CLI call with a strict one-line-JSON
 *     contract (no tools, no file reads). Runs outside the project work lock
 *     and leaves no run record: it is metadata, not work.
 *  3. Fallback — producer + small. The safe default when everything else
 *     fails; the worst case is a suboptimal addressee, never a broken send.
 */

const VALID_AGENT_IDS = new Set(AGENT_PROFILES.map((agent) => agent.id));

// ── Layer 1: heuristics ──────────────────────────────────────────────────────
// Conservative by design: each rule only fires on phrasing that clearly names
// its domain. Priority resolves overlaps (bug-fixing beats styling: "修复跳跃
// 并把画面调亮" goes to the programmer). Anything ambiguous falls through to
// the classifier.

const TEAM_LARGE_PATTERN =
  /重新?做|重构|推倒重来|重新设计|换成.{0,12}(?:游戏|玩法)|整体|全面(?:翻新|升级|调整)|大改|做一?个新|再做一版|完整版|下一版本/;
const PROGRAMMER_PATTERN =
  /修复|修一下|修掉|报错|\bbug\b|崩溃|闪退|异常|error|无法(?:运行|启动|跳跃|移动|操作)|不能(?:动|跳|跑|玩|点)|失灵|导出失败|黑屏|卡死|卡住|白屏/i;
const ARTIST_PATTERN =
  /画面|美术|配色|颜色|色调|像素风|风格|界面|\bUI\b|素材|贴图|图标|特效|动画|视觉|好看|丑/i;
const DESIGNER_PATTERN =
  /玩法|关卡|数值|难度|平衡|规则|胜负|得分|计分|奖励|道具|敌人(?:太|过|数量)|手感|节奏|无聊|不好玩/;
const QA_PATTERN = /测试|验证|检查一下|质检|有没有问题|是否正常|体验一下|验收/;
const QUESTION_PATTERN = /[?？]\s*$|^(?:为什么|怎么|如何|是什么|能不能|可不可以|啥是)/;

export function classifyByHeuristics(message: string): DispatchDecision | undefined {
  const text = message.trim();
  if (!text) return undefined;

  if (TEAM_LARGE_PATTERN.test(text)) {
    return { route: "team", agentId: "producer", scope: "large", reason: "大规模改动，启动团队流程", source: "heuristic" };
  }
  if (PROGRAMMER_PATTERN.test(text)) {
    return { route: "agent", agentId: "programmer", scope: "small", reason: "修复/报错类任务，派给程序", source: "heuristic" };
  }
  if (ARTIST_PATTERN.test(text)) {
    return { route: "agent", agentId: "artist", scope: "small", reason: "画面/素材类任务，派给美术", source: "heuristic" };
  }
  if (DESIGNER_PATTERN.test(text)) {
    return { route: "agent", agentId: "designer", scope: "small", reason: "玩法/数值类任务，派给策划", source: "heuristic" };
  }
  if (QA_PATTERN.test(text)) {
    return { route: "agent", agentId: "qa", scope: "small", reason: "测试验证类任务，派给 QA", source: "heuristic" };
  }
  if (QUESTION_PATTERN.test(text)) {
    return { route: "agent", agentId: "producer", scope: "small", reason: "问题咨询，由制作人解答", source: "heuristic" };
  }
  return undefined;
}

// ── Layer 2: classifier turn ─────────────────────────────────────────────────

export function buildClassifierPrompt(input: {
  message: string;
  projectName: string;
  dimension: string;
}): string {
  return [
    "你是 GameAIStudio 的派单分类器。根据用户消息决定由哪个角色处理。",
    "只输出一行 JSON，不要任何其他文字。不要读取任何文件，不要使用任何工具，立即作答。",
    '格式：{"route":"agent或team","agent":"producer|designer|programmer|artist|qa","scope":"small或large","reason":"15字以内中文原因"}',
    "规则：修bug/改代码/导出问题→programmer；画面/素材/UI→artist；玩法/关卡/数值→designer；测试/验证→qa；提问/规划→producer；新游戏或大规模整体改动→route=team 且 scope=large。",
    `项目：${input.projectName}（${input.dimension.toUpperCase()}）`,
    `用户消息：${input.message}`,
  ].join("\n");
}

/** Tolerant parse: find the first JSON object anywhere in the reply, validate hard. */
export function parseClassifierReply(raw: string): DispatchDecision | undefined {
  const match = /\{[\s\S]*?\}/.exec(raw);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const route = parsed.route === "team" ? "team" : parsed.route === "agent" ? "agent" : undefined;
    const agentId = typeof parsed.agent === "string" && VALID_AGENT_IDS.has(parsed.agent) ? parsed.agent : undefined;
    const scope = parsed.scope === "large" ? "large" : parsed.scope === "small" ? "small" : undefined;
    if (!route || !scope) return undefined;
    if (route === "agent" && !agentId) return undefined;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 40)
        : "分类器判定";
    return { route, agentId: agentId ?? "producer", scope, reason, source: "classifier" };
  } catch {
    return undefined;
  }
}

export const FALLBACK_DECISION: DispatchDecision = {
  route: "agent",
  agentId: "producer",
  scope: "small",
  reason: "无法自动分类，转交制作人",
  source: "fallback",
};

// ── The service ──────────────────────────────────────────────────────────────

export interface IntentRouteInput {
  project: StudioProject;
  message: string;
  /** Image attachments can only ride on a single agent turn, never the pipeline. */
  hasAttachments?: boolean;
  tools: CliTool[];
}

const CLASSIFIER_TIMEOUT_MS = 90_000;

export class IntentRouterService {
  constructor(private readonly cliService: Pick<CliService, "runTurn">) {}

  async route(input: IntentRouteInput): Promise<DispatchDecision> {
    const plog = getProjectLogger(input.project.rootPath);
    let decision = classifyByHeuristics(input.message);

    if (!decision) {
      decision = await this.classify(input).catch((error: unknown) => {
        plog.warn("dispatch", "分类回合异常，使用兜底路由", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      });
    }
    if (!decision) {
      decision = { ...FALLBACK_DECISION };
    }
    // Attachments must land on a concrete agent turn — downgrade team routes.
    if (input.hasAttachments && decision.route === "team") {
      decision = {
        ...decision,
        route: "agent",
        scope: "small",
        reason: `${decision.reason}（含图片，改为单 Agent 处理）`,
      };
    }
    plog.info("dispatch", "自动派单决策", {
      route: decision.route,
      agentId: decision.agentId,
      scope: decision.scope,
      source: decision.source,
      reason: decision.reason,
      message: input.message.replace(/\s+/g, " ").slice(0, 120),
    });
    return decision;
  }

  /** One cheap structured-output turn on the producer's CLI; no run record, no lock. */
  private async classify(input: IntentRouteInput): Promise<DispatchDecision | undefined> {
    const producer = AGENT_PROFILES.find((agent) => agent.id === "producer") ?? AGENT_PROFILES[0];
    const cliToolId: CliToolId = chooseAgentCli(
      producer,
      input.tools,
      input.project.agentCliToolIds?.[producer.id]
    );
    const tool = input.tools.find((candidate) => candidate.id === cliToolId);
    if (!tool?.installed || tool.status !== "available") {
      return undefined;
    }
    const collected = await collectTurn(
      this.cliService.runTurn(cliToolId, {
        prompt: buildClassifierPrompt({
          message: input.message,
          projectName: input.project.name,
          dimension: input.project.dimension,
        }),
        workingDir: input.project.rootPath,
        images: [],
        signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS),
      })
    );
    if (collected.exitCode !== 0 || !collected.content.trim()) {
      return undefined;
    }
    return parseClassifierReply(collected.content);
  }
}
