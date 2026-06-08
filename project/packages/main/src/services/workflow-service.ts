import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type AgentProfile,
  type CliTool,
  type CliToolId,
  type GodotRunResult,
  type PreviewResult,
  type RunStudioWorkflowInput,
  type RunStudioWorkflowResult,
  type StudioRun
} from "@gameaistudio/shared";
import { AgentService } from "./agent-service";
import { AutoPreviewService } from "./auto-preview-service";
import { CliService } from "./cli-service";
import { GodotService } from "./godot-service";
import { ProjectService } from "./project-service";
import { RunService } from "./run-service";

const DEFAULT_WORKFLOW_AGENTS = ["producer", "designer", "programmer", "artist", "qa"];

function agentById(agentId: string): AgentProfile {
  return AGENT_PROFILES.find((agent) => agent.id === agentId) ?? AGENT_PROFILES[0];
}

function chooseCli(agent: AgentProfile, tools: CliTool[], preferredCliToolId?: CliToolId): CliToolId {
  const preferred = preferredCliToolId ? tools.find((tool) => tool.id === preferredCliToolId && tool.installed) : undefined;
  const defaultTool = tools.find((tool) => tool.id === agent.defaultCli && tool.installed);
  const fallback = tools.find((tool) => tool.installed);
  return preferred?.id ?? defaultTool?.id ?? fallback?.id ?? preferredCliToolId ?? agent.defaultCli;
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

export class WorkflowService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly cliService: CliService,
    private readonly agentService: AgentService,
    private readonly godotService: GodotService,
    private readonly autoPreviewService: AutoPreviewService,
    private readonly runService: RunService
  ) {}

  async run(input: RunStudioWorkflowInput): Promise<RunStudioWorkflowResult> {
    const project = await this.projectService.requireProject(input.projectId);
    const agentIds = input.agentIds?.length ? input.agentIds : DEFAULT_WORKFLOW_AGENTS;
    const agents = agentIds.map(agentById);
    const tools = await this.cliService.discover();

    const run = await this.runService.createRun({
      projectId: project.id,
      kind: "studio-workflow",
      title: "AI 游戏工作室团队工作流",
      steps: [
        ...agents.map((agent, index) => ({
          title: `${index + 1}. ${agent.title}：${agent.specialty}`,
          agentId: agent.id,
          cliToolId: chooseCli(agent, tools, input.preferredCliToolId),
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
        ...(input.autoStartPreview
          ? [
              {
                title: "刷新实时 Web 预览",
                message: "启动或复用本地预览服务器。"
              }
            ]
          : [])
      ]
    });

    await this.runService.startRun(run.id, run.steps[0]?.id);

    let latestRun: StudioRun = run;
    let exportResult: GodotRunResult | undefined;
    let previewResult: PreviewResult | undefined;
    let failedSteps = 0;

    for (const [index, agent] of agents.entries()) {
      const step = latestRun.steps[index];
      if (!step) {
        continue;
      }
      await this.runService.updateStep(run.id, step.id, { status: "running" });
      const cliToolId = step.cliToolId ?? chooseCli(agent, tools, input.preferredCliToolId);
      const result = await this.agentService.runTurn(
        {
          projectId: project.id,
          agentId: agent.id,
          cliToolId,
          message: step.message ?? buildWorkflowMessage(agent, input.message, index)
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
      const stepFailed = !tools.some((tool) => tool.id === cliToolId && tool.installed) || (lastAgentMessage?.exitCode ?? 0) !== 0;
      if (stepFailed) {
        failedSteps += 1;
      }
      latestRun = await this.runService.updateStep(run.id, step.id, {
        status: stepFailed ? "failed" : "completed",
        cliToolId,
        exitCode: lastAgentMessage?.exitCode,
        message: stepFailed ? lastAgentMessage?.content ?? `${CLI_TOOL_LABELS[cliToolId]} 执行失败。` : `${agent.title} 已完成。`
      });
    }

    let stepCursor = agents.length;
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

    if (input.autoStartPreview) {
      if (await this.runService.isCancelled(run.id)) {
        return {
          project: await this.projectService.getProject(project.id),
          run: (await this.runService.getRun(run.id)) ?? latestRun,
          exportResult
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

    return {
      project: await this.projectService.getProject(project.id),
      run: latestRun,
      exportResult,
      previewResult
    };
  }
}
