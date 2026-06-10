import type { ProcessRunResult } from "../../services/process-runner";

export type LocalCliOutputFormat = "plain" | "codex-jsonl" | "claude-stream-json";

export type ParsedLocalCliOutput = {
  content: string;
  stderr: string;
  sessionId?: string;
  model?: string;
  errorMessage?: string;
};

type JsonRecord = Record<string, unknown>;

function parseJsonLine(line: string): JsonRecord | null {
  try {
    const value = JSON.parse(line) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asObject(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readClaudeAssistantText(event: JsonRecord): string {
  if (asString(event.type) !== "assistant") return "";
  const message = asObject(event.message);
  const content = Array.isArray(message.content) ? message.content : [];
  const parts: string[] = [];

  for (const entry of content) {
    const block = asObject(entry);
    if (asString(block.type) === "text") {
      const text = asString(block.text);
      if (text) parts.push(text);
    }
  }

  return parts.join("\n\n");
}

function readCodexAgentMessage(event: JsonRecord): string {
  if (asString(event.type) !== "item.completed") return "";
  const item = asObject(event.item);
  return asString(item.type) === "agent_message" ? asString(item.text).trim() : "";
}

function readCodexErrorMessage(event: JsonRecord): string {
  const type = asString(event.type);
  if (type === "error") return asString(event.message).trim();
  if (type !== "turn.failed") return "";
  const error = asObject(event.error);
  return asString(error.message).trim();
}

export function parseCodexJsonl(stdout: string, stderr = ""): ParsedLocalCliOutput {
  let sessionId = "";
  let content = "";
  let errorMessage = "";

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJsonLine(line);
    if (!event) continue;

    if (asString(event.type) === "thread.started") {
      sessionId = asString(event.thread_id, sessionId);
      continue;
    }

    const agentMessage = readCodexAgentMessage(event);
    if (agentMessage) {
      content = agentMessage;
      continue;
    }

    const eventError = readCodexErrorMessage(event);
    if (eventError) {
      errorMessage = eventError;
    }
  }

  return {
    content: content || (errorMessage ? "" : stdout),
    stderr: errorMessage ? [errorMessage, stderr].filter(Boolean).join("\n") : stderr,
    ...(sessionId ? { sessionId } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

export function parseClaudeStreamJson(stdout: string, stderr = ""): ParsedLocalCliOutput {
  let sessionId = "";
  let model = "";
  let finalResult: JsonRecord | null = null;
  const assistantTexts: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJsonLine(line);
    if (!event) continue;

    const type = asString(event.type);
    if (type === "system" && asString(event.subtype) === "init") {
      sessionId = asString(event.session_id, sessionId);
      model = asString(event.model, model);
      continue;
    }

    if (type === "assistant") {
      sessionId = asString(event.session_id, sessionId);
      const text = readClaudeAssistantText(event);
      if (text) assistantTexts.push(text);
      continue;
    }

    if (type === "result") {
      finalResult = event;
      sessionId = asString(event.session_id, sessionId);
    }
  }

  const resultText = finalResult ? asString(finalResult.result).trim() : "";
  const summary = resultText || assistantTexts.join("\n\n").trim();
  const isError = finalResult?.is_error === true;
  const subtype = finalResult ? asString(finalResult.subtype).trim() : "";
  const errorMessage = isError ? ["Claude run failed", subtype, summary].filter(Boolean).join(": ") : "";

  return {
    content: summary || stdout,
    stderr: errorMessage ? [errorMessage, stderr].filter(Boolean).join("\n") : stderr,
    ...(sessionId ? { sessionId } : {}),
    ...(model ? { model } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

export function parseLocalCliOutput(
  format: LocalCliOutputFormat | undefined,
  result: Pick<ProcessRunResult, "stdout" | "stderr">,
): ParsedLocalCliOutput {
  switch (format) {
    case "codex-jsonl":
      return parseCodexJsonl(result.stdout, result.stderr);
    case "claude-stream-json":
      return parseClaudeStreamJson(result.stdout, result.stderr);
    default:
      return {
        content: result.stdout,
        stderr: result.stderr,
      };
  }
}

export function extractStructuredTextDelta(
  format: LocalCliOutputFormat | undefined,
  line: string,
): { text?: string; stderr?: string } {
  const event = parseJsonLine(line.trim());
  if (!event) return {};

  if (format === "codex-jsonl") {
    const text = readCodexAgentMessage(event);
    if (text) return { text };
    const error = readCodexErrorMessage(event);
    return error ? { stderr: error } : {};
  }

  if (format === "claude-stream-json") {
    const text = readClaudeAssistantText(event);
    if (text) return { text };
    if (asString(event.type) === "result" && event.is_error === true) {
      const resultText = asString(event.result).trim();
      return resultText ? { stderr: resultText } : {};
    }
  }

  return {};
}

export function appendAndExtractStructuredDeltas(input: {
  format: LocalCliOutputFormat | undefined;
  buffer: string;
  chunk: string;
}): { buffer: string; deltas: Array<{ text?: string; stderr?: string }> } {
  if (!input.format || input.format === "plain") {
    return { buffer: "", deltas: [{ text: input.chunk }] };
  }

  const combined = `${input.buffer}${input.chunk}`;
  const lines = combined.split(/\r?\n/);
  const endsWithNewline = /\r?\n$/.test(combined);
  const completeLines = endsWithNewline ? lines : lines.slice(0, -1);
  const buffer = endsWithNewline ? "" : lines.at(-1) ?? "";
  const deltas = completeLines
    .map((line) => extractStructuredTextDelta(input.format, line))
    .filter((delta) => Boolean(delta.text || delta.stderr));

  return { buffer, deltas };
}
