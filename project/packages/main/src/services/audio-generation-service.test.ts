import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioProject } from "@gameaistudio/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetLibraryService, readGeneratedAudioRecords } from "./asset-library-service";
import { AudioGenerationService } from "./audio-generation-service";
import { AudioSettingsService } from "./audio-settings-service";
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

function aceResponse(noteAndBytes = "song"): Response {
  const dataUrl = `data:audio/mpeg;base64,${Buffer.from(noteAndBytes).toString("base64")}`;
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "## Metadata\nCaption: test", audio: [{ audio_url: { url: dataUrl }, type: "audio_url" }] } }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("AudioGenerationService", () => {
  let dataRoot: string;
  let projectRoot: string;
  let settings: AudioSettingsService;
  let projectService: ProjectService;
  let assetLibrary: AssetLibraryService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-audio-data-"));
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-audio-project-"));
    settings = new AudioSettingsService(dataRoot);
    const project = fakeProject(projectRoot);
    projectService = { requireProject: async () => project } as unknown as ProjectService;
    assetLibrary = new AssetLibraryService(projectService);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function addAce(apiKey?: string) {
    const result = await settings.saveProvider({
      name: "ACE Music",
      protocol: "ace-music-v1",
      baseUrl: "https://api.acemusic.ai/v1",
      modelId: "acemusic/acestep-v1.5-turbo",
      outputFormat: "mp3",
      order: 0,
      enabled: true,
      apiKey
    });
    return result.providers[0]!;
  }

  it("hints to configure a provider when none exist", async () => {
    const service = new AudioGenerationService(settings, projectService, assetLibrary, { fetchImpl: vi.fn() as unknown as typeof fetch });
    const result = await service.generateAudio({ projectId: "project_1", kind: "bgm", prompt: "menu theme" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("服务设置");
  });

  it("generates audio and saves it into assets/audio/<kind>", async () => {
    await addAce("k");
    const fetchImpl = vi.fn(async () => aceResponse("bgm-bytes"));
    const service = new AudioGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await service.generateAudio({ projectId: "project_1", kind: "bgm", prompt: "main theme", loopable: true, durationSeconds: 30 });
    expect(result.ok).toBe(true);
    expect(result.audios).toHaveLength(1);
    const record = result.audios[0]!;
    expect(record.projectRelativePath.startsWith("assets/audio/bgm/")).toBe(true);
    expect(record.resPath).toBe(`res://${record.projectRelativePath}`);
    expect(record.format).toBe("mp3");
    expect(record.loopable).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.acemusic.ai/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }>; modalities: string[] };
    expect(body.modalities).toContain("audio");
    expect(body.messages[0]?.content).toContain("main theme");

    const written = await readFile(path.join(projectRoot, record.projectRelativePath));
    expect(written.toString()).toBe("bgm-bytes");

    const persisted = await readGeneratedAudioRecords(projectRoot);
    expect(persisted).toHaveLength(1);
  });

  it("reports failure with an actionable hint when the upstream rejects", async () => {
    await addAce("bad");
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401, headers: { "content-type": "text/plain" } }));
    const service = new AudioGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await service.generateAudio({ projectId: "project_1", kind: "sfx", prompt: "jump" });
    expect(result.ok).toBe(false);
    expect(result.attempts[0]?.error).toContain("API Key");
  });

  it("skips providers without a key", async () => {
    await addAce();
    const fetchImpl = vi.fn();
    const service = new AudioGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await service.generateAudio({ projectId: "project_1", kind: "sfx", prompt: "coin" });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.attempts[0]?.error).toContain("API Key");
  });

  it("probes the models endpoint for testProvider", async () => {
    const provider = await addAce("k");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const service = new AudioGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await service.testProvider(provider.id);
    expect(result).toMatchObject({ ok: true, status: "ok" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.acemusic.ai/v1/models");
    expect(init.method).toBe("GET");
  });
});

describe("AssetLibraryService audio", () => {
  let dir: string;
  let project: StudioProject;
  let service: AssetLibraryService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-audio-lib-"));
    project = fakeProject(dir);
    service = new AssetLibraryService({ requireProject: async () => project } as unknown as ProjectService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves audio, keeps slot uniqueness and deletes file + record", async () => {
    const records = await service.saveGeneratedAudio({
      project,
      audios: [
        { mimeType: "audio/mpeg", bytes: Buffer.from("a"), format: "mp3" },
        { mimeType: "audio/mpeg", bytes: Buffer.from("b"), format: "mp3" }
      ],
      meta: { kind: "sfx", prompt: "jump", modelId: "ace" }
    });
    expect(records).toHaveLength(2);

    await service.setAudioSlot({ projectId: project.id, audioId: records[0]!.id, slot: "sfx.jump" });
    const lib = await service.setAudioSlot({ projectId: project.id, audioId: records[1]!.id, slot: "sfx.jump" });
    expect(lib.audios.filter((audio) => audio.slot === "sfx.jump")).toHaveLength(1);

    const afterDelete = await service.deleteAudio({ projectId: project.id, audioId: records[0]!.id });
    expect(afterDelete.audios.some((audio) => audio.id === records[0]!.id)).toBe(false);
  });

  it("does not lose audio records under concurrent saves", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        service.saveGeneratedAudio({
          project,
          audios: [{ mimeType: "audio/mpeg", bytes: Buffer.from(`s${index}`), format: "mp3" }],
          meta: { kind: "sfx", prompt: `sfx ${index}`, modelId: "ace" }
        })
      )
    );
    const records = await readGeneratedAudioRecords(dir);
    expect(records).toHaveLength(10);
  });

  it("keeps image and audio records independent in the same manifest", async () => {
    await service.saveGeneratedImages({
      project,
      images: [{ mimeType: "image/png", bytes: Buffer.from("img") }],
      meta: { prompt: "hero", purpose: "character", modelId: "m" }
    });
    await service.saveGeneratedAudio({
      project,
      audios: [{ mimeType: "audio/mpeg", bytes: Buffer.from("bgm"), format: "mp3" }],
      meta: { kind: "bgm", prompt: "theme", modelId: "ace" }
    });
    expect((await service.listAssets(project.id)).assets).toHaveLength(1);
    expect((await service.listAudio(project.id)).audios).toHaveLength(1);
  });
});
