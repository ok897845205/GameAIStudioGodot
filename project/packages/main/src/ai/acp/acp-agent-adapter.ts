import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GodotRunResult } from "@gameaistudio/shared";
import { sanitizeCliText } from "../../services/cli-text";
import { getProjectLogger } from "../../services/logger";
import {
  findExecutableInDirectory,
  wellKnownExecutableDirs,
  type RuntimeEnvironment,
} from "../runtime-environment";
import type {
  AdapterHealth,
  AgentTurnRequest,
  AiAdapter,
  DiscoverResult,
  HealthOptions,
  TurnChunk,
} from "../adapter-contract";
import { AcpClient, type JsonRecord } from "./acp-client";
import {
  clearAcpSessionId,
  readAcpSessionId,
  writeAcpSessionId,
} from "./acp-session-store";

/**
 * Runs an agent turn over the Agent Client Protocol instead of a one-shot
 * headless CLI invocation. The spawned process (e.g. `claude-code-acp`) is a
 * full agentic engine; ACP gives us:
 *  - native streaming chunks (`agent_message_chunk`)
 *  - live tool visibility (`tool_call` / `tool_call_update` → step chunks)
 *  - per-action permission requests, auto-approved here but fully audited in
 *    the agent log (vs. the headless path's blanket bypass flag)
 */
export type AcpAgentConfig = {
  id: string;
  label: string;
  /** Executable that speaks ACP on stdio, e.g. `claude-code-acp`. */
  agentCommand: string;
  /**
   * Fallback executable names sharing the same args (e.g. Cursor ships as
   * `cursor-agent`, newer installs as `agent`). Tried in order after
   * `agentCommand`.
   */
  alternateCommands?: string[];
  agentArgs?: string[];
  env?: NodeJS.ProcessEnv;
  /**
   * For ACP adapters that drive another CLI (e.g. `claude-code-acp` driving
   * KSCC): the host CLI must also exist, and its resolved path is exported to
   * the adapter process via `envVar` (e.g. CLAUDE_CODE_EXECUTABLE).
   */
  hostCli?: { command: string; envVar: string };
  installCommand: string[];
  installHint: string;
  timeoutMs?: number;
};

export const ACP_PROTOCOL_VERSION = 1;

