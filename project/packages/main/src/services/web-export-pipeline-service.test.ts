import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectDetails, StudioProject } from "@gameaistudio/shared";
import { RunService } from "./run-service";
import { StudioStore } from "./store";
import { WebExportPipelineService } from "./web-export-pipeline-service";
import { getProjectLogger } from "./logger";

function createProject(rootPath: string): StudioProject {
  return {
    id: "proj_1",
    name: "Demo",
    dimension: "2d",
    prompt: "demo",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
}

function createInspection(project: StudioProject, ok = true) {
  return {
    projectId: project.id,
    webBuildPath: project.webBuildPath,
    ok,
    files: ok ? ["game.pck", "game.wasm", "index.html"] : ["index.html"],
    totalBytes: ok ? 1024 : 12,
    requiredFiles: ["index.html", "*.wasm", "*.pck"],
    missingRequiredFiles: ok ? [] : ["*.wasm", "*.pck"],
    message: ok ? "Web build contains 3 files (1024 bytes)." : "Web build is missing required files: *.wasm, *.pck."
  };
}

describe("WebExportPipelineService", () => {
  it("stops before export and zip when validation fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-export-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);

    let exportCalled = false;
    let zipCalled = false;

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages: [],
        runs: await runService.listRuns(project.id)
      })
    };
    const godotService = {
      validate: async () => ({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "validation failed",
        durationMs: 1
      }),
      exportWeb: async () => {
        exportCalled = true;
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1
        };
      }
    };
    const exportService = {
      inspectWebBuild: async () => createInspection(project),
      zipWebBuild: async () => {
        zipCalled = true;
        return {
          projectId: project.id,
          zipPath: path.join(project.rootPath, "dist", "demo.zip"),
          webBuildPath: project.webBuildPath
        };
      }
    };

    try {
      const pipeline = new WebExportPipelineService(projectService as never, godotService as never, exportService as never, runService);
      const result = await pipeline.exportWebZip(project.id);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("校验失败");
      expect(exportCalled).toBe(false);
      expect(zipCalled).toBe(false);
      expect(result.run.status).toBe("failed");
      expect(result.run.steps.map((step) => step.status)).toEqual(["failed", "queued", "queued", "queued"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops before zip when the exported Web build is incomplete", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-export-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);

    let zipCalled = false;

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages: [],
        runs: await runService.listRuns(project.id)
      })
    };
    const godotService = {
      validate: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      }),
      exportWeb: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      })
    };
    const exportService = {
      inspectWebBuild: async () => createInspection(project, false),
      zipWebBuild: async () => {
        zipCalled = true;
        return {
          projectId: project.id,
          zipPath: path.join(project.rootPath, "dist", "demo.zip"),
          webBuildPath: project.webBuildPath
        };
      }
    };

    try {
      const pipeline = new WebExportPipelineService(projectService as never, godotService as never, exportService as never, runService);
      const result = await pipeline.exportWebZip(project.id);

      expect(result.ok).toBe(false);
      expect(result.inspectionResult?.missingRequiredFiles).toEqual(["*.wasm", "*.pck"]);
      expect(zipCalled).toBe(false);
      expect(result.run.status).toBe("failed");
      expect(result.run.steps.map((step) => step.status)).toEqual(["completed", "completed", "failed", "queued"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finishes the run when Web build inspection throws", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-export-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);

    let zipCalled = false;

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages: [],
        runs: await runService.listRuns(project.id)
      })
    };
    const godotService = {
      validate: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      }),
      exportWeb: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      })
    };
    const exportService = {
      inspectWebBuild: async () => {
        throw new Error("cannot inspect build output");
      },
      zipWebBuild: async () => {
        zipCalled = true;
        return {
          projectId: project.id,
          zipPath: path.join(project.rootPath, "dist", "demo.zip"),
          webBuildPath: project.webBuildPath
        };
      }
    };

    try {
      const pipeline = new WebExportPipelineService(projectService as never, godotService as never, exportService as never, runService);
      const result = await pipeline.exportWebZip(project.id);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("cannot inspect build output");
      expect(zipCalled).toBe(false);
      expect(result.run.status).toBe("failed");
      expect(result.run.summary).toBe("Web 构建产物检查失败，已停止 zip 打包。");
      expect(result.run.steps.map((step) => step.status)).toEqual(["completed", "completed", "failed", "queued"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns the Web build inspection when export and zip complete", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-export-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);
    const inspection = createInspection(project);

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages: [],
        runs: await runService.listRuns(project.id)
      })
    };
    const godotService = {
      validate: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      }),
      exportWeb: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      })
    };
    const exportService = {
      inspectWebBuild: async () => inspection,
      zipWebBuild: async () => ({
        projectId: project.id,
        zipPath: path.join(project.rootPath, "dist", "demo.zip"),
        manifestPath: path.join(project.webBuildPath, "gameaistudio-export.json"),
        webBuildPath: project.webBuildPath,
        inspection
      })
    };

    try {
      const pipeline = new WebExportPipelineService(projectService as never, godotService as never, exportService as never, runService);
      const result = await pipeline.exportWebZip(project.id);

      expect(result.ok).toBe(true);
      expect(result.manifestPath).toBe(path.join(project.webBuildPath, "gameaistudio-export.json"));
      expect(result.inspectionResult).toEqual(inspection);
      expect(result.run.status).toBe("completed");
      expect(result.run.steps.map((step) => step.status)).toEqual(["completed", "completed", "completed", "completed"]);
      await getProjectLogger(project.rootPath).flush();
      const log = await readFile(path.join(project.rootPath, ".gameaistudio", "logs", "project.log"), "utf8");
      expect(log).toContain("[export] 开始 Web zip 导出流水线");
      expect(log).toContain("[export] Web zip 导出流水线完成");
      expect(log).toContain(result.run.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
