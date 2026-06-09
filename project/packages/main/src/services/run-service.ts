import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type CliToolId,
  type StudioRun,
  type StudioRunEvent,
  type StudioRunKind,
  type StudioRunStatus,
  type StudioRunStep
} from "@gameaistudio/shared";
import { getProjectLogger } from "./logger";
import { createRunId, createRunStepId } from "./naming";
import { StudioStore } from "./store";

export type RunEventSink = (event: StudioRunEvent) => void;
export type RunLogProjectResolver = (projectId: string) => Promise<{ id: string; name: string; rootPath: string } | undefined>;

interface CreateRunInput {
  projectId: string;
  kind: StudioRunKind;
  title: string;
  steps: Array<Omit<StudioRunStep, "id" | "status"> & { id?: string; status?: StudioRunStatus }>;
}

export class RunService {
  constructor(
    private readonly store: StudioStore,
    private readonly emit: RunEventSink = () => {},
    private readonly resolveProjectForLogs?: RunLogProjectResolver
  ) {}

  async listRuns(projectId: string): Promise<StudioRun[]> {
    return this.store.listRuns(projectId);
  }

  async createRun(input: CreateRunInput): Promise<StudioRun> {
    const now = new Date().toISOString();
    const run: StudioRun = {
      id: createRunId(),
      projectId: input.projectId,
      kind: input.kind,
      title: input.title,
      status: "queued",
      steps: input.steps.map((step) => ({
        ...step,
        id: step.id ?? createRunStepId(),
        status: step.status ?? "queued"
      })),
      createdAt: now,
      updatedAt: now
    };
    await this.saveAndEmit("created", run);
    void this.logRun(run, "info", "运行已创建", {
      kind: run.kind,
      title: run.title,
      status: run.status,
      stepCount: run.steps.length,
      steps: run.steps.map((step) => this.stepSummary(step))
    });
    return run;
  }

  async startRun(runId: string, currentStepId?: string): Promise<StudioRun> {
    const run = await this.requireRun(runId);
    const updated = await this.patchRun(run, {
      status: "running",
      currentStepId
    });
    void this.logRun(updated, "info", "运行已启动", {
      kind: updated.kind,
      title: updated.title,
      currentStepId,
      currentStep: updated.steps.find((step) => step.id === currentStepId)?.title
    });
    return updated;
  }

  async updateStep(runId: string, stepId: string, patch: Partial<StudioRunStep>): Promise<StudioRun> {
    const run = await this.requireRun(runId);
    const beforeStep = run.steps.find((step) => step.id === stepId);
    const now = new Date().toISOString();
    const steps = run.steps.map((step) => {
      if (step.id !== stepId) {
        return step;
      }
      const startedAt = patch.status === "running" && !step.startedAt ? now : step.startedAt;
      const completedAt =
        (patch.status === "completed" || patch.status === "failed" || patch.status === "cancelled") && !patch.completedAt
          ? now
          : patch.completedAt ?? step.completedAt;
      const durationMs = startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : patch.durationMs ?? step.durationMs;
      return {
        ...step,
        ...patch,
        startedAt,
        completedAt,
        durationMs
      };
    });

    const updated = await this.patchRun(run, {
      steps,
      currentStepId: patch.status === "running" ? stepId : run.currentStepId
    });
    const afterStep = updated.steps.find((step) => step.id === stepId);
    if (beforeStep && afterStep) {
      void this.logStepUpdate(updated, beforeStep, afterStep, patch);
    }
    return updated;
  }

  async appendStepOutput(runId: string, stepId: string, chunk: string, maxLength = 6000): Promise<StudioRun> {
    const run = await this.requireRun(runId);
    const steps = run.steps.map((step) => {
      if (step.id !== stepId) {
        return step;
      }
      const output = `${step.output ?? ""}${chunk}`.slice(-maxLength);
      return {
        ...step,
        output,
        outputUpdatedAt: new Date().toISOString()
      };
    });
    const updated = await this.patchRun(run, { steps });
    const afterStep = updated.steps.find((step) => step.id === stepId);
    if (afterStep) {
      void this.logRun(updated, "debug", "运行步骤输出追加", {
        kind: updated.kind,
        title: updated.title,
        stepId: afterStep.id,
        stepTitle: afterStep.title,
        agentId: afterStep.agentId,
        agent: this.agentTitle(afterStep.agentId),
        cliToolId: afterStep.cliToolId,
        cli: afterStep.cliToolId ? CLI_TOOL_LABELS[afterStep.cliToolId as CliToolId] : undefined,
        chunkLength: chunk.length,
        outputTail: this.shortText(afterStep.output, 1600),
        outputLength: afterStep.output?.length
      });
    }
    return updated;
  }

  async finishRun(runId: string, status: Extract<StudioRunStatus, "completed" | "failed" | "cancelled">, summary?: string): Promise<StudioRun> {
    const run = await this.requireRun(runId);
    const updated = await this.patchRun(run, {
      status,
      summary,
      currentStepId: undefined,
      completedAt: new Date().toISOString()
    });
    void this.logRun(updated, status === "failed" ? "warn" : status === "cancelled" ? "warn" : "info", `运行已结束(${status})`, {
      kind: updated.kind,
      title: updated.title,
      status: updated.status,
      summary,
      failedSteps: updated.steps.filter((step) => step.status === "failed").length,
      completedSteps: updated.steps.filter((step) => step.status === "completed").length,
      cancelledSteps: updated.steps.filter((step) => step.status === "cancelled").length
    });
    return updated;
  }

