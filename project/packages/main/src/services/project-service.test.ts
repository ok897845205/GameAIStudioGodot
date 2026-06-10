import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioProject } from "@gameaistudio/shared";
import { ProjectService, assertTemplateReady, shouldCopyTemplateEntry } from "./project-service";
import type { StudioPaths } from "./resource-paths";
import { StudioStore } from "./store";

const WEB_EXPORT_PRESET = `[preset.0]

name="Web"
platform="Web"
export_path="build/web/index.html"
`;

function createPaths(root: string): StudioPaths {
  return {
    resourceRoot: root,
    dataRoot: path.join(root, "data"),
    projectsRoot: path.join(root, "data", "projects"),
    templatesRoot: path.join(root, "gameaistudio_template"),
    engineRoot: path.join(root, "engine"),
    godotGuiPath: undefined,
    godotConsolePath: undefined
  };
}

async function writeTemplate(paths: StudioPaths, dimension: "2d" | "3d", options: { includeProject?: boolean; includeWebExport?: boolean } = {}) {
  const includeProject = options.includeProject ?? true;
  const includeWebExport = options.includeWebExport ?? true;
  const templatePath = path.join(paths.templatesRoot, `gameaistudio_template_${dimension}`);
  await mkdir(templatePath, { recursive: true });
  if (includeProject) {
    await writeFile(path.join(templatePath, "project.godot"), `config/name="${dimension.toUpperCase()}"\n`, "utf8");
  }
  if (includeWebExport) {
    await writeFile(path.join(templatePath, "export_presets.cfg"), WEB_EXPORT_PRESET, "utf8");
  }
  await writeFile(path.join(templatePath, "main.tscn"), "[gd_scene format=3]\n", "utf8");
  return templatePath;
}

describe("assertTemplateReady", () => {
  it("fails when the template project file is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-project-service-"));
    const paths = createPaths(root);

    try {
      const templatePath = await writeTemplate(paths, "2d", { includeProject: false });

      await expect(assertTemplateReady(templatePath, "2d")).rejects.toThrow("2D Godot 模板工程缺失");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the template has no Web export preset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-project-service-"));
    const paths = createPaths(root);

    try {
      const templatePath = await writeTemplate(paths, "3d", { includeWebExport: false });

      await expect(assertTemplateReady(templatePath, "3d")).rejects.toThrow("3D Godot 模板缺少 Web 导出预设");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("shouldCopyTemplateEntry", () => {
  it("excludes generated Godot cache and build output directories from copied projects", () => {
    const templatePath = path.join("C:", "templates", "gameaistudio_template_2d");

    expect(shouldCopyTemplateEntry(templatePath, templatePath)).toBe(true);
    expect(shouldCopyTemplateEntry(templatePath, path.join(templatePath, "scripts", "player.gd"))).toBe(true);
    expect(shouldCopyTemplateEntry(templatePath, path.join(templatePath, ".godot", "uid_cache.bin"))).toBe(false);
    expect(shouldCopyTemplateEntry(templatePath, path.join(templatePath, "build", "web", "index.html"))).toBe(false);
    expect(shouldCopyTemplateEntry(templatePath, path.join(templatePath, "dist", "old.zip"))).toBe(false);
  });
});

describe("ProjectService", () => {
  it("creates a Godot project from a Web-ready template", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-project-service-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "state.json"));
    const service = new ProjectService(paths, store);

    try {
      await writeTemplate(paths, "2d");
      const project = await service.createProject({
        name: "黄金矿工",
        dimension: "2d",
        prompt: "我要创建一个黄金矿工"
      });

      expect(project.dimension).toBe("2d");
      expect(project.messages).toHaveLength(2);
      expect(await readFile(path.join(project.rootPath, "project.godot"), "utf8")).toContain('config/name="黄金矿工"');
      expect(await readFile(path.join(project.rootPath, "GAMEAISTUDIO.md"), "utf8")).toContain("Original prompt: 我要创建一个黄金矿工");
      expect(await readFile(path.join(project.rootPath, ".gameaistudio", "agent-context.md"), "utf8")).toContain("No Agent turn has been prepared yet");
      expect(await readFile(path.join(project.rootPath, ".gameaistudio", "agent-journal.md"), "utf8")).toContain("Project created");
      for (const relativePath of ["GAMEAISTUDIO.md", ".gameaistudio/agent-context.md", ".gameaistudio/agent-journal.md"]) {
        const bytes = await readFile(path.join(project.rootPath, relativePath));
        expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      }
      expect((await store.listProjects()).map((stored) => stored.id)).toEqual([project.id]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("copies a clean template without stale Godot cache or previous Web build output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-project-service-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "state.json"));
    const service = new ProjectService(paths, store);

    try {
      const templatePath = await writeTemplate(paths, "2d");
      await mkdir(path.join(templatePath, ".godot"), { recursive: true });
      await mkdir(path.join(templatePath, "build", "web"), { recursive: true });
      await mkdir(path.join(templatePath, "dist"), { recursive: true });
      await writeFile(path.join(templatePath, ".godot", "uid_cache.bin"), "cache", "utf8");
      await writeFile(path.join(templatePath, "build", "web", "index.html"), "<html></html>", "utf8");
      await writeFile(path.join(templatePath, "dist", "old.zip"), "zip", "utf8");

      const project = await service.createProject({
        name: "Clean Template",
        dimension: "2d",
        prompt: "demo"
      });

      await expect(access(path.join(project.rootPath, "main.tscn"))).resolves.toBeUndefined();
      await expect(access(path.join(project.rootPath, ".godot", "uid_cache.bin"))).rejects.toThrow();
      await expect(access(path.join(project.rootPath, "build", "web", "index.html"))).rejects.toThrow();
      await expect(access(path.join(project.rootPath, "dist", "old.zip"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the in-project metadata current without overwriting the Agent guide", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-project-service-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "state.json"));
    const service = new ProjectService(paths, store);

    try {
      await writeTemplate(paths, "2d");
      const project = await service.createProject({
        name: "Metadata Demo",
        dimension: "2d",
        prompt: "demo"
      });
      const guidePath = path.join(project.rootPath, "GAMEAISTUDIO.md");
      await writeFile(guidePath, "# Metadata Demo\n\nDecision: keep hook timing snappy.\n", "utf8");

      const updated = await service.updateProject({
        ...project,
        exportZipPath: path.join(project.rootPath, "dist", "metadata-demo-web.zip"),
        latestExportManifestPath: path.join(project.webBuildPath, "gameaistudio-export.json")
      });

      const manifest = JSON.parse(await readFile(path.join(project.rootPath, ".gameaistudio", "project.json"), "utf8")) as StudioProject;
      expect(manifest.updatedAt).toBe(updated.updatedAt);
      expect(manifest.exportZipPath).toBe(updated.exportZipPath);
      expect(manifest.latestExportManifestPath).toBe(updated.latestExportManifestPath);
      expect(await readFile(guidePath, "utf8")).toContain("Decision: keep hook timing snappy.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deletes a project record and its local Godot directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-project-service-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "state.json"));
    const service = new ProjectService(paths, store);

    try {
      await writeTemplate(paths, "2d");
      const project = await service.createProject({
        name: "Delete Demo",
        dimension: "2d",
        prompt: "demo"
      });

      const deleted = await service.deleteProject(project.id);

      expect(deleted.rootPath).toBe(project.rootPath);
      await expect(access(project.rootPath)).rejects.toThrow();
      expect(await store.listProjects()).toEqual([]);
      await expect(service.requireProject(project.id)).rejects.toThrow("Project not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
