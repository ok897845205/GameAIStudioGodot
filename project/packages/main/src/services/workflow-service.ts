import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  chooseAgentCli,
  type AgentMessage,
  type AgentProfile,
  type CliTool,
  type ExportResult,
  type CliToolId,
  type GodotRunResult,
  type PreviewResult,
  type RunStudioWorkflowInput,
  type RunStudioWorkflowResult,
  type StudioRun,
  type WebBuildInspection
} from "@gameaistudio/shared";
import { AgentService } from "./agent-service";
import { AutoPreviewService } from "./auto-preview-service";
import { CliService } from "./cli-service";
import { ExportService } from "./export-service";
import type { GitService } from "./git-service";
import { GodotService } from "./godot-service";
import { getProjectLogger } from "./logger";
import { createMessageId } from "./naming";
import { ProjectService } from "./project-service";
import { RunService } from "./run-service";

const DEFAULT_WORKFLOW_AGENTS = ["producer", "designer", "programmer", "artist", "qa"];

function agentById(agentId: string): AgentProfile {
  return AGENT_PROFILES.find((agent) => agent.id === agentId) ?? AGENT_PROFILES[0];
}

function buildWorkflowMessage(agent: AgentProfile, userMessage: string, index: number): string {
  const roleInstruction: Record<string, string> = {
    producer: "先拆目标、验收标准和第一版范围，给后续 Agent 明确边界。",
    designer: "基于制作人目标补齐玩法规则、关卡节奏、数值和用户反馈。",
    programmer: "把设计转成 Godot 可执行改动，优先修改脚本和场景，让 Web 预览能体现玩法。",
    artist: "整理视觉方向和可落地资源清单，必要时创建占位素材说明。",
    qa: "检查当前版本是否满足原始需求，指出缺陷、风险和下一轮修复建议。回复的第一行必须是「QA结论：通过」或「QA结论：发现问题」，然后再给出测试细节。"
  };

  return [
    `这是团队工作流第 ${index + 1} 步，你作为${agent.title}继续推进项目。`,
    roleInstruction[agent.id] ?? "根据你的职责推进项目。",
    "",
    "用户给团队的总目标：",
    userMessage
  ].join("\n");
}

function chooseWorkflowCli(agent: AgentProfile, tools: CliTool[], input: RunStudioWorkflowInput): CliToolId {
  return input.agentCliToolIds?.[agent.id] ?? chooseAgentCli(agent, tools, input.preferredCliToolId);
}

export type QaVerdict = "pass" | "issues" | "unknown";

/**
 * Reads the QA Agent's verdict from the head of its reply. The QA workflow
 * prompt asks for an explicit first line（QA结论：通过 / 发现问题）; free-form
 * replies fall back to a conservative "unknown", which still triggers the fix
 * round — a missed fix is worse than a redundant one.
 */
export function parseQaVerdict(content: string): QaVerdict {
  const head = content.trimStart().slice(0, 400);
  if (/QA\s*结论\s*[:：]\s*通过/.test(head)) return "pass";
  if (/QA\s*结论\s*[:：]\s*发现问题/.test(head)) return "issues";
  if (/未发现(?:明显)?问题|没有发现(?:明显)?问题|全部通过/.test(head)) return "pass";
  return "unknown";
}

function tailOf(value: string | undefined, maxLength: number): string {
  const text = value?.trim() ?? "";
  return text.length > maxLength ? `…${text.slice(-maxLength)}` : text;
}

