import type { GodotRunResult } from "@gameaistudio/shared";
import {
  ProcessRegistry,
  runProcess,
} from "../../services/process-runner";
import {
  hasCliPermissionFailure,
  processOutput,
  tailText,
} from "../../services/cli-diagnostics";
import { getProjectLogger } from "../../services/logger";
import {
  findExecutableInDirectory,
  type RuntimeEnvironment,
} from "../runtime-environment";
import type {
  AdapterCapabilities,
  AdapterHealth,
  AdapterImageInput,
  AgentTurnRequest,
  AiAdapter,
  DiscoverResult,
  HealthOptions,
  TurnChunk,
} from "../adapter-contract";
import {
  appendAndExtractStructuredDeltas,
  parseLocalCliOutput,
  type LocalCliOutputFormat,
} from "./local-cli-output";

export type LocalCliConfig = {
  id: string;
  label: string;
  command: string;
  versionArgs: string[];
  /** Args for a headless prompt run; the prompt itself is delivered via stdin. */
  promptArgs: string[];
  /** How stdout should be interpreted before it is shown to the user. */
  outputFormat?: LocalCliOutputFormat;
  /** Optional image argv builder for CLIs that accept real image attachments. */
  imageArgs?: (images: AdapterImageInput[]) => string[];
  installCommand: string[];
  installHint: string;
  credentialEnvVars: string[];
  credentialHint: string;
  capabilities: AdapterCapabilities;
  /**
   * A cheap headless invocation used by `health()` to detect login/401 issues
   * that `--version` cannot. Run explicitly (e.g. a settings "test" action),
   * never on every discover.
   */
  headlessProbe?: { prompt: string; timeoutMs?: number };
};

export type LocalCliAdapter = AiAdapter & { readonly config: LocalCliConfig };

type Runner = typeof runProcess;

const AUTH_FAILURE = /\b401\b|unauthor|forbidden|not\s+logged\s*in|please\s+log\s*in|login\s+required|invalid\s+api\s*key/i;

const firstLine = (text: string): string | undefined =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

function buildPromptArgs(config: LocalCliConfig, req: AgentTurnRequest): string[] {
  const args = [...config.promptArgs];
  const imageArgs = config.imageArgs?.(req.images) ?? [];
  if (imageArgs.length === 0) {
    return args;
  }

  const stdinPromptIndex = args.lastIndexOf("-");
  if (stdinPromptIndex === -1) {
    return [...args, ...imageArgs];
  }

  return [
    ...args.slice(0, stdinPromptIndex),
    ...imageArgs,
    ...args.slice(stdinPromptIndex)
  ];
}

/**
 * Builds a local-CLI adapter: a CLI spawned on the user's machine. All per-CLI
 * variation (command, prompt args, install, credentials, capabilities, headless
 * probe) lives in `config`; the lifecycle (discover/health/install/runTurn) is
 * shared. The process runner is injectable so adapters unit-test with a fake.
 */
