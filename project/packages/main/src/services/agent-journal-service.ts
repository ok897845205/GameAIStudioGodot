import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type AgentMessage,
  type CliToolId,
  type ProjectFileChange,
  type StudioProject
} from "@gameaistudio/shared";

const AGENT_JOURNAL_RELATIVE_PATH = path.join(".gameaistudio", "agent-journal.md");
const DEFAULT_JOURNAL_TAIL_CHARS = 5000;
const DEFAULT_OUTPUT_CHARS = 3600;

export function getAgentJournalPath(projectRoot: string): string {
  return path.join(projectRoot, AGENT_JOURNAL_RELATIVE_PATH);
}

function oneLine(value: string, maxLength = 360): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return "?";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatFileChange(change: ProjectFileChange): string {
  const size =
    change.kind === "deleted"
      ? `${formatBytes(change.beforeSize)} -> deleted`
      : change.kind === "added"
        ? `new ${formatBytes(change.afterSize)}`
        : `${formatBytes(change.beforeSize)} -> ${formatBytes(change.afterSize)}`;
  return `- ${change.kind}: ${change.path} (${size})`;
}

function trimOutput(value: string, maxLength = DEFAULT_OUTPUT_CHARS): string {
  const normalized = value.trim().replace(/```/g, "'''");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}\n\n[output truncated]`;
}

export function buildAgentJournalEntry(input: {
  project: StudioProject;
  agentId: string;
  cliToolId: CliToolId;
  userMessage: string;
  agentMessage: AgentMessage;
  status: "completed" | "failed" | "cancelled";
  fileChanges: ProjectFileChange[];
  contextPath?: string;
}): string {
  const agent = AGENT_PROFILES.find((profile) => profile.id === input.agentId);
  const agentTitle = agent?.title ?? input.agentId;
  const fileChangeLines =
    input.fileChanges.length > 0
      ? input.fileChanges.slice(0, 40).map(formatFileChange)
      : ["- none"];
  const omittedChanges = input.fileChanges.length > 40 ? [`- ... ${input.fileChanges.length - 40} more file changes`] : [];
  const output = trimOutput(input.agentMessage.content) || "(empty)";

  return [
    `## ${input.agentMessage.createdAt} - ${agentTitle} / ${CLI_TOOL_LABELS[input.cliToolId]}`,
    "",
    `- Project: ${input.project.name} (${input.project.dimension.toUpperCase()})`,
    `- Status: ${input.status}`,
    `- Exit code: ${input.agentMessage.exitCode ?? "n/a"}`,
    `- Duration: ${input.agentMessage.durationMs ?? 0} ms`,
    `- User request: ${oneLine(input.userMessage)}`,
    input.contextPath ? `- Context: ${input.contextPath}` : undefined,
    "",
    "### Changed Files",
    "",
    ...fileChangeLines,
    ...omittedChanges,
    "",
    "### Agent Output",
    "",
    "```text",
    output,
    "```",
    ""
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export async function appendAgentJournal(projectRoot: string, entry: string): Promise<string> {
  const journalPath = getAgentJournalPath(projectRoot);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await appendFile(journalPath, `${entry.trimEnd()}\n\n`, "utf8");
  return journalPath;
}

export async function readAgentJournalTail(projectRoot: string, maxChars = DEFAULT_JOURNAL_TAIL_CHARS): Promise<string> {
  try {
    const journal = await readFile(getAgentJournalPath(projectRoot), "utf8");
    if (journal.length <= maxChars) {
      return journal.trim();
    }
    return journal.slice(-maxChars).trim();
  } catch {
    return "";
  }
}
