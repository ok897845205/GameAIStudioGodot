import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
import { createMessageId, createProjectDirectoryName, createProjectId } from "./naming";
import { getTemplatePath, type StudioPaths } from "./resource-paths";
import { removeProjectDir } from "./project-dir-cleanup";
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

// Markdown files at the `.gameaistudio/` root that belong to the app itself
// and must never be relocated by the legacy-doc migration below.
const RESERVED_STUDIO_MARKDOWN = new Set(["agent-journal.md"]);

// agent-context.md now lives at docs/agent-context.md and regenerates every
// turn — a legacy copy under `.gameaistudio/` is stale by definition and is
// deleted rather than moved.
const LEGACY_DELETED_MARKDOWN = new Set(["agent-context.md"]);

/**
 * Earlier builds let Agents write collaboration documents (plans, design
 * specs, QA reports…) straight into `.gameaistudio/`. Now that the directory
 * is agent-forbidden, those documents would become unreachable — move any
 * non-reserved markdown file at the `.gameaistudio/` root into `docs/`,
 * where future turns are told to keep them.
 */
export async function migrateLegacyAgentDocs(rootPath: string): Promise<string[]> {
  const studioDir = path.join(rootPath, ".gameaistudio");
  let entries;
  try {
    entries = await readdir(studioDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries.filter(
    (entry) =>
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".md") &&
      !RESERVED_STUDIO_MARKDOWN.has(entry.name.toLowerCase()) &&
      !entry.name.toLowerCase().startsWith("chat-export-")
  );
  if (candidates.length === 0) {
    return [];
  }

  const docsDir = path.join(rootPath, "docs");
  await mkdir(docsDir, { recursive: true });
  const moved: string[] = [];
  for (const entry of candidates) {
    const source = path.join(studioDir, entry.name);
    if (LEGACY_DELETED_MARKDOWN.has(entry.name.toLowerCase())) {
      await rm(source, { force: true }).catch(() => undefined);
      continue;
    }
    let target = path.join(docsDir, entry.name);
    if (await pathExists(target)) {
      const stem = entry.name.replace(/\.md$/i, "");
      target = path.join(docsDir, `${stem}-migrated.md`);
      if (await pathExists(target)) continue;
    }
    try {
      await rename(source, target);
      moved.push(`docs/${path.basename(target)}`);
    } catch (error) {
      getProjectLogger(rootPath).warn("project", "迁移协作文档失败", {
        file: entry.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (moved.length > 0) {
    getProjectLogger(rootPath).info("project", "已将协作文档从 .gameaistudio 迁移到 docs/", { moved });
  }
  await updateLegacyProjectGuide(rootPath);
  return moved;
}

/**
 * GAMEAISTUDIO.md is written once at project creation and may be edited by
 * Agents afterwards, so it cannot be regenerated wholesale. Surgically rewrite
 * the stale agent-context path that older guides point at (the file moved
 * from `.gameaistudio/` to `docs/`).
 */
async function updateLegacyProjectGuide(rootPath: string): Promise<void> {
  const guidePath = path.join(rootPath, "GAMEAISTUDIO.md");
  try {
    const content = await readFile(guidePath, "utf8");
    if (!content.includes(".gameaistudio/agent-context.md")) {
      return;
    }
    await writeFile(guidePath, content.replaceAll(".gameaistudio/agent-context.md", "docs/agent-context.md"), "utf8");
    getProjectLogger(rootPath).info("project", "已更新 GAMEAISTUDIO.md 中的 Agent 上下文路径指引");
  } catch {
    // Guide missing or unreadable — nothing to update.
  }
}

export class ProjectService {
  /** Projects whose legacy `.gameaistudio/*.md` docs were already migrated this session. */
  private readonly docsMigrated = new Set<string>();

  /**
   * Per-project chat history, persisted INSIDE the project at
   * `.gameaistudio/chat-history.json` — the chat travels with the project
   * (copy/move/restore all keep it). The in-memory cache is the single
   * mutation point so concurrent appends never lose writes; the file is the
   * durable copy. Legacy messages from the global studio-state.json are
   * migrated on first load.
   */
  private readonly chatCache = new Map<string, AgentMessage[]>();

  constructor(
    private readonly paths: StudioPaths,
    private readonly store: StudioStore
  ) {}

  private chatHistoryPath(rootPath: string): string {
    return path.join(rootPath, ".gameaistudio", "chat-history.json");
  }

  private async loadChat(project: StudioProject): Promise<AgentMessage[]> {
    const cached = this.chatCache.get(project.id);
    if (cached) return cached;

    let messages: AgentMessage[] | undefined;
    try {
      const raw = await readFile(this.chatHistoryPath(project.rootPath), "utf8");
      const parsed = JSON.parse(raw) as { messages?: AgentMessage[] };
      if (Array.isArray(parsed.messages)) {
        messages = parsed.messages;
      }
    } catch {
      // No project-local history yet — migrate from the legacy global store.
    }
    if (!messages) {
      messages = await this.store.listMessages(project.id);
      if (messages.length > 0) {
        await this.saveChat(project, messages);
        getProjectLogger(project.rootPath).info("chat", "聊天记录已迁移到项目目录", {
          projectId: project.id,
          migrated: messages.length
        });
      }
    }
    this.chatCache.set(project.id, messages);
    return messages;
  }

  private async saveChat(project: StudioProject, messages: AgentMessage[]): Promise<void> {
    const filePath = this.chatHistoryPath(project.rootPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ version: 1, messages }, null, 2), "utf8");
  }

  async createProject(input: CreateProjectInput): Promise<ProjectDetails> {
    const id = createProjectId();
    const now = new Date().toISOString();
    // The directory name is auto-generated ASCII (CLI-safe cwd); the
    // user-entered name (which may be Chinese) is display-only.
    const rootPath = await this.allocateProjectRoot(input.dimension);
    const displayName =
      input.name.trim() || input.prompt.trim().replace(/\s+/g, " ").slice(0, 24) || path.basename(rootPath);
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
      name: displayName,
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
    this.chatCache.set(project.id, introMessages);
    await this.saveChat(project, introMessages);

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

  /** Finds an unused `2D_game_<timestamp>` directory (suffix on collision). */
  private async allocateProjectRoot(dimension: GameDimension): Promise<string> {
    const base = createProjectDirectoryName(dimension);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = path.join(
        this.paths.projectsRoot,
        attempt === 0 ? base : `${base}_${attempt + 1}`
      );
      if (!(await pathExists(candidate))) {
        return candidate;
      }
    }
    throw new Error(`无法分配项目目录：${base} 及其后缀都已存在。`);
  }

  async listProjects(): Promise<StudioProject[]> {
    return this.store.listProjects();
  }

  async getProject(projectId: string): Promise<ProjectDetails> {
    const project = await this.requireProject(projectId);
    return {
      ...project,
      messages: [...(await this.loadChat(project))],
      runs: await this.store.listRuns(projectId)
    };
  }

  async requireProject(projectId: string): Promise<StudioProject> {
    const project = await this.store.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (!this.docsMigrated.has(project.id)) {
      this.docsMigrated.add(project.id);
      await migrateLegacyAgentDocs(project.rootPath).catch(() => []);
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
    await removeProjectDir(project.rootPath);
    this.chatCache.delete(projectId);
    await this.store.deleteProject(projectId);
    return project;
  }

  async appendMessages(projectId: string, messages: AgentMessage[]): Promise<AgentMessage[]> {
    const project = await this.requireProject(projectId);
    const list = await this.loadChat(project);
    list.push(...messages);
    await this.saveChat(project, list);
    return [...list];
  }

  async deleteMessage(projectId: string, messageId: string): Promise<AgentMessage[]> {
    const project = await this.requireProject(projectId);
    const list = await this.loadChat(project);
    const index = list.findIndex((message) => message.id === messageId);
    const deleted = index >= 0;
    if (deleted) {
      list.splice(index, 1);
      await this.saveChat(project, list);
    }
    getProjectLogger(project.rootPath).info("chat", "删除单条聊天消息", {
      projectId,
      messageId,
      deleted
    });
    return [...list];
  }

  async clearMessages(projectId: string, agentId?: string): Promise<AgentMessage[]> {
    const project = await this.requireProject(projectId);
    const list = await this.loadChat(project);
    const kept = agentId === undefined ? [] : list.filter((message) => message.agentId !== agentId);
    const removed = list.length - kept.length;
    if (removed > 0) {
      this.chatCache.set(project.id, kept);
      await this.saveChat(project, kept);
    }
    getProjectLogger(project.rootPath).info("chat", "清空聊天会话", {
      projectId,
      agentId: agentId ?? "(all)",
      removed
    });
    return [...(this.chatCache.get(project.id) ?? kept)];
  }

  /**
   * Exports the full project chat (with Agent/CLI/time/attachment/file-change
   * metadata) as a UTF-8 markdown file inside `.gameaistudio/` — the artifact
   * users attach when reporting problems.
   */
  async exportChatHistory(projectId: string): Promise<ExportChatResult> {
    const project = await this.requireProject(projectId);
    const messages = await this.loadChat(project);
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
        "- Read `docs/agent-context.md` when GameAIStudio prepares an Agent turn.",
        "- Write collaboration documents (plans, design specs, QA reports) into `docs/`, never into `.gameaistudio/`.",
        "- Record major design decisions in this file when useful."
      ].join("\n")
    );
  }

  private async writeInitialAgentFiles(project: StudioProject): Promise<void> {
    const studioDir = path.join(project.rootPath, ".gameaistudio");
    const docsDir = path.join(project.rootPath, "docs");
    await mkdir(studioDir, { recursive: true });
    await mkdir(docsDir, { recursive: true });
    await writeUtf8BomFile(
      path.join(docsDir, "agent-context.md"),
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
        "- .gameaistudio/agent-journal.md",
        "- docs/ (collaboration documents: plans, design specs, QA reports)"
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
