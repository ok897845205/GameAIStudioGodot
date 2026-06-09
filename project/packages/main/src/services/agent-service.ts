import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type AgentAttachment,
  type AgentAttachmentInput,
  type AgentMessage,
  type AgentStreamEvent,
  type CliToolId,
  type RunAgentTurnInput,
  type RunAgentTurnResult
} from "@gameaistudio/shared";
import { AgentContextService, type AgentContextBundle } from "./agent-context-service";
import { appendAgentJournal, buildAgentJournalEntry } from "./agent-journal-service";
import { getProjectLogger } from "./logger";
import { createMessageId } from "./naming";
import { CliService } from "./cli-service";
import { ProjectFileChangeService } from "./project-file-change-service";
import { ProjectService } from "./project-service";
import { ProcessRegistry, type ProcessRunResult } from "./process-runner";
import { RunService } from "./run-service";

export function buildAgentPrompt(input: {
  agentId: string;
  projectName: string;
  projectPrompt: string;
  projectRoot: string;
  userMessage: string;
  context: AgentContextBundle;
  attachments?: AgentAttachment[];
}): string {
  const { agentId, projectName, projectPrompt, projectRoot, userMessage, context, attachments = [] } = input;
  const agent = AGENT_PROFILES.find((profile) => profile.id === agentId) ?? AGENT_PROFILES[0];
  const attachmentLines = attachments.length
    ? [
        "",
        "本轮图片附件：",
        ...attachments.map((attachment) => `- ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes): ${path.join(projectRoot, attachment.projectRelativePath)}`),
        "请把这些图片作为用户需求的一部分进行识别、理解和回应。"
      ]
    : [];
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
    "上下文读取：",
    `- 请先阅读 ${context.contextPath}，里面包含项目文件地图、最近对话、交付状态和响应契约。`,
    "- 不要依赖命令行参数里展开的完整上下文；完整上下文以该文件为准。",
    "本轮用户消息：",
    userMessage,
    ...attachmentLines
  ].join("\n");
}

function sanitizeAttachmentName(value: string): string {
  const trimmed = value.trim() || "image";
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 96);
}

function parseImageDataUrl(input: AgentAttachmentInput): { mimeType: string; bytes: Buffer } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(input.dataUrl);
  if (!match) {
    throw new Error(`图片附件格式无效：${input.name}`);
  }
  const mimeType = match[1] || input.mimeType;
  if (!mimeType.startsWith("image/")) {
    throw new Error(`只支持图片附件：${input.name}`);
  }
  return {
    mimeType,
    bytes: Buffer.from(match[2] ?? "", "base64")
  };
}

async function persistAttachments(projectRoot: string, attachments: AgentAttachmentInput[] = []): Promise<AgentAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }
  const attachmentRoot = path.join(projectRoot, ".gameaistudio", "attachments");
  await mkdir(attachmentRoot, { recursive: true });
  const persisted: AgentAttachment[] = [];

  for (const attachment of attachments) {
    const id = createMessageId();
    const { mimeType, bytes } = parseImageDataUrl(attachment);
    const safeName = sanitizeAttachmentName(attachment.name);
    const relativePath = path.join(".gameaistudio", "attachments", `${id}-${safeName}`).replace(/\\/g, "/");
    await writeFile(path.join(projectRoot, relativePath), bytes);
    persisted.push({
      id,
      kind: "image",
      name: safeName,
      mimeType,
      size: bytes.length,
      projectRelativePath: relativePath
    });
  }

  return persisted;
}

function processOutput(result: ProcessRunResult): string {
  return [
    result.stdout.trim(),
    result.stderr.trim() ? `\n--- stderr ---\n${result.stderr.trim()}` : ""
  ]
    .join("")
    .trim();
}

export function buildAgentProcessMessage(input: {
  toolLabel: string;
  toolId?: CliToolId;
  result: ProcessRunResult;
  fileChangeCount: number;
}): string {
  const output = processOutput(input.result);
  if (input.result.cancelled) {
    return "本轮 Agent 运行已取消。";
  }

  if (input.result.exitCode === 0) {
    if (output) {
      return output;
    }
    if (input.fileChangeCount > 0) {
      return `${input.toolLabel} CLI 已完成本轮运行，未输出文本，但检测到 ${input.fileChangeCount} 个项目文件变更。`;
    }
    return `${input.toolLabel} CLI 已结束但没有输出，也未检测到项目文件变更。请确认该 CLI 已登录，并支持非交互运行。`;
  }

  const reason = input.result.timedOut
    ? `${input.toolLabel} CLI 运行超时。`
    : `${input.toolLabel} CLI 执行失败（exitCode=${input.result.exitCode ?? "unknown"}）。`;
  const hint = buildCliFailureHint(input.toolId, output);
  if (output) {
    return `${reason}\n\n${output}${hint ? `\n\n${hint}` : ""}`;
  }
  return `${reason}\n\n没有返回可读输出。请在终端运行该 CLI，确认它已登录并支持非交互模式。`;
}

