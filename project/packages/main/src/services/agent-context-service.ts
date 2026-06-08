import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_PROFILES, CLI_TOOL_LABELS, type AgentMessage, type ProjectDetails } from "@gameaistudio/shared";

export interface AgentContextFile {
  path: string;
  size: number;
  kind: "text" | "asset" | "binary";
}

export interface AgentContextBundle {
  contextPath: string;
  markdown: string;
  files: AgentContextFile[];
  recentMessages: string[];
}

export interface AgentContextServiceOptions {
  maxFiles?: number;
  maxMessages?: number;
}

interface BuildMarkdownInput {
  project: ProjectDetails;
  agentId: string;
  userMessage: string;
  files: AgentContextFile[];
  recentMessages: string[];
  now: string;
}

const DEFAULT_MAX_FILES = 140;
const DEFAULT_MAX_MESSAGES = 10;
const IGNORED_DIRECTORIES = new Set([".git", ".godot", ".gameaistudio", "build", "dist", "node_modules"]);
const IGNORED_SUFFIXES = [".uid", ".import", ".tmp", ".log"];
const TEXT_EXTENSIONS = new Set([
  ".cfg",
  ".gd",
  ".gdshader",
  ".godot",
  ".json",
  ".md",
  ".shader",
  ".tres",
  ".tscn",
  ".txt",
  ".xml",
  ".yml",
  ".yaml"
]);
const ASSET_EXTENSIONS = new Set([".aseprite", ".glb", ".gltf", ".jpg", ".jpeg", ".ogg", ".png", ".svg", ".wav", ".webp"]);

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function shouldIncludeAgentContextPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) {
    return false;
  }
  const basename = parts[parts.length - 1] ?? "";
  return !IGNORED_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

function classifyFile(filePath: string): AgentContextFile["kind"] {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  if (ASSET_EXTENSIONS.has(extension)) {
    return "asset";
  }
  return "binary";
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function trimForContext(value: string, maxLength = 520): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function roleLabel(message: AgentMessage): string {
  if (message.role === "user") {
    return "用户";
  }
  if (message.role === "system") {
    return "系统";
  }
  const agent = AGENT_PROFILES.find((profile) => profile.id === message.agentId);
  return agent?.title ?? "Agent";
}

function formatMessage(message: AgentMessage): string {
  const cliLabel = message.cliToolId ? ` / ${CLI_TOOL_LABELS[message.cliToolId]}` : "";
  return `- ${roleLabel(message)}${cliLabel}: ${trimForContext(message.content)}`;
}

export function summarizeRecentMessages(messages: AgentMessage[], maxMessages = DEFAULT_MAX_MESSAGES): string[] {
  return messages.slice(-maxMessages).map(formatMessage);
}

async function walkFiles(rootPath: string, directory: string, files: AgentContextFile[]): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootPath, fullPath));

    if (entry.isDirectory()) {
      if (!shouldIncludeAgentContextPath(relativePath)) {
        continue;
      }
      await walkFiles(rootPath, fullPath, files);
      continue;
    }

    if (!entry.isFile() || !shouldIncludeAgentContextPath(relativePath)) {
      continue;
    }

    const fileStat = await stat(fullPath);
    files.push({
      path: relativePath,
      size: fileStat.size,
      kind: classifyFile(relativePath)
    });
  }
}

export async function listAgentContextFiles(rootPath: string, maxFiles = DEFAULT_MAX_FILES): Promise<AgentContextFile[]> {
  const files: AgentContextFile[] = [];
  await walkFiles(rootPath, rootPath, files);
  return files.sort((left, right) => left.path.localeCompare(right.path)).slice(0, maxFiles);
}

function formatFileList(files: AgentContextFile[]): string[] {
  if (files.length === 0) {
    return ["- 当前项目目录内还没有可纳入上下文的源文件或素材。"];
  }
  return files.map((file) => `- ${file.path} (${formatBytes(file.size)}, ${file.kind})`);
}

export function buildAgentContextMarkdown(input: BuildMarkdownInput): string {
  const agent = AGENT_PROFILES.find((profile) => profile.id === input.agentId) ?? AGENT_PROFILES[0];
  const recentMessages = input.recentMessages.length > 0 ? input.recentMessages : ["- 暂无历史对话。"];

  return [
    "# GameAIStudio Agent Context",
    "",
    `Updated: ${input.now}`,
    `Project: ${input.project.name}`,
    `Dimension: ${input.project.dimension.toUpperCase()}`,
    `Original user goal: ${input.project.prompt}`,
    `Project root: ${input.project.rootPath}`,
    `Active agent: ${agent.title} - ${agent.specialty}`,
    "",
    "## Work Style",
    "",
    "- Work directly in this Godot project folder and keep changes inside it.",
    "- Prefer a small playable Godot increment over broad planning-only output.",
    "- Keep Web export compatibility in mind when changing scripts, scenes, resources, or export presets.",
    "- When changing project files, mention the main files touched and the intended gameplay effect.",
    "- If you cannot complete a change, leave concrete next steps that another Agent can continue.",
    "",
    "## Current User Message",
    "",
    input.userMessage.trim() || "(empty)",
    "",
    "## Recent Conversation",
    "",
    ...recentMessages,
    "",
    "## Project File Map",
    "",
    ...formatFileList(input.files),
    "",
    "## Response Contract",
    "",
    "- Summarize what changed or what decision was made.",
    "- Call out risks or missing assets honestly.",
    "- End with the next best action for the user or the next Agent."
  ].join("\n");
}

export class AgentContextService {
  constructor(private readonly options: AgentContextServiceOptions = {}) {}

  async prepare(input: { project: ProjectDetails; agentId: string; userMessage: string }): Promise<AgentContextBundle> {
    const files = await listAgentContextFiles(input.project.rootPath, this.options.maxFiles ?? DEFAULT_MAX_FILES);
    const recentMessages = summarizeRecentMessages(input.project.messages, this.options.maxMessages ?? DEFAULT_MAX_MESSAGES);
    const contextPath = path.join(input.project.rootPath, ".gameaistudio", "agent-context.md");
    const markdown = buildAgentContextMarkdown({
      project: input.project,
      agentId: input.agentId,
      userMessage: input.userMessage,
      files,
      recentMessages,
      now: new Date().toISOString()
    });

    await mkdir(path.dirname(contextPath), { recursive: true });
    await writeFile(contextPath, markdown, "utf8");

    return {
      contextPath,
      markdown,
      files,
      recentMessages
    };
  }
}
