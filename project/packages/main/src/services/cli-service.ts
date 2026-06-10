import type {
  CliCredentialStatus,
  CliDiagnostic,
  CliDiscoverySource,
  CliTool,
  CliToolId,
  CliToolCapabilities,
  CliToolHealth,
  GodotRunResult,
} from "@gameaistudio/shared";
import { CLI_TOOL_LABELS } from "@gameaistudio/shared";
import { runProcess } from "./process-runner";
import {
  createRuntimeEnvironment,
  type RuntimeEnvironment,
} from "../ai/runtime-environment";
import {
  createAdapterRegistry,
  type AdapterRegistry,
} from "../ai/adapter-registry";
import type { AgentTurnRequest, TurnChunk } from "../ai/adapter-contract";
import type { LocalCliAdapter } from "../ai/adapters/local-cli-adapter";
import { getAppLogger } from "./logger";

// Re-exported from their canonical home (ai/runtime-environment) so existing
// imports/tests against `./cli-service` keep working.
export {
  selectExecutableFromLocatorOutput,
  cliExecutableCandidates,
  findExecutableInDirectory,
  npmGlobalBinPath,
} from "../ai/runtime-environment";

export function evaluateCredentialStatus(
  credentialEnvVars: string[],
  env: NodeJS.ProcessEnv = process.env
): { status: CliCredentialStatus; detectedCredentialEnvVars: string[] } {
  const detectedCredentialEnvVars = credentialEnvVars.filter((name) => Boolean(env[name]?.trim()));
  if (credentialEnvVars.length === 0) {
    return {
      status: "unknown",
      detectedCredentialEnvVars
    };
  }
  return {
    status: detectedCredentialEnvVars.length > 0 ? "configured" : "missing",
    detectedCredentialEnvVars
  };
}

function installManagerCommand(installCommand: string[]): string {
  return installCommand[0] ?? "npm";
}

export function buildInstallCommand(
  installCommand: string[],
  installManagerExecutable?: string
): { command: string; args: string[] } {
  const [command = "npm", ...args] = installCommand;
  return {
    command: installManagerExecutable ?? command,
    args
  };
}

export function buildInstallManagerUnavailableResult(installManager: string, startedAt: number): GodotRunResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: `未检测到 ${installManager}，无法在应用内安装 CLI。请先安装 ${installManager} 后刷新，或手动安装对应 AI CLI。`,
    durationMs: Date.now() - startedAt
  };
}

