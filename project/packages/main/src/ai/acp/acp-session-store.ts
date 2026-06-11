import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Persists ACP session ids per conversation thread so turns can resume the
 * provider-side session (`session/load`) instead of cold-starting. Stored in
 * the project's `.gameaistudio/` dir so continuity survives app restarts.
 * Every operation is failure-tolerant — losing a session id only costs one
 * cold start.
 */

interface SessionFile {
  [key: string]: { sessionId: string; updatedAt: string };
}

function sessionFilePath(workingDir: string): string {
  return path.join(workingDir, ".gameaistudio", "acp-session-ids.json");
}

async function readFileSafe(workingDir: string): Promise<SessionFile> {
  try {
    const raw = await readFile(sessionFilePath(workingDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as SessionFile)
      : {};
  } catch {
    return {};
  }
}

export async function readAcpSessionId(
  workingDir: string,
  key: string,
): Promise<string | undefined> {
  const sessions = await readFileSafe(workingDir);
  const sessionId = sessions[key]?.sessionId;
  return typeof sessionId === "string" && sessionId ? sessionId : undefined;
}

export async function writeAcpSessionId(
  workingDir: string,
  key: string,
  sessionId: string,
): Promise<void> {
  try {
    const sessions = await readFileSafe(workingDir);
    sessions[key] = { sessionId, updatedAt: new Date().toISOString() };
    await mkdir(path.dirname(sessionFilePath(workingDir)), { recursive: true });
    await writeFile(sessionFilePath(workingDir), JSON.stringify(sessions, null, 2), "utf8");
  } catch {
    // best effort — next turn cold-starts
  }
}

export async function clearAcpSessionId(workingDir: string, key: string): Promise<void> {
  try {
    const sessions = await readFileSafe(workingDir);
    if (!(key in sessions)) return;
    delete sessions[key];
    await writeFile(sessionFilePath(workingDir), JSON.stringify(sessions, null, 2), "utf8");
  } catch {
    // best effort
  }
}
