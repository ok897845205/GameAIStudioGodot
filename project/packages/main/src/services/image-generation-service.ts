import type {
  GenerateImageInput,
  GenerateImageResult,
  GeneratedAssetPurpose,
  GenerationAttempt,
  MediaModelConfig,
  MediaProtocolId,
  MediaProviderConfig,
  MediaProviderTestResult,
  RegenerateAssetInput
} from "@gameaistudio/shared";
import { getAppLogger } from "./logger";
import type { AssetLibraryService } from "./asset-library-service";
import { removeSolidBackground } from "./image-background";
import {
  buildImageRequest,
  buildProbeRequest,
  classifyMediaHttpStatus,
  classifyMediaThrownError,
  parseImageResponse,
  summarizeUpstreamError,
  type GeneratedImagePayload
} from "./media-protocols";
import type { MediaSettingsService } from "./media-settings-service";
import type { ProjectService } from "./project-service";

const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 15_000;
const MAX_IMAGES_PER_REQUEST = 4;
/** Defensive cap on a single generated image download (hostile/huge URLs). */
const MAX_IMAGE_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/** English asset framing per purpose — image models follow it more reliably. */
const PURPOSE_PROMPTS: Record<GeneratedAssetPurpose, string> = {
  character: "2D game character sprite, full body, single character, centered",
  enemy: "2D game enemy sprite, full body, single creature, centered",
  prop: "game item prop, single object, centered",
  background: "game background scene art, no characters, full frame",
  "ui-icon": "game UI icon, simple readable silhouette, centered",
  "ui-button": "game UI button graphic, clean shape, centered",
  logo: "game logo title artwork",
  cover: "game cover key art",
  promo: "promotional key art for a game",
  other: "game art asset"
};

export interface ImageGenerationServiceOptions {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

interface ResolvedImage {
  mimeType: string;
  bytes: Buffer;
}

export class ImageGenerationService {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly settingsService: MediaSettingsService,
    private readonly projectService: ProjectService,
    private readonly assetLibrary: AssetLibraryService,
    options: ImageGenerationServiceOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
    const project = await this.projectService.requireProject(input.projectId);
    const prompt = input.prompt.trim();
    if (!prompt) {
      return { ok: false, modelId: input.modelId ?? "", assets: [], attempts: [], error: "请输入素材描述。" };
    }
    const count = Math.min(Math.max(input.count ?? 1, 1), MAX_IMAGES_PER_REQUEST);

    const model = await this.resolveModel(input.modelId);
    if (!model) {
      return {
        ok: false,
        modelId: input.modelId ?? "",
        assets: [],
        attempts: [],
        error: "还没有可用的图片模型。请在「AI 素材工坊 → 服务设置」中添加服务商和模型绑定。"
      };
    }

    const produced = await this.produceImages(model, prompt, input, count);
    if (!produced.ok || !produced.provider) {
      return { ok: false, modelId: model.id, assets: [], attempts: produced.attempts, error: produced.error };
    }
    const assets = await this.assetLibrary.saveGeneratedImages({
      project,
      images: produced.images,
      meta: {
        prompt,
        finalPrompt: this.buildFinalPrompt(prompt, input, produced.provider.protocol),
        purpose: input.purpose,
        style: input.style,
        aspectRatio: input.aspectRatio,
        transparentBackground: input.transparentBackground,
        modelId: model.id,
        providerId: produced.provider.id,
        providerName: produced.provider.name,
        upstreamModelId: produced.upstreamModelId
      }
    });
    return { ok: true, modelId: model.id, assets, attempts: produced.attempts };
  }

  /**
   * Regenerate one library asset IN PLACE: same res:// path, same slot, new
   * image bytes (re-runs the original prompt/model). Keeps any code the
   * programmer Agent already wired to that path valid — the "保持全自动 + 事后
   * 替换" flow: let the pipeline auto-bind, then swap images you don't like.
   */
  async regenerateImage(input: RegenerateAssetInput): Promise<GenerateImageResult> {
    const record = await this.assetLibrary.getAsset(input.projectId, input.assetId);
    if (!record) {
      return { ok: false, modelId: "", assets: [], attempts: [], error: "素材不存在或已删除。" };
    }
    const model = await this.resolveModel(record.modelId);
    if (!model) {
      return { ok: false, modelId: record.modelId, assets: [], attempts: [], error: "该素材使用的图片模型已不可用，请到服务设置检查。" };
    }
    const synthInput: GenerateImageInput = {
      projectId: input.projectId,
      prompt: record.prompt,
      purpose: record.purpose,
      style: record.style,
      aspectRatio: record.aspectRatio,
      transparentBackground: record.transparentBackground,
      modelId: model.id,
      count: 1
    };
    const produced = await this.produceImages(model, record.prompt, synthInput, 1);
    if (!produced.ok || !produced.images[0]) {
      return { ok: false, modelId: model.id, assets: [], attempts: produced.attempts, error: produced.error };
    }
    const updated = await this.assetLibrary.replaceAsset({
      projectId: input.projectId,
      assetId: input.assetId,
      bytes: produced.images[0].bytes
    });
    return { ok: true, modelId: model.id, assets: [updated], attempts: produced.attempts };
  }