export function createLocalCliAdapter(
  config: LocalCliConfig,
  deps: { runner?: Runner } = {},
): LocalCliAdapter {
  const runner = deps.runner ?? runProcess;

  const resolveExecutable = async (
    env: RuntimeEnvironment,
  ): Promise<string | undefined> => {
    const onPath = await env.which(config.command);
    if (onPath) return onPath;
    // Fallback: an npm-installed CLI whose global bin is not on PATH.
    const manager = config.installCommand[0] ?? "npm";
    const npmExecutable = await env.which(manager);
    const globalBin = npmExecutable
      ? await env.npmGlobalBin(npmExecutable)
      : undefined;
    return findExecutableInDirectory(config.command, globalBin, env.platform);
  };

  const discover = async (
    env: RuntimeEnvironment,
  ): Promise<DiscoverResult> => {
    const executablePath = await resolveExecutable(env);
    return executablePath
      ? { found: true, executablePath }
      : { found: false };
  };

  const health = async (
    env: RuntimeEnvironment,
    options: HealthOptions = {},
  ): Promise<AdapterHealth> => {
    const executablePath = await resolveExecutable(env);
    if (!executablePath) {
      return {
        installed: false,
        authed: "unknown",
        headlessOk: "unknown",
        detail: "未在 PATH 或安装目录中找到该 CLI。",
      };
    }

    const version = await runner(executablePath, config.versionArgs, {
      timeoutMs: 4000,
    });
    const versionText = firstLine(version.stdout || version.stderr);

    // Credential presence (cheap, env-based). Not the same as "logged in".
    const hasCredEnv = config.credentialEnvVars.some((name) =>
      Boolean(env.env[name]?.trim()),
    );

    let headlessOk: AdapterHealth["headlessOk"] = "unknown";
    let authed: AdapterHealth["authed"] = hasCredEnv ? true : "unknown";
    let detail: string | undefined;

    // The headless probe makes a real model call — only run it on an explicit
    // request (default), never on discovery (`{ probe: false }`).
    if (options.probe !== false && config.headlessProbe) {
      const probe = await runner(executablePath, config.promptArgs, {
        stdin: config.headlessProbe.prompt,
        timeoutMs: config.headlessProbe.timeoutMs ?? 20000,
      });
      const combined = `${probe.stdout}\n${probe.stderr}`;
      if (AUTH_FAILURE.test(combined)) {
        headlessOk = false;
        authed = false;
        detail = "非交互模式返回未授权（如 401 / 未登录）。请在该 CLI 内完成登录或配置凭据。";
      } else if (probe.exitCode === 0) {
        headlessOk = true;
        if (authed === "unknown") authed = true;
      } else {
        headlessOk = false;
        detail =
          firstLine(probe.stderr) ?? `非交互探测退出码 ${probe.exitCode}。`;
      }
    }

    return {
      installed: version.exitCode === 0,
      authed,
      headlessOk,
      ...(versionText ? { version: versionText } : {}),
      ...(detail ? { detail } : {}),
    };
  };

  const install = async (
    env: RuntimeEnvironment,
  ): Promise<GodotRunResult> => {
    const startedAt = Date.now();
    const manager = config.installCommand[0] ?? "npm";
    const managerExecutable = await env.which(manager);
    if (!managerExecutable) {
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `未检测到 ${manager}，无法在应用内安装 CLI。请先安装 ${manager} 后刷新。`,
        durationMs: Date.now() - startedAt,
      };
    }
    const [, ...args] = config.installCommand;
    const result = await runner(managerExecutable, args, {
      timeoutMs: 20 * 60 * 1000,
    });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    };
  };

  async function* runTurn(
    req: AgentTurnRequest,
    env: RuntimeEnvironment,
  ): AsyncIterable<TurnChunk> {
    const executablePath = (await resolveExecutable(env)) ?? config.command;
    const promptArgs = buildPromptArgs(config, req);
    const plog = getProjectLogger(req.workingDir);

    const registry = new ProcessRegistry();
    const key = "turn:active";
    if (req.signal.aborted) registry.cancel(key);
    const onAbort = () => registry.cancel(key);
    req.signal.addEventListener("abort", onAbort, { once: true });

    // Bridge the runner's stdout callback into an async stream.
    const queue: TurnChunk[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let structuredStdoutBuffer = "";
    const push = (chunk: TurnChunk) => {
      queue.push(chunk);
      wake?.();
    };

    plog.info("cli-adapter", "启动本地 CLI", {
      adapterId: config.id,
      adapter: config.label,
      command: config.command,
      executablePath,
      args: promptArgs,
      cwd: req.workingDir,
      contextPath: req.contextPath,
      promptLength: req.prompt.length,
      imageCount: req.images.length,
      imagePaths: req.images.map((image) => image.path ?? image.name),
      timeoutMs: 15 * 60 * 1000,
    });
    push({
      type: "step",
      title: `${config.label} CLI 启动：${config.command} ${promptArgs.join(" ")}`,
    });

    const task = runner(executablePath, promptArgs, {
      cwd: req.workingDir,
      stdin: req.prompt,
      timeoutMs: 15 * 60 * 1000,
      processKey: key,
      registry,
      onStdout: (chunk) => {
        const extracted = appendAndExtractStructuredDeltas({
          format: config.outputFormat,
          buffer: structuredStdoutBuffer,
          chunk,
        });
        structuredStdoutBuffer = extracted.buffer;
        for (const delta of extracted.deltas) {
          if (delta.text) push({ type: "text-delta", text: delta.text });
          if (delta.stderr) push({ type: "stderr-delta", text: delta.stderr });
        }
      },
      onStderr: (chunk) => push({ type: "stderr-delta", text: chunk }),
    })
      .then((result) => {
        const parsedOutput = parseLocalCliOutput(config.outputFormat, result);
        const normalizedResult = {
          ...result,
          stdout: parsedOutput.content,
          stderr: parsedOutput.stderr,
        };
        const combinedOutput = processOutput(normalizedResult);
        const permissionFailure = hasCliPermissionFailure(combinedOutput);
        plog.log(result.exitCode === 0 && !permissionFailure ? "info" : "warn", "cli-adapter", "本地 CLI 结束", {
          adapterId: config.id,
          adapter: config.label,
          executablePath,
          args: promptArgs,
          cwd: req.workingDir,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          cancelled: result.cancelled,
          timedOut: result.timedOut,
          detectedPermissionFailure: permissionFailure,
          outputFormat: config.outputFormat ?? "plain",
          sessionId: parsedOutput.sessionId,
          parsedStdoutTail: tailText(normalizedResult.stdout, 2000),
          parsedStderrTail: tailText(normalizedResult.stderr, 2000),
          rawStdoutTail: tailText(result.stdout, 2000),
          rawStderrTail: tailText(result.stderr, 2000),
        });
        push({
          type: "final",
          content: normalizedResult.stdout,
          stderr: normalizedResult.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          cancelled: result.cancelled,
          timedOut: result.timedOut,
        });
      })
      .catch((error: unknown) => {
        plog.error("cli-adapter", "本地 CLI 调用异常", {
          adapterId: config.id,
          adapter: config.label,
          executablePath,
          args: promptArgs,
          cwd: req.workingDir,
          error: error instanceof Error ? error.message : String(error),
        });
        push({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
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
      await task;
    }
  }

  return {
    id: config.id,
    label: config.label,
    capabilities: config.capabilities,
    config,
    discover,
    health,
    install,
    runTurn,
  };
}
