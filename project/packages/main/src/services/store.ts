import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMessage, StudioProject, StudioRun } from "@gameaistudio/shared";

interface StudioState {
  projects: StudioProject[];
  messages: AgentMessage[];
  runs: StudioRun[];
}

function createEmptyState(): StudioState {
  return {
    projects: [],
    messages: [],
    runs: []
  };
}

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
        runs: Array.isArray(parsed.runs) ? parsed.runs : []
      };
    } catch {
      this.state = createEmptyState();
      await this.save();
    }

    return this.state;
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(this.state ?? createEmptyState(), null, 2), "utf8");
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

  async deleteProject(projectId: string): Promise<void> {
    const state = await this.load();
    state.projects = state.projects.filter((project) => project.id !== projectId);
    state.messages = state.messages.filter((message) => message.projectId !== projectId);
    state.runs = state.runs.filter((run) => run.projectId !== projectId);
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

}
