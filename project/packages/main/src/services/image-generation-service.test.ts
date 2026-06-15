import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioProject } from "@gameaistudio/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetLibraryService } from "./asset-library-service";
import { ImageGenerationService } from "./image-generation-service";
import { MediaSettingsService } from "./media-settings-service";
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

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("ImageGenerationService", () => {
  let dataRoot: string;
  let projectRoot: string;
  let settings: MediaSettingsService;
  let projectService: ProjectService;
  let assetLibrary: AssetLibraryService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-media-data-"));
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-media-project-"));
    settings = new MediaSettingsService(dataRoot);
    const project = fakeProject(projectRoot);
    projectService = { requireProject: async () => project } as unknown as ProjectService;
    assetLibrary = new AssetLibraryService(projectService);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function addProvider(name: string, protocol: "openai-images-v1" | "gemini-image-v1", apiKey?: string) {
    const result = await settings.saveProvider({
      name,
      protocol,
      baseUrl: `https://${name}.example.com/v1`,
      enabled: true,
      apiKey
    });
    return result.providers.find((provider) => provider.name === name)!;
  }

  describe("testProvider", () => {
    it("reports no-key before making any request", async () => {
      const provider = await addProvider("keyless", "openai-images-v1");
      const fetchImpl = vi.fn();
      const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
      const result = await service.testProvider(provider.id);
      expect(result).toMatchObject({ ok: false, status: "no-key" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("probes the models endpoint and reports success", async () => {
      const provider = await addProvider("openai", "openai-images-v1", "sk-1");
      const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
      const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
      const result = await service.testProvider(provider.id);
      expect(result).toMatchObject({ ok: true, status: "ok", httpStatus: 200 });
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://openai.example.com/v1/models");
      expect(init.method).toBe("GET");
    });

    it("classifies a 401 as an auth problem", async () => {
      const provider = await addProvider("openai", "openai-images-v1", "bad");
      const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
      const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
      const result = await service.testProvider(provider.id);
      expect(result).toMatchObject({ ok: false, status: "auth", httpStatus: 401 });
    });

    it("classifies a thrown connection error as a network problem", async () => {
      const provider = await addProvider("openai", "openai-images-v1", "k");
      const fetchImpl = vi.fn(async () => {
        throw new Error("fetch failed");
      });
      const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
      const result = await service.testProvider(provider.id);
      expect(result).toMatchObject({ ok: false, status: "network" });
    });
  });

  it("returns a config hint when no image model exists", async () => {
    const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: vi.fn() });
    const result = await service.generateImage({ projectId: "project_1", prompt: "a cat", purpose: "character" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("服务设置");
  });

  it("generates via the first binding and saves assets into the project", async () => {
    const provider = await addProvider("openai", "openai-images-v1", "sk-1");
    await settings.saveModel({
      id: "gpt-image-2",
      kind: "image",
      displayName: "GPT Image 2",
      order: 0,
      enabled: true,
      bindings: [{ providerId: provider.id, upstreamModelId: "gpt-image-1", order: 1, enabled: true }]
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] })
    );
    const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await service.generateImage({
      projectId: "project_1",
      prompt: "a cat knight",
      purpose: "character",
      style: "pixel art",
      count: 1
    });

    expect(result.ok).toBe(true);
    expect(result.assets).toHaveLength(1);
    expect(result.attempts).toEqual([
      expect.objectContaining({ ok: true, providerName: "openai", upstreamModelId: "gpt-image-1" })
    ]);

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://openai.example.com/v1/images/generations");
    const body = JSON.parse(String(requestInit.body)) as { prompt: string };
    expect(body.prompt).toContain("a cat knight");
    expect(body.prompt).toContain("pixel art");
    expect(body.prompt).toContain("character sprite");

    const written = await readFile(path.join(projectRoot, result.assets[0]!.projectRelativePath));
    expect(written.toString()).toBe("image-bytes");
  });

  it("falls back to the next binding when the first upstream fails", async () => {
    const primary = await addProvider("primary", "openai-images-v1", "k1");
    const backup = await addProvider("backup", "gemini-image-v1", "k2");
    await settings.saveModel({
      id: "nano-banana",
      kind: "image",
      displayName: "Nano Banana",
      order: 0,
      enabled: true,
      bindings: [
        { providerId: primary.id, upstreamModelId: "boom", order: 1, enabled: true },
        { providerId: backup.id, upstreamModelId: "mgg-5", order: 2, enabled: true }
      ]
    });

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("primary")) {
        return jsonResponse(500, { error: { message: "upstream exploded" } });
      }
      return jsonResponse(200, {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("g").toString("base64") } }] } }]
      });
    });
    const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await service.generateImage({ projectId: "project_1", prompt: "a forest", purpose: "background" });

    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ ok: false, providerName: "primary" });
    expect(result.attempts[0]?.error).toContain("upstream exploded");
    expect(result.attempts[1]).toMatchObject({ ok: true, providerName: "backup" });
    expect(result.assets[0]?.providerName).toBe("backup");
  });

  it("regenerates an asset in place — same path & slot, new bytes", async () => {
    const provider = await addProvider("openai", "openai-images-v1", "sk-1");
    await settings.saveModel({
      id: "gpt-image-2",
      kind: "image",
      displayName: "GPT Image 2",
      order: 0,
      enabled: true,
      bindings: [{ providerId: provider.id, upstreamModelId: "gpt-image-1", order: 1, enabled: true }]
    });
    let call = 0;
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: [{ b64_json: Buffer.from(`bytes-${call++}`).toString("base64") }] })
    );
    const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const first = await service.generateImage({ projectId: "project_1", prompt: "a cat", purpose: "character", count: 1 });
    expect(first.ok).toBe(true);
    const original = first.assets[0]!;
    await assetLibrary.setSlot({ projectId: "project_1", assetId: original.id, slot: "player.main" });
    const originalBytes = await readFile(path.join(projectRoot, original.projectRelativePath));

    const regen = await service.regenerateImage({ projectId: "project_1", assetId: original.id });
    expect(regen.ok).toBe(true);
    const updated = regen.assets[0]!;
    // Same id, same path, slot preserved.
    expect(updated.id).toBe(original.id);
    expect(updated.projectRelativePath).toBe(original.projectRelativePath);
    expect(updated.slot).toBe("player.main");
    // New bytes written to the same file.
    const newBytes = await readFile(path.join(projectRoot, updated.projectRelativePath));
    expect(newBytes.equals(originalBytes)).toBe(false);
    // Library still has exactly one asset (replaced, not appended).
    expect((await assetLibrary.listAssets("project_1")).assets).toHaveLength(1);
  });

  it("rejects an oversized image download advertised by content-length", async () => {
    const provider = await addProvider("openai", "openai-images-v1", "sk-1");
    await settings.saveModel({
      id: "gpt-image-2",
      kind: "image",
      displayName: "GPT Image 2",
      order: 0,
      enabled: true,
      bindings: [{ providerId: provider.id, upstreamModelId: "gpt-image-1", order: 1, enabled: true }]
    });

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/images/generations")) {
        return jsonResponse(200, { data: [{ url: "https://cdn.example.com/huge.png" }] });
      }
      return new Response("x", { status: 200, headers: { "content-length": String(99 * 1024 * 1024) } });
    });
    const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await service.generateImage({ projectId: "project_1", prompt: "a cat", purpose: "character" });

    expect(result.ok).toBe(false);
    expect(result.attempts[0]?.error).toContain("过大");
  });

  it("skips providers without a key and reports failure when everything fails", async () => {
    const keyless = await addProvider("keyless", "openai-images-v1");
    await settings.saveModel({
      id: "m",
      kind: "image",
      displayName: "M",
      order: 0,
      enabled: true,
      bindings: [{ providerId: keyless.id, upstreamModelId: "x", order: 1, enabled: true }]
    });

    const fetchImpl = vi.fn();
    const service = new ImageGenerationService(settings, projectService, assetLibrary, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await service.generateImage({ projectId: "project_1", prompt: "y", purpose: "other" });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.attempts[0]?.error).toContain("API Key");
    expect(result.error).toContain("失败");
  });
});
