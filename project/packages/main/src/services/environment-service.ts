import path from "node:path";
import type { EnvironmentTool, EnvironmentToolId, EnvironmentToolStatus, GodotRunResult, SystemEnvironment } from "@gameaistudio/shared";
import { getAppLogger } from "./logger";
import { runProcess, type ProcessRunResult } from "./process-runner";

type CommandRunner = typeof runProcess;

interface EnvironmentToolSpec {
  id: EnvironmentToolId;
  label: string;
  command: string;
  versionArgs: string[];
  missingAction: string;
  /** winget package id for the one-click install on Windows. */
  wingetId: string;
  installHint: string;
}

const ENVIRONMENT_TOOLS: EnvironmentToolSpec[] = [
  {
    id: "git",
    label: "Git",
    command: "git",
    versionArgs: ["--version"],
    missingAction: "点击安装（winget），或手动安装 Git 后刷新。Git 用于游戏项目的版本管理。",
    wingetId: "Git.Git",
    installHint: "winget install Git.Git，或从 https://git-scm.com 下载安装。"
  },
  {
    id: "node",
    label: "Node.js",
    command: "node",
    versionArgs: ["--version"],
    missingAction: "点击安装（winget），或手动安装 Node.js 后刷新。npm 用于一键安装各 AI CLI。",
    wingetId: "OpenJS.NodeJS.LTS",
    installHint: "winget install OpenJS.NodeJS.LTS，或从 https://nodejs.org 下载 LTS 安装。"
  }
];

/** Merges registry-level PATH entries into the running process's PATH. */
export function mergePathEntries(currentPath: string, registryPath: string): string {
  const seen = new Set(
    currentPath
      .split(path.delimiter)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  const additions = registryPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !seen.has(entry.toLowerCase()));
  return additions.length > 0 ? [currentPath, ...additions].join(path.delimiter) : currentPath;
}

