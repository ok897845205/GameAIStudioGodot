import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildProcessLaunch } from "../../services/process-runner";

/**
 * Minimal Agent Client Protocol (ACP) client.
 *
 * ACP is JSON-RPC 2.0 over newline-delimited JSON on the agent process's
 * stdio (https://agentclientprotocol.com). GameAIStudio is the *client*
 * (like an editor); the spawned process (e.g. `claude-code-acp`) is the
 * *agent*. This module owns only the wire protocol — turn semantics live in
 * `acp-agent-adapter.ts`.
 *
 * Implemented deliberately tolerant: unknown notification fields are passed
 * through, unknown server requests get a JSON-RPC "method not found" reply.
 */

export type JsonRecord = Record<string, unknown>;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface AcpClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Handles agent→client notifications (e.g. `session/update`). */
  onNotification?: (method: string, params: JsonRecord) => void;
  /**
   * Handles agent→client requests (e.g. `session/request_permission`).
   * Return the result payload; throw to send a JSON-RPC error.
   */
  onRequest?: (method: string, params: JsonRecord) => Promise<unknown> | unknown;
  /** Raw stderr passthrough for diagnostics. */
  onStderr?: (chunk: string) => void;
  /** Called once when the process exits (for whatever reason). */
  onExit?: (code: number | null) => void;
}

export class AcpClientError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AcpClientError";
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export class AcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private stdoutBuffer = "";
  private closed = false;
  private exitCode: number | null = null;
  private stderrTail = "";

  constructor(private readonly options: AcpClientOptions) {
    // `claude-code-acp` installs as an npm .cmd shim on Windows.
    const launch = buildProcessLaunch(options.command, options.args ?? []);
    this.child = spawn(launch.command, launch.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdin.on("error", () => undefined);
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000);
      this.options.onStderr?.(chunk);
    });
    this.child.on("error", (error) => this.failAll(new AcpClientError(`ACP agent 启动失败：${error.message}`)));
    this.child.on("close", (code) => {
      this.exitCode = code;
      this.closed = true;
      this.options.onExit?.(code);
      this.failAll(
        new AcpClientError(
          `ACP agent 进程已退出（exitCode=${code ?? "unknown"}）。${this.stderrTail ? `\n${this.stderrTail.trim().slice(-600)}` : ""}`,
        ),
      );
    });
  }

  get lastStderr(): string {
    return this.stderrTail;
  }

  get processExitCode(): number | null {
    return this.exitCode;
  }

  /** Sends a client→agent request and resolves with its result. */
  request<T = JsonRecord>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new AcpClientError("ACP agent 进程已退出。"));
    }
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.writeLine(payload);
    });
  }

  /** Sends a client→agent notification (no response expected). */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.writeLine({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  /** Terminates the agent process. Safe to call repeatedly. */
  dispose(): void {
    if (!this.closed) {
      this.child.kill("SIGTERM");
    }
  }

  private writeLine(payload: unknown): void {
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      // stdin already closed; the close handler will reject pending requests.
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.onLine(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let message: JsonRecord;
    try {
      const parsed = JSON.parse(line) as unknown;
      message = asRecord(parsed);
    } catch {
      // Non-JSON noise on stdout (some agents log there); ignore.
      return;
    }

    // Response to one of our requests.
    if ("id" in message && !("method" in message)) {
      const response = message as unknown as JsonRpcResponse;
      const entry = typeof response.id === "number" ? this.pending.get(response.id) : undefined;
      if (!entry) return;
      this.pending.delete(response.id as number);
      if (response.error) {
        entry.reject(new AcpClientError(response.error.message, response.error.code, response.error.data));
      } else {
        entry.resolve(response.result ?? {});
      }
      return;
    }

    const method = typeof message.method === "string" ? message.method : undefined;
    if (!method) return;
    const params = asRecord(message.params);

    // Agent→client request: must answer.
    if ("id" in message) {
      const id = message.id as number | string;
      void this.handleServerRequest(id, method, params);
      return;
    }

    // Agent→client notification.
    this.options.onNotification?.(method, params);
  }

  private async handleServerRequest(id: number | string, method: string, params: JsonRecord): Promise<void> {
    if (!this.options.onRequest) {
      this.writeLine({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
      return;
    }
    try {
      const result = await this.options.onRequest(method, params);
      this.writeLine({ jsonrpc: "2.0", id, result: result ?? {} });
    } catch (error) {
      this.writeLine({
        jsonrpc: "2.0",
        id,
        error: {
          code: error instanceof AcpClientError && error.code !== undefined ? error.code : -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }
}
