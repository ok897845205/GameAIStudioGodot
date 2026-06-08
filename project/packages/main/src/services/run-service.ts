import type { StudioRun, StudioRunEvent, StudioRunKind, StudioRunStatus, StudioRunStep } from "@gameaistudio/shared";
import { createRunId, createRunStepId } from "./naming";
import { StudioStore } from "./store";

export type RunEventSink = (event: StudioRunEvent) => void;

interface CreateRunInput {
  projectId: string;
  kind: StudioRunKind;
  title: string;
  steps: Array<Omit<StudioRunStep, "id" | "status"> & { id?: string; status?: StudioRunStatus }>;
}

export class RunService {
  constructor(
    private readonly store: StudioStore,
    private readonly emit: RunEventSink = () => {}
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
    return run;
  }

  async startRun(runId: string, currentStepId?: string): Promise<StudioRun> {
    const run = await this.requireRun(runId);
    return this.patchRun(run, {
      status: "running",
      currentStepId
    });
  }

  async updateStep(runId: string, stepId: string, patch: Partial<StudioRunStep>): Promise<StudioRun> {
    const run = await this.requireRun(runId);
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

    return this.patchRun(run, {
      steps,
      currentStepId: patch.status === "running" ? stepId : run.currentStepId
    });
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
    return this.patchRun(run, { steps });
  }

  async finishRun(runId: string, status: Extract<StudioRunStatus, "completed" | "failed" | "cancelled">, summary?: string): Promise<StudioRun> {
    const run = await this.requireRun(runId);
    return this.patchRun(run, {
      status,
      summary,
      currentStepId: undefined,
      completedAt: new Date().toISOString()
    });
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

    return this.patchRun(run, {
      status: "cancelled",
      steps,
      currentStepId: undefined,
      summary,
      completedAt: now
    });
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
}