function shortOutput(value?: string, maxLength = 1200): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(+${text.length - maxLength})` : text;
}

async function getInstallManagerInfo(
  installCommand: string[],
  env: RuntimeEnvironment
): Promise<{ available: boolean; version?: string; globalBinPath?: string; executablePath?: string }> {
  const manager = installManagerCommand(installCommand);
  const executable = await env.which(manager);
  if (!executable) {
    return { available: false };
  }
  const [version, globalBinPath] = await Promise.all([
    runProcess(executable, ["--version"], { timeoutMs: 4000 }),
    manager === "npm" ? env.npmGlobalBin(executable) : Promise.resolve(undefined)
  ]);
  const versionText = (version.stdout || version.stderr).trim().split(/\r?\n/)[0];
  return {
    available: version.exitCode === 0,
    executablePath: executable,
    version: versionText || undefined,
    globalBinPath
  };
}

const DISCOVERY_SOURCE_LABELS: Record<CliDiscoverySource, string> = {
  path: "PATH",
  "npm-global": "npm 全局目录",
  "well-known": "常见安装目录",
};

export function buildCliDiagnostics(input: {
  installed: boolean;
  status: CliTool["status"];
  executablePath?: string;
  source?: CliDiscoverySource;
  version?: string;
  installManager: string;
  installManagerPath?: string;
  installManagerAvailable: boolean;
  installManagerVersion?: string;
  installGlobalBinPath?: string;
  credentialStatus: CliCredentialStatus;
  credentialEnvVars: string[];
  detectedCredentialEnvVars: string[];
  installHint: string;
  credentialHint: string;
  capabilities?: CliToolCapabilities;
  health?: CliToolHealth;
}): CliDiagnostic[] {
  const diagnostics: CliDiagnostic[] = [];

  if (input.installed) {
    diagnostics.push({
      id: "cli-found",
      severity: "ok",
      title: "CLI 已发现",
      detail: input.executablePath
        ? `${input.executablePath}${input.source ? `（来源：${DISCOVERY_SOURCE_LABELS[input.source]}）` : ""}`
        : "已在 PATH 中发现命令。"
    });
  } else {
    diagnostics.push({
      id: "cli-missing",
      severity: "error",
      title: "CLI 未安装或不在 PATH",
      detail: input.installHint,
      action: input.installManagerAvailable ? "点击安装，或手动安装后刷新。" : `请先安装 ${input.installManager}，再安装该 CLI。`
    });
  }

  if (input.installed && input.status === "error") {
    diagnostics.push({
      id: "cli-version-error",
      severity: "warning",
      title: input.health?.headlessOk === false ? "非交互模式异常" : "版本检测异常",
      detail:
        input.health?.detail ??
        (input.health?.headlessOk === false
          ? "命令存在，但非交互 Agent 调用失败。"
          : "命令存在，但 --version 返回异常。Agent 运行时可能失败。"),
      action:
        input.health?.headlessOk === false
          ? "在终端用该 CLI 的非交互模式测试登录状态，修复后刷新 CLI。"
          : "尝试在终端手动运行该 CLI，确认它可以正常启动。"
    });
  }

  if (input.installed && input.health?.authed === false) {
    diagnostics.push({
      id: "cli-auth-error",
      severity: "error",
      title: "认证不可用",
      detail: input.health.detail ?? input.credentialHint,
      action: input.credentialHint
    });
  }

  if (input.installed && input.health?.headlessOk === true) {
    diagnostics.push({
      id: "cli-headless-ok",
      severity: "ok",
      title: "非交互可用",
      detail: "已通过 Agent headless 调用探测。"
    });
  }

  diagnostics.push({
    id: "install-manager",
    severity: input.installManagerAvailable ? "ok" : "warning",
    title: input.installManagerAvailable ? `${input.installManager} 可用` : `${input.installManager} 不可用`,
    detail: input.installManagerAvailable
      ? `${input.installManagerVersion ?? input.installManager} 可用于一键安装 CLI。${input.installManagerPath ? `路径：${input.installManagerPath}` : ""}`
      : `未检测到 ${input.installManager}，无法从应用内执行安装命令。`,
    action: input.installManagerAvailable ? undefined : `安装 ${input.installManager} 后点击刷新。`
  });

  if (!input.installed && input.installManagerAvailable && input.installGlobalBinPath) {
    diagnostics.push({
      id: "install-global-bin",
      severity: "info",
      title: "全局安装目录",
      detail: input.installGlobalBinPath,
      action: `如果安装后仍检测不到 CLI，请把该目录加入系统 PATH，然后重启 GameAIStudio。`
    });
  }

  if (input.credentialStatus === "configured") {
    diagnostics.push({
      id: "credential-configured",
      severity: "ok",
      title: "检测到凭据环境变量",
      detail: `已检测到：${input.detectedCredentialEnvVars.join(", ")}`
    });
  } else if (input.credentialStatus === "missing") {
    diagnostics.push({
      id: "credential-missing",
      severity: "info",
      title: "未检测到常见凭据环境变量",
      detail: input.credentialHint,
      action: `可配置：${input.credentialEnvVars.join(" / ")}，或在 CLI 内完成登录。`
    });
  }

  if (input.capabilities) {
    diagnostics.push({
      id: "cli-capabilities",
      severity: "info",
      title: "Adapter 能力",
      detail: [
        input.capabilities.runModel,
        input.capabilities.headless ? "headless" : "interactive",
        input.capabilities.supportsStream ? "stream" : "one-shot",
        input.capabilities.supportsImages ? `image:${input.capabilities.imageInputMode}` : "image:unsupported"
      ].join(" / ")
    });
  }

  return diagnostics;
}

/**
 * Facade over the AI adapter registry. Keeps the existing IPC contract
 * (`discover`/`install`/`buildAgentCommand` + the `CliTool` shape) while the
 * per-CLI knowledge now lives in `ai/adapters/*`.
 */
export class CliService {
  constructor(
    private readonly env: RuntimeEnvironment = createRuntimeEnvironment(),
    private readonly registry: AdapterRegistry = createAdapterRegistry()
  ) {}

