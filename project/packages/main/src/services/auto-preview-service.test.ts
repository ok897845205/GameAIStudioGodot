import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PreviewEvent, StudioProject } from "@gameaistudio/shared";
import { addPreviewCacheBust, shouldRefreshPreviewAfterFileChanges, shouldTriggerAutoPreview } from "./auto-preview-service";
import { AutoPreviewService } from "./auto-preview-service";

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

describe("shouldTriggerAutoPreview", () => {
  const projectRoot = path.resolve("C:/GameAIStudio/projects/gold-miner");
  const webBuildPath = path.join(projectRoot, "build", "web");

  it("triggers for Godot source and asset files", () => {
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "scripts/player.gd")).toBe(true);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "scenes/main.tscn")).toBe(true);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "assets/gold.png")).toBe(true);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "project.godot")).toBe(true);
  });

  it("ignores generated export and engine metadata paths", () => {
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "build/web/index.html")).toBe(false);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, ".godot/imported/player.gd-abc.md5")).toBe(false);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, ".gameaistudio/project.json")).toBe(false);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "dist/game-web.zip")).toBe(false);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "scripts/player.gd.uid")).toBe(false);
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath, "icon.svg.import")).toBe(false);
  });

  it("treats unknown watcher events as relevant", () => {
    expect(shouldTriggerAutoPreview(projectRoot, webBuildPath)).toBe(true);
  });
});

describe("addPreviewCacheBust", () => {
  it("adds a version query parameter", () => {
    expect(addPreviewCacheBust("http://127.0.0.1:3000/index.html", 123)).toBe("http://127.0.0.1:3000/index.html?v=123");
    expect(addPreviewCacheBust("http://127.0.0.1:3000/index.html?debug=1", 123)).toBe(
      "http://127.0.0.1:3000/index.html?debug=1&v=123"
    );
  });
});

describe("shouldRefreshPreviewAfterFileChanges", () => {
  const projectRoot = path.resolve("C:/GameAIStudio/projects/gold-miner");
  const webBuildPath = path.join(projectRoot, "build", "web");

  it("refreshes after Agent changes to Godot scripts, scenes, or assets", () => {
    expect(
      shouldRefreshPreviewAfterFileChanges(projectRoot, webBuildPath, [
        {
          path: "scripts/hook.gd",
          kind: "modified",
          isText: true
        }
      ])
    ).toBe(true);
    expect(
      shouldRefreshPreviewAfterFileChanges(projectRoot, webBuildPath, [
        {
          path: "assets/gold.png",
          kind: "added",
          isText: false
        }
      ])
    ).toBe(true);
  });

  it("does not refresh after Agent changes only internal or generated files", () => {
    expect(
      shouldRefreshPreviewAfterFileChanges(projectRoot, webBuildPath, [
        {
          path: ".gameaistudio/agent-context.md",
          kind: "modified",
          isText: true
        },
        {
          path: "build/web/index.html",
          kind: "modified",
          isText: true
        }
      ])
    ).toBe(false);
  });
});

describe("AutoPreviewService", () => {
  it("does not start the preview server when the initial export fails", async () => {
    const project = createProject(path.resolve("C:/GameAIStudio/projects/broken-preview"));
    const events: PreviewEvent[] = [];
    let previewStarted = false;

    const projectService = {
      requireProject: async () => project,
      updateProject: async (updated: StudioProject) => {
        Object.assign(project, updated);
        return project;
      }
    };
    const godotService = {
      exportWeb: async () => ({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "export failed",
        durationMs: 10
      })
    };
    const previewServer = {
      start: async () => {
        previewStarted = true;
        return {
          projectId: project.id,
          url: "http://127.0.0.1:3000/index.html",
          webBuildPath: project.webBuildPath
        };
      }
    };
    const service = new AutoPreviewService(
      projectService as never,
      godotService as never,
      previewServer as never,
      (event) => events.push(event)
    );

    await expect(service.start(project.id)).rejects.toThrow("export failed");

    expect(previewStarted).toBe(false);
    expect(project.previewStatus).toBe("failed");
    expect(events.map((event) => event.status)).toEqual(["exporting", "failed"]);
  });
});
