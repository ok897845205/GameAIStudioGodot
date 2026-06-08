import { AGENT_PROFILES, CLI_TOOL_LABELS, type AgentMessage, type CliToolId, type RunAgentTurnInput, type RunAgentTurnResult } from "@gameaistudio/shared";
import { AgentContextService, type AgentContextBundle } from "./agent-context-service";
import { createMessageId } from "./naming";
import { CliService } from "./cli-service";
import { ProjectFileChangeService } from "./project-file-change-service";
import { ProjectService } from "./project-service";
import { ProjectSnapshotService } from "./project-snapshot-service";
import { ProcessRegistry, runProcess } from "./process-runner";
import { RunService } from "./run-service";

function buildPrompt(input: {
  agentId: string;
  projectName: string;
  projectPrompt: string;
  projectRoot: string;
  userMessage: string;
  context: AgentContextBundle;
}): string {
  const { agentId, projectName, projectPrompt, projectRoot, userMessage, context } = input;
  const agent = AGENT_PROFILES.find((profile) => profile.id === agentId) ?? AGENT_PROFILES[0];
  return [
    agent.systemPrompt,
    "",
    "你正在 GameAIStudio 桌面应用中工作。",
    `项目名称：${projectName}`,
    `用户原始需求：${projectPrompt}`,
    `Godot 项目目录：${projectRoot}`,
    `Agent 上下文文件：${context.contextPath}`,
    "",
    "工作约束：",
    "- 只在这个 Godot 项目目录内创建或修改文件。",
    "- 先阅读或遵循 Agent 上下文文件中的项目文件地图、最近对话和交付要求。",
    "- 优先交付一个可预览、可导出的最小可玩版本；程序类任务要尽量直接修改 Godot 文件。",
    "- 如需运行命令，说明命令和目的；如果当前 CLI 不能执行命令，也要给出可继续的具体文件级改动方案。",
    "- 回答末尾给出完成内容、涉及文件、未完成风险、下一步建议。",
    "",
    "当前 Agent 上下文快照：",
    context.markdown,
    "",
    "本轮用户消息：",
    userMessage
  ].join("\n");
}

