import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioProject } from "@gameaistudio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AssetLibraryService,
  buildAssetContextLines,
  MAX_ASSET_CONTEXT_LINES,
  purposeDirectory,
  readGeneratedAssetRecords
} from "./asset-library-service";
import type { GeneratedAssetRecord } from "@gameaistudio/shared";
import type { ProjectService } from "./project-service";

function fakeProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "测试项目",
    dimension: "2d",
    prompt: "test",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    activeAgentId: "producer"
  };
}

describe("AssetLibraryService", () => {
  let dir: string;
  let project: StudioProject;
  let service: AssetLibraryService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-assets-"));
    project = fakeProject(dir);
    const projectService = { requireProject: async () => project } as unknown as ProjectService;
    service = new AssetLibraryService(projectService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps purposes onto the standard asset directories", () => {
    expect(purposeDirectory("character")).toBe("assets/characters");
    expect(purposeDirectory("enemy")).toBe("assets/characters");
    expect(purposeDirectory("background")).toBe("assets/backgrounds");
    expect(purposeDirectory("ui-icon")).toBe("assets/ui");
    expect(purposeDirectory("cover")).toBe("assets/images");
  });

  it("saves images into the project, records res:// paths and survives reload", async () => {
    const records = await service.saveGeneratedImages({
      project,
      images: [{ mimeType: "image/png", bytes: Buffer.from("png-1") }],
      meta: { prompt: "A cat knight!", purpose: "character", modelId: "nano-banana" }
    });

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.projectRelativePath.startsWith("assets/characters/")).toBe(true);
    expect(record.resPath).toBe(`res://${record.projectRelativePath}`);
    expect(record.fileName).toMatch(/^a-cat-knight-[0-9a-f]{8}\.png$/);

    const written = await readFile(path.join(dir, record.projectRelativePath));
    expect(written.toString()).toBe("png-1");

    const reloaded = await readGeneratedAssetRecords(dir);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.id).toBe(record.id);
  });

  it("deletes the file together with the manifest record", async () => {
    const [record] = await service.saveGeneratedImages({
      project,
      images: [{ mimeType: "image/png", bytes: Buffer.from("x") }],
      meta: { prompt: "coin", purpose: "prop", modelId: "m" }
    });

    const library = await service.deleteAsset({ projectId: project.id, assetId: record!.id });
    expect(library.assets).toHaveLength(0);
    await expect(access(path.join(dir, record!.projectRelativePath))).rejects.toThrow();
  });

  it("keeps slots unique by clearing the previous holder", async () => {
    const records = await service.saveGeneratedImages({
      project,
      images: [
        { mimeType: "image/png", bytes: Buffer.from("a") },
        { mimeType: "image/png", bytes: Buffer.from("b") }
      ],
      meta: { prompt: "hero", purpose: "character", modelId: "m" }
    });

    await service.setSlot({ projectId: project.id, assetId: records[0]!.id, slot: "player.main" });
    const library = await service.setSlot({ projectId: project.id, assetId: records[1]!.id, slot: "player.main" });

    const holders = library.assets.filter((asset) => asset.slot === "player.main");
    expect(holders).toHaveLength(1);
    expect(holders[0]?.id).toBe(records[1]!.id);
  });

  it("does not lose records when saves run concurrently (manifest race)", async () => {
    // Manual generate (no project lock) racing the workflow path: both
    // read-modify-write the same manifest. The per-project serialization must
    // keep every record.
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        service.saveGeneratedImages({
          project,
          images: [{ mimeType: "image/png", bytes: Buffer.from(`img-${index}`) }],
          meta: { prompt: `asset ${index}`, purpose: "prop", modelId: "m" }
        })
      )
    );
    const records = await readGeneratedAssetRecords(dir);
    expect(records).toHaveLength(12);
    expect(new Set(records.map((record) => record.id)).size).toBe(12);
  });

  it("keeps slot uniqueness under concurrent setSlot calls", async () => {
    const records = await service.saveGeneratedImages({
      project,
      images: Array.from({ length: 5 }, (_, index) => ({ mimeType: "image/png", bytes: Buffer.from(`a${index}`) })),
      meta: { prompt: "hero", purpose: "character", modelId: "m" }
    });
    await Promise.all(records.map((record) => service.setSlot({ projectId: project.id, assetId: record.id, slot: "player.main" })));
    const holders = (await readGeneratedAssetRecords(dir)).filter((record) => record.slot === "player.main");
    expect(holders).toHaveLength(1);
  });

  it("describes assets semantically for the agent context", async () => {
    const records = await service.saveGeneratedImages({
      project,
      images: [{ mimeType: "image/png", bytes: Buffer.from("a") }],
      meta: { prompt: "橘猫骑士", purpose: "character", style: "pixel art", modelId: "m" }
    });
    await service.setSlot({ projectId: project.id, assetId: records[0]!.id, slot: "player.main" });

    const lines = buildAssetContextLines(await readGeneratedAssetRecords(dir));
    expect(lines[0]).toContain("res://assets/characters/");
    expect(lines[0]).toContain("角色");
    expect(lines[0]).toContain("[slot: player.main]");
    expect(lines[0]).toContain("橘猫骑士");
  });

  it("caps the context list, always keeping slotted assets and noting omissions", () => {
    const make = (index: number, slot?: string): GeneratedAssetRecord => ({
      id: `a${index}`,
      projectId: "project_1",
      fileName: `a${index}.png`,
      projectRelativePath: `assets/images/a${index}.png`,
      resPath: `res://assets/images/a${index}.png`,
      prompt: `asset ${index}`,
      purpose: "prop",
      modelId: "m",
      mimeType: "image/png",
      sizeBytes: 1,
      createdAt: "2026-06-11T00:00:00.000Z",
      ...(slot ? { slot } : {})
    });
    // 200 unslotted + 2 slotted (one at the very start, easily past the cap).
    const records = [make(0, "player.main"), ...Array.from({ length: 200 }, (_, i) => make(i + 1)), make(999, "boss.main")];

    const lines = buildAssetContextLines(records);
    expect(lines.length).toBe(MAX_ASSET_CONTEXT_LINES + 1);
    // Both slotted assets survive the cap regardless of position.
    expect(lines.some((line) => line.includes("[slot: player.main]"))).toBe(true);
    expect(lines.some((line) => line.includes("[slot: boss.main]"))).toBe(true);
    // The most recent unslotted asset is kept; the omission note is present.
    expect(lines.some((line) => line.includes("res://assets/images/a200.png"))).toBe(true);
    expect(lines.at(-1)).toContain("未在此列出");
  });
});