export async function resolveAcpAgentExecutable(
  env: RuntimeEnvironment,
  command: string,
  alternates: string[] = [],
): Promise<string | undefined> {
  for (const candidate of [command, ...alternates]) {
    const onPath = await env.which(candidate);
    if (onPath) return onPath;
    const npmExecutable = await env.which("npm");
    const globalBin = npmExecutable ? await env.npmGlobalBin(npmExecutable) : undefined;
    const inGlobalBin = findExecutableInDirectory(candidate, globalBin, env.platform);
    if (inGlobalBin) return inGlobalBin;
    for (const dir of wellKnownExecutableDirs(env, candidate)) {
      const found = findExecutableInDirectory(candidate, dir, env.platform);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Extracts the JS entry an npm `.cmd` shim points at (the
 * `"%dp0%\node_modules\<pkg>\cli.js"` line), resolved to an absolute path.
 */
export async function readCmdShimTarget(shimPath: string): Promise<string | undefined> {
  try {
    const content = await readFile(shimPath, "utf8");
    const match = /"%dp0%[\\/]([^"]+\.(?:js|cjs|mjs))"/i.exec(content);
    if (!match?.[1]) return undefined;
    return path.join(path.dirname(shimPath), match[1]);
  } catch {
    return undefined;
  }
}

/**
 * Resolves a host CLI (exported via env to an ACP adapter, e.g.
 * CLAUDE_CODE_EXECUTABLE) to something the adapter's internal `spawn` can
 * actually run. On Windows, npm installs a `.cmd` shim — Node refuses to
 * spawn those without a shell (EINVAL, CVE-2024-27980), so prefer the sibling
 * native `.exe`, then the shim's JS entry (SDKs run `.js` paths via node).
 */
export async function resolveSpawnableHostCliPath(
  env: RuntimeEnvironment,
  command: string,
): Promise<string | undefined> {
  const raw = await resolveAcpAgentExecutable(env, command);
  if (!raw) return undefined;
  if (!/\.(cmd|bat)$/i.test(raw)) return raw;
  const exeSibling = raw.replace(/\.(cmd|bat)$/i, ".exe");
  if (existsSync(exeSibling)) return exeSibling;
  const shimTarget = await readCmdShimTarget(raw);
  if (shimTarget && existsSync(shimTarget)) return shimTarget;
  return undefined;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/** Picks the least-privileged "allow" option from a permission request. */
export function chooseAcpPermissionOption(
  options: unknown,
): { optionId: string; name: string } | undefined {
  if (!Array.isArray(options)) return undefined;
  const parsed = options.map((option) => {
    const record = asRecord(option);
    return {
      optionId: asString(record.optionId),
      name: asString(record.name),
      kind: asString(record.kind),
    };
  });
  const allowOnce = parsed.find((option) => option.kind === "allow_once");
  const anyAllow = parsed.find((option) => option.kind.startsWith("allow"));
  const chosen = allowOnce ?? anyAllow ?? parsed[0];
  return chosen?.optionId ? { optionId: chosen.optionId, name: chosen.name } : undefined;
}

/** Translates one `session/update` payload into zero or more turn chunks. */
export function acpUpdateToChunks(update: JsonRecord): TurnChunk[] {
  const kind = asString(update.sessionUpdate);
  if (kind === "agent_message_chunk") {
    const content = asRecord(update.content);
    const text = asString(content.text);
    return text ? [{ type: "text-delta", text: sanitizeCliText(text) }] : [];
  }
  if (kind === "tool_call") {
    const title = asString(update.title) || asString(update.kind) || "工具调用";
    return [{ type: "step", title: `工具：${sanitizeCliText(title)}` }];
  }
  if (kind === "tool_call_update") {
    if (asString(update.status) === "failed") {
      const title = asString(update.title) || "工具调用";
      return [{ type: "stderr-delta", text: `工具失败：${sanitizeCliText(title)}\n` }];
    }
    return [];
  }
  // agent_thought_chunk / plan / unknown updates: not user-facing in phase 1.
  return [];
}

export interface AcpProbeResult {
  ok: boolean;
  /** From `agentCapabilities.promptCapabilities.image` in the handshake. */
  imageSupport?: boolean;
  /** From `agentCapabilities.loadSession`. */
  loadSession?: boolean;
  error?: string;
}

export type AcpAgentAdapter = AiAdapter & {
  readonly acpConfig: AcpAgentConfig;
  isAvailable(env: RuntimeEnvironment): Promise<boolean>;
  /**
   * Spawns the agent for a real `initialize` handshake (no model call) and
   * reports its advertised capabilities — the truth source for the dynamic
   * image-support / session-resume reporting in the UI.
   */
  probeCapabilities(env: RuntimeEnvironment): Promise<AcpProbeResult>;
};

export function createAcpAgentAdapter(config: AcpAgentConfig): AcpAgentAdapter {
  const timeoutMs = config.timeoutMs ?? 15 * 60 * 1000;

  /**
   * Resolves everything needed to spawn the agent: the adapter executable and
   * the spawn env (including the host CLI path when this adapter drives one).
   * Returns undefined when either piece is missing.
   */
  const resolveSpawnContext = async (
    env: RuntimeEnvironment,
  ): Promise<{ executablePath: string; spawnEnv?: NodeJS.ProcessEnv } | undefined> => {
    const executablePath = await resolveAcpAgentExecutable(env, config.agentCommand, config.alternateCommands);
    if (!executablePath) return undefined;
    if (!config.hostCli) {
      return { executablePath, ...(config.env ? { spawnEnv: config.env } : {}) };
    }
    // Must be a path the adapter's internal spawn can execute (never a .cmd
    // shim — that EINVALs on Windows); unusable host → ACP unavailable and the
    // headless fallback takes over.
    const hostPath = await resolveSpawnableHostCliPath(env, config.hostCli.command);
    if (!hostPath) return undefined;
    return {
      executablePath,
      spawnEnv: { ...config.env, [config.hostCli.envVar]: hostPath },
    };
  };

  const discover = async (env: RuntimeEnvironment): Promise<DiscoverResult> => {
    const context = await resolveSpawnContext(env);
    return context
      ? { found: true, executablePath: context.executablePath, source: "path" }
      : { found: false };
  };

  const probeCapabilities = async (env: RuntimeEnvironment): Promise<AcpProbeResult> => {
    const context = await resolveSpawnContext(env);
    if (!context) {
      return {
        ok: false,
        error: config.hostCli
          ? `未找到 ${config.agentCommand} 或宿主 CLI ${config.hostCli.command}。`
          : `未找到 ${config.agentCommand}。`,
      };
    }
    const client = new AcpClient({
      command: context.executablePath,
      args: config.agentArgs ?? [],
      env: context.spawnEnv,
    });
    const timeout = setTimeout(() => client.dispose(), 10000);
    try {
      const init = await client.request<JsonRecord>("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      });
      const agentCapabilities = asRecord(init.agentCapabilities);
      const promptCapabilities = asRecord(agentCapabilities.promptCapabilities);
      return {
        ok: true,
        imageSupport: promptCapabilities.image === true,
        loadSession: agentCapabilities.loadSession === true,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
      client.dispose();
    }
  };

  const health = async (
    env: RuntimeEnvironment,
    options?: HealthOptions,
  ): Promise<AdapterHealth> => {
    const executablePath = (await resolveSpawnContext(env))?.executablePath;
    if (!executablePath) {
      return {
        installed: false,
        authed: "unknown",
        headlessOk: "unknown",
        detail: `未找到 ${config.agentCommand}，ACP 模式不可用。`,
      };
    }
    if (options?.probe === false) {
      return { installed: true, authed: "unknown", headlessOk: "unknown" };
    }
    // The handshake is fast and free (no model call) — safe for "测试".
    const probe = await probeCapabilities(env);
    return {
      installed: true,
      authed: "unknown",
      headlessOk: "unknown",
      imagesOk: probe.ok ? probe.imageSupport : "unknown",
      ...(probe.error ? { detail: `ACP 握手失败：${probe.error}` } : {}),
    };
  };

  const install = async (): Promise<GodotRunResult> => ({
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: config.installHint,
    durationMs: 0,
  });

  async function* runTurn(
    req: AgentTurnRequest,
    env: RuntimeEnvironment,
  ): AsyncIterable<TurnChunk> {
    const startedAt = Date.now();
    const plog = getProjectLogger(req.workingDir);
    const spawnContext = await resolveSpawnContext(env);
    const executablePath = spawnContext?.executablePath;
    if (!executablePath) {
      yield { type: "error", error: `未找到 ${config.agentCommand}，无法以 ACP 模式运行。` };
      yield {
        type: "final",
        content: "",
        stderr: `未找到 ${config.agentCommand}。${config.installHint}`,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
      };
      return;
    }

    // Bridge ACP notifications into an async stream (same queue pattern as
    // the headless adapter).
    const queue: TurnChunk[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let content = "";
    let cancelled = false;
    let timedOut = false;
    const push = (chunk: TurnChunk) => {
      queue.push(chunk);
      wake?.();
    };

    plog.info("acp", "启动 ACP agent", {
      adapterId: config.id,
      agent: config.label,
      command: config.agentCommand,
      executablePath,
      cwd: req.workingDir,
      promptLength: req.prompt.length,
      imageCount: req.images.length,
      timeoutMs,
    });
    push({ type: "step", title: `${config.label} 以 ACP 模式启动（${config.agentCommand}）` });

    // `session/load` replays the whole history as session/update notifications
    // before our prompt runs; those must not re-enter the chat stream.
    let promptPhase = false;
    const client = new AcpClient({
      command: executablePath,
      args: config.agentArgs ?? [],
      cwd: req.workingDir,
      env: spawnContext.spawnEnv,
      onNotification: (method, params) => {
        if (method !== "session/update" || !promptPhase) return;
        for (const chunk of acpUpdateToChunks(asRecord(params.update))) {
          if (chunk.type === "text-delta") content += chunk.text;
          push(chunk);
        }
      },
      onRequest: (method, params) => {
        if (method === "session/request_permission") {
          const toolCall = asRecord(params.toolCall);
          const title = asString(toolCall.title) || "未命名操作";
          const option = chooseAcpPermissionOption(params.options);
          if (!option) {
            plog.warn("acp", "权限请求没有可用选项，已取消", { adapterId: config.id, title });
            return { outcome: { outcome: "cancelled" } };
          }
          // Auto-approve, but keep a per-action audit trail (the headless
          // path's bypass flag can't do this).
          plog.info("acp", "自动批准权限请求", {
            adapterId: config.id,
            title,
            optionId: option.optionId,
            optionName: option.name,
          });
          push({ type: "step", title: `已自动批准：${sanitizeCliText(title)}` });
          return { outcome: { outcome: "selected", optionId: option.optionId } };
        }
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
      },
      onStderr: (chunk) => {
        // Adapter-process stderr is internal diagnostics (tracing lines from
        // codex-acp / claude-code-acp), not user-facing output: log it, never
        // stream it into the chat. Failures still surface via final.stderr.
        const text = sanitizeCliText(chunk).trim();
        if (text) {
          plog.debug("acp", "agent 进程 stderr", {
            adapterId: config.id,
            line: text.slice(0, 600),
          });
        }
      },
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      client.dispose();
    }, timeoutMs);
    const onAbort = () => {
      cancelled = true;
      try {
        client.notify("session/cancel", { sessionId: activeSessionId });
      } catch {
        // best effort
      }
      setTimeout(() => client.dispose(), 1500);
    };
    let activeSessionId = "";
    if (req.signal.aborted) onAbort();
    req.signal.addEventListener("abort", onAbort, { once: true });

    const sessionStoreKey = req.sessionKey ? `${config.id}:${req.sessionKey}` : undefined;

    const turn = (async () => {
      const init = await client.request<JsonRecord>("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      });
      const agentCapabilities = asRecord(init.agentCapabilities);
      const promptCapabilities = asRecord(agentCapabilities.promptCapabilities);
      const supportsImageBlocks = promptCapabilities.image === true;
      const supportsLoadSession = agentCapabilities.loadSession === true;

      // Session resume: continue the provider-side conversation when the
      // agent supports it and we have a stored id for this thread.
      let resumed = false;
      const storedSessionId =
        supportsLoadSession && sessionStoreKey
          ? await readAcpSessionId(req.workingDir, sessionStoreKey)
          : undefined;
      if (storedSessionId) {
        try {
          await client.request<JsonRecord>("session/load", {
            sessionId: storedSessionId,
            cwd: req.workingDir,
            mcpServers: [],
          });
          activeSessionId = storedSessionId;
          resumed = true;
          push({ type: "step", title: "已恢复上次 ACP 会话（多轮上下文延续）" });
        } catch (error) {
          // Stale/foreign session — cold start instead.
          if (sessionStoreKey) {
            await clearAcpSessionId(req.workingDir, sessionStoreKey);
          }
          plog.warn("acp", "session/load 失败，回退新会话", {
            adapterId: config.id,
            sessionId: storedSessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!resumed) {
        const session = await client.request<JsonRecord>("session/new", {
          cwd: req.workingDir,
          mcpServers: [],
        });
        activeSessionId = asString(session.sessionId);
      }
      if (sessionStoreKey && activeSessionId) {
        await writeAcpSessionId(req.workingDir, sessionStoreKey, activeSessionId);
      }

      const promptBlocks: JsonRecord[] = [{ type: "text", text: req.prompt }];
      if (supportsImageBlocks) {
        for (const image of req.images) {
          const base64 = image.dataUrl.replace(/^data:[^;]+;base64,/, "");
          if (base64) {
            promptBlocks.push({ type: "image", mimeType: image.mimeType, data: base64 });
          }
        }
      }

      promptPhase = true;
      const result = await client.request<JsonRecord>("session/prompt", {
        sessionId: activeSessionId,
        prompt: promptBlocks,
      });
      return asString(result.stopReason, "end_turn");
    })();

    const settle = turn
      .then((stopReason) => {
        const wasCancelled = cancelled || stopReason === "cancelled";
        plog.log(wasCancelled ? "warn" : "info", "acp", "ACP 回合结束", {
          adapterId: config.id,
          agent: config.label,
          stopReason,
          cancelled: wasCancelled,
          sessionId: activeSessionId,
          durationMs: Date.now() - startedAt,
          contentLength: content.length,
        });
        push({
          type: "final",
          content,
          stderr: sanitizeCliText(client.lastStderr),
          exitCode: wasCancelled ? null : 0,
          durationMs: Date.now() - startedAt,
          cancelled: wasCancelled,
          timedOut,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        plog.error("acp", "ACP 回合失败", {
          adapterId: config.id,
          agent: config.label,
          error: message,
          cancelled,
          timedOut,
          stderrTail: sanitizeCliText(client.lastStderr).slice(-800) || undefined,
        });
        push({ type: "error", error: message });
        push({
          type: "final",
          content,
          stderr: [sanitizeCliText(client.lastStderr), message].filter(Boolean).join("\n"),
          exitCode: cancelled ? null : 1,
          durationMs: Date.now() - startedAt,
          cancelled,
          timedOut,
        });
      })
      .finally(() => {
        clearTimeout(timeout);
        client.dispose();
        finished = true;
        wake?.();
      });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    } finally {
      req.signal.removeEventListener("abort", onAbort);
      await settle;
    }
  }

  return {
    id: `${config.id}-acp`,
    label: `${config.label} (ACP)`,
    capabilities: {
      runModel: "local",
      supportsImages: true,
      imageInputMode: "base64",
      supportsStream: true,
      supportsResume: true,
      headless: true,
    },
    acpConfig: config,
    discover,
    health,
    install,
    runTurn,
    probeCapabilities,
    isAvailable: async (env) => Boolean(await resolveSpawnContext(env)),
  };
}
