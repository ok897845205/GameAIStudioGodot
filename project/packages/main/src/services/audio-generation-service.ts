import type {
  AudioProviderConfig,
  GenerateAudioInput,
  GenerateAudioResult,
  GeneratedAudioRecord,
  GenerationAttempt,
  MediaProviderTestResult
} from "@gameaistudio/shared";
import { getAppLogger } from "./logger";
import type { AssetLibraryService } from "./asset-library-service";
import type { AudioSettingsService } from "./audio-settings-service";
import {
  audioMimeToExtension,
  buildAudioProbeRequest,
  buildAudioPrompt,
  buildAudioRequest,
  parseAudioResponse,
  type GeneratedAudioPayload
} from "./audio-protocols";
import { classifyMediaHttpStatus, classifyMediaThrownError, summarizeUpstreamError } from "./media-protocols";
import type { ProjectService } from "./project-service";

// Music generation is slow; allow a generous ceiling (ACE ~20-40s, but a busy
// queue can run longer).
const DEFAULT_REQUEST_TIMEOUT_MS = 240_000;
const PROBE_TIMEOUT_MS = 15_000;
const MAX_AUDIO_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export interface AudioGenerationServiceOptions {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

interface ResolvedAudio {
  mimeType: string;
  bytes: Buffer;
  format: string;
  note?: string;
}

/**
 * Generates audio (BGM / SFX / ambience) via the configured providers, saves
 * the result into the project's assets/audio library and records traceable
 * metadata. Protocol-agnostic: it speaks to whatever `audio-protocols`
 * supports (ACE Music today; ElevenLabs/Mubert later). Failures fall through
 * to the next enabled provider, mirroring the image generation service.
 */
export class AudioGenerationService {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly settingsService: AudioSettingsService,
    private readonly projectService: ProjectService,
    private readonly assetLibrary: Pick<AssetLibraryService, "saveGeneratedAudio">,
    options: AudioGenerationServiceOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async testProvider(providerId: string): Promise<MediaProviderTestResult> {
    const started = Date.now();
    const provider = await this.settingsService.getProviderWithSecret(providerId);
    if (!provider) {
      return { providerId, ok: false, status: "unknown", message: "服务商不存在。", durationMs: 0 };
    }
    if (!provider.apiKey) {
      return { providerId, ok: false, status: "no-key", message: "尚未配置 API Key。", durationMs: Date.now() - started };
    }
    const probe = buildAudioProbeRequest(provider);
    try {
      const response = await this.fetchImpl(probe.url, { method: "GET", headers: probe.headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (response.ok) {
        return { providerId, ok: true, status: "ok", message: "连接成功：基址可达且鉴权通过。", httpStatus: response.status, durationMs: Date.now() - started };
      }
      const classified = classifyMediaHttpStatus(response.status);
      return { providerId, ok: false, status: classified.kind, message: classified.hint, httpStatus: response.status, durationMs: Date.now() - started };
    } catch (error) {
      const classified = classifyMediaThrownError(error);
      getAppLogger().warn("audio", "音频服务商连接测试失败", { providerId, name: provider.name, error: classified.hint });
      return { providerId, ok: false, status: classified.kind, message: classified.hint, durationMs: Date.now() - started };
    }
  }

  async generateAudio(input: GenerateAudioInput): Promise<GenerateAudioResult> {
    const project = await this.projectService.requireProject(input.projectId);
    const prompt = input.prompt.trim();
    if (!prompt) {
      return { ok: false, audios: [], attempts: [], error: "请输入音频描述。" };
    }

    const providers = input.providerId
      ? [await this.settingsService.getProviderWithSecret(input.providerId)].filter((p): p is AudioProviderConfig => Boolean(p))
      : await this.settingsService.listEnabledProviders();
    if (providers.length === 0) {
      return {
        ok: false,
        audios: [],
        attempts: [],
        error: "还没有可用的音频服务商。请在「音频 → 服务设置」中添加 ACE Music 并填入 API Key。"
      };
    }

    const attempts: GenerationAttempt[] = [];
    for (const provider of providers) {
      const started = Date.now();
      if (!provider.enabled) {
        attempts.push({ providerId: provider.id, providerName: provider.name, upstreamModelId: provider.modelId, ok: false, durationMs: 0, error: "服务商已禁用" });
        continue;
      }
      if (!provider.apiKey) {
        attempts.push({ providerId: provider.id, providerName: provider.name, upstreamModelId: provider.modelId, ok: false, durationMs: 0, error: "未配置 API Key" });
        continue;
      }
      try {
        const audio = await this.generateWithProvider(provider, input);
        attempts.push({ providerId: provider.id, providerName: provider.name, upstreamModelId: provider.modelId, ok: true, durationMs: Date.now() - started });
        const records = await this.assetLibrary.saveGeneratedAudio({
          project,
          audios: [audio],
          meta: {
            kind: input.kind,
            prompt,
            finalPrompt: buildAudioPrompt(input),
            loopable: input.loopable ?? input.seamlessLoop,
            providerId: provider.id,
            providerName: provider.name,
            upstreamModelId: provider.modelId,
            modelId: provider.modelId,
            license: audio.note
          }
        });
        return { ok: true, audios: records, attempts };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ providerId: provider.id, providerName: provider.name, upstreamModelId: provider.modelId, ok: false, durationMs: Date.now() - started, error: message });
        getAppLogger().warn("audio", "音频生成失败，尝试下一个服务商", { providerName: provider.name, error: message });
      }
    }

    const failures = attempts.filter((attempt) => !attempt.ok);
    return {
      ok: false,
      audios: [],
      attempts,
      error: `全部 ${failures.length} 个音频服务商都失败了。最后错误：${failures[failures.length - 1]?.error ?? "未知"}`
    };
  }

  private async generateWithProvider(provider: AudioProviderConfig, input: GenerateAudioInput): Promise<ResolvedAudio> {
    const request = buildAudioRequest(provider, input);
    const response = await this.fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    });
    const text = await response.text();
    if (!response.ok) {
      const hint = classifyMediaHttpStatus(response.status).hint;
      throw new Error(`${summarizeUpstreamError(response.status, text)}（${hint}）`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`上游返回了无法解析的响应：${text.slice(0, 200)}`);
    }
    const payloads = parseAudioResponse(provider.protocol, payload);
    const first = payloads[0];
    if (!first) {
      throw new Error("上游未返回音频（可能命中内容策略或参数不被支持）。");
    }
    return this.resolvePayload(first);
  }

  private async resolvePayload(payload: GeneratedAudioPayload): Promise<ResolvedAudio> {
    if (payload.bytes) {
      return { mimeType: payload.mimeType, bytes: payload.bytes, format: audioMimeToExtension(payload.mimeType), note: payload.note };
    }
    if (payload.url) {
      const response = await this.fetchImpl(payload.url, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
      if (!response.ok) {
        throw new Error(`下载生成音频失败：HTTP ${response.status}`);
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_DOWNLOAD_BYTES) {
        throw new Error(`生成音频过大（${Math.round(declaredLength / 1024 / 1024)}MB），已拒绝下载。`);
      }
      const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || payload.mimeType || "audio/mpeg";
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_AUDIO_DOWNLOAD_BYTES) {
        throw new Error(`生成音频过大（${Math.round(buffer.byteLength / 1024 / 1024)}MB），已拒绝保存。`);
      }
      return { mimeType, bytes: Buffer.from(buffer), format: audioMimeToExtension(mimeType), note: payload.note };
    }
    throw new Error("上游未返回可用音频数据。");
  }
}

export type { GeneratedAudioRecord };
