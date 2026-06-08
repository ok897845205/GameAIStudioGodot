import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { GodotRunResult } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import type { StudioPaths } from "./resource-paths";
import { runProcess } from "./process-runner";

export class GodotService {
  constructor(
    private readonly paths: StudioPaths,
    private readonly projectService: ProjectService
  ) {}

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

