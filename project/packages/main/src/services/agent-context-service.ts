import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { AGENT_PROFILES, CLI_TOOL_LABELS, type AgentMessage, type PreviewStatus, type ProjectDetails } from "@gameaistudio/shared";
import { readAgentJournalTail } from "./agent-journal-service";
import { writeUtf8BomFile } from "./text-file-encoding";

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
  agentJournal: string;
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
  agentJournal: string;
  now: string;
  /** Compact git state line, e.g. "main@abc1234, 3 uncommitted change(s)". */
  gitSummary?: string;
  /** This agent's own recent turns (private memory). */
  ownMessages?: string[];
  /** Latest QA findings shared as the known-issues board. */
  knownIssues?: string;
  /** This agent's most recent failure, if any. */
  lastError?: string;
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
  const attachmentLabel = message.attachments?.length
    ? ` [attachments: ${message.attachments.map((attachment) => attachment.projectRelativePath).join(", ")}]`
    : "";
  return `- ${roleLabel(message)}${cliLabel}${attachmentLabel}: ${trimForContext(message.content)}`;
}

export function summarizeRecentMessages(messages: AgentMessage[], maxMessages = DEFAULT_MAX_MESSAGES): string[] {
  return messages.slice(-maxMessages).map(formatMessage);
}

/** The agent's own thread tail — its private working memory across rounds. */
export function summarizeAgentOwnMessages(
  messages: AgentMessage[],
  agentId: string,
  maxMessages = 6
): string[] {
  return messages
    .filter((message) => message.agentId === agentId)
    .slice(-maxMessages)
    .map(formatMessage);
}

/** Latest QA findings — shared with every agent as the "known issues" board. */
export function latestQaFindings(messages: AgentMessage[], maxLength = 700): string | undefined {
  const finding = [...messages]
    .reverse()
    .find((message) => message.agentId === "qa" && message.role === "agent" && message.kind !== "error");
  if (!finding) return undefined;
  const text = finding.content.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** The agent's most recent failed turn, so it can avoid repeating the mistake. */
export function latestAgentError(
  messages: AgentMessage[],
  agentId: string,
  maxLength = 400
): string | undefined {
  const failure = [...messages]
    .reverse()
    .find((message) => message.agentId === agentId && message.kind === "error");
  if (!failure) return undefined;
  const text = failure.content.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
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

function previewStatusLabel(status?: PreviewStatus): string {
  if (!status) {
    return "not started";
  }
  const labels: Record<PreviewStatus, string> = {
    watching: "watching",
    exporting: "exporting",
    ready: "ready",
    failed: "failed",
    stopped: "stopped"
  };
  return labels[status];
}

function formatDeliveryStatus(project: ProjectDetails, gitSummary?: string): string[] {
  const inspection = project.latestWebBuildInspection;
  const inspectionLine = inspection
    ? inspection.ok
      ? `- Web artifact inspection: OK (${inspection.files.length} files, ${formatBytes(inspection.totalBytes)})`
      : `- Web artifact inspection: FAILED, missing ${inspection.missingRequiredFiles.join(", ")}`
    : "- Web artifact inspection: not run yet";

  return [
    `- Web build path: ${project.webBuildPath}`,
    ...(gitSummary ? [`- Git: ${gitSummary}`] : []),
    `- Preview: ${previewStatusLabel(project.previewStatus)}${project.previewUrl ? ` (${project.previewUrl})` : ""}`,
    `- Web zip: ${project.exportZipPath ?? "not exported yet"}`,
    `- Export manifest: ${project.latestExportManifestPath ?? "not exported yet"}`,
    inspectionLine,
    inspection ? `- Required Web artifacts: ${inspection.requiredFiles.join(", ")}` : "- Required Web artifacts: index.html, *.wasm, *.pck"
  ];
}

export function buildAgentContextMarkdown(input: BuildMarkdownInput): string {
  const agent = AGENT_PROFILES.find((profile) => profile.id === input.agentId) ?? AGENT_PROFILES[0];
  const recentMessages = input.recentMessages.length > 0 ? input.recentMessages : ["- 暂无历史对话。"];
  const agentJournal = input.agentJournal.trim() || "- No Agent journal entries yet.";

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
    "## Delivery Status",
    "",
    ...formatDeliveryStatus(input.project, input.gitSummary),
    "",
    "## Current User Message",
    "",
    input.userMessage.trim() || "(empty)",
    "",
    "## Recent Conversation",
    "",
    ...recentMessages,
    "",
    ...(input.ownMessages && input.ownMessages.length > 0
      ? ["## Your Recent Turns (this agent)", "", ...input.ownMessages, ""]
      : []),
    ...(input.knownIssues
      ? ["## Known Issues (latest QA findings)", "", input.knownIssues, ""]
      : []),
    ...(input.lastError
      ? ["## Your Last Error", "", input.lastError, "", "Avoid repeating the failure above; fix its root cause first if it blocks you.", ""]
      : []),
    "## Recent Agent Journal",
    "",
    agentJournal,
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

  async prepare(input: {
    project: ProjectDetails;
    agentId: string;
    userMessage: string;
    gitSummary?: string;
  }): Promise<AgentContextBundle> {
    const files = await listAgentContextFiles(input.project.rootPath, this.options.maxFiles ?? DEFAULT_MAX_FILES);
    const recentMessages = summarizeRecentMessages(input.project.messages, this.options.maxMessages ?? DEFAULT_MAX_MESSAGES);
    const agentJournal = await readAgentJournalTail(input.project.rootPath);
    const contextPath = path.join(input.project.rootPath, ".gameaistudio", "agent-context.md");
    const markdown = buildAgentContextMarkdown({
      project: input.project,
      agentId: input.agentId,
      userMessage: input.userMessage,
      files,
      recentMessages,
      agentJournal,
      now: new Date().toISOString(),
      gitSummary: input.gitSummary,
      ownMessages: summarizeAgentOwnMessages(input.project.messages, input.agentId),
      knownIssues: latestQaFindings(input.project.messages),
      lastError: latestAgentError(input.project.messages, input.agentId)
    });

    await mkdir(path.dirname(contextPath), { recursive: true });
    await writeUtf8BomFile(contextPath, markdown);

    return {
      contextPath,
      markdown,
      files,
      recentMessages,
      agentJournal
    };
  }
}
