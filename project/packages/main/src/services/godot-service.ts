import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { GodotOpenResult, GodotRunResult } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import type { StudioPaths } from "./resource-paths";
import { runProcess } from "./process-runner";

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

export class GodotService {
  constructor(
    private readonly paths: StudioPaths,
    private readonly projectService: ProjectService
  ) {}

  async openEditor(projectId: string): Promise<GodotOpenResult> {
    const project = await this.projectService.requireProject(projectId);
    const launch = buildGodotEditorLaunchPlan(this.paths, project.rootPath);
    if (!launch.ok || !launch.command) {
      return {
        ok: false,
        projectRoot: project.rootPath,
        message: launch.message
      };
    }

    try {
      const child = spawn(launch.command, launch.args, {
        cwd: project.rootPath,
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
      child.unref();
      return {
        ok: true,
        executablePath: launch.command,
        projectRoot: project.rootPath,
        message: launch.message
      };
    } catch (error) {
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
    if (!this.paths.godotConsolePath) {
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "未找到内置 Godot console 可执行文件。",
        durationMs: Date.now() - startedAt
      };
    }

    await mkdir(project.webBuildPath, { recursive: true });
    const exportPath = path.join(project.webBuildPath, "index.html");
    const result = await runProcess(
      this.paths.godotConsolePath,
      ["--headless", "--path", project.rootPath, "--export-release", "Web", exportPath],
      { timeoutMs: 20 * 60 * 1000 }
    );
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    };
  }

  async validate(projectId: string): Promise<GodotRunResult> {
    const startedAt = Date.now();
    const project = await this.projectService.requireProject(projectId);
    if (!this.paths.godotConsolePath) {
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "未找到内置 Godot console 可执行文件。",
        durationMs: Date.now() - startedAt
      };
    }

    const result = await runProcess(
      this.paths.godotConsolePath,
      ["--headless", "--path", project.rootPath, "-s", "tools/ci/validate_project.gd"],
      { timeoutMs: 10 * 60 * 1000 }
    );
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    };
  }
}