  async cancelRun(runId: string, summary = "用户已取消运行。"): Promise<StudioRun> {
    const run = await this.requireRun(runId);
    const now = new Date().toISOString();
    const steps = run.steps.map((step) => {
      if (step.status !== "running" && step.status !== "queued") {
        return step;
      }
      return {
        ...step,
        status: "cancelled" as const,
        message: step.status === "running" ? "正在取消本地 CLI 进程。" : "已跳过。",
        completedAt: now,
        durationMs: step.startedAt ? Date.parse(now) - Date.parse(step.startedAt) : step.durationMs
      };
    });

    const updated = await this.patchRun(run, {
      status: "cancelled",
      steps,
      currentStepId: undefined,
      summary,
      completedAt: now
    });
    void this.logRun(updated, "warn", "运行已取消", {
      kind: updated.kind,
      title: updated.title,
      summary,
      cancelledSteps: updated.steps.filter((step) => step.status === "cancelled").length
    });
    return updated;
  }

  async getRun(runId: string): Promise<StudioRun | undefined> {
    return this.store.getRun(runId);
  }

  async isCancelled(runId: string): Promise<boolean> {
    const run = await this.store.getRun(runId);
    return run?.status === "cancelled";
  }

  private async requireRun(runId: string): Promise<StudioRun> {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }

  private async patchRun(run: StudioRun, patch: Partial<StudioRun>): Promise<StudioRun> {
    const updated: StudioRun = {
      ...run,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await this.saveAndEmit("updated", updated);
    return updated;
  }

  private async saveAndEmit(type: StudioRunEvent["type"], run: StudioRun): Promise<void> {
    await this.store.upsertRun(run);
    this.emit({ type, run });
  }

  private async logRun(run: StudioRun, level: "debug" | "info" | "warn" | "error", message: string, meta: Record<string, unknown>): Promise<void> {
    if (!this.resolveProjectForLogs) {
      return;
    }
    try {
      const project = await this.resolveProjectForLogs(run.projectId);
      if (!project) {
        return;
      }
      getProjectLogger(project.rootPath).log(level, "run", message, {
        projectId: project.id,
        project: project.name,
        runId: run.id,
        ...meta
      });
    } catch {
      // Run logging must not interfere with the actual workflow.
    }
  }

  private logStepUpdate(
    run: StudioRun,
    beforeStep: StudioRunStep,
    afterStep: StudioRunStep,
    patch: Partial<StudioRunStep>
  ): Promise<void> | undefined {
    const statusChanged = beforeStep.status !== afterStep.status;
    const hasImportantPatch =
      patch.message !== undefined ||
      patch.exitCode !== undefined ||
      patch.fileChanges !== undefined ||
      patch.status === "completed" ||
      patch.status === "failed" ||
      patch.status === "cancelled";
    const outputChanged = patch.output !== undefined || patch.outputUpdatedAt !== undefined;

    if (!statusChanged && !hasImportantPatch && !outputChanged) {
      return undefined;
    }

    const terminal = afterStep.status === "completed" || afterStep.status === "failed" || afterStep.status === "cancelled";
    const level =
      afterStep.status === "failed" ? "error" : afterStep.status === "cancelled" ? "warn" : outputChanged && !terminal ? "debug" : "info";
    const message = outputChanged && !statusChanged && !hasImportantPatch ? "运行步骤输出更新" : `运行步骤${this.stepStatusLabel(afterStep.status)}`;

    return this.logRun(run, level, message, {
      kind: run.kind,
      title: run.title,
      stepId: afterStep.id,
      stepTitle: afterStep.title,
      agentId: afterStep.agentId,
      agent: this.agentTitle(afterStep.agentId),
      cliToolId: afterStep.cliToolId,
      cli: afterStep.cliToolId ? CLI_TOOL_LABELS[afterStep.cliToolId as CliToolId] : undefined,
      previousStatus: beforeStep.status,
      status: afterStep.status,
      exitCode: afterStep.exitCode,
      durationMs: afterStep.durationMs,
      message: this.shortText(afterStep.message, 2000),
      outputTail: this.shortText(afterStep.output, terminal ? 5000 : 1600),
      outputLength: afterStep.output?.length,
      fileChanges: afterStep.fileChanges?.slice(0, 30),
      fileChangeCount: afterStep.fileChanges?.length
    });
  }

  private stepSummary(step: StudioRunStep): Record<string, unknown> {
    return {
      id: step.id,
      title: step.title,
      agentId: step.agentId,
      agent: this.agentTitle(step.agentId),
      cliToolId: step.cliToolId,
      cli: step.cliToolId ? CLI_TOOL_LABELS[step.cliToolId as CliToolId] : undefined,
      status: step.status
    };
  }

  private agentTitle(agentId?: string): string | undefined {
    return agentId ? AGENT_PROFILES.find((agent) => agent.id === agentId)?.title : undefined;
  }

  private stepStatusLabel(status: StudioRunStatus): string {
    const labels: Record<StudioRunStatus, string> = {
      queued: "排队中",
      running: "运行中",
      completed: "完成",
      failed: "失败",
      cancelled: "取消"
    };
    return labels[status];
  }

  private shortText(value?: string, maxLength = 1200): string | undefined {
    const text = value?.trim();
    if (!text) return undefined;
    return text.length > maxLength ? `${text.slice(-maxLength)}…(tail ${maxLength}/${text.length})` : text;
  }
}
