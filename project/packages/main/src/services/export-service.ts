import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExportResult } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import { runProcess } from "./process-runner";

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class ExportService {
  constructor(private readonly projectService: ProjectService) {}

  async zipWebBuild(projectId: string): Promise<ExportResult> {
    const project = await this.projectService.requireProject(projectId);
    const exportDir = path.join(project.rootPath, "dist");
    await mkdir(exportDir, { recursive: true });
    const zipPath = path.join(exportDir, `${project.name.replace(/\s+/g, "-")}-web.zip`);

    if (process.platform === "win32") {
      const sourceGlob = `${project.webBuildPath}${path.sep}*`;
      const command = `Compress-Archive -Path ${psQuote(sourceGlob)} -DestinationPath ${psQuote(zipPath)} -Force`;
      const result = await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
        timeoutMs: 10 * 60 * 1000
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || "Compress-Archive failed.");
      }
    } else {
      const result = await runProcess("zip", ["-r", zipPath, "."], {
        cwd: project.webBuildPath,
        timeoutMs: 10 * 60 * 1000
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || "zip failed.");
      }
    }

    const updated = await this.projectService.updateProject({ ...project, exportZipPath: zipPath });
    return {
      projectId: updated.id,
      zipPath,
      webBuildPath: updated.webBuildPath
    };
  }
}

