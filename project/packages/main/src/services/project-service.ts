import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type AgentMessage,
  type CreateProjectInput,
  type ExportChatResult,
  type GameDimension,
  type ProjectDetails,
  type StudioProject
} from "@gameaistudio/shared";
import { getAppLogger, getProjectLogger } from "./logger";
import { createMessageId, createProjectId, sanitizeProjectName } from "./naming";
import { getTemplatePath, type StudioPaths } from "./resource-paths";
import { StudioStore } from "./store";
import { writeUtf8BomFile } from "./text-file-encoding";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function templateHasWebExportPreset(exportPresetsPath: string): Promise<boolean> {
  try {
    return /platform\s*=\s*"Web"/.test(await readFile(exportPresetsPath, "utf8"));
  } catch {
    return false;
  }
}

export function shouldCopyTemplateEntry(templatePath: string, sourcePath: string): boolean {
  const relativePath = path.relative(templatePath, sourcePath);
  if (!relativePath) {
    return true;
  }
  const firstSegment = relativePath.split(path.sep)[0];
  return ![".godot", "build", "dist"].includes(firstSegment);
}

export async function assertTemplateReady(templatePath: string, dimension: GameDimension): Promise<void> {
  const label = dimension.toUpperCase();
  const projectFile = path.join(templatePath, "project.godot");
  const exportPresetsPath = path.join(templatePath, "export_presets.cfg");

  if (!(await pathExists(projectFile))) {
    throw new Error(`${label} Godot 模板工程缺失：未找到 ${projectFile}`);
  }

  if (!(await templateHasWebExportPreset(exportPresetsPath))) {
    throw new Error(`${label} Godot 模板缺少 Web 导出预设：请在 ${exportPresetsPath} 中添加 platform="Web"。`);
  }
}

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

    await assertTemplateReady(templatePath, input.dimension);
    await mkdir(this.paths.projectsRoot, { recursive: true });
    await cp(templatePath, rootPath, {
      recursive: true,
      force: false,
      filter: (sourcePath) => shouldCopyTemplateEntry(templatePath, sourcePath)
    });

    const project: StudioProject = {
      id,
      name: input.name.trim() || safeName,
      dimension: input.dimension,
      prompt: input.prompt.trim(),
      agentCliToolIds: input.agentCliToolIds,
      rootPath,
      webBuildPath: path.join(rootPath, "build", "web"),
      createdAt: now,
      updatedAt: now,
      activeAgentId: "producer"
    };

    await this.patchGodotProjectName(project);
    await this.writeProjectMetadata(project);
    await this.writeProjectGuide(project);
    await this.writeInitialAgentFiles(project);
    await this.store.upsertProject(project);

    const introMessages = this.createIntroMessages(project);
    await this.store.appendMessages(introMessages);

    getProjectLogger(rootPath).info("project", "创建项目", {
      project: project.name,
      projectId: id,
      dimension: project.dimension,
      prompt: project.prompt,
      agentCliToolIds: project.agentCliToolIds,
      rootPath,
    });

    return {
      ...project,
      messages: introMessages,
      runs: []
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
      runs: await this.store.listRuns(projectId)
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
    await this.writeProjectMetadata(updated);
    await this.store.upsertProject(updated);
    return updated;
  }

  async deleteProject(projectId: string): Promise<StudioProject> {
    const project = await this.requireProject(projectId);
    getAppLogger().info("project", "删除项目", {
      project: project.name,
      projectId,
      rootPath: project.rootPath,
    });
    await rm(project.rootPath, { recursive: true, force: true });
    await this.store.deleteProject(projectId);
    return project;
  }

  async appendMessages(projectId: string, messages: AgentMessage[]): Promise<AgentMessage[]> {
    await this.requireProject(projectId);
    await this.store.appendMessages(messages);
    return this.store.listMessages(projectId);
  }

  async deleteMessage(projectId: string, messageId: string): Promise<AgentMessage[]> {
    const project = await this.requireProject(projectId);
    const deleted = await this.store.deleteMessage(projectId, messageId);
    getProjectLogger(project.rootPath).info("chat", "删除单条聊天消息", {
      projectId,
      messageId,
      deleted
    });
    return this.store.listMessages(projectId);
  }

  async clearMessages(projectId: string, agentId?: string): Promise<AgentMessage[]> {
    const project = await this.requireProject(projectId);
    const removed = await this.store.clearMessages(projectId, agentId);
    getProjectLogger(project.rootPath).info("chat", "清空聊天会话", {
      projectId,
      agentId: agentId ?? "(all)",
      removed
    });
    return this.store.listMessages(projectId);
  }

  /**
   * Exports the full project chat (with Agent/CLI/time/attachment/file-change
   * metadata) as a UTF-8 markdown file inside `.gameaistudio/` — the artifact
   * users attach when reporting problems.
   */
  async exportChatHistory(projectId: string): Promise<ExportChatResult> {
    const project = await this.requireProject(projectId);
    const messages = await this.store.listMessages(projectId);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportPath = path.join(project.rootPath, ".gameaistudio", `chat-export-${stamp}.md`);

    const lines: string[] = [
      `# 聊天记录 — ${project.name}`,
      "",
      `导出时间：${new Date().toISOString()}`,
      `项目目录：${project.rootPath}`,
      `消息数量：${messages.length}`,
      ""
    ];
    for (const message of messages) {
      const agent = AGENT_PROFILES.find((profile) => profile.id === message.agentId);
      const who =
        message.role === "user" ? "用户" : message.role === "system" ? "系统" : agent?.title ?? message.agentId;
      const meta = [
        message.createdAt,
        who,
        message.cliToolId ? CLI_TOOL_LABELS[message.cliToolId] : undefined,
        message.kind && message.kind !== "text" ? `kind:${message.kind}` : undefined,
        typeof message.exitCode === "number" ? `exit:${message.exitCode}` : undefined,
        message.durationMs ? `${message.durationMs}ms` : undefined
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(`## ${meta}`, "", message.content.trim(), "");
      if (message.attachments?.length) {
        lines.push(`附件：${message.attachments.map((attachment) => attachment.projectRelativePath).join("、")}`, "");
      }
      if (message.fileChanges?.length) {
        lines.push(`文件变更（${message.fileChanges.length}）：`, ...message.fileChanges.map((change) => `- [${change.kind}] ${change.path}`), "");
      }
    }

    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeUtf8BomFile(exportPath, lines.join("\n"));
    getProjectLogger(project.rootPath).info("chat", "导出聊天记录", {
      projectId,
      path: exportPath,
      messageCount: messages.length
    });
    return { projectId, path: exportPath, messageCount: messages.length };
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

  private async writeProjectMetadata(project: StudioProject): Promise<void> {
    const studioDir = path.join(project.rootPath, ".gameaistudio");
    await mkdir(studioDir, { recursive: true });
    await writeFile(path.join(studioDir, "project.json"), JSON.stringify(project, null, 2), "utf8");
  }

  private async writeProjectGuide(project: StudioProject): Promise<void> {
    await writeUtf8BomFile(
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
      ].join("\n")
    );
  }

  private async writeInitialAgentFiles(project: StudioProject): Promise<void> {
    const studioDir = path.join(project.rootPath, ".gameaistudio");
    await mkdir(studioDir, { recursive: true });
    await writeUtf8BomFile(
      path.join(studioDir, "agent-context.md"),
      [
        "# GameAIStudio Agent Context",
        "",
        `Project: ${project.name}`,
        `Dimension: ${project.dimension.toUpperCase()}`,
        `Original user goal: ${project.prompt}`,
        `Project root: ${project.rootPath}`,
        "",
        "No Agent turn has been prepared yet. Run an Agent or the team workflow to refresh this file with the live file map, recent conversation, delivery status, and Agent journal tail.",
        "",
        "Useful project-local files:",
        "- GAMEAISTUDIO.md",
        "- .gameaistudio/project.json",
        "- .gameaistudio/agent-journal.md"
      ].join("\n")
    );
    await writeUtf8BomFile(
      path.join(studioDir, "agent-journal.md"),
      [
        "# GameAIStudio Agent Journal",
        "",
        `## ${project.createdAt} - Project created`,
        "",
        `- Project: ${project.name} (${project.dimension.toUpperCase()})`,
        `- Original user goal: ${project.prompt}`,
        "- Status: waiting for the first Agent turn.",
        ""
      ].join("\n")
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
        cliToolId: project.agentCliToolIds?.producer ?? AGENT_PROFILES[0]?.defaultCli
      }
    ];
  }
}
