import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectFilePreview } from "@gameaistudio/shared";
import type { StudioProject } from "@gameaistudio/shared";
import { resolveProjectLogPath } from "./logger";
import { isPathInsideDirectory } from "./preview-server";
import { ProjectService } from "./project-service";
import { stripUtf8Bom } from "./text-file-encoding";

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const AUDIO_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac"
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const TEXT_MIME_TYPES: Record<string, string> = {
  ".cfg": "text/plain; charset=utf-8",
  ".gd": "text/plain; charset=utf-8",
  ".godot": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".tscn": "text/plain; charset=utf-8",
  ".import": "text/plain; charset=utf-8"
};

function mimeTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return (
    IMAGE_MIME_TYPES[extension] ??
    AUDIO_MIME_TYPES[extension] ??
    TEXT_MIME_TYPES[extension] ??
    "application/octet-stream"
  );
}

function isLikelyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }
  return buffer.toString("utf8").includes("\uFFFD") === false;
}

export class ProjectFilePreviewService {
  constructor(private readonly projectService: ProjectService) {}

  async read(input: { projectId: string; relativePath: string }): Promise<ProjectFilePreview> {
    const project = await this.projectService.requireProject(input.projectId);
    const normalizedRelativePath = input.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const absolutePath = path.resolve(project.rootPath, normalizedRelativePath);
    const projectRoot = path.resolve(project.rootPath);
    if (!isPathInsideDirectory(absolutePath, projectRoot)) {
      throw new Error("文件路径不在当前项目目录内。");
    }

    return this.readAbsoluteFile(project, absolutePath, normalizedRelativePath);
  }

  async readProjectLog(projectId: string): Promise<ProjectFilePreview> {
    const project = await this.projectService.requireProject(projectId);
    const absolutePath = resolveProjectLogPath(project.rootPath);
    const relativeToProject = path.relative(project.rootPath, absolutePath);
    const displayPath =
      relativeToProject && !relativeToProject.startsWith("..") && !path.isAbsolute(relativeToProject)
        ? relativeToProject.replace(/\\/g, "/")
        : absolutePath;
    return this.readAbsoluteFile(project, absolutePath, displayPath);
  }

  private async readAbsoluteFile(
    project: StudioProject,
    absolutePath: string,
    displayPath: string,
  ): Promise<ProjectFilePreview> {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`不是可预览文件：${displayPath}`);
    }

    const mimeType = mimeTypeFor(absolutePath);
    const base = {
      projectId: project.id,
      relativePath: displayPath,
      absolutePath,
      name: path.basename(absolutePath),
      size: fileStat.size,
      mimeType
    };

    if (mimeType.startsWith("image/")) {
      if (fileStat.size > MAX_IMAGE_BYTES) {
        return {
          ...base,
          kind: "binary",
          truncated: true
        };
      }
      const data = await readFile(absolutePath);
      return {
        ...base,
        kind: "image",
        dataUrl: `data:${mimeType};base64,${data.toString("base64")}`
      };
    }

    if (mimeType.startsWith("audio/")) {
      if (fileStat.size > MAX_AUDIO_BYTES) {
        return {
          ...base,
          kind: "binary",
          truncated: true
        };
      }
      const data = await readFile(absolutePath);
      return {
        ...base,
        kind: "audio",
        dataUrl: `data:${mimeType};base64,${data.toString("base64")}`
      };
    }

    const data = await readFile(absolutePath);
    const truncated = data.length > MAX_TEXT_BYTES;
    const sample = truncated ? data.subarray(0, MAX_TEXT_BYTES) : data;
    if (!isLikelyText(sample)) {
      return {
        ...base,
        kind: "binary",
        truncated
      };
    }

    return {
      ...base,
      kind: "text",
      content: stripUtf8Bom(sample.toString("utf8")),
      truncated
    };
  }
}
