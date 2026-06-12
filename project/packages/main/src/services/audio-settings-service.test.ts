import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioSettingsService } from "./audio-settings-service";

describe("AudioSettingsService", () => {
  let dir: string;
  let service: AudioSettingsService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-audio-"));
    service = new AudioSettingsService(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const aceInput = {
    name: "ACE Music",
    protocol: "ace-music-v1" as const,
    baseUrl: "https://api.acemusic.ai/v1/",
    modelId: "acemusic/acestep-v1.5-turbo",
    outputFormat: "mp3",
    order: 0,
    enabled: true
  };

  it("masks the API key and normalizes the base URL", async () => {
    const settings = await service.saveProvider({ ...aceInput, apiKey: "secret-key" });
    const provider = settings.providers[0]!;
    expect(provider.hasApiKey).toBe(true);
    expect(provider.baseUrl).toBe("https://api.acemusic.ai/v1");
    expect(JSON.stringify(settings)).not.toContain("secret-key");
    expect((await service.getProviderWithSecret(provider.id))?.apiKey).toBe("secret-key");
  });

  it("keeps the key when omitted and clears on empty string", async () => {
    const created = (await service.saveProvider({ ...aceInput, apiKey: "k1" })).providers[0]!;
    await service.saveProvider({ ...aceInput, id: created.id, enabled: false });
    expect((await service.getProviderWithSecret(created.id))?.apiKey).toBe("k1");
    const cleared = await service.saveProvider({ ...aceInput, id: created.id, apiKey: "" });
    expect(cleared.providers[0]?.hasApiKey).toBe(false);
  });

  it("requires a model id", async () => {
    await expect(service.saveProvider({ ...aceInput, modelId: "  " })).rejects.toThrow(/模型 ID/);
  });

  it("persists the auto-generate switch across instances", async () => {
    await service.saveProvider({ ...aceInput, apiKey: "k" });
    await service.setAutoGenerate(true);
    const reloaded = new AudioSettingsService(dir);
    const settings = await reloaded.getSettings();
    expect(settings.autoGenerateInWorkflow).toBe(true);
    expect(settings.providers).toHaveLength(1);
    expect(await reloaded.isAutoGenerateEnabled()).toBe(true);
  });

  it("lists only enabled providers in order", async () => {
    await service.saveProvider({ ...aceInput, name: "B", order: 2, apiKey: "k" });
    await service.saveProvider({ ...aceInput, name: "A", order: 1, apiKey: "k" });
    await service.saveProvider({ ...aceInput, name: "Off", order: 0, enabled: false, apiKey: "k" });
    const enabled = await service.listEnabledProviders();
    expect(enabled.map((provider) => provider.name)).toEqual(["A", "B"]);
  });
});
