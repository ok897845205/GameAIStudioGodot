/**
 * Per-project mutual exclusion for AI work.
 *
 * Multiple projects may run turns/workflows concurrently (everything on disk
 * is project-scoped), but within ONE project only a single turn or workflow
 * may run at a time: two CLIs editing the same files corrupt change
 * attribution, overwrite each other's agent-context.md and race the git
 * auto-commit. The second request is rejected explicitly ("明确不允许") —
 * queueing can be layered on later.
 */

export type ProjectWorkKind = "agent-turn" | "studio-workflow";

export interface ProjectWorkInfo {
  kind: ProjectWorkKind;
  since: string;
}

export const PROJECT_WORK_LABELS: Record<ProjectWorkKind, string> = {
  "agent-turn": "Agent 回合",
  "studio-workflow": "团队工作流",
};

export class ProjectLockService {
  private readonly active = new Map<string, ProjectWorkInfo>();

  /** Returns true when the lock was acquired; false when the project is busy. */
  tryAcquire(projectId: string, kind: ProjectWorkKind): boolean {
    if (this.active.has(projectId)) {
      return false;
    }
    this.active.set(projectId, { kind, since: new Date().toISOString() });
    return true;
  }

  release(projectId: string): void {
    this.active.delete(projectId);
  }

  describe(projectId: string): ProjectWorkInfo | undefined {
    return this.active.get(projectId);
  }

  /** Friendly one-liner for the rejection message. */
  busyMessage(projectId: string): string {
    const info = this.active.get(projectId);
    const label = info ? PROJECT_WORK_LABELS[info.kind] : "任务";
    return `该项目正有${label}在运行，本条请求未执行。请等待完成，或在「运行」面板取消后重试。`;
  }
}
