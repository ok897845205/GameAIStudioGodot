import type { GodotRunResult, WebBuildInspection, WebExportResult } from "@gameaistudio/shared";
import { ExportService } from "./export-service";
import { GodotService } from "./godot-service";
import { ProjectService } from "./project-service";
import { RunService } from "./run-service";
import { getProjectLogger } from "./logger";

function summarizeRunResult(result: GodotRunResult, successMessage: string): string {
  if (result.ok) {
    return successMessage;
  }
  return result.stderr || result.stdout || "命令执行失败。";
}

function resultOutput(result: GodotRunResult): string {
  return [result.stdout.trim(), result.stderr.trim() ? `\n--- stderr ---\n${result.stderr.trim()}` : ""].join("").trim();
}

function inspectionOutput(result: WebBuildInspection): string {
  return [
    result.message,
    `Path: ${result.webBuildPath}`,
    `Required: ${result.requiredFiles.join(", ")}`,
    result.missingRequiredFiles.length ? `Missing: ${result.missingRequiredFiles.join(", ")}` : undefined,
    result.files.length ? `Files:\n${result.files.map((file) => `- ${file}`).join("\n")}` : "Files: none"
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function shortOutput(value?: string, maxLength = 1200): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(+${text.length - maxLength})` : text;
}

export class WebExportPipelineService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly godotService: GodotService,
    private readonly exportService: ExportService,
    private readonly runService: RunService
  ) {}

  async exportWebZip(projectId: string): Promise<WebExportResult> {
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);
    const startedAt = Date.now();
    const run = await this.runService.createRun({
      projectId,
      kind: "godot-export",
      title: "Web zip 导出",
      steps: [
        { title: "Godot 项目校验", message: "导出前检查 Godot 项目结构和脚本。" },
        { title: "Godot Web 导出", message: "使用内置 Godot 导出 Web 构建。" },
        { title: "Web 构建产物检查", message: "确认 build/web 包含 index.html、wasm 和 pck。" },
        { title: "打包 Web zip", message: "压缩 build/web 为可分享的 zip 文件。" }
      ]
    });
    log.info("export", "开始 Web zip 导出流水线", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      webBuildPath: project.webBuildPath,
      runId: run.id
    });

    const [validateStep, exportStep, inspectStep, zipStep] = run.steps;
    await this.runService.startRun(run.id, validateStep?.id);

    await this.runService.updateStep(run.id, validateStep!.id, { status: "running" });
    const validationResult = await this.godotService.validate(projectId);
    await this.runService.updateStep(run.id, validateStep!.id, {
      status: validationResult.ok ? "completed" : "failed",
      exitCode: validationResult.exitCode ?? undefined,
      output: resultOutput(validationResult),
      message: summarizeRunResult(validationResult, "Godot 校验通过。")
    });

    if (!validationResult.ok) {
      const failedRun = await this.runService.finishRun(run.id, "failed", "Godot 校验失败，已停止导出。");
      log.warn("export", "Web zip 导出流水线失败：Godot 校验失败", {
        projectId: project.id,
        project: project.name,
        runId: run.id,
        exitCode: validationResult.exitCode,
        durationMs: Date.now() - startedAt,
        godotDurationMs: validationResult.durationMs,
        stdout: shortOutput(validationResult.stdout, 600),
        stderr: shortOutput(validationResult.stderr)
      });
      return {
        ok: false,
        project: await this.projectService.getProject(projectId),
        run: failedRun,
        webBuildPath: project.webBuildPath,
        validationResult,
        error: "Godot 校验失败，已停止导出。"
      };
    }

    await this.runService.updateStep(run.id, exportStep!.id, { status: "running" });
    const exportResult = await this.godotService.exportWeb(projectId);
    await this.runService.updateStep(run.id, exportStep!.id, {
      status: exportResult.ok ? "completed" : "failed",
      exitCode: exportResult.exitCode ?? undefined,
      output: resultOutput(exportResult),
      message: summarizeRunResult(exportResult, "Godot Web 导出完成。")
    });

    if (!exportResult.ok) {
      const failedRun = await this.runService.finishRun(run.id, "failed", "Godot Web 导出失败，已停止 zip 打包。");
      log.warn("export", "Web zip 导出流水线失败：Godot Web 导出失败", {
        projectId: project.id,
        project: project.name,
        runId: run.id,
        exitCode: exportResult.exitCode,
        durationMs: Date.now() - startedAt,
        godotDurationMs: exportResult.durationMs,
        stdout: shortOutput(exportResult.stdout, 600),
        stderr: shortOutput(exportResult.stderr)
      });
      return {
        ok: false,
        project: await this.projectService.getProject(projectId),
        run: failedRun,
        webBuildPath: project.webBuildPath,
        validationResult,
        exportResult,
        error: "Godot Web 导出失败，已停止 zip 打包。"
      };
    }

    await this.runService.updateStep(run.id, inspectStep!.id, { status: "running" });
    let inspectionResult: WebBuildInspection;
    try {
      inspectionResult = await this.exportService.inspectWebBuild(projectId);
      await this.runService.updateStep(run.id, inspectStep!.id, {
        status: inspectionResult.ok ? "completed" : "failed",
        output: inspectionOutput(inspectionResult),
        message: inspectionResult.message
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runService.updateStep(run.id, inspectStep!.id, {
        status: "failed",
        message
      });
      const failedRun = await this.runService.finishRun(run.id, "failed", "Web 构建产物检查失败，已停止 zip 打包。");
      log.error("export", "Web zip 导出流水线失败：构建产物检查异常", {
        projectId: project.id,
        project: project.name,
        runId: run.id,
        durationMs: Date.now() - startedAt,
        error
      });
      return {
        ok: false,
        project: await this.projectService.getProject(projectId),
        run: failedRun,
        webBuildPath: project.webBuildPath,
        validationResult,
        exportResult,
        error: message
      };
    }

    if (!inspectionResult.ok) {
      const failedRun = await this.runService.finishRun(run.id, "failed", "Web 构建产物不完整，已停止 zip 打包。");
      log.warn("export", "Web zip 导出流水线失败：构建产物不完整", {
        projectId: project.id,
        project: project.name,
        runId: run.id,
        webBuildPath: inspectionResult.webBuildPath,
        missingRequiredFiles: inspectionResult.missingRequiredFiles,
        fileCount: inspectionResult.files.length,
        durationMs: Date.now() - startedAt,
        message: inspectionResult.message
      });
      return {
        ok: false,
        project: await this.projectService.getProject(projectId),
        run: failedRun,
        webBuildPath: project.webBuildPath,
        validationResult,
        exportResult,
        inspectionResult,
        error: inspectionResult.message
      };
    }

    await this.runService.updateStep(run.id, zipStep!.id, { status: "running" });
    try {
      const zipResult = await this.exportService.zipWebBuild(projectId);
      await this.runService.updateStep(run.id, zipStep!.id, {
        status: "completed",
        message: `Web zip 已生成：${zipResult.zipPath}`
      });
      const completedRun = await this.runService.finishRun(run.id, "completed", `Web zip 已导出：${zipResult.zipPath}`);
      log.info("export", "Web zip 导出流水线完成", {
        projectId: project.id,
        project: project.name,
        runId: run.id,
        webBuildPath: zipResult.webBuildPath,
        zipPath: zipResult.zipPath,
        manifestPath: zipResult.manifestPath,
        fileCount: (zipResult.inspection ?? inspectionResult).files.length,
        durationMs: Date.now() - startedAt
      });
      return {
        ok: true,
        project: await this.projectService.getProject(projectId),
        run: completedRun,
        webBuildPath: zipResult.webBuildPath,
        zipPath: zipResult.zipPath,
        manifestPath: zipResult.manifestPath,
        inspectionResult: zipResult.inspection ?? inspectionResult,
        validationResult,
        exportResult
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runService.updateStep(run.id, zipStep!.id, {
        status: "failed",
        message
      });
      const failedRun = await this.runService.finishRun(run.id, "failed", "Web zip 打包失败。");
      log.error("export", "Web zip 导出流水线失败：zip 打包异常", {
        projectId: project.id,
        project: project.name,
        runId: run.id,
        durationMs: Date.now() - startedAt,
        error
      });
      return {
        ok: false,
        project: await this.projectService.getProject(projectId),
        run: failedRun,
        webBuildPath: project.webBuildPath,
        inspectionResult,
        validationResult,
        exportResult,
        error: message
      };
    }
  }
}
