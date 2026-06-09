import path from "node:path";
import type { EnvironmentTool, EnvironmentToolId, EnvironmentToolStatus, SystemEnvironment } from "@gameaistudio/shared";
import { runProcess, type ProcessRunResult } from "./process-runner";

type CommandRunner = typeof runProcess;

interface EnvironmentToolSpec {
  id: EnvironmentToolId;
  label: string;
  command: string;
  versionArgs: string[];
  missingAction: string;
}

const ENVIRONMENT_TOOLS: EnvironmentToolSpec[] = [
  {
    id: "git",
    label: "Git",
    command: "git",
    versionArgs: ["--version"],
    missingAction: "安装 Git 并重启 GameAIStudio，才能为 Godot 项目启用 Git 版本管理。"
  },
  {
    id: "node",
    label: "Node.js",
    command: "node",
    versionArgs: ["--version"],
    missingAction: "安装 Node.js 后重启 GameAIStudio，CLI 安装和部分本地工具链会更稳定。"
  }
];

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
  constructor(private readonly runner: CommandRunner = runProcess) {}

  async inspect(): Promise<SystemEnvironment> {
    const lastCheckedAt = new Date().toISOString();
    const tools = await Promise.all(ENVIRONMENT_TOOLS.map((spec) => this.inspectTool(spec, lastCheckedAt)));
    return {
      status: environmentStatus(tools),
      tools,
      lastCheckedAt
    };
  }

  private async inspectTool(spec: EnvironmentToolSpec, lastCheckedAt: string): Promise<EnvironmentTool> {
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
