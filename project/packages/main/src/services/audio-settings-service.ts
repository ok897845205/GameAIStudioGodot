import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AUDIO_PROTOCOL_IDS,
  type AudioGenerationSettings,
  type AudioProviderConfig,
  type AudioProviderView,
  type SaveAudioProviderInput
} from "@gameaistudio/shared";
import { getAppLogger } from "./logger";

const SETTINGS_FILE = "audio-generation.json";

interface StoredAudioSettings {
  providers: AudioProviderConfig[];
  autoGenerateInWorkflow: boolean;
}

function cleanBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`API 基址必须是 http/https 地址：${value}`);
  }
  return trimmed;
}

function toView(provider: AudioProviderConfig): AudioProviderView {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    modelId: provider.modelId,
    outputFormat: provider.outputFormat,
    order: provider.order,
    enabled: provider.enabled,
    hasApiKey: Boolean(provider.apiKey)
  };
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order - right.order);
}

/**
 * User-configured audio providers (ACE Music etc.) and the workflow
 * auto-generate switch. Mirrors {@link MediaSettingsService} for images:
 * persisted as one JSON file in the data root; API keys stay in the main
 * process and never reach the renderer (only `hasApiKey`).
 */
export class AudioSettingsService {
  private settings: StoredAudioSettings = { providers: [], autoGenerateInWorkflow: false };
  private loaded = false;

  constructor(private readonly dataRoot: string) {}

  private get settingsPath(): string {
    return path.join(this.dataRoot, SETTINGS_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredAudioSettings>;
      this.settings = {
        providers: Array.isArray(parsed.providers)
          ? parsed.providers.filter((provider) => AUDIO_PROTOCOL_IDS.includes(provider.protocol))
          : [],
        autoGenerateInWorkflow: parsed.autoGenerateInWorkflow === true
      };
    } catch {
      this.settings = { providers: [], autoGenerateInWorkflow: false };
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private async persist(): Promise<void> {
    await mkdir(this.dataRoot, { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf8");
  }

  async getSettings(): Promise<AudioGenerationSettings> {
    await this.ensureLoaded();
    return {
      providers: sortByOrder(this.settings.providers).map(toView),
      autoGenerateInWorkflow: this.settings.autoGenerateInWorkflow
    };
  }

  /** Full provider config incl. API key — main-process use only. */
  async getProviderWithSecret(providerId: string): Promise<AudioProviderConfig | undefined> {
    await this.ensureLoaded();
    return this.settings.providers.find((provider) => provider.id === providerId);
  }

  /** Enabled providers in call order — generation tries them in turn. */
  async listEnabledProviders(): Promise<AudioProviderConfig[]> {
    await this.ensureLoaded();
    return sortByOrder(this.settings.providers.filter((provider) => provider.enabled));
  }

  async isAutoGenerateEnabled(): Promise<boolean> {
    await this.ensureLoaded();
    return this.settings.autoGenerateInWorkflow;
  }

  async saveProvider(input: SaveAudioProviderInput): Promise<AudioGenerationSettings> {
    await this.ensureLoaded();
    const name = input.name.trim();
    if (!name) throw new Error("服务商名称不能为空。");
    if (!AUDIO_PROTOCOL_IDS.includes(input.protocol)) throw new Error(`未知音频协议：${input.protocol}`);
    const modelId = input.modelId.trim();
    if (!modelId) throw new Error("上游模型 ID 不能为空。");
    const baseUrl = cleanBaseUrl(input.baseUrl);
    const outputFormat = (input.outputFormat || "mp3").trim().toLowerCase();

    const existing = input.id ? this.settings.providers.find((provider) => provider.id === input.id) : undefined;
    if (input.id && !existing) throw new Error(`服务商不存在：${input.id}`);
    if (existing) {
      existing.name = name;
      existing.protocol = input.protocol;
      existing.baseUrl = baseUrl;
      existing.modelId = modelId;
      existing.outputFormat = outputFormat;
      existing.order = input.order;
      existing.enabled = input.enabled;
      if (input.apiKey !== undefined) existing.apiKey = input.apiKey.trim() || undefined;
    } else {
      this.settings.providers.push({
        id: randomUUID(),
        name,
        protocol: input.protocol,
        baseUrl,
        modelId,
        outputFormat,
        order: input.order,
        enabled: input.enabled,
        apiKey: input.apiKey?.trim() || undefined
      });
    }
    await this.persist();
    getAppLogger().info("audio", existing ? "更新音频服务商" : "新增音频服务商", { name, protocol: input.protocol, baseUrl, modelId });
    return this.getSettings();
  }

  async deleteProvider(providerId: string): Promise<AudioGenerationSettings> {
    await this.ensureLoaded();
    this.settings.providers = this.settings.providers.filter((provider) => provider.id !== providerId);
    await this.persist();
    getAppLogger().info("audio", "删除音频服务商", { providerId });
    return this.getSettings();
  }

  async setAutoGenerate(enabled: boolean): Promise<AudioGenerationSettings> {
    await this.ensureLoaded();
    this.settings.autoGenerateInWorkflow = enabled;
    await this.persist();
    getAppLogger().info("audio", "切换工作流自动生成音频", { enabled });
    return this.getSettings();
  }
}
