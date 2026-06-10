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
    qa: "检查当前版本是否满足原始需求，指出缺陷、风险和下一轮修复建议。"
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
  return [
    ...agents.map((agent, index) => ({
      title: `${index + 1}. ${agent.title}：${agent.specialty}`,
      agentId: agent.id,
      cliToolId: chooseWorkflowCli(agent, tools, input),
      message: buildWorkflowMessage(agent, input.message, index)
    })),
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

    let latestRun: StudioRun = run;
    let exportResult: GodotRunResult | undefined;
    let inspectionResult: WebBuildInspection | undefined;
    let zipResult: ExportResult | undefined;
    let previewResult: PreviewResult | undefined;
    let failedSteps = 0;
    let failedAgentSteps = 0;

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
    if (latestRun.status === "completed" && agentFileChangeCount > 0 && this.gitService) {
      try {
        await this.gitService.commit({
          projectId: project.id,
          message: `自动保存：团队工作流 ${new Date().toLocaleString("zh-CN", { hour12: false })}`
        });
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