function firstOutputLine(result: ProcessRunResult): string | undefined {
  return (result.stdout || result.stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function findExecutable(command: string, runner: CommandRunner): Promise<string | undefined> {
  const locator =
    process.platform === "win32"
      ? { command: "where.exe", args: [command] }
      : { command: "sh", args: ["-lc", `command -v ${command}`] };
  const result = await runner(locator.command, locator.args, { timeoutMs: 3000 });
  if (result.exitCode !== 0) {
    return undefined;
  }
  return firstOutputLine(result);
}

function toolStatus(versionResult: ProcessRunResult): EnvironmentToolStatus {
  if (versionResult.exitCode === 0) {
    return "available";
  }
  return versionResult.exitCode === null ? "missing" : "error";
}

function buildToolDiagnostics(input: {
  spec: EnvironmentToolSpec;
  status: EnvironmentToolStatus;
  executablePath?: string;
  version?: string;
  error?: string;
}): EnvironmentTool["diagnostics"] {
  if (input.status === "available") {
    return [
      {
        id: `${input.spec.id}-available`,
        severity: "ok",
        title: `${input.spec.label} 可用`,
        detail: `${input.version ?? input.spec.command}${input.executablePath ? ` · ${input.executablePath}` : ""}`
      }
    ];
  }

  if (input.status === "error") {
    return [
      {
        id: `${input.spec.id}-error`,
        severity: "warning",
        title: `${input.spec.label} 版本检测异常`,
        detail: input.error || `${input.spec.command} --version 返回异常。`,
        action: `在终端运行 ${input.spec.command} --version，确认命令可正常启动。`
      }
    ];
  }

  return [
    {
      id: `${input.spec.id}-missing`,
      severity: "error",
      title: `未检测到 ${input.spec.label}`,
      detail: `${input.spec.command} 不在 PATH 中。`,
      action: input.spec.missingAction
    }
  ];
}

export function environmentStatus(tools: EnvironmentTool[]): SystemEnvironment["status"] {
  if (tools.every((tool) => tool.status === "available")) {
    return "ready";
  }
  if (tools.some((tool) => tool.status === "available")) {
    return "partial";
  }
  return "missing";
}

export class EnvironmentService {
  constructor(
    private readonly runner: CommandRunner = runProcess,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async inspect(): Promise<SystemEnvironment> {
    const lastCheckedAt = new Date().toISOString();
    const wingetAvailable = await this.isWingetAvailable();
    const tools = await Promise.all(
      ENVIRONMENT_TOOLS.map((spec) => this.inspectTool(spec, lastCheckedAt, wingetAvailable))
    );
    return {
      status: environmentStatus(tools),
      tools,
      lastCheckedAt
    };
  }

  /**
   * One-click install of a base dependency via winget (Windows). After a
   * successful install the machine/user PATH from the registry is merged into
   * this process so the new tool is discoverable without restarting the app.
   */
  async install(toolId: EnvironmentToolId): Promise<GodotRunResult> {
    const startedAt = Date.now();
    const spec = ENVIRONMENT_TOOLS.find((candidate) => candidate.id === toolId);
    if (!spec) {
      return { ok: false, exitCode: null, stdout: "", stderr: `未知环境工具：${toolId}`, durationMs: Date.now() - startedAt };
    }
    if (this.platform !== "win32") {
      return { ok: false, exitCode: null, stdout: "", stderr: `当前系统不支持一键安装，请手动安装：${spec.installHint}`, durationMs: Date.now() - startedAt };
    }
    if (!(await this.isWingetAvailable())) {
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `未检测到 winget，无法一键安装。请手动安装：${spec.installHint}`,
        durationMs: Date.now() - startedAt
      };
    }

    getAppLogger().info("environment", "开始安装基础依赖", { toolId, wingetId: spec.wingetId });
    const result = await this.runner(
      "winget",
      [
        "install",
        "--id",
        spec.wingetId,
        "-e",
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements"
      ],
      { timeoutMs: 15 * 60 * 1000 }
    );
    if (result.exitCode === 0) {
      await this.refreshProcessPath();
    }
    getAppLogger().log(result.exitCode === 0 ? "info" : "warn", "environment", "基础依赖安装完成", {
      toolId,
      wingetId: spec.wingetId,
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt
    });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt
    };
  }

  /** Re-reads Machine+User PATH from the registry into process.env.PATH. */
  private async refreshProcessPath(): Promise<void> {
    try {
      const result = await this.runner(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"
        ],
        { timeoutMs: 15000 }
      );
      const registryPath = result.stdout.trim();
      if (result.exitCode === 0 && registryPath) {
        process.env.PATH = mergePathEntries(process.env.PATH ?? "", registryPath);
        getAppLogger().info("environment", "已刷新进程 PATH（安装后免重启生效）");
      }
    } catch {
      // PATH refresh is best-effort; a restart also picks the tool up.
    }
  }

  private async isWingetAvailable(): Promise<boolean> {
    if (this.platform !== "win32") return false;
    return Boolean(await findExecutable("winget", this.runner));
  }

  private async inspectTool(
    spec: EnvironmentToolSpec,
    lastCheckedAt: string,
    wingetAvailable: boolean
  ): Promise<EnvironmentTool> {
    const executablePath = await findExecutable(spec.command, this.runner);
    const version = await this.runner(executablePath ?? spec.command, spec.versionArgs, { timeoutMs: 4000 });
    const status = executablePath ? toolStatus(version) : "missing";
    const versionText = status === "available" ? firstOutputLine(version) : undefined;
    const normalizedExecutablePath = executablePath ? path.normalize(executablePath) : undefined;

    return {
      id: spec.id,
      label: spec.label,
      command: spec.command,
      installed: status === "available",
      status,
      executablePath: normalizedExecutablePath,
      version: versionText,
      installAvailable: status !== "available" && this.platform === "win32" && wingetAvailable,
      installHint: spec.installHint,
      diagnostics: buildToolDiagnostics({
        spec,
        status,
        executablePath: normalizedExecutablePath,
        version: versionText,
        error: firstOutputLine(version)
      }),
      lastCheckedAt
    };
  }
}
