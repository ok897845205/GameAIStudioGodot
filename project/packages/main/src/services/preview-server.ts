import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { PreviewResult } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

interface RunningPreview {
  server: http.Server;
  url: string;
}

export function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const relativePath = path.relative(path.resolve(directory), path.resolve(candidate));
  return relativePath === "" || (Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function safeDecodeRequestPath(requestPath: string): string {
  try {
    return decodeURIComponent(requestPath.split("?")[0] ?? "/");
  } catch {
    return "/";
  }
}

export function safeJoin(root: string, requestPath: string): string {
  const decoded = safeDecodeRequestPath(requestPath);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (!isPathInsideDirectory(target, resolvedRoot)) {
    return path.join(resolvedRoot, "index.html");
  }
  return target;
}

async function assertPreviewBuildReady(webBuildPath: string): Promise<void> {
  try {
    await readdir(webBuildPath);
  } catch {
    throw new Error(`Web 预览目录不存在：${webBuildPath}。请先导出 Web 构建。`);
  }

  const indexPath = path.join(webBuildPath, "index.html");
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error(`Web 预览缺少 index.html：${indexPath}。请重新导出 Web 构建。`);
  }
}

export class PreviewServer {
  private readonly previews = new Map<string, RunningPreview>();

  constructor(private readonly projectService: ProjectService) {}

  async start(projectId: string): Promise<PreviewResult> {
    const existing = this.previews.get(projectId);
    const project = await this.projectService.requireProject(projectId);
    if (existing) {
      return {
        projectId,
        url: existing.url,
        webBuildPath: project.webBuildPath
      };
    }

    await assertPreviewBuildReady(project.webBuildPath);
    const server = http.createServer((request, response) => {
      const target = safeJoin(project.webBuildPath, request.url ?? "/");
      const finalTarget = existsSync(target) && statSync(target).isFile() ? target : path.join(project.webBuildPath, "index.html");
      if (!existsSync(finalTarget) || !statSync(finalTarget).isFile()) {
        response.writeHead(404, {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8"
        });
        response.end("Preview file not found.");
        return;
      }
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Expires", "0");
      response.setHeader("Content-Type", MIME_TYPES[path.extname(finalTarget).toLowerCase()] ?? "application/octet-stream");
      createReadStream(finalTarget).pipe(response);
    });

    const url = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address) {
          resolve(`http://127.0.0.1:${address.port}/index.html`);
        }
      });
    });

    this.previews.set(projectId, { server, url });
    await this.projectService.updateProject({ ...project, previewUrl: url });

    return {
      projectId,
      url,
      webBuildPath: project.webBuildPath
    };
  }

  async stop(projectId: string): Promise<void> {
    const preview = this.previews.get(projectId);
    if (!preview) {
      return;
    }
    await new Promise<void>((resolve) => {
      preview.server.close(() => resolve());
    });
    this.previews.delete(projectId);
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.previews.values()].map(
        (preview) =>
          new Promise<void>((resolve) => {
            preview.server.close(() => resolve());
          })
      )
    );
    this.previews.clear();
  }
}
