import { existsSync } from "node:fs";
import path from "node:path";
import type { CliCredentialStatus, CliDiagnostic, CliTool, CliToolId, GodotRunResult } from "@gameaistudio/shared";
import { CLI_TOOL_LABELS } from "@gameaistudio/shared";
import { runProcess } from "./process-runner";

interface CliSpec {
  id: CliToolId;
  command: string;
  versionArgs: string[];
  installCommand: string[];
  installHint: string;
  defaultArgs: string[];
  credentialEnvVars: string[];
  credentialHint: string;
}

const CLI_SPECS: CliSpec[] = [
  {
    id: "codex",
    command: "codex",
    versionArgs: ["--version"],
    installCommand: ["npm", "install", "-g", "@openai/codex"],
    installHint: "通过 npm 全局安装 OpenAI Codex CLI，或把已安装的 codex 加入 PATH。",
    defaultArgs: ["exec", "--skip-git-repo-check"],
    credentialEnvVars: ["OPENAI_API_KEY"],
    credentialHint: "Codex CLI 通常需要登录或提供 OPENAI_API_KEY。若已在 CLI 内登录，可忽略环境变量提示。"
  },
  {
    id: "claude",
    command: "claude",
    versionArgs: ["--version"],
    installCommand: ["npm", "install", "-g", "@anthropic-ai/claude-code"],
    installHint: "通过 npm 全局安装 Claude Code，或把已安装的 claude 加入 PATH。",
    defaultArgs: ["--print"],
    credentialEnvVars: ["ANTHROPIC_API_KEY"],
    credentialHint: "Claude CLI 通常需要登录或提供 ANTHROPIC_API_KEY。若已完成 claude 登录，可忽略环境变量提示。"
  },
  {
    id: "kscc",
    command: "kscc",
    versionArgs: ["--version"],
    installCommand: ["npm", "install", "-g", "kscc"],
    installHint: "安装 KSCC CLI，或在系统 PATH 中提供 kscc 命令。",
    defaultArgs: ["--print"],
    credentialEnvVars: ["KSCC_API_KEY"],
    credentialHint: "KSCC CLI 可能需要登录或配置 KSCC_API_KEY，具体以本机 kscc 命令要求为准。"
  },
  {
    id: "kimi",
    command: "kimi",
    versionArgs: ["--version"],
    installCommand: ["npm", "install", "-g", "@moonshot-ai/kimi-cli"],
    installHint: "安装 Kimi CLI，或在系统 PATH 中提供 kimi 命令。",
    defaultArgs: ["--print"],
    credentialEnvVars: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    credentialHint: "Kimi CLI 通常需要 Moonshot/Kimi API Key，可尝试配置 MOONSHOT_API_KEY 或 KIMI_API_KEY。"
  }
];

function getSpec(toolId: CliToolId): CliSpec {
  const spec = CLI_SPECS.find((candidate) => candidate.id === toolId);
  if (!spec) {
    throw new Error(`Unknown CLI tool: ${toolId}`);
  }
  return spec;
}

async function findExecutable(command: string): Promise<string | undefined> {
  const locator =
    process.platform === "win32"
      ? { command: "where.exe", args: [command] }
      : { command: "sh", args: ["-lc", `command -v ${command}`] };
  const result = await runProcess(locator.command, locator.args, { timeoutMs: 3000 });
  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return result.exitCode === 0 ? firstLine : undefined;
}

export function cliExecutableCandidates(command: string, directory: string, platform = process.platform): string[] {
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  const basePath = pathModule.join(directory, command);
  if (platform !== "win32" || path.extname(command)) {
    return [basePath];
  }
  return [basePath, `${basePath}.cmd`, `${basePath}.exe`, `${basePath}.bat`];
}

export function findExecutableInDirectory(command: string, directory?: string, platform = process.platform): string | undefined {
  if (!directory) {
    return undefined;
  }
  return cliExecutableCandidates(command, directory, platform).find((candidate) => existsSync(candidate));
}

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

function installManagerCommand(spec: CliSpec): string {
  return spec.installCommand[0] ?? "npm";
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

export function npmGlobalBinPath(prefix: string, platform = process.platform): string | undefined {
  const normalized = prefix.trim();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return undefined;
  }
  return platform === "win32" ? normalized : `${normalized.replace(/\/+$/, "")}/bin`;
}

async function getNpmGlobalBinPath(npmExecutable: string): Promise<string | undefined> {
  const prefix = await runProcess(npmExecutable, ["config", "get", "prefix"], { timeoutMs: 4000 });
  if (prefix.exitCode !== 0) {
    return undefined;
  }
  return npmGlobalBinPath((prefix.stdout || prefix.stderr).trim().split(/\r?\n/)[0] ?? "");
}

