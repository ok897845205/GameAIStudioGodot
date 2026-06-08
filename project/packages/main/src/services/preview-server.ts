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

function safeJoin(root: string, requestPath: string): string {
  const decoded = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (!target.startsWith(resolvedRoot)) {
    return path.join(resolvedRoot, "index.html");
  }
  return target;
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

    await readdir(project.webBuildPath);
    const server = http.createServer((request, response) => {
      const target = safeJoin(project.webBuildPath, request.url ?? "/");
      const finalTarget = existsSync(target) && statSync(target).isFile() ? target : path.join(project.webBuildPath, "index.html");
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
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

