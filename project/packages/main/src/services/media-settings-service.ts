import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MediaGenerationSettings,
  MediaModelConfig,
  MediaProtocolId,
  MediaProviderConfig,
  MediaProviderView,
  SaveMediaModelInput,
  SaveMediaProviderInput
} from "@gameaistudio/shared";
import { getAppLogger } from "./logger";
import { BUILTIN_MEDIA_VERSION, builtinMediaDefaults } from "./builtin-media-defaults";
import { decryptSecret, encryptSecret } from "./secret-box";

const SETTINGS_FILE = "media-generation.json";
const PROTOCOL_IDS: MediaProtocolId[] = ["openai-images-v1", "openai-chat-image-v1", "gemini-image-v1"];

interface StoredMediaSettings {
  providers: MediaProviderConfig[];
  models: MediaModelConfig[];
  /** Built-in seed version that produced these providers (for re-seeding). */
  builtinVersion?: number;
}

export interface MediaSettingsServiceOptions {
  /** Seed built-in providers/models on first load (production); off for tests. */
  seedBuiltins?: boolean;
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order - right.order);
}

/** Decrypt a stored key into the in-memory plaintext used by generation. */
function decryptKey(value: string | undefined): string | undefined {
  return value ? decryptSecret(value) : undefined;
}

/** Encrypt an in-memory plaintext key for writing to disk. */
function encryptKey(value: string | undefined): string | undefined {
  return value ? encryptSecret(value) : undefined;
}

function cleanBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`API 基址必须是 http/https 地址：${value}`);
  }
  return trimmed;
}

function cleanHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toProviderView(provider: MediaProviderConfig): MediaProviderView {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    extraHeaders: provider.extraHeaders,
    enabled: provider.enabled,
    hasApiKey: Boolean(provider.apiKey)
  };
}

/**
 * User-configured image/video providers and model routing.
 *
 * Persisted as one JSON file in the data root. API keys are stored locally in
 * that file and never returned to the renderer (`MediaProviderView.hasApiKey`
 * only); resolved provider configs with keys stay inside the main process.
 */
export class MediaSettingsService {
  private settings: StoredMediaSettings = { providers: [], models: [] };
  private loaded = false;

  constructor(private readonly dataRoot: string, private readonly options: MediaSettingsServiceOptions = {}) {}

  private get settingsPath(): string {
    return path.join(this.dataRoot, SETTINGS_FILE);
  }

