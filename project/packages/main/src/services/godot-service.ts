import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { GodotOpenResult, GodotRunResult } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import type { StudioPaths } from "./resource-paths";
import { runProcess } from "./process-runner";
import { getProjectLogger } from "./logger";
import { ensureWebExportTemplates, godotSpawnEnv, missingTemplatesMessage } from "./godot-export-templates";

export interface GodotEditorLaunchPlan {
  ok: boolean;
  command?: string;
  args: string[];
  message: string;
}

export function buildGodotEditorLaunchPlan(paths: StudioPaths, projectRoot: string): GodotEditorLaunchPlan {
  if (!paths.godotGuiPath || !existsSync(paths.godotGuiPath)) {
    return {
      ok: false,
      args: [],
      message: "未找到内置 Godot GUI 可执行文件，无法打开编辑器。"
    };
  }

  return {
    ok: true,
    command: paths.godotGuiPath,
    args: ["--path", projectRoot, "--editor"],
    message: "正在用内置 Godot 打开项目。"
  };
}

function shortOutput(value?: string, maxLength = 1200): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(+${text.length - maxLength})` : text;
}

export class GodotService {
  constructor(
    private readonly paths: StudioPaths,
    private readonly projectService: ProjectService
  ) {}

  async openEditor(projectId: string): Promise<GodotOpenResult> {
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);
    log.info("godot", "请求打开 Godot 编辑器", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      executablePath: this.paths.godotGuiPath
    });
    const launch = buildGodotEditorLaunchPlan(this.paths, project.rootPath);
    if (!launch.ok || !launch.command) {
      log.warn("godot", "Godot 编辑器打开失败", {
        projectId: project.id,
        project: project.name,
        rootPath: project.rootPath,
        message: launch.message
      });
      return {
        ok: false,
        projectRoot: project.rootPath,
        message: launch.message
      };
    }

    try {
      // Same managed data dir as headless runs, so the GUI editor sees the
      // bundled export templates and stays isolated from the user's own Godot.
      await ensureWebExportTemplates(this.paths.engineRoot, this.paths.dataRoot).catch(() => undefined);
      const child = spawn(launch.command, launch.args, {
        cwd: project.rootPath,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        env: { ...process.env, ...godotSpawnEnv(this.paths.dataRoot) }
      });
      child.unref();
      log.info("godot", "Godot 编辑器已启动", {
        projectId: project.id,
        project: project.name,
        rootPath: project.rootPath,
        executablePath: launch.command
      });
      return {
        ok: true,
        executablePath: launch.command,
        projectRoot: project.rootPath,
        message: launch.message
      };
    } catch (error) {
      log.error("godot", "Godot 编辑器启动异常", {
        projectId: project.id,
        project: project.name,
        rootPath: project.rootPath,
        executablePath: launch.command,
        error
      });
      return {
        ok: false,
        executablePath: launch.command,
        projectRoot: project.rootPath,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async exportWeb(projectId: string): Promise<GodotRunResult> {
    const startedAt = Date.now();
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);
    log.info("godot", "开始 Godot Web 导出", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      webBuildPath: project.webBuildPath,
      executablePath: this.paths.godotConsolePath
    });
    if (!this.paths.godotConsolePath) {
      const result = {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "未找到内置 Godot console 可执行文件。",
        durationMs: Date.now() - startedAt
      };
      this.logRunResult(project, "Godot Web 导出失败", result);
      return result;
    }

    // Web export needs the export templates. Godot runs against the managed
    // data dir (env redirection, see godot-export-templates.ts), so install
    // the bundled templates there first; never touch the user's real Godot
    // dir and never modify project files.
    const templateStatus = await ensureWebExportTemplates(this.paths.engineRoot, this.paths.dataRoot);
    if (templateStatus.copied.length > 0) {
      log.info("godot", "已安装内置 Web 导出模板", {
        copied: templateStatus.copied,
        source: templateStatus.source,
        managedDir: templateStatus.managedDir
      });
    }
    if (!templateStatus.ok) {
      const result = {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: missingTemplatesMessage(this.paths.engineRoot, templateStatus),
        durationMs: Date.now() - startedAt
      };
      this.logRunResult(project, "Godot Web 导出失败", result);
      return result;
    }

    await mkdir(project.webBuildPath, { recursive: true });
    const exportPath = path.join(project.webBuildPath, "index.html");
    const result = await runProcess(
      this.paths.godotConsolePath,
      ["--headless", "--path", project.rootPath, "--export-release", "Web", exportPath],
      { timeoutMs: 20 * 60 * 1000, env: godotSpawnEnv(this.paths.dataRoot) }
    );
    const runResult = {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    };
    this.logRunResult(project, runResult.ok ? "Godot Web 导出完成" : "Godot Web 导出失败", runResult, { exportPath });
    return runResult;
  }

  async validate(projectId: string): Promise<GodotRunResult> {
    const startedAt = Date.now();
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);
    log.info("godot", "开始 Godot 项目校验", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      executablePath: this.paths.godotConsolePath
    });
    if (!this.paths.godotConsolePath) {
      const result = {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "未找到内置 Godot console 可执行文件。",
        durationMs: Date.now() - startedAt
      };
      this.logRunResult(project, "Godot 项目校验失败", result);
      return result;
    }

    const result = await runProcess(
      this.paths.godotConsolePath,
      ["--headless", "--path", project.rootPath, "-s", "tools/ci/validate_project.gd"],
      { timeoutMs: 10 * 60 * 1000, env: godotSpawnEnv(this.paths.dataRoot) }
    );
    const runResult = {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    };
    this.logRunResult(project, runResult.ok ? "Godot 项目校验完成" : "Godot 项目校验失败", runResult);
    return runResult;
  }

  private logRunResult(project: { id: string; name: string; rootPath: string }, message: string, result: GodotRunResult, extra = {}): void {
    getProjectLogger(project.rootPath).log(result.ok ? "info" : "warn", "godot", message, {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: shortOutput(result.stdout, 600),
      stderr: shortOutput(result.stderr),
      ...extra
    });
  }
}