  /** Runs the model's bindings in order, returning the first success's images (no save). */
  private async produceImages(
    model: MediaModelConfig,
    prompt: string,
    input: GenerateImageInput,
    count: number
  ): Promise<{
    ok: boolean;
    images: ResolvedImage[];
    attempts: GenerationAttempt[];
    provider?: MediaProviderConfig;
    upstreamModelId?: string;
    error?: string;
  }> {
    const attempts: GenerationAttempt[] = [];
    const bindings = model.bindings.filter((binding) => binding.enabled);
    if (bindings.length === 0) {
      return { ok: false, images: [], attempts, error: `模型 ${model.displayName} 没有启用任何 API 绑定。` };
    }

    for (const binding of bindings) {
      const provider = await this.settingsService.getProviderWithSecret(binding.providerId);
      const started = Date.now();
      if (!provider || !provider.enabled) {
        attempts.push({
          providerId: binding.providerId,
          providerName: provider?.name ?? binding.providerId,
          upstreamModelId: binding.upstreamModelId,
          ok: false,
          durationMs: 0,
          error: provider ? "服务商已禁用" : "服务商不存在"
        });
        continue;
      }
      if (!provider.apiKey) {
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          upstreamModelId: binding.upstreamModelId,
          ok: false,
          durationMs: 0,
          error: "未配置 API Key"
        });
        continue;
      }
      try {
        let images = await this.generateWithProvider(provider, binding.upstreamModelId, prompt, input, count);
        // Most models can't emit real alpha — strip the solid fill ourselves so
        // sprites drop into scenes as cutouts, not opaque squares. Backgrounds
        // (transparentBackground=false) are never touched.
        if (input.transparentBackground) {
          images = images.map((image) =>
            image.mimeType.toLowerCase().includes("png")
              ? { ...image, bytes: removeSolidBackground(image.bytes) }
              : image
          );
        }
        attempts.push({ providerId: provider.id, providerName: provider.name, upstreamModelId: binding.upstreamModelId, ok: true, durationMs: Date.now() - started });
        return { ok: true, images, attempts, provider, upstreamModelId: binding.upstreamModelId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ providerId: provider.id, providerName: provider.name, upstreamModelId: binding.upstreamModelId, ok: false, durationMs: Date.now() - started, error: message });
        getAppLogger().warn("media", "生图绑定失败，尝试下一个", { modelId: model.id, providerName: provider.name, upstreamModelId: binding.upstreamModelId, error: message });
      }
    }

    const failures = attempts.filter((attempt) => !attempt.ok);
    return { ok: false, images: [], attempts, error: `全部 ${failures.length} 个 API 绑定都失败了。最后错误：${failures[failures.length - 1]?.error ?? "未知"}` };
  }

  /**
   * 「测试连接」: a read-only probe of a provider's base URL + API key that does
   * NOT spend image-generation credits. Classifies the outcome into an
   * actionable status (auth / not-found / network / protocol / …) for the UI.
   */
  async testProvider(providerId: string): Promise<MediaProviderTestResult> {
    const started = Date.now();
    const provider = await this.settingsService.getProviderWithSecret(providerId);
    if (!provider) {
      return { providerId, ok: false, status: "unknown", message: "服务商不存在。", durationMs: 0 };
    }
    if (!provider.apiKey) {
      return { providerId, ok: false, status: "no-key", message: "尚未配置 API Key。", durationMs: Date.now() - started };
    }
    const probe = buildProbeRequest(provider);
    try {
      const response = await this.fetchImpl(probe.url, {
        method: "GET",
        headers: probe.headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      });
      if (response.ok) {
        return {
          providerId,
          ok: true,
          status: "ok",
          message: "连接成功：基址可达且鉴权通过。",
          httpStatus: response.status,
          durationMs: Date.now() - started
        };
      }
      const classified = classifyMediaHttpStatus(response.status);
      return {
        providerId,
        ok: false,
        status: classified.kind,
        message: classified.hint,
        httpStatus: response.status,
        durationMs: Date.now() - started
      };
    } catch (error) {
      const classified = classifyMediaThrownError(error);
      getAppLogger().warn("media", "服务商连接测试失败", { providerId, name: provider.name, error: classified.hint });
      return {
        providerId,
        ok: false,
        status: classified.kind,
        message: classified.hint,
        durationMs: Date.now() - started
      };
    }
  }

  private async resolveModel(modelId?: string): Promise<MediaModelConfig | undefined> {
    if (modelId) {
      const model = await this.settingsService.getModel(modelId);
      return model?.enabled && model.kind === "image" ? model : undefined;
    }
    const models = await this.settingsService.listEnabledModels();
    return models.find((model) => model.kind === "image");
  }

  private buildFinalPrompt(prompt: string, input: GenerateImageInput, protocol: MediaProtocolId): string {
    const parts = [`${PURPOSE_PROMPTS[input.purpose]}.`, prompt];
    if (input.style) {
      parts.push(`Art style: ${input.style}.`);
    }
    // Only the openai-images protocol can request a real alpha channel. For the
    // others we ask for a single flat pure-white background with NO shadow and
    // NO gradient, so our post-processing flood-fill can cleanly knock it out.
    if (input.transparentBackground && protocol !== "openai-images-v1") {
      parts.push(
        "The subject must be fully inside the frame, centered, not cropped. Place it on a single flat pure white (#FFFFFF) background. No drop shadow, no ground shadow, no gradient, no scenery, no extra props — only the subject on flat white."
      );
    }
    return parts.join(" ");
  }

  private async generateWithProvider(
    provider: MediaProviderConfig,
    upstreamModelId: string,
    prompt: string,
    input: GenerateImageInput,
    count: number
  ): Promise<ResolvedImage[]> {
    const finalPrompt = this.buildFinalPrompt(prompt, input, provider.protocol);
    const callOnce = async (n: number): Promise<GeneratedImagePayload[]> => {
      const request = buildImageRequest({
        provider,
        upstreamModelId,
        prompt: finalPrompt,
        count: n,
        aspectRatio: input.aspectRatio,
        transparentBackground: input.transparentBackground
      });
      const response = await this.fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
      const text = await response.text();
      if (!response.ok) {
        // Pair the raw upstream excerpt with an actionable hint so users know
        // whether to fix the Key, the base URL, the model id, or just retry.
        const hint = classifyMediaHttpStatus(response.status).hint;
        throw new Error(`${summarizeUpstreamError(response.status, text)}（${hint}）`);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`上游返回了无法解析的响应：${text.slice(0, 200)}`);
      }
      return parseImageResponse(provider.protocol, payload);
    };

    // openai-images batches natively; chat/gemini endpoints return one image
    // per call, so fan out and keep whatever succeeded.
    let payloads: GeneratedImagePayload[];
    if (provider.protocol === "openai-images-v1" || count === 1) {
      payloads = await callOnce(count);
    } else {
      const settled = await Promise.allSettled(Array.from({ length: count }, () => callOnce(1)));
      payloads = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
      if (payloads.length === 0) {
        const firstError = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
        throw firstError ? new Error(String(firstError.reason instanceof Error ? firstError.reason.message : firstError.reason)) : new Error("上游未返回图片。");
      }
    }

    const images: ResolvedImage[] = [];
    for (const payload of payloads) {
      if (payload.bytes) {
        images.push({ mimeType: payload.mimeType, bytes: payload.bytes });
      } else if (payload.url) {
        images.push(await this.downloadImage(payload.url));
      }
    }
    if (images.length === 0) {
      throw new Error("上游未返回图片（可能命中内容安全策略，请调整描述）。");
    }
    return images;
  }

  private async downloadImage(url: string): Promise<ResolvedImage> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
    if (!response.ok) {
      throw new Error(`下载生成图片失败：HTTP ${response.status}`);
    }
    // Reject obviously oversized payloads before buffering them into memory.
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`生成图片过大（${Math.round(declaredLength / 1024 / 1024)}MB），已拒绝下载。`);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`生成图片过大（${Math.round(buffer.byteLength / 1024 / 1024)}MB），已拒绝保存。`);
    }
    return { mimeType, bytes: Buffer.from(buffer) };
  }
}
