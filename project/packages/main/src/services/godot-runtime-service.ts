import { existsSync } from "node:fs";
import path from "node:path";
import type { GameDimension, GodotRuntime, GodotRuntimeStatus, RuntimeDiagnostic } from "@gameaistudio/shared";
import { runProcess } from "./process-runner";
import { getTemplatePath, type StudioPaths } from "./resource-paths";

interface VersionProbe {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const TEMPLATE_DIMENSIONS: GameDimension[] = ["2d", "3d"];

function firstLine(value: string): string | undefined {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function hasPath(value?: string): boolean {
  return Boolean(value && existsSync(value));
}

function runtimeStatus(diagnostics: RuntimeDiagnostic[]): GodotRuntimeStatus {
  if (diagnostics.some((diagnostic) => diagnostic.id === "engine-root-missing" || diagnostic.id === "console-missing")) {
    return "missing";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "error";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "partial";
  }
  return "ready";
}

export function buildGodotRuntime(paths: StudioPaths, versionProbe?: VersionProbe): GodotRuntime {
  const templates = TEMPLATE_DIMENSIONS.map((dimension) => {
    const templatePath = getTemplatePath(paths, dimension);
    return {
      dimension,
      path: templatePath,
      available: existsSync(path.join(templatePath, "project.godot"))
    };
  });
  const diagnostics: RuntimeDiagnostic[] = [];
  const engineRootAvailable = existsSync(paths.engineRoot);
  const consoleAvailable = hasPath(paths.godotConsolePath);
  const guiAvailable = hasPath(paths.godotGuiPath);
  const version = versionProbe?.exitCode === 0 ? firstLine(versionProbe.stdout || versionProbe.stderr) : undefined;

  diagnostics.push({
    id: engineRootAvailable ? "engine-root-found" : "engine-root-missing",
    severity: engineRootAvailable ? "ok" : "error",
    title: engineRootAvailable ? "内置引擎目录已发现" : "内置引擎目录缺失",
    detail: paths.engineRoot,
    action: engineRootAvailable ? undefined : "请把 Godot 可执行文件放入应用资源的 engine 目录。"
  });

  diagnostics.push({
    id: consoleAvailable ? "console-found" : "console-missing",
    severity: consoleAvailable ? "ok" : "error",
    title: consoleAvailable ? "Godot Console 可用" : "Godot Console 缺失",
    detail: paths.godotConsolePath ?? path.join(paths.engineRoot, "Godot_v4.6.2-stable_win64_console.exe"),
    action: consoleAvailable ? undefined : "Web 导出和项目校验需要 console 版 Godot。"
  });

  diagnostics.push({
    id: guiAvailable ? "gui-found" : "gui-missing",
    severity: guiAvailable ? "ok" : "warning",
    title: guiAvailable ? "Godot GUI 可执行文件已发现" : "Godot GUI 可执行文件未发现",
    detail: paths.godotGuiPath ?? path.join(paths.engineRoot, "Godot_v4.6.2-stable_win64.exe"),
    action: guiAvailable ? undefined : "当前仍可用 console 执行导出；打开编辑器功能需要 GUI 版 Godot。"
  });

  if (versionProbe) {
    diagnostics.push({
      id: versionProbe.exitCode === 0 ? "version-ok" : "version-error",
      severity: versionProbe.exitCode === 0 ? "ok" : "error",
      title: versionProbe.exitCode === 0 ? "Godot 版本探测通过" : "Godot 版本探测失败",
      detail: version ?? firstLine(versionProbe.stderr || versionProbe.stdout) ?? "Godot --version 未返回可读输出。",
      action: versionProbe.exitCode === 0 ? undefined : "请在终端运行内置 Godot console，确认它能正常启动。"
    });
  } else if (consoleAvailable) {
    diagnostics.push({
      id: "version-skipped",
      severity: "info",
      title: "尚未运行版本探测",
      detail: "启动信息已发现 Godot console；版本将在运行时健康检查中探测。"
    });
  }

  for (const template of templates) {
    diagnostics.push({
      id: `template-${template.dimension}`,
      severity: template.available ? "ok" : "error",
      title: template.available ? `${template.dimension.toUpperCase()} 模板可用` : `${template.dimension.toUpperCase()} 模板缺失`,
      detail: template.path,
      action: template.available ? undefined : "请确认 gameaistudio_template 目录包含对应 Godot 模板工程。"
    });
  }

  return {
    status: runtimeStatus(diagnostics),
    resourceRoot: paths.resourceRoot,
    engineRoot: paths.engineRoot,
    templatesRoot: paths.templatesRoot,
    guiPath: paths.godotGuiPath,
    consolePath: paths.godotConsolePath,
    version,
    templates,
    diagnostics,
    lastCheckedAt: new Date().toISOString()
  };
}

export class GodotRuntimeService {
  constructor(private readonly paths: StudioPaths) {}

  async inspect(): Promise<GodotRuntime> {
    if (!this.paths.godotConsolePath || !existsSync(this.paths.godotConsolePath)) {
      return buildGodotRuntime(this.paths);
    }

    const probe = await runProcess(this.paths.godotConsolePath, ["--version"], { timeoutMs: 5000 });
    return buildGodotRuntime(this.paths, {
      exitCode: probe.exitCode,
      stdout: probe.stdout,
      stderr: probe.stderr
    });
  }
}