  private async toCliTool(
    adapter: LocalCliAdapter,
    checkedAt: string,
    options: { probe?: boolean } = {}
  ): Promise<CliTool> {
    const { config } = adapter;
    const installManager = installManagerCommand(config.installCommand);
    const installManagerInfo = await getInstallManagerInfo(config.installCommand, this.env);
    // adapter.discover already applies the npm-global-bin fallback.
    const discovered = await adapter.discover(this.env);
    const executablePath = discovered.executablePath;
    // Discovery stays fast and free of real API calls (`probe: false`); the
    // explicit "test connection" action passes `probe: true` to run the
    // headless probe that surfaces 401 / not-logged-in.
    const health = executablePath
      ? await adapter.health(this.env, { probe: options.probe ?? false })
      : ({
          installed: false,
          authed: "unknown",
          headlessOk: "unknown",
          detail: "未在 PATH 或安装目录中找到该 CLI。"
        } satisfies CliToolHealth);
    const credential = evaluateCredentialStatus(config.credentialEnvVars, this.env.env);

    const sharedFields = {
      id: config.id as CliToolId,
      label: CLI_TOOL_LABELS[config.id as CliToolId],
      command: config.command,
      installCommand: config.installCommand,
      installHint: config.installHint,
      installManager,
      installManagerPath: installManagerInfo.executablePath,
      installManagerAvailable: installManagerInfo.available,
      installManagerVersion: installManagerInfo.version,
      installGlobalBinPath: installManagerInfo.globalBinPath,
      defaultArgs: config.promptArgs,
      credentialStatus: credential.status,
      credentialEnvVars: config.credentialEnvVars,
      detectedCredentialEnvVars: credential.detectedCredentialEnvVars,
      credentialHint: config.credentialHint,
      capabilities: adapter.capabilities,
      health,
      lastCheckedAt: checkedAt
    };

    if (!executablePath) {
      const baseTool = {
        ...sharedFields,
        installed: false,
        status: "missing" as const
      };
      return { ...baseTool, diagnostics: buildCliDiagnostics(baseTool) } satisfies CliTool;
    }

    const status =
      health.installed && health.authed !== false && health.headlessOk !== false ? ("available" as const) : ("error" as const);
    const baseTool = {
      ...sharedFields,
      installed: true,
      status,
      executablePath,
      source: discovered.source,
      version: health.version
    };
    return { ...baseTool, diagnostics: buildCliDiagnostics(baseTool) } satisfies CliTool;
  }

  async discover(): Promise<CliTool[]> {
    const checkedAt = new Date().toISOString();
    return Promise.all(this.registry.listLocalCli().map((adapter) => this.toCliTool(adapter, checkedAt)));
  }

  /**
   * Full health check for one CLI, including the headless probe (a real model
   * call). Triggered explicitly from the UI's "test connection" — this is what
   * surfaces `headlessOk: false` (e.g. `claude --print` 401).
   */
  async testTool(toolId: CliToolId): Promise<CliTool> {
    const startedAt = Date.now();
    getAppLogger().info("cli", "开始测试 AI CLI 非交互连接", {
      toolId,
      label: CLI_TOOL_LABELS[toolId]
    });
    const adapter = this.registry.requireLocalCli(toolId);
    const tool = await this.toCliTool(adapter, new Date().toISOString(), { probe: true });
    getAppLogger().log(tool.status === "available" ? "info" : "warn", "cli", "AI CLI 非交互测试完成", {
      toolId,
      label: tool.label,
      installed: tool.installed,
      status: tool.status,
      executablePath: tool.executablePath,
      version: tool.version,
      authed: tool.health.authed,
      headlessOk: tool.health.headlessOk,
      supportsImages: tool.capabilities.supportsImages,
      detail: tool.health.detail,
      durationMs: Date.now() - startedAt
    });
    return tool;
  }

  async install(toolId: CliToolId): Promise<GodotRunResult> {
    const startedAt = Date.now();
    const adapter = this.registry.requireLocalCli(toolId);
    getAppLogger().info("cli", "开始安装 AI CLI", {
      toolId,
      label: CLI_TOOL_LABELS[toolId],
      installCommand: adapter.config.installCommand
    });
    const result = await adapter.install!(this.env);
    getAppLogger().log(result.ok ? "info" : "warn", "cli", "AI CLI 安装完成", {
      toolId,
      label: CLI_TOOL_LABELS[toolId],
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
      commandDurationMs: result.durationMs,
      stdout: shortOutput(result.stdout, 600),
      stderr: shortOutput(result.stderr)
    });
    return result;
  }

  buildAgentCommand(toolId: CliToolId, prompt: string, executablePath?: string): { command: string; args: string[]; stdin: string } {
    const { config } = this.registry.requireLocalCli(toolId);
    return {
      command: executablePath ?? config.command,
      args: config.promptArgs,
      stdin: prompt
    };
  }

  runTurn(toolId: CliToolId, request: AgentTurnRequest): AsyncIterable<TurnChunk> {
    return this.registry.requireLocalCli(toolId).runTurn(request, this.env);
  }
}
