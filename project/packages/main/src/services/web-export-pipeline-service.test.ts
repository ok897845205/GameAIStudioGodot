import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectDetails, StudioProject } from "@gameaistudio/shared";
import { RunService } from "./run-service";
import { StudioStore } from "./store";
import { WebExportPipelineService } from "./web-export-pipeline-service";

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
        runs: await runService.listRuns(project.id),
        snapshots: []
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
      expect(result.run.steps.map((step) => step.status)).toEqual(["failed", "queued", "queued"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
