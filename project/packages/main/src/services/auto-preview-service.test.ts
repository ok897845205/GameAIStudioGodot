import path from "node:path";
import { describe, expect, it } from "vitest";
import { addPreviewCacheBust, shouldTriggerAutoPreview } from "./auto-preview-service";

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