export function buildFixRoundMessage(input: {
  userMessage: string;
  qaVerdict: QaVerdict;
  qaFindings?: string;
  validationFailed: boolean;
  validationOutput?: string;
}): string {
  return [
    "这是团队工作流的「修复与打磨」阶段。你作为程序 Agent，根据下面的反馈直接修改项目文件完成修复：",
    ...(input.qaVerdict !== "pass" && input.qaFindings
      ? ["", "QA 反馈：", tailOf(input.qaFindings, 2400)]
      : []),
    ...(input.validationFailed
      ? ["", "Godot 可运行校验失败输出：", tailOf(input.validationOutput, 1600)]
      : []),
    "",
    "要求：",
    "- 优先修复导致游戏无法启动、无法导出或核心玩法缺失的问题。",
    "- 修复后保持 Web 导出兼容。",
    "- 回复末尾列出修改的文件和剩余风险。",
    "",
    "用户的总目标：",
    input.userMessage
  ].join("\n");
}

function inspectionOutput(result: WebBuildInspection): string {
  return [
    result.message,
    `Path: ${result.webBuildPath}`,
    `Required: ${result.requiredFiles.join(", ")}`,
    result.missingRequiredFiles.length ? `Missing: ${result.missingRequiredFiles.join(", ")}` : undefined,
    result.files.length ? `Files:\n${result.files.map((file) => `- ${file}`).join("\n")}` : "Files: none"
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function workflowResultLine(label: string, value: string | undefined): string {
  return `- ${label}: ${value ?? "未执行"}`;
}

function countAgentFileChanges(run: StudioRun, agentCount: number): number {
  return run.steps.slice(0, agentCount).reduce((total, step) => total + (step.fileChanges?.length ?? 0), 0);
}

function hasAutoDelivery(input: RunStudioWorkflowInput): boolean {
  return Boolean(input.autoExportWeb || input.autoPackageWebZip || input.autoStartPreview);
}

export function buildWorkflowStartMessage(input: {
  projectId: string;
  userMessage: string;
  routes: Array<{ agent: AgentProfile; cliToolId: CliToolId }>;
}): AgentMessage {
  const goal = input.userMessage.trim().replace(/\s+/g, " ");
  const content = [
    "团队工作流已启动，AI 团队开始工作：",
    ...input.routes.map(
      ({ agent, cliToolId }, index) =>
        `${index + 1}. ${agent.title}（${CLI_TOOL_LABELS[cliToolId]}）— ${agent.specialty}`
    ),
    "",
    `目标：${goal.length > 200 ? `${goal.slice(0, 200)}…` : goal}`,
    "每个 Agent 的实时进度可在右侧「运行」面板查看，期间你可以继续输入新的要求。"
  ].join("\n");

  return {
    id: createMessageId(),
    projectId: input.projectId,
    agentId: "producer",
    role: "system",
    kind: "workflow",
    content,
    createdAt: new Date().toISOString()
  };
}

function buildWorkflowSummaryMessage(input: {
  projectId: string;
  run: StudioRun;
  exportResult?: GodotRunResult;
  inspectionResult?: WebBuildInspection;
  zipResult?: ExportResult;
  previewResult?: PreviewResult;
}): AgentMessage {
  const { projectId, run, exportResult, inspectionResult, zipResult, previewResult } = input;
  const failedSteps = run.steps.filter((step) => step.status === "failed").length;
  const inspectionSummary = inspectionResult
    ? inspectionResult.ok
      ? `完整，${inspectionResult.files.length} 个文件，${inspectionResult.totalBytes} bytes`
      : `不完整，缺失 ${inspectionResult.missingRequiredFiles.join(", ")}`
    : undefined;
  const content = [
    `团队工作流已${run.status === "completed" ? "完成" : "结束"}。`,
    `状态：${run.status}${failedSteps > 0 ? `，失败步骤 ${failedSteps} 个` : ""}`,
    "",
    "交付结果：",
    workflowResultLine("Godot Web 导出", exportResult ? (exportResult.ok ? "成功" : `失败，exitCode=${exportResult.exitCode ?? "unknown"}`) : undefined),
    workflowResultLine("Web 构建产物检查", inspectionSummary),
    workflowResultLine("Web zip", zipResult?.zipPath),
    workflowResultLine("导出清单", zipResult?.manifestPath),
    workflowResultLine("实时预览", previewResult?.url),
    "",
    run.summary ? `运行摘要：${run.summary}` : undefined,
    "下一步可以直接描述要修改的玩法、美术、难度或 bug，我会把上下文继续交给对应 Agent。"
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    id: createMessageId(),
    projectId,
    agentId: "producer",
    role: "system",
    kind: "workflow",
    content,
    createdAt: new Date().toISOString()
  };
}

export function buildWorkflowRunSteps(agents: AgentProfile[], tools: CliTool[], input: RunStudioWorkflowInput): Array<{
  title: string;
  agentId?: string;
  cliToolId?: CliToolId;
  message?: string;
}> {
  const programmer = agentById("programmer");
  return [
    ...agents.map((agent, index) => ({
      title: `${index + 1}. ${agent.title}：${agent.specialty}`,
      agentId: agent.id,
      cliToolId: chooseWorkflowCli(agent, tools, input),
      message: buildWorkflowMessage(agent, input.message, index)
    })),
    // Quality loop phases (验收闭环): validate → fix round → git save. The fix
    // round's real message is built at runtime from the QA / validation output.
    ...(input.withQualityLoop
      ? [
          {
            title: "Godot 可运行校验",
            message: "headless 校验项目能否正常加载与启动。"
          },
          {
            title: "修复与打磨",
            agentId: programmer.id,
            cliToolId: chooseWorkflowCli(programmer, tools, input),
            message: "根据 QA 反馈与校验结果修复问题（具体任务在运行时生成）。"
          },
          {
            title: "Git 保存版本",
            message: "提交本轮文件变更为一个 Git 版本。"
          }
        ]
      : []),
    ...(input.autoExportWeb
      ? [
          {
            title: "Godot Web 自动导出",
            message: "团队工作流结束后刷新 Web 构建。"
          }
        ]
      : []),
    ...(input.autoPackageWebZip
      ? [
          {
            title: "Web 构建产物检查",
            message: "确认 build/web 包含 index.html、wasm 和 pck。"
          },
          {
            title: "打包 Web zip",
            message: "把 build/web 压缩为可分享的 Web zip。"
          }
        ]
      : []),
    ...(input.autoStartPreview
      ? [
          {
            title: "刷新实时 Web 预览",
            message: "启动或复用本地预览服务器。"
          }
        ]
      : [])
  ];
}

export function isAgentWorkflowStepFailed(input: {
  cliToolId: CliToolId;
  tools: CliTool[];
  message?: AgentMessage;
}): boolean {
  if (!input.tools.some((tool) => tool.id === input.cliToolId && tool.installed && tool.status === "available")) {
    return true;
  }
  if (!input.message || input.message.role === "system") {
    return true;
  }
  return input.message.exitCode !== 0;
}

async function failQueuedDeliverySteps(input: {
  runService: RunService;
  runId: string;
  run: StudioRun;
  startIndex: number;
  message: string;
}): Promise<{ run: StudioRun; failedSteps: number }> {
  let latestRun = input.run;
  let failedSteps = 0;
  const deliverySteps = input.run.steps.slice(input.startIndex);

  for (const step of deliverySteps) {
    if (step.status !== "queued") {
      continue;
    }
    failedSteps += 1;
    latestRun = await input.runService.updateStep(input.runId, step.id, {
      status: "failed",
      message: input.message
    });
  }

  return { run: latestRun, failedSteps };
}

export class WorkflowService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly cliService: CliService,
    private readonly agentService: AgentService,
    private readonly godotService: GodotService,
    private readonly exportService: ExportService,
    private readonly autoPreviewService: AutoPreviewService,
    private readonly runService: RunService,
    private readonly gitService?: Pick<GitService, "commit">
  ) {}

  async run(input: RunStudioWorkflowInput): Promise<RunStudioWorkflowResult> {
    const project = await this.projectService.requireProject(input.projectId);
    const agentIds = input.agentIds?.length ? input.agentIds : DEFAULT_WORKFLOW_AGENTS;
    const agents = agentIds.map(agentById);
    const tools = await this.cliService.discover();
    const plog = getProjectLogger(project.rootPath);
    const workflowStartedAt = Date.now();
    plog.info("workflow", "团队工作流开始", {
      project: project.name,
      agents: agents.map((a) => a.title),
      cliRoutes: agents.map((agent) => ({
        agentId: agent.id,
        agent: agent.title,
        cliToolId: chooseWorkflowCli(agent, tools, input),
        cli: CLI_TOOL_LABELS[chooseWorkflowCli(agent, tools, input)]
      })),
      autoExportWeb: input.autoExportWeb,
      autoPackageWebZip: input.autoPackageWebZip,
      autoStartPreview: input.autoStartPreview,
    });

    const run = await this.runService.createRun({
      projectId: project.id,
      kind: "studio-workflow",
      title: "AI 游戏工作室团队工作流",
      steps: buildWorkflowRunSteps(agents, tools, input)
    });

    await this.runService.startRun(run.id, run.steps[0]?.id);
    // The chat is the user's primary view — announce the kickoff there with
    // the agent→CLI routing, not just in the run panel.
    await this.projectService.appendMessages(project.id, [
      buildWorkflowStartMessage({
        projectId: project.id,
        userMessage: input.message,
        routes: agents.map((agent) => ({ agent, cliToolId: chooseWorkflowCli(agent, tools, input) }))
      })
    ]);

    let latestRun: StudioRun = run;
    let exportResult: GodotRunResult | undefined;
    let inspectionResult: WebBuildInspection | undefined;
    let zipResult: ExportResult | undefined;
    let previewResult: PreviewResult | undefined;
    let failedSteps = 0;
    let failedAgentSteps = 0;
    // Quality-loop state: the QA Agent's verdict drives the fix round.
    let qaVerdict: QaVerdict = "unknown";
    let qaFindings = "";
    let qaCompleted = false;
    let fixFileChangeCount = 0;

    for (const [index, agent] of agents.entries()) {
      const step = latestRun.steps[index];
      if (!step) {
        continue;
      }
      await this.runService.updateStep(run.id, step.id, { status: "running" });
      const cliToolId = step.cliToolId ?? chooseWorkflowCli(agent, tools, input);
      const result = await this.agentService.runTurn(
        {
          projectId: project.id,
          agentId: agent.id,
          cliToolId,
          message: step.message ?? buildWorkflowMessage(agent, input.message, index),
          autoStartPreview: false
        },
        { recordRun: false, parentRunId: run.id, parentStepId: step.id }
      );
      if (await this.runService.isCancelled(run.id)) {
        return {
          project: await this.projectService.getProject(project.id),
          run: (await this.runService.getRun(run.id)) ?? latestRun
        };
      }
      const lastAgentMessage = [...result.messages]
        .reverse()
        .find((message) => message.agentId === agent.id && (message.role === "agent" || message.role === "system"));
      const stepFailed = isAgentWorkflowStepFailed({
        cliToolId,
        tools,
        message: lastAgentMessage
      });
      if (stepFailed) {
        failedSteps += 1;
        failedAgentSteps += 1;
      }
      if (agent.id === "qa" && lastAgentMessage && !stepFailed) {
        qaCompleted = true;
        qaVerdict = parseQaVerdict(lastAgentMessage.content);
        qaFindings = lastAgentMessage.content;
      }
      latestRun = await this.runService.updateStep(run.id, step.id, {
        status: stepFailed ? "failed" : "completed",
        cliToolId,
        exitCode: lastAgentMessage?.exitCode,
        message: stepFailed ? lastAgentMessage?.content ?? `${CLI_TOOL_LABELS[cliToolId]} 执行失败。` : `${agent.title} 已完成。`,
        ...(lastAgentMessage?.fileChanges ? { fileChanges: lastAgentMessage.fileChanges } : {})
      });
    }

    let stepCursor = agents.length;
    if (agents.length > 0 && failedAgentSteps === agents.length) {
      const skipped = await failQueuedDeliverySteps({
        runService: this.runService,
        runId: run.id,
        run: latestRun,
        startIndex: stepCursor,
        message: "所有 Agent 步骤都失败，已跳过后续 Web 导出、打包和预览，避免生成只包含旧模板的交付物。"
      });
      latestRun = skipped.run;
      failedSteps += skipped.failedSteps;
      latestRun = await this.runService.finishRun(
        run.id,
        "failed",
        `团队工作流结束，所有 ${failedAgentSteps} 个 Agent 步骤失败，已跳过自动交付步骤。`
      );
      plog.error("workflow", "团队工作流失败：所有 Agent 步骤失败", {
        project: project.name,
        failedAgentSteps,
        durationMs: Date.now() - workflowStartedAt,
      });
      await this.projectService.appendMessages(project.id, [
        buildWorkflowSummaryMessage({
          projectId: project.id,
          run: latestRun,
          exportResult,
          inspectionResult,
          zipResult,
          previewResult
        })
      ]);

      return {
        project: await this.projectService.getProject(project.id),
        run: latestRun,
        exportResult,
        inspectionResult,
        zipResult,
        previewResult
      };
    }

    if (hasAutoDelivery(input) && failedAgentSteps > 0) {
      const skipped = await failQueuedDeliverySteps({
        runService: this.runService,
        runId: run.id,
        run: latestRun,
        startIndex: stepCursor,
        message: `已有 ${failedAgentSteps} 个 Agent 步骤失败，已跳过后续 Web 导出、打包和预览，避免交付半成品。`
      });
      latestRun = skipped.run;
      failedSteps += skipped.failedSteps;
      latestRun = await this.runService.finishRun(
        run.id,
        "failed",
        `团队工作流结束，有 ${failedAgentSteps} 个 Agent 步骤失败，已跳过自动交付步骤。`
      );
      plog.warn("workflow", "团队工作流失败：部分 Agent 步骤失败", {
        project: project.name,
        failedAgentSteps,
        durationMs: Date.now() - workflowStartedAt,
      });
      await this.projectService.appendMessages(project.id, [
        buildWorkflowSummaryMessage({
          projectId: project.id,
          run: latestRun,
          exportResult,
          inspectionResult,
          zipResult,
          previewResult
        })
      ]);
      return {
        project: await this.projectService.getProject(project.id),
        run: latestRun,
        exportResult,
        inspectionResult,
        zipResult,
        previewResult
      };
    }

    const agentFileChangeCount = countAgentFileChanges(latestRun, agents.length);
    if (hasAutoDelivery(input) && agents.length > 0 && agentFileChangeCount === 0) {
      const skipped = await failQueuedDeliverySteps({
        runService: this.runService,
        runId: run.id,
        run: latestRun,
        startIndex: stepCursor,
        message: "Agent 步骤没有产生项目文件变更，已跳过 Web 导出、zip 打包和预览，避免交付旧模板。"
      });
      latestRun = skipped.run;
      failedSteps += skipped.failedSteps;
      latestRun = await this.runService.finishRun(
        run.id,
        "failed",
        "团队工作流结束，但 Agent 没有产生项目文件变更，已跳过自动交付步骤。"
      );
      plog.warn("workflow", "团队工作流失败：没有项目文件变更", {
        project: project.name,
        agents: agents.map((agent) => agent.title),
        agentFileChangeCount,
        durationMs: Date.now() - workflowStartedAt,
      });
      await this.projectService.appendMessages(project.id, [
        buildWorkflowSummaryMessage({
          projectId: project.id,
          run: latestRun,
          exportResult,
          inspectionResult,
          zipResult,
          previewResult
        })
      ]);

      return {
        project: await this.projectService.getProject(project.id),
        run: latestRun,
        exportResult,
        inspectionResult,
        zipResult,
        previewResult
      };
    }

    if (input.withQualityLoop) {
      if (await this.runService.isCancelled(run.id)) {
        return {
          project: await this.projectService.getProject(project.id),
          run: (await this.runService.getRun(run.id)) ?? latestRun
        };
      }

      // ── Godot 可运行校验 ──────────────────────────────────────────────
      // Informational gate: a failure feeds the fix round instead of failing
      // the workflow outright (the fix round re-validates).
      let validationResult: GodotRunResult | undefined;
      const validateStep = latestRun.steps[stepCursor++];
      if (validateStep) {
        await this.runService.updateStep(run.id, validateStep.id, { status: "running" });
        validationResult = await this.godotService.validate(project.id);
        latestRun = await this.runService.updateStep(run.id, validateStep.id, {
          status: validationResult.ok ? "completed" : "failed",
          exitCode: validationResult.exitCode ?? undefined,
          message: validationResult.ok
            ? "Godot 校验通过，项目可正常加载。"
            : "Godot 校验失败，错误已交给「修复与打磨」处理。",
          output: tailOf(validationResult.stderr || validationResult.stdout, 2000) || undefined
        });
      }
      const validationFailed = Boolean(validationResult && !validationResult.ok);

      // ── 修复与打磨（QA 反馈循环）──────────────────────────────────────
      const fixStep = latestRun.steps[stepCursor++];
      if (fixStep) {
        const needsFix = (qaCompleted && qaVerdict !== "pass") || validationFailed;
        if (!needsFix) {
          latestRun = await this.runService.updateStep(run.id, fixStep.id, {
            status: "skipped",
            message: qaCompleted
              ? "QA 结论为通过且校验正常，跳过修复轮。"
              : "没有 QA 反馈且校验正常，跳过修复轮。"
          });
        } else if (await this.runService.isCancelled(run.id)) {
          return {
            project: await this.projectService.getProject(project.id),
            run: (await this.runService.getRun(run.id)) ?? latestRun
          };
        } else {
          await this.runService.updateStep(run.id, fixStep.id, { status: "running" });
          const fixCli = fixStep.cliToolId ?? chooseWorkflowCli(agentById("programmer"), tools, input);
          const fixResult = await this.agentService.runTurn(
            {
              projectId: project.id,
              agentId: "programmer",
              cliToolId: fixCli,
              message: buildFixRoundMessage({
                userMessage: input.message,
                qaVerdict,
                qaFindings,
                validationFailed,
                validationOutput: validationResult
                  ? `${validationResult.stderr}\n${validationResult.stdout}`
                  : undefined
              }),
              autoStartPreview: false
            },
            { recordRun: false, parentRunId: run.id, parentStepId: fixStep.id }
          );
          const fixMessage = [...fixResult.messages]
            .reverse()
            .find((message) => message.agentId === "programmer" && (message.role === "agent" || message.role === "system"));
          const fixTurnFailed = isAgentWorkflowStepFailed({ cliToolId: fixCli, tools, message: fixMessage });
          fixFileChangeCount = fixMessage?.fileChanges?.length ?? 0;
          // Close the loop: when validation triggered the fix, re-validate.
          let revalidated: GodotRunResult | undefined;
          if (!fixTurnFailed && validationFailed) {
            revalidated = await this.godotService.validate(project.id);
          }
          const fixOk = !fixTurnFailed && (!validationFailed || revalidated?.ok === true);
          if (!fixOk) {
            failedSteps += 1;
          }
          latestRun = await this.runService.updateStep(run.id, fixStep.id, {
            status: fixOk ? "completed" : "failed",
            cliToolId: fixCli,
            exitCode: fixMessage?.exitCode,
            message: fixOk
              ? `修复完成${revalidated ? "，Godot 复检通过" : ""}（${fixFileChangeCount} 个文件变更）。`
              : fixTurnFailed
                ? fixMessage?.content ?? "修复轮执行失败。"
                : "修复后 Godot 复检仍失败，请展开校验输出查看错误。",
            ...(fixMessage?.fileChanges ? { fileChanges: fixMessage.fileChanges } : {})
          });
        }
      }

      // ── Git 保存版本 ─────────────────────────────────────────────────
      const gitStep = latestRun.steps[stepCursor++];
      if (gitStep) {
        const totalChanges = agentFileChangeCount + fixFileChangeCount;
        if (!this.gitService) {
          latestRun = await this.runService.updateStep(run.id, gitStep.id, {
            status: "skipped",
            message: "未配置 Git 服务，跳过版本保存。"
          });
        } else if (totalChanges === 0) {
          latestRun = await this.runService.updateStep(run.id, gitStep.id, {
            status: "skipped",
            message: "本轮没有项目文件变更，跳过 Git 保存。"
          });
        } else {
          await this.runService.updateStep(run.id, gitStep.id, { status: "running" });
          try {
            const commitMessage = `自动保存：团队工作流 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
            await this.gitService.commit({ projectId: project.id, message: commitMessage });
            await this.projectService.appendMessages(project.id, [
              {
                id: createMessageId(),
                projectId: project.id,
                agentId: "producer",
                role: "system",
                kind: "git",
                content: `已自动保存 Git 版本（${totalChanges} 个文件变更）：${commitMessage}`,
                createdAt: new Date().toISOString()
              }
            ]);
            latestRun = await this.runService.updateStep(run.id, gitStep.id, {
              status: "completed",
              message: `已保存 Git 版本（${totalChanges} 个文件变更）。`
            });
          } catch (error) {
            failedSteps += 1;
            latestRun = await this.runService.updateStep(run.id, gitStep.id, {
              status: "failed",
              message: `Git 保存失败：${error instanceof Error ? error.message : String(error)}`
            });
          }
        }
      }
    }

    if (input.autoExportWeb) {
      if (await this.runService.isCancelled(run.id)) {
        return {
          project: await this.projectService.getProject(project.id),
          run: (await this.runService.getRun(run.id)) ?? latestRun
        };
      }
      const exportStep = latestRun.steps[stepCursor++];
      if (exportStep) {
        await this.runService.updateStep(run.id, exportStep.id, { status: "running" });
        exportResult = await this.godotService.exportWeb(project.id);
        if (!exportResult.ok) {
          failedSteps += 1;
        }
        latestRun = await this.runService.updateStep(run.id, exportStep.id, {
          status: exportResult.ok ? "completed" : "failed",
          exitCode: exportResult.exitCode ?? undefined,
          message: exportResult.ok ? "Godot Web 导出完成。" : exportResult.stderr || exportResult.stdout || "Godot Web 导出失败。"
        });
      }
    }

    if (input.autoPackageWebZip) {
      if (await this.runService.isCancelled(run.id)) {
        return {
          project: await this.projectService.getProject(project.id),
          run: (await this.runService.getRun(run.id)) ?? latestRun,
          exportResult,
          inspectionResult,
          zipResult
        };
      }
      const inspectStep = latestRun.steps[stepCursor++];
      const zipStep = latestRun.steps[stepCursor++];
      let zipBlocked = false;
      if (inspectStep) {
        if (exportResult && !exportResult.ok) {
          zipBlocked = true;
          failedSteps += 1;
          latestRun = await this.runService.updateStep(run.id, inspectStep.id, {
            status: "failed",
            message: "Godot Web 导出失败，已跳过产物检查。"
          });
        } else {
          await this.runService.updateStep(run.id, inspectStep.id, { status: "running" });
          try {
            inspectionResult = await this.exportService.inspectWebBuild(project.id);
            if (!inspectionResult.ok) {
              zipBlocked = true;
              failedSteps += 1;
            }
            latestRun = await this.runService.updateStep(run.id, inspectStep.id, {
              status: inspectionResult.ok ? "completed" : "failed",
              output: inspectionOutput(inspectionResult),
              message: inspectionResult.message
            });
          } catch (error) {
            failedSteps += 1;
            zipBlocked = true;
            latestRun = await this.runService.updateStep(run.id, inspectStep.id, {
              status: "failed",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
      if (zipStep) {
        if (zipBlocked) {
          failedSteps += 1;
          latestRun = await this.runService.updateStep(run.id, zipStep.id, {
            status: "failed",
            message: exportResult && !exportResult.ok ? "Godot Web 导出失败，已跳过 zip 打包。" : "Web 构建产物检查失败，已跳过 zip 打包。"
          });
        } else {
          await this.runService.updateStep(run.id, zipStep.id, { status: "running" });
          try {
            zipResult = await this.exportService.zipWebBuild(project.id);
            inspectionResult = zipResult.inspection ?? inspectionResult;
            latestRun = await this.runService.updateStep(run.id, zipStep.id, {
              status: "completed",
              message: `Web zip 已生成：${zipResult.zipPath}`
            });
          } catch (error) {
            failedSteps += 1;
            latestRun = await this.runService.updateStep(run.id, zipStep.id, {
              status: "failed",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    if (input.autoStartPreview) {
      if (await this.runService.isCancelled(run.id)) {
        return {
          project: await this.projectService.getProject(project.id),
          run: (await this.runService.getRun(run.id)) ?? latestRun,
          exportResult,
          inspectionResult,
          zipResult
        };
      }

      const previewStep = latestRun.steps[stepCursor];
      if (previewStep) {
        await this.runService.updateStep(run.id, previewStep.id, { status: "running" });
        try {
          previewResult = await this.autoPreviewService.start(project.id, { exportFirst: false });
          latestRun = await this.runService.updateStep(run.id, previewStep.id, {
            status: "completed",
            message: `实时预览已启动：${previewResult.url}`
          });
        } catch (error) {
          failedSteps += 1;
          latestRun = await this.runService.updateStep(run.id, previewStep.id, {
            status: "failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    latestRun = await this.runService.finishRun(
      run.id,
      failedSteps > 0 ? "failed" : "completed",
      failedSteps > 0 ? `团队工作流完成，但有 ${failedSteps} 个步骤失败。` : "团队工作流完成，项目已推进到下一版。"
    );
    plog.log(failedSteps > 0 ? "warn" : "info", "workflow", `团队工作流结束(${latestRun.status})`, {
      project: project.name,
      failedSteps,
      durationMs: Date.now() - workflowStartedAt,
      webExport: exportResult ? (exportResult.ok ? "ok" : "failed") : "skipped",
      webZip: zipResult?.zipPath ? "ok" : "skipped",
      preview: previewResult?.url ?? "skipped",
    });
    await this.projectService.appendMessages(project.id, [
      buildWorkflowSummaryMessage({
        projectId: project.id,
        run: latestRun,
        exportResult,
        inspectionResult,
        zipResult,
        previewResult
      })
    ]);
    // Legacy auto-commit path; with the quality loop the visible "Git 保存版本"
    // step has already committed.
    if (!input.withQualityLoop && latestRun.status === "completed" && agentFileChangeCount > 0 && this.gitService) {
      try {
        const commitMessage = `自动保存：团队工作流 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
        await this.gitService.commit({
          projectId: project.id,
          message: commitMessage
        });
        await this.projectService.appendMessages(project.id, [
          {
            id: createMessageId(),
            projectId: project.id,
            agentId: "producer",
            role: "system",
            kind: "git",
            content: `已自动保存 Git 版本（${agentFileChangeCount} 个文件变更）：${commitMessage}`,
            createdAt: new Date().toISOString()
          }
        ]);
      } catch (error) {
        plog.warn("git", "团队工作流自动保存 Git 版本失败", {
          project: project.name,
          projectId: project.id,
          agentFileChangeCount,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      project: await this.projectService.getProject(project.id),
      run: latestRun,
      exportResult,
      inspectionResult,
      zipResult,
      previewResult
    };
  }
}
