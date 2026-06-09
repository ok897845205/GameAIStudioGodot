import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExportResult, StudioProject, WebBuildInspection } from "@gameaistudio/shared";
import { sanitizeProjectName } from "./naming";
import { ProjectService } from "./project-service";
import { runProcess } from "./process-runner";
import { getProjectLogger } from "./logger";

const REQUIRED_WEB_BUILD_FILES = ["index.html", "*.wasm", "*.pck"];
const EXPORT_MANIFEST_FILENAME = "gameaistudio-export.json";
const REQUIRED_WEB_ZIP_FILES = ["index.html", EXPORT_MANIFEST_FILENAME, "*.wasm", "*.pck"];

export interface WebZipInspection {
  ok: boolean;
  zipPath?: string;
  entries: string[];
  requiredFiles: string[];
  missingRequiredFiles: string[];
  message: string;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shortOutput(value?: string, maxLength = 1200): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(+${text.length - maxLength})` : text;
}

async function collectFiles(rootPath: string, currentPath = rootPath): Promise<Array<{ relativePath: string; size: number }>> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(rootPath, absolutePath);
      }
      if (!entry.isFile()) {
        return [];
      }
      const fileStat = await stat(absolutePath);
      return [
        {
          relativePath: path.relative(rootPath, absolutePath).replace(/\\/g, "/"),
          size: fileStat.size
        }
      ];
    })
  );
  return files.flat();
}

export async function inspectWebBuildPath(projectId: string, webBuildPath: string): Promise<WebBuildInspection> {
  let artifacts: Array<{ relativePath: string; size: number }> = [];
  try {
    artifacts = await collectFiles(webBuildPath);
  } catch {
    artifacts = [];
  }

  const files = artifacts.map((artifact) => artifact.relativePath).sort((left, right) => left.localeCompare(right));
  const lowerFiles = files.map((file) => file.toLowerCase());
  const missingRequiredFiles = [
    lowerFiles.includes("index.html") ? undefined : "index.html",
    lowerFiles.some((file) => file.endsWith(".wasm")) ? undefined : "*.wasm",
    lowerFiles.some((file) => file.endsWith(".pck")) ? undefined : "*.pck"
  ].filter((file): file is string => Boolean(file));
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
  const ok = missingRequiredFiles.length === 0;

  return {
    projectId,
    webBuildPath,
    ok,
    files,
    totalBytes,
    requiredFiles: REQUIRED_WEB_BUILD_FILES,
    missingRequiredFiles,
    message: ok
      ? `Web build contains ${files.length} files (${totalBytes} bytes).`
      : `Web build is missing required files: ${missingRequiredFiles.join(", ")}.`
  };
}

export function buildExportManifest(project: StudioProject, inspection: WebBuildInspection, exportedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      formatVersion: 1,
      generator: "GameAIStudio",
      exportedAt,
      project: {
        id: project.id,
        name: project.name,
        dimension: project.dimension,
        prompt: project.prompt
      },
      webBuild: {
        ok: inspection.ok,
        totalBytes: inspection.totalBytes,
        files: inspection.files,
        requiredFiles: inspection.requiredFiles,
        missingRequiredFiles: inspection.missingRequiredFiles
      }
    },
    null,
    2
  );
}

async function writeExportManifest(project: StudioProject, inspection: WebBuildInspection): Promise<string> {
  const manifestPath = path.join(project.webBuildPath, EXPORT_MANIFEST_FILENAME);
  await writeFile(manifestPath, `${buildExportManifest(project, inspection)}\n`, "utf8");
  return manifestPath;
}

export function buildWebZipPath(project: StudioProject): string {
  return path.join(project.rootPath, "dist", `${sanitizeProjectName(project.name)}-web.zip`);
}

export function inspectWebZipEntries(entries: string[], zipPath?: string): WebZipInspection {
  const normalizedEntries = entries
    .map((entry) => entry.replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase())
    .sort((left, right) => left.localeCompare(right));
  const missingRequiredFiles = [
    normalizedEntries.includes("index.html") ? undefined : "index.html",
    normalizedEntries.includes(EXPORT_MANIFEST_FILENAME) ? undefined : EXPORT_MANIFEST_FILENAME,
    normalizedEntries.some((entry) => entry.endsWith(".wasm")) ? undefined : "*.wasm",
    normalizedEntries.some((entry) => entry.endsWith(".pck")) ? undefined : "*.pck"
  ].filter((file): file is string => Boolean(file));
  const ok = missingRequiredFiles.length === 0;

  return {
    ok,
    zipPath,
    entries: normalizedEntries,
    requiredFiles: REQUIRED_WEB_ZIP_FILES,
    missingRequiredFiles,
    message: ok
      ? `Web zip contains ${normalizedEntries.length} entries.`
      : `Web zip is missing required files: ${missingRequiredFiles.join(", ")}.`
  };
}

async function listZipEntries(zipPath: string): Promise<string[]> {
  if (process.platform === "win32") {
    const command = [
      "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
      `$zip = [System.IO.Compression.ZipFile]::OpenRead(${psQuote(zipPath)});`,
      "try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }"
    ].join(" ");
    const result = await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      timeoutMs: 2 * 60 * 1000
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "Could not inspect Web zip.");
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const result = await runProcess("unzip", ["-Z1", zipPath], { timeoutMs: 2 * 60 * 1000 });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "Could not inspect Web zip.");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function inspectWebZipPath(zipPath: string): Promise<WebZipInspection> {
  return inspectWebZipEntries(await listZipEntries(zipPath), zipPath);
}

export class ExportService {
  constructor(private readonly projectService: ProjectService) {}

  async inspectWebBuild(projectId: string): Promise<WebBuildInspection> {
    const project = await this.projectService.requireProject(projectId);
    const inspection = await inspectWebBuildPath(project.id, project.webBuildPath);
    getProjectLogger(project.rootPath).log(inspection.ok ? "info" : "warn", "export", "Web 构建产物检查完成", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      webBuildPath: project.webBuildPath,
      ok: inspection.ok,
      fileCount: inspection.files.length,
      totalBytes: inspection.totalBytes,
      missingRequiredFiles: inspection.missingRequiredFiles,
      message: inspection.message
    });
    await this.projectService.updateProject({
      ...project,
      latestWebBuildInspection: inspection
    });
    return inspection;
  }

  async zipWebBuild(projectId: string): Promise<ExportResult> {
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);
    const startedAt = Date.now();
    log.info("export", "开始打包 Web zip", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      webBuildPath: project.webBuildPath
    });
    const inspection = await inspectWebBuildPath(project.id, project.webBuildPath);
    if (!inspection.ok) {
      await this.projectService.updateProject({ ...project, latestWebBuildInspection: inspection });
      log.warn("export", "Web zip 打包失败：构建产物不完整", {
        projectId: project.id,
        project: project.name,
        webBuildPath: project.webBuildPath,
        missingRequiredFiles: inspection.missingRequiredFiles,
        fileCount: inspection.files.length,
        message: inspection.message,
        durationMs: Date.now() - startedAt
      });
      throw new Error(inspection.message);
    }
    const manifestPath = await writeExportManifest(project, inspection);

    const exportDir = path.join(project.rootPath, "dist");
    await mkdir(exportDir, { recursive: true });
    const zipPath = buildWebZipPath(project);

    if (process.platform === "win32") {
      const sourceGlob = `${project.webBuildPath}${path.sep}*`;
      const command = `Compress-Archive -Path ${psQuote(sourceGlob)} -DestinationPath ${psQuote(zipPath)} -Force`;
      const result = await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
        timeoutMs: 10 * 60 * 1000
      });
      if (result.exitCode !== 0) {
        log.warn("export", "Web zip 打包失败：Compress-Archive 异常", {
          projectId: project.id,
          project: project.name,
          zipPath,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdout: shortOutput(result.stdout, 600),
          stderr: shortOutput(result.stderr)
        });
        throw new Error(result.stderr || result.stdout || "Compress-Archive failed.");
      }
    } else {
      const result = await runProcess("zip", ["-r", zipPath, "."], {
        cwd: project.webBuildPath,
        timeoutMs: 10 * 60 * 1000
      });
      if (result.exitCode !== 0) {
        log.warn("export", "Web zip 打包失败：zip 命令异常", {
          projectId: project.id,
          project: project.name,
          zipPath,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdout: shortOutput(result.stdout, 600),
          stderr: shortOutput(result.stderr)
        });
        throw new Error(result.stderr || result.stdout || "zip failed.");
      }
    }

    const zipInspection = await inspectWebZipPath(zipPath);
    if (!zipInspection.ok) {
      log.warn("export", "Web zip 打包失败：zip 内容检查未通过", {
        projectId: project.id,
        project: project.name,
        zipPath,
        missingRequiredFiles: zipInspection.missingRequiredFiles,
        entryCount: zipInspection.entries.length,
        message: zipInspection.message,
        durationMs: Date.now() - startedAt
      });
      throw new Error(zipInspection.message);
    }

    const updated = await this.projectService.updateProject({
      ...project,
      exportZipPath: zipPath,
      latestExportManifestPath: manifestPath,
      latestWebBuildInspection: inspection
    });
    log.info("export", "Web zip 打包完成", {
      projectId: updated.id,
      project: updated.name,
      rootPath: updated.rootPath,
      webBuildPath: updated.webBuildPath,
      zipPath,
      manifestPath,
      fileCount: inspection.files.length,
      totalBytes: inspection.totalBytes,
      durationMs: Date.now() - startedAt
    });
    return {
      projectId: updated.id,
      zipPath,
      webBuildPath: updated.webBuildPath,
      manifestPath,
      inspection
    };
  }
}
