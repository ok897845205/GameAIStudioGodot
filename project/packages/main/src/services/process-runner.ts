import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface ProcessRunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
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
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    if (options.processKey && options.registry) {
      options.registry.register(options.processKey, child);
    }
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
