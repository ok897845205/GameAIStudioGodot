import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioProject } from "@gameaistudio/shared";
import { ExportService, buildExportManifest, buildWebZipPath, inspectWebBuildPath, inspectWebZipEntries, inspectWebZipPath } from "./export-service";
import { getProjectLogger } from "./logger";

function createProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "Gold Miner",
    dimension: "2d",
    prompt: "gold miner",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
}

describe("inspectWebBuildPath", () => {
  it("reports missing required Godot Web artifacts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-web-build-"));

    try {
      const inspection = await inspectWebBuildPath("project_1", path.join(dir, "missing-build"));

      expect(inspection.ok).toBe(false);
      expect(inspection.files).toEqual([]);
      expect(inspection.missingRequiredFiles).toEqual(["index.html", "*.wasm", "*.pck"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts a complete Godot Web build", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-web-build-"));
    const webBuildPath = path.join(dir, "build", "web");

    try {
      await mkdir(webBuildPath, { recursive: true });
      await writeFile(path.join(webBuildPath, "index.html"), "<html></html>", "utf8");
      await writeFile(path.join(webBuildPath, "game.wasm"), "wasm", "utf8");
      await writeFile(path.join(webBuildPath, "game.pck"), "pack", "utf8");

      const inspection = await inspectWebBuildPath("project_1", webBuildPath);

      expect(inspection.ok).toBe(true);
      expect(inspection.files).toEqual(["game.pck", "game.wasm", "index.html"]);
      expect(inspection.missingRequiredFiles).toEqual([]);
      expect(inspection.totalBytes).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildWebZipPath", () => {
  it("uses a Windows-safe filename for ordinary user project names", () => {
    const project = {
      ...createProject("C:\\Users\\KSG\\Documents\\GameAIStudio\\projects\\GoldMiner"),
      name: "黄金矿工: 2D/3D?"
    };

    expect(buildWebZipPath(project)).toBe(path.join(project.rootPath, "dist", "黄金矿工-2D-3D-web.zip"));
  });
});

describe("inspectWebZipEntries", () => {
  it("requires the playable Web files and export manifest", () => {
    const inspection = inspectWebZipEntries(["index.html", "game.wasm", "game.pck"]);

    expect(inspection.ok).toBe(false);
    expect(inspection.missingRequiredFiles).toEqual(["gameaistudio-export.json"]);
  });

  it("accepts a complete Web zip entry list", () => {
    const inspection = inspectWebZipEntries(["./index.html", "game.wasm", "game.pck", "gameaistudio-export.json"]);

    expect(inspection.ok).toBe(true);
    expect(inspection.missingRequiredFiles).toEqual([]);
  });
});

describe("ExportService", () => {
  it("persists the latest Web build inspection on the project", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-export-service-"));
    let project = createProject(path.join(dir, "project"));
    const projectService = {
      requireProject: async () => project,
      updateProject: async (updated: StudioProject) => {
        project = updated;
        return updated;
      }
    };

    try {
      const service = new ExportService(projectService as never);
      const inspection = await service.inspectWebBuild(project.id);

      expect(inspection.ok).toBe(false);
      expect(project.latestWebBuildInspection).toEqual(inspection);
      expect(project.latestWebBuildInspection?.missingRequiredFiles).toEqual(["index.html", "*.wasm", "*.pck"]);
      await getProjectLogger(project.rootPath).flush();
      const log = await readFile(path.join(project.rootPath, ".gameaistudio", "logs", "project.log"), "utf8");
      expect(log).toContain("[export] Web 构建产物检查完成");
      expect(log).toContain("index.html");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists the zip path with the successful Web build inspection", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-export-service-"));
    let project = createProject(path.join(dir, "project"));
    const projectService = {
      requireProject: async () => project,
      updateProject: async (updated: StudioProject) => {
        project = updated;
        return updated;
      }
    };

    try {
      await mkdir(project.webBuildPath, { recursive: true });
      await writeFile(path.join(project.webBuildPath, "index.html"), "<html></html>", "utf8");
      await writeFile(path.join(project.webBuildPath, "game.wasm"), "wasm", "utf8");
      await writeFile(path.join(project.webBuildPath, "game.pck"), "pack", "utf8");

      const service = new ExportService(projectService as never);
      const result = await service.zipWebBuild(project.id);

      expect(result.inspection?.ok).toBe(true);
      expect(result.manifestPath).toBe(path.join(project.webBuildPath, "gameaistudio-export.json"));
      expect(await inspectWebZipPath(result.zipPath)).toMatchObject({
        ok: true,
        missingRequiredFiles: []
      });
      expect(project.exportZipPath).toBe(result.zipPath);
      expect(project.latestExportManifestPath).toBe(result.manifestPath);
      expect(project.latestWebBuildInspection).toEqual(result.inspection);
      expect((await stat(result.zipPath)).isFile()).toBe(true);
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
        generator: string;
        project: { id: string; name: string; dimension: string; prompt: string; rootPath?: string };
        webBuild: { requiredFiles: string[]; files: string[] };
      };
      expect(manifest.generator).toBe("GameAIStudio");
      expect(manifest.project).toEqual({
        id: project.id,
        name: "Gold Miner",
        dimension: "2d",
        prompt: "gold miner"
      });
      expect(manifest.project.rootPath).toBeUndefined();
      expect(manifest.webBuild.requiredFiles).toEqual(["index.html", "*.wasm", "*.pck"]);
      expect(manifest.webBuild.files).toEqual(["game.pck", "game.wasm", "index.html"]);
      await getProjectLogger(project.rootPath).flush();
      const log = await readFile(path.join(project.rootPath, ".gameaistudio", "logs", "project.log"), "utf8");
      expect(log).toContain("[export] 开始打包 Web zip");
      expect(log).toContain("[export] Web zip 打包完成");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds a portable export manifest without local project paths", () => {
    const project = createProject("C:\\Users\\KSG\\Documents\\GameAIStudio\\projects\\GoldMiner");
    const inspection = {
      projectId: project.id,
      webBuildPath: project.webBuildPath,
      ok: true,
      files: ["index.html", "game.wasm", "game.pck"],
      totalBytes: 256,
      requiredFiles: ["index.html", "*.wasm", "*.pck"],
      missingRequiredFiles: [],
      message: "ok"
    };

    const manifest = buildExportManifest(project, inspection, "2026-06-08T00:00:00.000Z");

    expect(manifest).toContain("\"generator\": \"GameAIStudio\"");
    expect(manifest).toContain("\"exportedAt\": \"2026-06-08T00:00:00.000Z\"");
    expect(manifest).not.toContain("Documents");
    expect(manifest).not.toContain("webBuildPath");
  });
});
