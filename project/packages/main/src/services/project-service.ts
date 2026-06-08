import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_PROFILES, type AgentMessage, type CreateProjectInput, type ProjectDetails, type StudioProject } from "@gameaistudio/shared";
import { createMessageId, createProjectId, sanitizeProjectName } from "./naming";
import { getTemplatePath, type StudioPaths } from "./resource-paths";
import { StudioStore } from "./store";

export class ProjectService {
  constructor(
    private readonly paths: StudioPaths,
    private readonly store: StudioStore
  ) {}

  async createProject(input: CreateProjectInput): Promise<ProjectDetails> {
    const id = createProjectId();
    const now = new Date().toISOString();
    const safeName = sanitizeProjectName(input.name || input.prompt);
    const rootPath = path.join(this.paths.projectsRoot, `${safeName}-${id.slice(-6)}`);
    const templatePath = getTemplatePath(this.paths, input.dimension);

    await mkdir(this.paths.projectsRoot, { recursive: true });
    await cp(templatePath, rootPath, { recursive: true, force: false });

    const project: StudioProject = {
      id,
      name: input.name.trim() || safeName,
      dimension: input.dimension,
      prompt: input.prompt.trim(),
      rootPath,
      webBuildPath: path.join(rootPath, "build", "web"),
      createdAt: now,
      updatedAt: now,
      activeAgentId: "producer"
    };

    await this.patchGodotProjectName(project);
    await this.writeProjectManifest(project);
    await this.store.upsertProject(project);

    const introMessages = this.createIntroMessages(project);
    await this.store.appendMessages(introMessages);

    return {
      ...project,
      messages: introMessages,
      runs: [],
      snapshots: []
    };
  }

  async listProjects(): Promise<StudioProject[]> {
    return this.store.listProjects();
  }

  async getProject(projectId: string): Promise<ProjectDetails> {
    const project = await this.requireProject(projectId);
    return {
      ...project,
      messages: await this.store.listMessages(projectId),
      runs: await this.store.listRuns(projectId),
      snapshots: await this.store.listSnapshots(projectId)
    };
  }

  async requireProject(projectId: string): Promise<StudioProject> {
    const project = await this.store.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  async updateProject(project: StudioProject): Promise<StudioProject> {
    const updated = {
      ...project,
      updatedAt: new Date().toISOString()
    };
    await this.store.upsertProject(updated);
    return updated;
  }

  async appendMessages(projectId: string, messages: AgentMessage[]): Promise<AgentMessage[]> {
    await this.requireProject(projectId);
    await this.store.appendMessages(messages);
    return this.store.listMessages(projectId);
  }

  private async patchGodotProjectName(project: StudioProject): Promise<void> {
    const projectFile = path.join(project.rootPath, "project.godot");
    try {
      const content = await readFile(projectFile, "utf8");
      const quotedName = JSON.stringify(project.name);
      const patched = content.match(/^config\/name=/m)
        ? content.replace(/^config\/name=.*$/m, `config/name=${quotedName}`)
        : `${content.trimEnd()}\nconfig/name=${quotedName}\n`;
      await writeFile(projectFile, patched, "utf8");
    } catch {
      // Godot will still open the copied template even if this optional rename fails.
    }
  }

  private async writeProjectManifest(project: StudioProject): Promise<void> {
    const studioDir = path.join(project.rootPath, ".gameaistudio");
    await mkdir(studioDir, { recursive: true });
    await writeFile(path.join(studioDir, "project.json"), JSON.stringify(project, null, 2), "utf8");
    await writeFile(
      path.join(project.rootPath, "GAMEAISTUDIO.md"),
      [
        `# ${project.name}`,
        "",
        `Original prompt: ${project.prompt}`,
        `Dimension: ${project.dimension.toUpperCase()}`,
        "",
        "Agent rules:",
        "- Keep all generated files inside this Godot project.",
        "- Prefer small playable increments over broad rewrites.",
        "- Maintain Web export compatibility.",
        "- Read `.gameaistudio/agent-context.md` when GameAIStudio prepares an Agent turn.",
        "- Record major design decisions in this file when useful."
      ].join("\n"),
      "utf8"
    );
  }

  private createIntroMessages(project: StudioProject): AgentMessage[] {
    const now = new Date().toISOString();
    return [
      {
        id: createMessageId(),
        projectId: project.id,
        agentId: "producer",
        role: "system",
        createdAt: now,
        content: `已创建 ${project.dimension.toUpperCase()} Godot 项目：${project.name}\n项目目录：${project.rootPath}`
      },
      {
        id: createMessageId(),
        projectId: project.id,
        agentId: "producer",
        role: "agent",
        createdAt: now,
        content: `我会先把“${project.prompt}”拆成可玩的第一版目标。可以直接让制作人规划，也可以切到程序、美术或 QA 让对应 Agent 开始工作。`,
        cliToolId: AGENT_PROFILES[0]?.defaultCli
      }
    ];
  }
}