export class AgentService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly cliService: CliService,
    private readonly runService: RunService,
    private readonly processRegistry: ProcessRegistry,
    private readonly fileChangeService: ProjectFileChangeService,
    private readonly snapshotService: ProjectSnapshotService,
    private readonly contextService: AgentContextService
  ) {}

  async runTurn(
    input: RunAgentTurnInput,
    options: { recordRun?: boolean; parentRunId?: string; parentStepId?: string } = {}
  ): Promise<RunAgentTurnResult> {
    const project = await this.projectService.requireProject(input.projectId);
    const agent = AGENT_PROFILES.find((profile) => profile.id === input.agentId) ?? AGENT_PROFILES[0];
    const shouldRecordRun = options.recordRun !== false;
    const run = shouldRecordRun
      ? await this.runService.createRun({
          projectId: project.id,
          kind: "agent-turn",
          title: `${agent.title} Agent 回合`,
          steps: [
            {
              title: `${agent.title} 调用 ${CLI_TOOL_LABELS[input.cliToolId]}`,
              agentId: input.agentId,
              cliToolId: input.cliToolId,
              message: input.message
            }
          ]
        })
      : undefined;
    const stepId = run?.steps[0]?.id;
    const outputRunId = run?.id ?? options.parentRunId;
    const outputStepId = stepId ?? options.parentStepId;
    if (run && stepId) {
      await this.runService.startRun(run.id, stepId);
      await this.runService.updateStep(run.id, stepId, { status: "running" });
    }

    const now = new Date().toISOString();
    const userMessage: AgentMessage = {
      id: createMessageId(),
      projectId: project.id,
      agentId: input.agentId,
      role: "user",
      content: input.message,
      createdAt: now,
      cliToolId: input.cliToolId
    };

    const tools = await this.cliService.discover();
    const selectedTool = tools.find((tool) => tool.id === input.cliToolId);
    if (!selectedTool?.installed) {
      const missingMessage: AgentMessage = {
        id: createMessageId(),
        projectId: project.id,
        agentId: input.agentId,
        role: "system",
        content: `${CLI_TOOL_LABELS[input.cliToolId]} CLI 未检测到。请先安装或加入 PATH。\n建议命令：${selectedTool?.installCommand.join(" ") ?? "查看 CLI 设置"}`,
        createdAt: new Date().toISOString(),
        cliToolId: input.cliToolId
      };
      const messages = await this.projectService.appendMessages(project.id, [userMessage, missingMessage]);
      if (run && stepId) {
        await this.runService.updateStep(run.id, stepId, {
          status: "failed",
          message: missingMessage.content
        });
        await this.runService.finishRun(run.id, "failed", `${CLI_TOOL_LABELS[input.cliToolId]} CLI 未检测到。`);
      }
      return {
        project: await this.projectService.getProject(project.id),
        messages,
        runs: await this.runService.listRuns(project.id),
        snapshots: await this.snapshotService.list(project.id)
      };
    }

    const context = await this.contextService.prepare({
      project: await this.projectService.getProject(project.id),
      agentId: input.agentId,
      userMessage: input.message
    });
    const prompt = buildPrompt({
      agentId: input.agentId,
      projectName: project.name,
      projectPrompt: project.prompt,
      projectRoot: project.rootPath,
      userMessage: input.message,
      context
    });
    const command = this.cliService.buildAgentCommand(input.cliToolId, prompt);
    await this.snapshotService.create({
      projectId: project.id,
      label: `${agent.title} 运行前`,
      reason: `before-agent:${agent.id}`
    });
    const beforeFiles = await this.fileChangeService.createSnapshot(project.rootPath);
    let outputTail = "";
    let lastOutputFlushAt = 0;
    let outputFlush = Promise.resolve();

    const scheduleOutputFlush = (chunk: string): void => {
      outputTail = `${outputTail}${chunk}`.slice(-6000);
      if (!outputRunId || !outputStepId) {
        return;
      }
      const nowMs = Date.now();
      if (nowMs - lastOutputFlushAt < 650) {
        return;
      }
      lastOutputFlushAt = nowMs;
      const tail = outputTail;
      outputFlush = outputFlush
        .then(() => this.runService.updateStep(outputRunId, outputStepId, { output: tail, outputUpdatedAt: new Date().toISOString() }))
        .then(() => undefined)
        .catch(() => undefined);
    };

    const result = await runProcess(command.command, command.args, {
      cwd: project.rootPath,
      timeoutMs: 15 * 60 * 1000,
      processKey: outputRunId && outputStepId ? `${outputRunId}:${outputStepId}` : undefined,
      registry: this.processRegistry,
      onStdout: scheduleOutputFlush,
      onStderr: scheduleOutputFlush
    });
    if (outputRunId && outputStepId && outputTail) {
      outputFlush = outputFlush
        .then(() => this.runService.updateStep(outputRunId, outputStepId, { output: outputTail, outputUpdatedAt: new Date().toISOString() }))
        .then(() => undefined)
        .catch(() => undefined);
      await outputFlush;
    }
    const afterFiles = await this.fileChangeService.createSnapshot(project.rootPath);
    const fileChanges = this.fileChangeService.compareSnapshots(beforeFiles, afterFiles);

    const content = [
      result.stdout.trim(),
      result.stderr.trim() ? `\n--- stderr ---\n${result.stderr.trim()}` : ""
    ]
      .join("")
      .trim();

    const agentMessage: AgentMessage = {
      id: createMessageId(),
      projectId: project.id,
      agentId: input.agentId,
      role: "agent",
      content: result.cancelled ? "本轮 Agent 运行已取消。" : content || `${CLI_TOOL_LABELS[input.cliToolId]} 本轮没有输出。`,
      createdAt: new Date().toISOString(),
      cliToolId: input.cliToolId,
      exitCode: result.exitCode ?? undefined,
      durationMs: result.durationMs
    };

    const updatedProject = await this.projectService.updateProject({
      ...project,
      activeAgentId: input.agentId
    });
    const messages = await this.projectService.appendMessages(project.id, [userMessage, agentMessage]);
    const succeeded = result.exitCode === 0;
    if (succeeded && fileChanges.length > 0) {
      await this.snapshotService.create({
        projectId: project.id,
        label: `${agent.title} 完成后`,
        reason: `after-agent:${agent.id}`
      });
    }
    if (run && stepId) {
      await this.runService.updateStep(run.id, stepId, {
        status: result.cancelled ? "cancelled" : succeeded ? "completed" : "failed",
        exitCode: result.exitCode ?? undefined,
        fileChanges,
        message: result.cancelled
          ? "用户已取消本轮 Agent 运行。"
          : succeeded
            ? `${agent.title} 已完成本轮输出。`
            : result.stderr || result.stdout || `${agent.title} 执行失败。`
      });
      await this.runService.finishRun(run.id, result.cancelled ? "cancelled" : succeeded ? "completed" : "failed", agentMessage.content.slice(0, 240));
    } else if (outputRunId && outputStepId) {
      await this.runService.updateStep(outputRunId, outputStepId, { fileChanges });
    }

    return {
      project: await this.projectService.getProject(updatedProject.id),
      messages,
      runs: await this.runService.listRuns(project.id),
      snapshots: await this.snapshotService.list(project.id)
    };
  }
}