function buildCliFailureHint(toolId: CliToolId | undefined, output: string): string | undefined {
  if (!/(invalid bearer token|invalid_authentication_error|api key appears to be invalid|failed to authenticate)/i.test(output)) {
    return undefined;
  }
  if (toolId === "claude") {
    return "修复建议：Claude 交互界面能打开不一定代表 `claude --print` 可用。请在终端运行 `claude auth status` 检查状态；如果仍然 401，运行 `claude setup-token` 或重新登录后再刷新 GameAIStudio。";
  }
  if (toolId === "kimi") {
    return "修复建议：Kimi 非交互模式需要有效的 Kimi/Moonshot 认证。请在终端运行 `kimi login`，或配置有效的 `KIMI_API_KEY` / `MOONSHOT_API_KEY` 后再刷新 GameAIStudio。";
  }
  return "修复建议：该 CLI 非交互模式认证失败。请在终端用同样的非交互参数测试登录状态，再回到 GameAIStudio 刷新 CLI。";
}

export function buildAgentStepMessage(input: {
  agentTitle: string;
  result: ProcessRunResult;
  agentMessageContent: string;
}): string {
  if (input.result.cancelled) {
    return "用户已取消本轮 Agent 运行。";
  }
  if (input.result.exitCode === 0) {
    return `${input.agentTitle} 已完成本轮输出。`;
  }
  const firstLine = input.agentMessageContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? `${input.agentTitle} 执行失败。`;
}

