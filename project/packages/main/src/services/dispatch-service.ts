import {
  AGENT_PROFILES,
  chooseAgentCli,
  type AgentMessage,
  type CliTool,
  type DispatchChatInput,
  type DispatchChatResult,
  type DispatchDecision,
  type RunAgentTurnInput,
  type RunAgentTurnResult,
  type RunStudioWorkflowResult,
} from "@gameaistudio/shared";
import type { IntentRouterService } from "./intent-router";
import { createMessageId } from "./naming";
import type { ProjectService } from "./project-service";
import type { WorkflowService } from "./workflow-service";

/**
 * 自动模式的派单执行器：拿到路由决策后落到真实执行路径。
 *
 *  - route="agent"            → 单 Agent 回合（带预览刷新 / Git 自动保存编排）
 *  - route="team" + "small"   → 精简流水线：程序 + QA + 质量闭环，免 zip 打包
 *  - route="team" + "large"   → 完整五角色流水线 + 全部交付步骤
 *
 * The decision itself is appended to the chat as a system message so the user
 * always sees who got the task and why (transparency over magic). Project
 * mutual exclusion is enforced by the underlying turn/workflow paths.
 */

const SMALL_TEAM_AGENT_IDS = ["programmer", "qa"];
const FULL_TEAM_AGENT_IDS = ["producer", "designer", "programmer", "artist", "qa"];

export function describeDispatchDecision(decision: DispatchDecision): string {
  const agent = AGENT_PROFILES.find((profile) => profile.id === decision.agentId);
  if (decision.route === "team") {
    const teamLabel = decision.scope === "small" ? "精简团队流程（程序 + QA）" : "完整团队工作流";
    return `自动模式：启动${teamLabel} — ${decision.reason}`;
  }
  return `自动模式：已派给${agent?.title ?? decision.agentId}（${decision.scope === "large" ? "较大任务" : "小任务"}）— ${decision.reason}`;
}

export interface DispatchServiceDeps {
  router: Pick<IntentRouterService, "route">;
  projectService: Pick<ProjectService, "requireProject" | "appendMessages">;
  workflowService: Pick<WorkflowService, "run">;
  /** The chat-turn path with preview/git orchestration (injected from IPC wiring). */
  runAgentTurn: (input: RunAgentTurnInput) => Promise<RunAgentTurnResult>;
  discoverTools: () => Promise<CliTool[]>;
}

export class DispatchService {
  constructor(private readonly deps: DispatchServiceDeps) {}

  async dispatch(input: DispatchChatInput): Promise<DispatchChatResult> {
    const project = await this.deps.projectService.requireProject(input.projectId);
    const tools = await this.deps.discoverTools();
    const decision = await this.deps.router.route({
      project,
      message: input.message,
      hasAttachments: (input.attachments?.length ?? 0) > 0,
      tools,
    });

    // Transparent routing: the decision lands in the chat before the work.
    const announcement: AgentMessage = {
      id: createMessageId(),
      projectId: project.id,
      agentId: decision.agentId,
      role: "system",
      kind: "log",
      content: describeDispatchDecision(decision),
      createdAt: new Date().toISOString(),
    };
    await this.deps.projectService.appendMessages(project.id, [announcement]);

    if (decision.route === "team") {
      const small = decision.scope === "small";
      const workflow: RunStudioWorkflowResult = await this.deps.workflowService.run({
        projectId: project.id,
        message: input.message,
        agentIds: small ? SMALL_TEAM_AGENT_IDS : FULL_TEAM_AGENT_IDS,
        agentCliToolIds: project.agentCliToolIds,
        autoExportWeb: true,
        // Small runs skip the shareable zip — the goal is a fast verified fix,
        // not a delivery package.
        autoPackageWebZip: !small,
        autoStartPreview: input.autoStartPreview,
        withQualityLoop: true,
      });
      return { decision, kind: "workflow", workflow };
    }

    const agent = AGENT_PROFILES.find((profile) => profile.id === decision.agentId) ?? AGENT_PROFILES[0];
    const cliToolId = chooseAgentCli(agent, tools, project.agentCliToolIds?.[agent.id]);
    const turn = await this.deps.runAgentTurn({
      projectId: project.id,
      agentId: agent.id,
      cliToolId,
      message: input.message,
      autoStartPreview: input.autoStartPreview,
      attachments: input.attachments,
    });
    return { decision, kind: "agent-turn", turn };
  }
}
