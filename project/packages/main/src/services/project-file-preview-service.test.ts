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