async function getInstallManagerInfo(
  spec: CliSpec
): Promise<{ available: boolean; version?: string; globalBinPath?: string; executablePath?: string }> {
  const manager = installManagerCommand(spec);
  const executable = await findExecutable(manager);
  if (!executable) {
    return { available: false };
  }
  const [version, globalBinPath] = await Promise.all([
    runProcess(executable, ["--version"], { timeoutMs: 4000 }),
    manager === "npm" ? getNpmGlobalBinPath(executable) : Promise.resolve(undefined)
  ]);
  const versionText = (version.stdout || version.stderr).trim().split(/\r?\n/)[0];
  return {
    available: version.exitCode === 0,
    executablePath: executable,
    version: versionText || undefined,
    globalBinPath
  };
}

export function buildCliDiagnostics(input: {
  installed: boolean;
  status: CliTool["status"];
  executablePath?: string;
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
}): CliDiagnostic[] {
  const diagnostics: CliDiagnostic[] = [];

  if (input.installed) {
    diagnostics.push({
      id: "cli-found",
      severity: "ok",
      title: "CLI 已发现",
      detail: input.executablePath ?? "已在 PATH 中发现命令。"
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
      title: "版本检测异常",
      detail: "命令存在，但 --version 返回异常。Agent 运行时可能失败。",
      action: "尝试在终端手动运行该 CLI，确认它可以正常启动。"
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

  return diagnostics;
}

export class CliService {
  async discover(): Promise<CliTool[]> {
    const checkedAt = new Date().toISOString();
    return Promise.all(
      CLI_SPECS.map(async (spec) => {
        const installManager = installManagerCommand(spec);
        const installManagerInfo = await getInstallManagerInfo(spec);
        const executablePath =
          (await findExecutable(spec.command)) ?? findExecutableInDirectory(spec.command, installManagerInfo.globalBinPath);
        const credential = evaluateCredentialStatus(spec.credentialEnvVars);
        if (!executablePath) {
          const baseTool = {
            id: spec.id,
            label: CLI_TOOL_LABELS[spec.id],
            command: spec.command,
            installed: false,
            status: "missing" as const,
            installCommand: spec.installCommand,
            installHint: spec.installHint,
            installManager,
            installManagerPath: installManagerInfo.executablePath,
            installManagerAvailable: installManagerInfo.available,
            installManagerVersion: installManagerInfo.version,
            installGlobalBinPath: installManagerInfo.globalBinPath,
            defaultArgs: spec.defaultArgs,
            credentialStatus: credential.status,
            credentialEnvVars: spec.credentialEnvVars,
            detectedCredentialEnvVars: credential.detectedCredentialEnvVars,
            credentialHint: spec.credentialHint,
            lastCheckedAt: checkedAt
          };
          return {
            ...baseTool,
            diagnostics: buildCliDiagnostics(baseTool)
          } satisfies CliTool;
        }

        const version = await runProcess(executablePath, spec.versionArgs, { timeoutMs: 4000 });
        const versionText = (version.stdout || version.stderr).trim().split(/\r?\n/)[0];
        const baseTool = {
          id: spec.id,
          label: CLI_TOOL_LABELS[spec.id],
          command: spec.command,
          installed: true,
          status: version.exitCode === 0 ? ("available" as const) : ("error" as const),
          executablePath,
          version: versionText || undefined,
          installCommand: spec.installCommand,
          installHint: spec.installHint,
          installManager,
          installManagerPath: installManagerInfo.executablePath,
          installManagerAvailable: installManagerInfo.available,
          installManagerVersion: installManagerInfo.version,
          installGlobalBinPath: installManagerInfo.globalBinPath,
          defaultArgs: spec.defaultArgs,
          credentialStatus: credential.status,
          credentialEnvVars: spec.credentialEnvVars,
          detectedCredentialEnvVars: credential.detectedCredentialEnvVars,
          credentialHint: spec.credentialHint,
          lastCheckedAt: checkedAt
        };
        return {
          ...baseTool,
          diagnostics: buildCliDiagnostics(baseTool)
        } satisfies CliTool;
      })
    );
  }

  async install(toolId: CliToolId): Promise<GodotRunResult> {
    const spec = getSpec(toolId);
    const startedAt = Date.now();
    const installManagerInfo = await getInstallManagerInfo(spec);
    if (!installManagerInfo.available) {
      return buildInstallManagerUnavailableResult(installManagerCommand(spec), startedAt);
    }
    const { command, args } = buildInstallCommand(spec.installCommand, installManagerInfo.executablePath);
    const result = await runProcess(command, args, { timeoutMs: 20 * 60 * 1000 });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt
    };
  }

  buildAgentCommand(toolId: CliToolId, prompt: string, executablePath?: string): { command: string; args: string[] } {
    const spec = getSpec(toolId);
    return {
      command: executablePath ?? spec.command,
      args: [...spec.defaultArgs, prompt]
    };
  }
}