  async load(): Promise<void> {
    let parsed: Partial<StoredMediaSettings> = {};
    try {
      parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<StoredMediaSettings>;
    } catch {
      parsed = {};
    }

    // Seed (or re-seed) built-in providers when enabled and the stored seed
    // version is behind — lets key rotation / routing changes reach installs.
    const needsSeed = this.options.seedBuiltins === true && parsed.builtinVersion !== BUILTIN_MEDIA_VERSION;
    if (needsSeed) {
      const defaults = builtinMediaDefaults();
      this.settings = {
        providers: defaults.providers.map((provider) => ({ ...provider, apiKey: decryptKey(provider.apiKey) })),
        models: defaults.models,
        builtinVersion: BUILTIN_MEDIA_VERSION
      };
      this.loaded = true;
      await this.persist();
      getAppLogger().info("media", "已写入内置图片服务商", { version: BUILTIN_MEDIA_VERSION, providers: defaults.providers.length });
      return;
    }

    this.settings = {
      providers: Array.isArray(parsed.providers)
        ? parsed.providers
            .filter((provider) => PROTOCOL_IDS.includes(provider.protocol))
            .map((provider) => ({ ...provider, apiKey: decryptKey(provider.apiKey) }))
        : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      builtinVersion: parsed.builtinVersion
    };
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.dataRoot, { recursive: true });
    // Encrypt API keys at rest — never write plaintext keys to disk.
    const toStore: StoredMediaSettings = {
      builtinVersion: this.settings.builtinVersion,
      providers: this.settings.providers.map((provider) => ({ ...provider, apiKey: encryptKey(provider.apiKey) })),
      models: this.settings.models
    };
    await writeFile(this.settingsPath, JSON.stringify(toStore, null, 2), "utf8");
  }

  async getSettings(): Promise<MediaGenerationSettings> {
    await this.ensureLoaded();
    return {
      providers: this.settings.providers.map(toProviderView),
      models: sortByOrder(this.settings.models).map((model) => ({
        ...model,
        bindings: sortByOrder(model.bindings)
      }))
    };
  }

  /** Full provider config including the API key — main-process use only. */
  async getProviderWithSecret(providerId: string): Promise<MediaProviderConfig | undefined> {
    await this.ensureLoaded();
    return this.settings.providers.find((provider) => provider.id === providerId);
  }

  async getModel(modelId: string): Promise<MediaModelConfig | undefined> {
    await this.ensureLoaded();
    const model = this.settings.models.find((entry) => entry.id === modelId);
    return model ? { ...model, bindings: sortByOrder(model.bindings) } : undefined;
  }

  /** Enabled image/video models in display order. */
  async listEnabledModels(): Promise<MediaModelConfig[]> {
    await this.ensureLoaded();
    return sortByOrder(this.settings.models.filter((model) => model.enabled)).map((model) => ({
      ...model,
      bindings: sortByOrder(model.bindings)
    }));
  }

  async saveProvider(input: SaveMediaProviderInput): Promise<MediaGenerationSettings> {
    await this.ensureLoaded();
    const name = input.name.trim();
    if (!name) {
      throw new Error("服务商名称不能为空。");
    }
    if (!PROTOCOL_IDS.includes(input.protocol)) {
      throw new Error(`未知协议：${input.protocol}`);
    }
    const baseUrl = cleanBaseUrl(input.baseUrl);
    const extraHeaders = cleanHeaders(input.extraHeaders);

    const existing = input.id ? this.settings.providers.find((provider) => provider.id === input.id) : undefined;
    if (input.id && !existing) {
      throw new Error(`服务商不存在：${input.id}`);
    }
    if (existing) {
      existing.name = name;
      existing.protocol = input.protocol;
      existing.baseUrl = baseUrl;
      existing.extraHeaders = extraHeaders;
      existing.enabled = input.enabled;
      if (input.apiKey !== undefined) {
        existing.apiKey = input.apiKey.trim() || undefined;
      }
    } else {
      this.settings.providers.push({
        id: randomUUID(),
        name,
        protocol: input.protocol,
        baseUrl,
        extraHeaders,
        enabled: input.enabled,
        apiKey: input.apiKey?.trim() || undefined
      });
    }
    await this.persist();
    getAppLogger().info("media", existing ? "更新生成服务商" : "新增生成服务商", { name, protocol: input.protocol, baseUrl });
    return this.getSettings();
  }

  async deleteProvider(providerId: string): Promise<MediaGenerationSettings> {
    await this.ensureLoaded();
    this.settings.providers = this.settings.providers.filter((provider) => provider.id !== providerId);
    // Bindings pointing at the removed provider would silently dead-end the
    // routing chain — drop them with it.
    for (const model of this.settings.models) {
      model.bindings = model.bindings.filter((binding) => binding.providerId !== providerId);
    }
    await this.persist();
    getAppLogger().info("media", "删除生成服务商", { providerId });
    return this.getSettings();
  }

  async saveModel(input: SaveMediaModelInput): Promise<MediaGenerationSettings> {
    await this.ensureLoaded();
    const id = input.id.trim();
    if (!id) {
      throw new Error("模型 ID 不能为空。");
    }
    const displayName = input.displayName.trim() || id;
    const knownProviderIds = new Set(this.settings.providers.map((provider) => provider.id));
    const bindings = input.bindings
      .filter((binding) => binding.upstreamModelId.trim().length > 0)
      .map((binding) => {
        if (!knownProviderIds.has(binding.providerId)) {
          throw new Error(`绑定指向不存在的服务商：${binding.providerId}`);
        }
        return {
          id: binding.id ?? randomUUID(),
          providerId: binding.providerId,
          upstreamModelId: binding.upstreamModelId.trim(),
          order: binding.order,
          enabled: binding.enabled
        };
      });

    const existing = this.settings.models.find((model) => model.id === id);
    if (existing) {
      existing.kind = input.kind;
      existing.displayName = displayName;
      existing.order = input.order;
      existing.enabled = input.enabled;
      existing.bindings = bindings;
    } else {
      this.settings.models.push({
        id,
        kind: input.kind,
        displayName,
        order: input.order,
        enabled: input.enabled,
        bindings
      });
    }
    await this.persist();
    getAppLogger().info("media", existing ? "更新生成模型" : "新增生成模型", { modelId: id, bindings: bindings.length });
    return this.getSettings();
  }

  async deleteModel(modelId: string): Promise<MediaGenerationSettings> {
    await this.ensureLoaded();
    this.settings.models = this.settings.models.filter((model) => model.id !== modelId);
    await this.persist();
    getAppLogger().info("media", "删除生成模型", { modelId });
    return this.getSettings();
  }
}
