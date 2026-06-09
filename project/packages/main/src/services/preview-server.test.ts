import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioProject } from "@gameaistudio/shared";
import { PreviewServer, isPathInsideDirectory, safeJoin } from "./preview-server";

function createProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "Preview",
    dimension: "2d",
    prompt: "preview",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
}

describe("PreviewServer", () => {
  it("keeps preview paths inside the Web build directory", () => {
    const root = path.join(path.resolve(os.tmpdir()), "gameaistudio-preview-root", "web");
    const sibling = path.join(path.dirname(root), `${path.basename(root)}-secret`, "secret.txt");

    expect(isPathInsideDirectory(path.join(root, "index.html"), root)).toBe(true);
    expect(isPathInsideDirectory(sibling, root)).toBe(false);
    expect(safeJoin(root, "/%2e%2e/web-secret/secret.txt")).toBe(path.join(root, "index.html"));
    expect(safeJoin(root, "/%E0%A4%A")).toBe(path.join(root, "index.html"));
  });

  it("serves preview files with no-cache headers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-preview-"));
    const project = createProject(path.join(dir, "project"));
    await mkdir(project.webBuildPath, { recursive: true });
    await writeFile(path.join(project.webBuildPath, "index.html"), "<html><body>preview</body></html>", "utf8");

    const projectService = {
      requireProject: async () => project,
      updateProject: async (updated: StudioProject) => updated
    };
    const server = new PreviewServer(projectService as never);

    try {
      const preview = await server.start(project.id);
      const response = await fetch(preview.url);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("expires")).toBe("0");
      expect(await response.text()).toContain("preview");
    } finally {
      await server.stopAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails clearly when the Web build directory is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-preview-"));
    const project = createProject(path.join(dir, "project"));
    const projectService = {
      requireProject: async () => project,
      updateProject: async (updated: StudioProject) => updated
    };
    const server = new PreviewServer(projectService as never);

    try {
      await expect(server.start(project.id)).rejects.toThrow("Web 预览目录不存在");
    } finally {
      await server.stopAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails clearly when the Web build index is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-preview-"));
    const project = createProject(path.join(dir, "project"));
    await mkdir(project.webBuildPath, { recursive: true });
    const projectService = {
      requireProject: async () => project,
      updateProject: async (updated: StudioProject) => updated
    };
    const server = new PreviewServer(projectService as never);

    try {
      await expect(server.start(project.id)).rejects.toThrow("Web 预览缺少 index.html");
    } finally {
      await server.stopAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to index.html for requests outside the Web build directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-preview-"));
    const project = createProject(path.join(dir, "project"));
    await mkdir(project.webBuildPath, { recursive: true });
    await mkdir(path.join(project.rootPath, "build", "web-secret"), { recursive: true });
    await writeFile(path.join(project.webBuildPath, "index.html"), "<html><body>preview</body></html>", "utf8");
    await writeFile(path.join(project.rootPath, "build", "web-secret", "secret.txt"), "secret", "utf8");

    const projectService = {
      requireProject: async () => project,
      updateProject: async (updated: StudioProject) => updated
    };
    const server = new PreviewServer(projectService as never);

    try {
      const preview = await server.start(project.id);
      const response = await fetch(preview.url.replace("/index.html", "/%2e%2e/web-secret/secret.txt"));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("preview");
    } finally {
      await server.stopAll();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
