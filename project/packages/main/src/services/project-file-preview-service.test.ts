import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioProject } from "@gameaistudio/shared";
import { describe, expect, it } from "vitest";
import { ProjectFilePreviewService } from "./project-file-preview-service";

function createProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "Preview Demo",
    dimension: "2d",
    prompt: "demo",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    activeAgentId: "producer"
  };
}

describe("ProjectFilePreviewService", () => {
  it("reads text files inside the selected project", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-file-preview-"));
    const project = createProject(dir);
    await writeFile(path.join(dir, "GAMEAISTUDIO.md"), "# Demo\n", "utf8");
    const service = new ProjectFilePreviewService({ requireProject: async () => project } as never);

    try {
      const preview = await service.read({
        projectId: project.id,
        relativePath: "GAMEAISTUDIO.md"
      });

      expect(preview.kind).toBe("text");
      expect(preview.content).toContain("# Demo");
      expect(preview.mimeType).toContain("markdown");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("previews project maintenance logs as text files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-file-preview-"));
    const project = createProject(dir);
    await mkdir(path.join(dir, ".gameaistudio", "logs"), { recursive: true });
    await writeFile(path.join(dir, ".gameaistudio", "logs", "project.log"), "INFO [cli-adapter] started\n", "utf8");
    const service = new ProjectFilePreviewService({ requireProject: async () => project } as never);

    try {
      const preview = await service.read({
        projectId: project.id,
        relativePath: ".gameaistudio/logs/project.log"
      });

      expect(preview.kind).toBe("text");
      expect(preview.content).toContain("[cli-adapter]");
      expect(preview.mimeType).toContain("text/plain");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("strips UTF-8 BOM from text previews", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-file-preview-"));
    const project = createProject(dir);
    await mkdir(project.rootPath, { recursive: true });
    await writeFile(path.join(project.rootPath, "GAMEAISTUDIO.md"), "\uFEFF# Demo\n", "utf8");
    const service = new ProjectFilePreviewService({ requireProject: async () => project } as never);

    try {
      const preview = await service.read({
        projectId: project.id,
        relativePath: "GAMEAISTUDIO.md"
      });

      expect(preview.kind).toBe("text");
      expect(preview.content).toBe("# Demo\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns image files as data urls", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-file-preview-"));
    const project = createProject(dir);
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(path.join(dir, "assets", "icon.png"), Buffer.from("iVBORw==", "base64"));
    const service = new ProjectFilePreviewService({ requireProject: async () => project } as never);

    try {
      const preview = await service.read({
        projectId: project.id,
        relativePath: "assets/icon.png"
      });

      expect(preview.kind).toBe("image");
      expect(preview.dataUrl).toBe("data:image/png;base64,iVBORw==");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns audio files as data urls", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-file-preview-"));
    const project = createProject(dir);
    await mkdir(path.join(dir, "assets", "audio"), { recursive: true });
    await writeFile(path.join(dir, "assets", "audio", "bgm.mp3"), Buffer.from("SUQzBA==", "base64"));
    const service = new ProjectFilePreviewService({ requireProject: async () => project } as never);

    try {
      const preview = await service.read({
        projectId: project.id,
        relativePath: "assets/audio/bgm.mp3"
      });

      expect(preview.kind).toBe("audio");
      expect(preview.dataUrl).toBe("data:audio/mpeg;base64,SUQzBA==");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects paths outside the project root", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-file-preview-"));
    const project = createProject(dir);
    const service = new ProjectFilePreviewService({ requireProject: async () => project } as never);

    try {
      await expect(
        service.read({
          projectId: project.id,
          relativePath: "../outside.txt"
        })
      ).rejects.toThrow("不在当前项目目录");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