function watchRunCancellation(input: {
  runId?: string;
  runService: RunService;
  processRegistry: ProcessRegistry;
  controller: AbortController;
}): () => void {
  if (!input.runId) {
    return () => undefined;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async (): Promise<void> => {
    if (stopped || input.controller.signal.aborted) {
      return;
    }
    if (await input.runService.isCancelled(input.runId!)) {
      input.controller.abort();
      input.processRegistry.cancelRun(input.runId!);
      return;
    }
    timer = setTimeout(() => {
      void tick();
    }, 350);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}

export class AgentService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly cliService: CliService,
    private readonly runService: RunService,
    private readonly processRegistry: ProcessRegistry,
    private readonly fileChangeService: ProjectFileChangeService,
    private readonly contextService: AgentContextService,
    private readonly emitStream: (event: AgentStreamEvent) => void = () => {}
  ) {}

  async runTurn(
    input: RunAgentTurnInput,
    options: { recordRun?: boolean; parentRunId?: string; parentStepId?: string } = {}
  ): Promise<RunAgentTurnResult> {
    const project = await this.projectService.requireProject(input.projectId);
    const agent = AGENT_PROFILES.find((profile) => profile.id === input.agentId) ?? AGENT_PROFILES[0];
    const plog = getProjectLogger(project.rootPath);
    const turnStartedAt = Date.now();
    plog.info("agent-turn", "开始", {
      project: project.name,
      agent: agent.title,
      cli: CLI_TOOL_LABELS[input.cliToolId],
      cliToolId: input.cliToolId,
      message: input.message.replace(/\s+/g, " ").slice(0, 200),
      attachments: input.attachments?.length ?? 0,
      parentRunId: options.parentRunId,
    });
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
    const attachments = await persistAttachments(project.rootPath, input.attachments);
    const userMessage: AgentMessage = {
      id: createMessageId(),
      projectId: project.id,
      agentId: input.agentId,
      role: "user",
      content: input.message,
      createdAt: now,
      cliToolId: input.cliToolId,
      attachments
    };

    const tools = await this.cliService.discover();
    const selectedTool = tools.find((tool) => tool.id === input.cliToolId);
    const unavailableMessage = !selectedTool?.installed
      ? `${CLI_TOOL_LABELS[input.cliToolId]} CLI 未检测到。请先安装或加入 PATH。\n建议命令：${selectedTool?.installCommand.join(" ") ?? "查看 CLI 设置"}`
      : selectedTool.status !== "available"
        ? `${selectedTool.label} CLI 当前不可用，暂不执行 Agent 回合。\n${selectedTool.health.detail ?? "请先在设置中查看分层健康状态，修复登录或非交互模式后刷新 CLI。"}`
        : attachments.length > 0 && !selectedTool.capabilities.supportsImages
          ? `${selectedTool.label} Adapter 不支持图片输入。请移除图片附件，或切换到支持图片的 CLI。`
          : undefined;
    if (unavailableMessage) {
      plog.warn("agent-turn", "CLI 不可用，跳过执行", {
        agent: agent.title,
        cli: CLI_TOOL_LABELS[input.cliToolId],
        reason: unavailableMessage.split(/\r?\n/)[0],
      });
      const missingMessage: AgentMessage = {
        id: createMessageId(),
        projectId: project.id,
        agentId: input.agentId,
        role: "system",
        content: unavailableMessage,
        createdAt: new Date().toISOString(),
        cliToolId: input.cliToolId
      };
      const messages = await this.projectService.appendMessages(project.id, [userMessage, missingMessage]);
      await appendAgentJournal(
        project.rootPath,
        buildAgentJournalEntry({
          project,
          agentId: input.agentId,
          cliToolId: input.cliToolId,
          userMessage: input.message,
          agentMessage: missingMessage,
          status: "failed",
          fileChanges: []
        })
      ).catch(() => undefined);
      if (run && stepId) {
        await this.runService.updateStep(run.id, stepId, {
          status: "failed",
          message: missingMessage.content
        });
        await this.runService.finishRun(run.id, "failed", unavailableMessage.split(/\r?\n/)[0]);
      }
      return {
        project: await this.projectService.getProject(project.id),
        messages,
        runs: await this.runService.listRuns(project.id)
      };
    }

    const attachmentContext = attachments.length
      ? `${input.message}\n\n图片附件：\n${attachments.map((attachment) => `- ${attachment.name}: ${path.join(project.rootPath, attachment.projectRelativePath)}`).join("\n")}`
      : input.message;
    const context = await this.contextService.prepare({
      project: await this.projectService.getProject(project.id),
      agentId: input.agentId,
      userMessage: attachmentContext
    });
    const prompt = buildAgentPrompt({
      agentId: input.agentId,
      projectName: project.name,
      projectPrompt: project.prompt,
      projectRoot: project.rootPath,
      userMessage: input.message,
      context,
      attachments
    });
    const beforeFiles = await this.fileChangeService.createSnapshot(project.rootPath);
    // Stable id for the in-flight assistant message: emitted with each stream
    // delta and reused as the final message id so the streaming bubble and the
    // persisted message are the same node (no flicker on settle).
    const streamingMessageId = createMessageId();
    const controller = new AbortController();
    const stopCancellationWatcher = watchRunCancellation({
      runId: outputRunId,
      runService: this.runService,
      processRegistry: this.processRegistry,
      controller
    });
    let outputTail = "";
    let lastOutputFlushAt = 0;
    let outputFlush = Promise.resolve();
    let streamedStdout = "";
    let streamedStderr = "";
    let finalStdout = "";
    let finalStderr = "";
    let adapterError = "";
    let exitCode: number | null = null;
    let durationMs = 0;
    let cancelled = false;
    let timedOut = false;

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

    try {
      for await (const chunk of this.cliService.runTurn(input.cliToolId, {
        prompt,
        workingDir: project.rootPath,
        contextPath: context.contextPath,
        images: attachments.map((attachment, index) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: input.attachments?.[index]?.dataUrl ?? "",
          path: path.join(project.rootPath, attachment.projectRelativePath)
        })),
        signal: controller.signal
      })) {
        switch (chunk.type) {
          case "text-delta":
            streamedStdout += chunk.text;
            scheduleOutputFlush(chunk.text);
            this.emitStream({
              projectId: project.id,
              agentId: input.agentId,
              messageId: streamingMessageId,
              delta: chunk.text,
              done: false
            });
            break;
          case "stderr-delta":
            streamedStderr += chunk.text;
            scheduleOutputFlush(chunk.text);
            break;
          case "step":
            scheduleOutputFlush(`\n[${chunk.title}]\n`);
            break;
          case "error":
            adapterError = adapterError ? `${adapterError}\n${chunk.error}` : chunk.error;
            scheduleOutputFlush(`\n${chunk.error}\n`);
            break;
          case "final":
            finalStdout = chunk.content;
            finalStderr = chunk.stderr ?? "";
            exitCode = chunk.exitCode;
            durationMs = chunk.durationMs;
            cancelled = Boolean(chunk.cancelled);
            timedOut = Boolean(chunk.timedOut);
            break;
        }
      }
    } catch (error) {
      adapterError = error instanceof Error ? error.message : String(error);
      scheduleOutputFlush(`\n${adapterError}\n`);
    } finally {
      stopCancellationWatcher();
      this.emitStream({
        projectId: project.id,
        agentId: input.agentId,
        messageId: streamingMessageId,
        delta: "",
        done: true
      });
    }

    const result: ProcessRunResult = {
      exitCode,
      stdout: finalStdout || streamedStdout,
      stderr: finalStderr || streamedStderr || adapterError,
      durationMs,
      cancelled: cancelled || controller.signal.aborted,
      timedOut
    };
    const finalVisibleOutput = processOutput(result);
    if (finalVisibleOutput && finalVisibleOutput !== outputTail.trim()) {
      outputTail = finalVisibleOutput.slice(-6000);
    }
    if (outputRunId && outputStepId && outputTail) {
      outputFlush = outputFlush
        .then(() => this.runService.updateStep(outputRunId, outputStepId, { output: outputTail, outputUpdatedAt: new Date().toISOString() }))
        .then(() => undefined)
        .catch(() => undefined);
      await outputFlush;
    }
    const afterFiles = await this.fileChangeService.createSnapshot(project.rootPath);
    const fileChanges = this.fileChangeService.compareSnapshots(beforeFiles, afterFiles);

    const agentMessage: AgentMessage = {
      id: streamingMessageId,
      projectId: project.id,
      agentId: input.agentId,
      role: "agent",
      content: buildAgentProcessMessage({
        toolLabel: CLI_TOOL_LABELS[input.cliToolId],
        toolId: input.cliToolId,
        result,
        fileChangeCount: fileChanges.length
      }),
      createdAt: new Date().toISOString(),
      cliToolId: input.cliToolId,
      exitCode: result.exitCode ?? undefined,
      durationMs: result.durationMs,
      fileChanges
    };

    const updatedProject = await this.projectService.updateProject({
      ...project,
      activeAgentId: input.agentId
    });
    const messages = await this.projectService.appendMessages(project.id, [userMessage, agentMessage]);
    const succeeded = result.exitCode === 0;
    const turnStatus = result.cancelled ? "cancelled" : succeeded ? "completed" : "failed";
    plog.log(turnStatus === "failed" ? "error" : "info", "agent-turn", `结束(${turnStatus})`, {
      agent: agent.title,
      cli: CLI_TOOL_LABELS[input.cliToolId],
      exitCode: result.exitCode ?? null,
      durationMs: Date.now() - turnStartedAt,
      cliDurationMs: result.durationMs,
      timedOut: result.timedOut,
      fileChanges: fileChanges.length,
      stderr: turnStatus === "failed" ? result.stderr.trim().slice(-800) || undefined : undefined,
    });
    await appendAgentJournal(
      project.rootPath,
      buildAgentJournalEntry({
        project: updatedProject,
        agentId: input.agentId,
        cliToolId: input.cliToolId,
        userMessage: input.message,
        agentMessage,
        status: result.cancelled ? "cancelled" : succeeded ? "completed" : "failed",
        fileChanges,
        contextPath: context.contextPath
      })
    ).catch(() => undefined);
    if (run && stepId) {
      await this.runService.updateStep(run.id, stepId, {
        status: result.cancelled ? "cancelled" : succeeded ? "completed" : "failed",
        exitCode: result.exitCode ?? undefined,
        fileChanges,
        message: buildAgentStepMessage({
          agentTitle: agent.title,
          result,
          agentMessageContent: agentMessage.content
        })
      });
      await this.runService.finishRun(run.id, result.cancelled ? "cancelled" : succeeded ? "completed" : "failed", agentMessage.content.slice(0, 240));
    } else if (outputRunId && outputStepId) {
      await this.runService.updateStep(outputRunId, outputStepId, { fileChanges });
    }

    return {
      project: await this.projectService.getProject(updatedProject.id),
      messages,
      runs: await this.runService.listRuns(project.id)
    };
  }
}
