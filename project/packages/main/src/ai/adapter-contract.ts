import type { CliFailureKind, GodotRunResult } from "@gameaistudio/shared";
import type { RuntimeEnvironment } from "./runtime-environment";

/**
 * How an adapter actually executes a turn. This is the runtime model, not just
 * a naming suffix:
 *  - `local`   — spawn a CLI on the user's machine (PATH/login/TTY/Windows shim).
 *  - `cloud`   — call a hosted API (HTTP), different auth/rate-limit/errors.
 *  - `gateway` — talk to a long-lived gateway (WS/HTTP) that fronts a model.
 */
export type RunModel = "local" | "cloud" | "gateway";

export type AdapterImageInput = {
  name: string;
  mimeType: string;
  /** Image as a data URL. */
  dataUrl: string;
  /**
   * Absolute on-disk path, if the host already persisted the image. Some CLIs
   * accept a path flag or reference the path inside the prompt rather than
   * base64 inline.
   */
  path?: string;
};

/**
 * Everything an adapter needs to run one agent turn. The caller does not need
 * to know any CLI's quirks — that knowledge lives in the adapter.
 */
export type AgentTurnRequest = {
  /**
   * Full prompt text — may be long and non-ASCII. Adapters MUST deliver it via
   * stdin or a temp file, never as an argv argument (encoding/length/escaping
   * on Windows).
   */
  prompt: string;
  /** Working directory the turn runs in (the project root). */
  workingDir: string;
  /** Optional path to the project-local agent context file. */
  contextPath?: string;
  /**
   * Stable identity of the conversation thread (e.g. `projectId:agentId`).
   * Adapters that support session resume use it to continue the same
   * provider-side session across turns instead of cold-starting each time.
   */
  sessionKey?: string;
  images: AdapterImageInput[];
  /** Cancellation — adapters MUST kill the child process / abort the request. */
  signal: AbortSignal;
};

/**
 * A streamed unit of a turn. Local adapters may emit a single `final`, but the
 * shape is a stream from day one so token-level streaming (and the IPC bridge
 * in front of it) is a natural extension, not a retrofit.
 */
export type TurnChunk =
  | { type: "text-delta"; text: string }
  | { type: "stderr-delta"; text: string }
  | { type: "step"; title: string }
  | { type: "error"; error: string }
  | {
      type: "final";
      content: string;
      stderr?: string;
      exitCode: number | null;
      durationMs: number;
      cancelled?: boolean;
      timedOut?: boolean;
    };

export type DiscoverySource = "path" | "npm-global" | "well-known";

export type DiscoverResult = {
  found: boolean;
  executablePath?: string;
  /** Where the executable was found — PATH, npm global bin, or a well-known install dir. */
  source?: DiscoverySource;
};

export type HealthOptions = {
  /**
   * Run the expensive headless / endpoint probe (real model call). Defaults to
   * `true`; discovery passes `false` to stay fast and avoid per-refresh API
   * calls / rate limits.
   */
  probe?: boolean;
};

/**
 * Layered health. Never collapse to a single "available": `--version` passing
 * tells you nothing about whether `--print` returns 401.
 */
export type AdapterHealth = {
  installed: boolean;
  /** Logged in / credentials present. `"unknown"` when not probed. */
  authed: boolean | "unknown";
  /** Non-interactive invocation actually works (catches `claude --print` 401). */
  headlessOk: boolean | "unknown";
  /** Can accept image input end-to-end. */
  imagesOk?: boolean | "unknown";
  /** Can write into the project directory. */
  writable?: boolean | "unknown";
  /** `false` when the latest probe hit a rate limit / quota ceiling. */
  quota?: boolean | "unknown";
  version?: string;
  /** Human-readable note for the worst failing check. */
  detail?: string;
  /** Classified kind of the most recent failure, if any. */
  lastErrorKind?: CliFailureKind;
};

export type ImageInputMode =
  | "file-flag"
  | "prompt-path-reference"
  | "base64"
  | "unsupported";

export type AdapterCapabilities = {
  runModel: RunModel;
  supportsImages: boolean;
  imageInputMode: ImageInputMode;
  supportsStream: boolean;
  supportsResume: boolean;
  headless: boolean;
};

export interface AiAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: AdapterCapabilities;

  /** How to find this adapter's executable / endpoint on this machine. */
  discover(env: RuntimeEnvironment): Promise<DiscoverResult>;
  /**
   * Layered health probe (version → auth → headless → images → writable).
   *
   * `options.probe` controls the *expensive* checks — for local CLIs the
   * headless invocation actually calls the model. It defaults to `true` (an
   * explicit "test connection"); discovery passes `{ probe: false }` so every
   * bootstrap/refresh stays fast and free of real API calls.
   */
  health(
    env: RuntimeEnvironment,
    options?: HealthOptions,
  ): Promise<AdapterHealth>;
  /** Optional install path (local CLIs via a package manager). */
  install?(env: RuntimeEnvironment): Promise<GodotRunResult>;

  /** Run one agent turn; yields streaming chunks and ends with a `final`. */
  runTurn(
    req: AgentTurnRequest,
    env: RuntimeEnvironment,
  ): AsyncIterable<TurnChunk>;
}

export type CollectedTurn = {
  content: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  durationMs: number;
  cancelled: boolean;
  timedOut: boolean;
};

/**
 * Drains a turn stream into a single result — the bridge for one-shot callers
 * (and the `CliService` facade) while the streaming IPC path is built out.
 */
export async function collectTurn(
  stream: AsyncIterable<TurnChunk>,
): Promise<CollectedTurn> {
  let content = "";
  let stderr = "";
  let exitCode: number | null = null;
  let error: string | undefined;
  let durationMs = 0;
  let cancelled = false;
  let timedOut = false;

  for await (const chunk of stream) {
    switch (chunk.type) {
      case "text-delta":
        content += chunk.text;
        break;
      case "stderr-delta":
        stderr += chunk.text;
        break;
      case "final":
        if (chunk.content) content = chunk.content;
        if (chunk.stderr) stderr = chunk.stderr;
        exitCode = chunk.exitCode;
        durationMs = chunk.durationMs;
        cancelled = Boolean(chunk.cancelled);
        timedOut = Boolean(chunk.timedOut);
        break;
      case "error":
        error = chunk.error;
        break;
      case "step":
        break;
    }
  }

  return { content, stderr, exitCode, durationMs, cancelled, timedOut, ...(error ? { error } : {}) };
}
