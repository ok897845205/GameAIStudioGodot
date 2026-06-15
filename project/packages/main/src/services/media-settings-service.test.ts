import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaSettingsService } from "./media-settings-service";

describe("MediaSettingsService", () => {
  let dir: string;
  let service: MediaSettingsService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-media-"));
    service = new MediaSettingsService(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("seeds built-in providers/models on first load and stores keys encrypted at rest", async () => {
    const seeded = new MediaSettingsService(dir, { seedBuiltins: true });
    const settings = await seeded.getSettings();
    // Built-in image providers + models present.
    expect(settings.providers.map((provider) => provider.name)).toContain("OpenRouter");
    expect(settings.models.map((model) => model.id)).toContain("nano-banana");
    // In-memory keys are usable (decrypted).
    const provider = await seeded.getProviderWithSecret(settings.providers.find((p) => p.name === "OpenRouter")!.id);
    expect(provider?.apiKey?.startsWith("sk-or-")).toBe(true);
    // On disk the key is ciphertext, not plaintext.
    const raw = await readFile(path.join(dir, "media-generation.json"), "utf8");
    expect(raw).toContain("enc:v1:");
    expect(raw).not.toContain("sk-or-v1-");
  });

  it("does not seed built-ins when the option is off (tests / clean slate)", async () => {
    const settings = await service.getSettings();
    expect(settings.providers).toHaveLength(0);
    expect(settings.models).toHaveLength(0);
  });

  it("encrypts a user-saved key at rest and decrypts it back in memory", async () => {
    const created = (await service.saveProvider({
      name: "P",
      protocol: "openai-images-v1",
      baseUrl: "https://example.com/v1",
      enabled: true,
      apiKey: "sk-plain-123"
    })).providers[0]!;
    const raw = await readFile(path.join(dir, "media-generation.json"), "utf8");
    expect(raw).not.toContain("sk-plain-123");
    expect(raw).toContain("enc:v1:");
    const reloaded = new MediaSettingsService(dir);
    expect((await reloaded.getProviderWithSecret(created.id))?.apiKey).toBe("sk-plain-123");
  });

  it("masks API keys in renderer-facing settings but keeps them internally", async () => {
    const settings = await service.saveProvider({
      name: "OpenAI",
      protocol: "openai-images-v1",
      baseUrl: "https://api.openai.com/v1/",
      enabled: true,
      apiKey: "sk-secret"
    });

    const provider = settings.providers[0]!;
    expect(provider.hasApiKey).toBe(true);
    expect(provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(JSON.stringify(settings)).not.toContain("sk-secret");

    const secret = await service.getProviderWithSecret(provider.id);
    expect(secret?.apiKey).toBe("sk-secret");
  });

  it("keeps the stored key when apiKey is omitted and clears it on empty string", async () => {
    const created = (await service.saveProvider({
      name: "P",
      protocol: "gemini-image-v1",
      baseUrl: "https://example.com/v1",
      enabled: true,
      apiKey: "key-1"
    })).providers[0]!;

    await service.saveProvider({
      id: created.id,
      name: "P renamed",
      protocol: "gemini-image-v1",
      baseUrl: "https://example.com/v1",
      enabled: false
    });
    expect((await service.getProviderWithSecret(created.id))?.apiKey).toBe("key-1");

    const cleared = await service.saveProvider({
      id: created.id,
      name: "P renamed",
      protocol: "gemini-image-v1",
      baseUrl: "https://example.com/v1",
      enabled: false,
      apiKey: ""
    });
    expect(cleared.providers[0]?.hasApiKey).toBe(false);
  });

  it("persists across instances and sorts models/bindings by order", async () => {
    const provider = (await service.saveProvider({
      name: "P",
      protocol: "openai-images-v1",
      baseUrl: "https://example.com/v1",
      enabled: true,
      apiKey: "k"
    })).providers[0]!;

    await service.saveModel({
      id: "nano-banana",
      kind: "image",
      displayName: "Nano Banana",
      order: 1,
      enabled: true,
      bindings: [
        { providerId: provider.id, upstreamModelId: "second", order: 2, enabled: true },
        { providerId: provider.id, upstreamModelId: "first", order: 1, enabled: true }
      ]
    });

    const reloaded = new MediaSettingsService(dir);
    const settings = await reloaded.getSettings();
    expect(settings.models[0]?.bindings.map((binding) => binding.upstreamModelId)).toEqual(["first", "second"]);
  });

  it("rejects bindings that point at unknown providers", async () => {
    await expect(
      service.saveModel({
        id: "m",
        kind: "image",
        displayName: "M",
        order: 0,
        enabled: true,
        bindings: [{ providerId: "ghost", upstreamModelId: "x", order: 1, enabled: true }]
      })
    ).rejects.toThrow(/不存在的服务商/);
  });

  it("removes bindings referencing a deleted provider", async () => {
    const provider = (await service.saveProvider({
      name: "P",
      protocol: "openai-images-v1",
      baseUrl: "https://example.com/v1",
      enabled: true
    })).providers[0]!;
    await service.saveModel({
      id: "m",
      kind: "image",
      displayName: "M",
      order: 0,
      enabled: true,
      bindings: [{ providerId: provider.id, upstreamModelId: "x", order: 1, enabled: true }]
    });

    const settings = await service.deleteProvider(provider.id);
    expect(settings.providers).toHaveLength(0);
    expect(settings.models[0]?.bindings).toHaveLength(0);
  });
});
