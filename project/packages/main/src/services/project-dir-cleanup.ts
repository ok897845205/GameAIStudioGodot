import { rm } from "node:fs/promises";
import { runProcess } from "./process-runner";
import { getAppLogger } from "./logger";

/**
 * Deleting a project directory fails with EBUSY/ENOTEMPTY/EPERM on Windows when
 * something still holds it open — typically an orphaned child the app spawned
 * (a Godot editor opened with `--path <dir>`, or an agent whose cwd was inside
 * it) that survived a previous, abruptly-closed session.
 *
 * Strategy: try to remove; if it's locked, best-effort kill processes that
 * reference the directory, then retry with backoff.
 */

const LOCK_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"]);

function isLockError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && LOCK_CODES.has((error as NodeJS.ErrnoException).code ?? ""));
}

/**
 * Best-effort kill of processes whose command line references `dir`. Windows
 * only (PowerShell); a no-op elsewhere. Catches the orphaned Godot editor,
 * whose command line contains `--path <dir>`. Excludes the current process.
 */
async function killProcessesUsingDir(dir: string): Promise<number> {
  if (process.platform !== "win32") return 0;
  // Escape single quotes for the PowerShell single-quoted string literal.
  const escaped = dir.replace(/'/g, "''");
  const script = [
    `$me = $PID;`,
    `$dir = '${escaped}';`,
    `$procs = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and $_.CommandLine.Contains($dir) };`,
    `$n = 0;`,
    `foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $n++ } catch {} }`,
    `Write-Output $n`
  ].join(" ");
  try {
    const result = await runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeoutMs: 15_000 });
    const n = parseInt(result.stdout.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Removes `dir` recursively, recovering from a locked directory by killing the
 * processes that reference it and retrying. Throws the last error if it still
 * can't be removed.
 */
export async function removeProjectDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
    return;
  } catch (error) {
    if (!isLockError(error)) throw error;
  }

  const killed = await killProcessesUsingDir(dir);
  if (killed > 0) {
    getAppLogger().warn("project", "删除项目前终止了占用目录的残留进程", { dir, killed });
  }

  // Windows releases the handle a moment after the holder exits — retry with backoff.
  const delays = [150, 300, 600, 1000, 1500];
  let lastError: unknown;
  for (const delay of delays) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isLockError(error)) throw error;
    }
  }
  throw new Error(
    `项目目录被占用，无法删除：${dir}。可能有残留的 Godot 编辑器或 AI 进程还在运行——请在任务管理器结束相关进程（Godot / node / codex）后重试，或重启电脑。`,
    { cause: lastError }
  );
}
