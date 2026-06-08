import type { GodotRunResult, WebExportResult } from "@gameaistudio/shared";
import { ExportService } from "./export-service";
import { GodotService } from "./godot-service";
import { ProjectService } from "./project-service";
import { RunService } from "./run-service";

function summarizeRunResult(result: GodotRunResult, successMessage: string): string {
  if (result.ok) {
    return successMessage;
  }
  return result.stderr || result.stdout || "命令执行失败。";
}

function resultOutput(result: GodotRunResult): string {
  return [result.stdout.trim(), result.stderr.trim() ? `\n--- stderr ---\n${result.stderr.trim()}` : ""].join("").trim();
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
    const run = await this.runService.createRun({
      projectId,
      kind: "godot-export",
      title: "Web zip 导出",
      steps: [
        { title: "Godot 项目校验", message: "导出前检查 Godot 项目结构和脚本。" },
        { title: "Godot Web 导出", message: "使用内置 Godot 导出 Web 构建。" },
        { title: "打包 Web zip", message: "压缩 build/web 为可分享的 zip 文件。" }
      ]
    });

    const [validateStep, exportStep, zipStep] = run.steps;
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

    await this.runService.updateStep(run.id, zipStep!.id, { status: "running" });
    try {
      const zipResult = await this.exportService.zipWebBuild(projectId);
      await this.runService.updateStep(run.id, zipStep!.id, {
        status: "completed",
        message: `Web zip 已生成：${zipResult.zipPath}`
      });
      const completedRun = await this.runService.finishRun(run.id, "completed", `Web zip 已导出：${zipResult.zipPath}`);
      return {
        ok: true,
        project: await this.projectService.getProject(projectId),
        run: completedRun,
        webBuildPath: zipResult.webBuildPath,
        zipPath: zipResult.zipPath,
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
  }
}
