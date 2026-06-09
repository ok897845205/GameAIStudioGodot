import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

interface ProcessLaunch {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface ProcessRunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  processKey?: string;
  registry?: ProcessRegistry;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ProcessRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  cancelled: boolean;
  timedOut: boolean;
}

export function isWindowsCommandShim(command: string, platform = process.platform): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

function quoteWindowsCmdArgument(value: string): string {
  return `"${value.replace(/\r\n?|\n/g, " ").replace(/"/g, '""')}"`;
}

export function buildProcessLaunch(
  command: string,
  args: string[],
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ProcessLaunch {
  if (!isWindowsCommandShim(command, platform)) {
    return { command, args };
  }

  const comspec = env.ComSpec ?? env.COMSPEC ?? "cmd.exe";
  const commandLine = `"${[command, ...args].map(quoteWindowsCmdArgument).join(" ")}"`;
  return {
    command: comspec,
    args: ["/d", "/v:off", "/c", commandLine],
    windowsVerbatimArguments: true
  };
}

export class ProcessRegistry {
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly cancelled = new Set<string>();

  register(key: string, child: ChildProcessWithoutNullStreams): void {
    this.cancelled.delete(key);
    this.active.set(key, child);
  }

  unregister(key: string): void {
    this.active.delete(key);
    setTimeout(() => this.cancelled.delete(key), 1000);
  }

  cancel(key: string): boolean {
    const child = this.active.get(key);
    if (!child) {
      return false;
    }
    this.cancelled.add(key);
    child.kill("SIGTERM");
    return true;
  }

  cancelRun(runId: string): number {
    let count = 0;
    for (const key of this.active.keys()) {
      if (key.startsWith(`${runId}:`) && this.cancel(key)) {
        count += 1;
      }
    }
    return count;
  }

  isCancelled(key: string): boolean {
    return this.cancelled.has(key);
  }
}

export function runProcess(command: string, args: string[], options: ProcessRunOptions = {}): Promise<ProcessRunResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const launch = buildProcessLaunch(command, args, process.platform, { ...process.env, ...options.env });
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments
      });
    } catch (error) {
      resolve({
        exitCode: null,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        cancelled: false,
        timedOut
      });
      return;
    }

    if (options.processKey && options.registry) {
      options.registry.register(options.processKey, child);
    }
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin ?? "");
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return;
          }
          timedOut = true;
          stderr += `\nProcess timed out after ${options.timeoutMs}ms.`;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      const cancelled = Boolean(options.processKey && options.registry?.isCancelled(options.processKey));
      if (options.processKey && options.registry) {
        options.registry.unregister(options.processKey);
      }
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr ? `${stderr}\n${error.message}` : error.message,
        durationMs: Date.now() - startedAt,
        cancelled,
        timedOut
      });
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      const cancelled = Boolean(options.processKey && options.registry?.isCancelled(options.processKey));
      if (cancelled && !stderr.includes("Process cancelled by user.")) {
        stderr += stderr ? "\nProcess cancelled by user." : "Process cancelled by user.";
      }
      if (options.processKey && options.registry) {
        options.registry.unregister(options.processKey);
      }
      resolve({
        exitCode: cancelled ? null : exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        cancelled,
        timedOut
      });
    });
  });
}
