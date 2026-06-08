import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMessage, ProjectSnapshot, StudioProject, StudioRun } from "@gameaistudio/shared";

interface StudioState {
  projects: StudioProject[];
  messages: AgentMessage[];
  runs: StudioRun[];
  snapshots: ProjectSnapshot[];
}

const EMPTY_STATE: StudioState = {
  projects: [],
  messages: [],
  runs: [],
  snapshots: []
};

export class StudioStore {
  private state?: StudioState;

  constructor(private readonly statePath: string) {}

  async load(): Promise<StudioState> {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StudioState>;
      this.state = {
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : []
      };
    } catch {
      this.state = { ...EMPTY_STATE };
      await this.save();
    }

    return this.state;
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(this.state ?? EMPTY_STATE, null, 2), "utf8");
  }

  async listProjects(): Promise<StudioProject[]> {
    const state = await this.load();
    return [...state.projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getProject(projectId: string): Promise<StudioProject | undefined> {
    const state = await this.load();
    return state.projects.find((project) => project.id === projectId);
  }

  async upsertProject(project: StudioProject): Promise<void> {
    const state = await this.load();
    const index = state.projects.findIndex((candidate) => candidate.id === project.id);
    if (index >= 0) {
      state.projects[index] = project;
    } else {
      state.projects.push(project);
    }
    await this.save();
  }

  async listMessages(projectId: string): Promise<AgentMessage[]> {
    const state = await this.load();
    return state.messages
      .filter((message) => message.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async appendMessages(messages: AgentMessage[]): Promise<void> {
    const state = await this.load();
    state.messages.push(...messages);
    await this.save();
  }

  async listRuns(projectId: string): Promise<StudioRun[]> {
    const state = await this.load();
    return state.runs
      .filter((run) => run.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getRun(runId: string): Promise<StudioRun | undefined> {
    const state = await this.load();
    return state.runs.find((run) => run.id === runId);
  }

  async upsertRun(run: StudioRun): Promise<void> {
    const state = await this.load();
    const index = state.runs.findIndex((candidate) => candidate.id === run.id);
    if (index >= 0) {
      state.runs[index] = run;
    } else {
      state.runs.push(run);
    }
    await this.save();
  }

  async listSnapshots(projectId: string): Promise<ProjectSnapshot[]> {
    const state = await this.load();
    return state.snapshots
      .filter((snapshot) => snapshot.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getSnapshot(snapshotId: string): Promise<ProjectSnapshot | undefined> {
    const state = await this.load();
    return state.snapshots.find((snapshot) => snapshot.id === snapshotId);
  }

  async upsertSnapshot(snapshot: ProjectSnapshot): Promise<void> {
    const state = await this.load();
    const index = state.snapshots.findIndex((candidate) => candidate.id === snapshot.id);
    if (index >= 0) {
      state.snapshots[index] = snapshot;
    } else {
      state.snapshots.push(snapshot);
    }
    await this.save();
  }
}
