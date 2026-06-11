import type { GeneratedAssetAspect, MediaProtocolId, MediaProviderConfig } from "@gameaistudio/shared";

/** A fully prepared upstream HTTP call (auth headers included). */
export interface MediaRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** One image extracted from an upstream response. */
export interface GeneratedImagePayload {
  mimeType: string;
  /** Inline base64 payload, already decoded. */
  bytes?: Buffer;
  /** Remote URL to download when the upstream returned a link instead. */
  url?: string;
}

export interface BuildImageRequestInput {
  provider: Pick<MediaProviderConfig, "protocol" | "baseUrl" | "apiKey" | "extraHeaders">;
  upstreamModelId: string;
  prompt: string;
  /** Only the openai-images protocol supports batching in one request. */
  count: number;
  aspectRatio?: GeneratedAssetAspect;
  transparentBackground?: boolean;
}

/** gpt-image generation sizes; other ratios fall back to the model default. */
const OPENAI_IMAGE_SIZES: Partial<Record<GeneratedAssetAspect, string>> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536"
};

function baseHeaders(provider: BuildImageRequestInput["provider"]): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    ...(provider.extraHeaders ?? {})
  };
}

export function buildImageRequest(input: BuildImageRequestInput): MediaRequestSpec {
  const { provider, upstreamModelId, prompt, count, aspectRatio, transparentBackground } = input;
  switch (provider.protocol) {
    case "openai-images-v1": {
      const size = aspectRatio ? OPENAI_IMAGE_SIZES[aspectRatio] : undefined;
      return {
        url: `${provider.baseUrl}/images/generations`,
        headers: baseHeaders(provider),
        // No `response_format`: gpt-image rejects it and answers b64 by
        // default, while url-answering models are handled at parse time.
        body: {
          model: upstreamModelId,
          prompt,
          n: count,
          ...(size ? { size } : {}),
          ...(transparentBackground ? { background: "transparent" } : {})
        }
      };
    }
    case "openai-chat-image-v1": {
      // Chat-style image models have no structured size/background params —
      // the constraints ride along in the prompt text.
      const hints = [
        ...(aspectRatio ? [`Aspect ratio: ${aspectRatio}.`] : []),
        ...(transparentBackground ? ["Plain solid background suitable for cutout."] : [])
      ];
      return {
        url: `${provider.baseUrl}/chat/completions`,
        headers: baseHeaders(provider),
        body: {
          model: upstreamModelId,
          messages: [{ role: "user", content: [prompt, ...hints].join(" ") }],
          modalities: ["image", "text"]
        }
      };
    }
    case "gemini-image-v1": {
      const headers = baseHeaders(provider);
      // Google's own endpoint authenticates via x-goog-api-key; OpenAI-style
      // gateways fronting Gemini expect the Bearer header. Send both.
      if (provider.apiKey && !headers["x-goog-api-key"]) {
        headers["x-goog-api-key"] = provider.apiKey;
      }
      return {
        url: `${provider.baseUrl}/models/${upstreamModelId}:generateContent`,
        headers,
        body: {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            ...(aspectRatio ? { imageConfig: { aspectRatio } } : {})
          }
        }
      };
    }
    default: {
      const exhaustive: never = provider.protocol;
      throw new Error(`未知协议：${exhaustive as string}`);
    }
  }
}

function decodeDataUrl(value: string): GeneratedImagePayload | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return undefined;
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

function parseOpenAiImages(payload: unknown): GeneratedImagePayload[] {
  const data = (payload as { data?: Array<{ b64_json?: string; url?: string }> }).data;
  if (!Array.isArray(data)) return [];
  const images: GeneratedImagePayload[] = [];
  for (const entry of data) {
    if (entry?.b64_json) {
      images.push({ mimeType: "image/png", bytes: Buffer.from(entry.b64_json, "base64") });
    } else if (entry?.url) {
      images.push({ mimeType: "image/png", url: entry.url });
    }
  }
  return images;
}

function parseChatImages(payload: unknown): GeneratedImagePayload[] {
  const choices = (payload as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } | string }> } }>;
  }).choices;
  if (!Array.isArray(choices)) return [];
  const images: GeneratedImagePayload[] = [];
  for (const choice of choices) {
    for (const image of choice?.message?.images ?? []) {
      const url = typeof image === "string" ? image : typeof image?.image_url === "string" ? image.image_url : image?.image_url?.url;
      if (!url) continue;
      const inline = decodeDataUrl(url);
      images.push(inline ?? { mimeType: "image/png", url });
    }
  }
  return images;
}

function parseGeminiImages(payload: unknown): GeneratedImagePayload[] {
  const candidates = (payload as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  }).candidates;
  if (!Array.isArray(candidates)) return [];
  const images: GeneratedImagePayload[] = [];
  for (const candidate of candidates) {
    for (const part of candidate?.content?.parts ?? []) {
      const inline = part?.inlineData;
      if (inline?.data) {
        images.push({ mimeType: inline.mimeType || "image/png", bytes: Buffer.from(inline.data, "base64") });
      }
    }
  }
  return images;
}

export function parseImageResponse(protocol: MediaProtocolId, payload: unknown): GeneratedImagePayload[] {
  switch (protocol) {
    case "openai-images-v1":
      return parseOpenAiImages(payload);
    case "openai-chat-image-v1":
      return parseChatImages(payload);
    case "gemini-image-v1":
      return parseGeminiImages(payload);
    default: {
      const exhaustive: never = protocol;
      throw new Error(`未知协议：${exhaustive as string}`);
    }
  }
}

/**
 * A cheap read-only probe that validates base URL + API key without spending
 * image-generation credits. Each protocol has a listing endpoint that answers
 * 200 on good auth, 401/403 on a bad key, and 404 on a wrong base URL.
 */
export function buildProbeRequest(provider: BuildImageRequestInput["provider"]): { url: string; headers: Record<string, string> } {
  const headers = baseHeaders(provider);
  delete headers["Content-Type"];
  if (provider.protocol === "gemini-image-v1") {
    if (provider.apiKey && !headers["x-goog-api-key"]) {
      headers["x-goog-api-key"] = provider.apiKey;
    }
  }
  return { url: `${provider.baseUrl}/models`, headers };
}

export type MediaErrorKind = "auth" | "not-found" | "rate-limit" | "network" | "protocol" | "server" | "unknown";

export interface ClassifiedMediaError {
  kind: MediaErrorKind;
  /** Actionable Chinese hint for the settings UI. */
  hint: string;
}

/** Maps an HTTP status to a cause and a fix-it hint shown next to the provider. */
export function classifyMediaHttpStatus(status: number): ClassifiedMediaError {
  if (status === 401 || status === 403) {
    return { kind: "auth", hint: "鉴权失败：API Key 不正确或已失效，请检查 Key。" };
  }
  if (status === 404) {
    return { kind: "not-found", hint: "接口未找到：API 基址或上游模型 ID 可能不对，也可能协议选错了。" };
  }
  if (status === 429) {
    return { kind: "rate-limit", hint: "触发限流或额度用尽：稍后再试，或检查账户余额。" };
  }
  if (status >= 500) {
    return { kind: "server", hint: "上游服务异常（5xx）：通常是对方临时故障，稍后重试。" };
  }
  if (status === 400 || status === 422) {
    return { kind: "protocol", hint: "请求被拒（参数错误）：协议或上游模型 ID 与该服务商不匹配。" };
  }
  return { kind: "unknown", hint: `请求失败（HTTP ${status}）。` };
}

/** Maps a thrown fetch/abort error to a cause and a fix-it hint. */
export function classifyMediaThrownError(error: unknown): ClassifiedMediaError {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout|timed out/i.test(message)) {
    return { kind: "network", hint: "请求超时：网络不可达或上游响应过慢，请检查网络与基址。" };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|network/i.test(message)) {
    return { kind: "network", hint: "无法连接：API 基址无法访问，请检查地址是否正确、网络/内网是否可达。" };
  }
  return { kind: "unknown", hint: message };
}

/** Upstream error bodies vary wildly — surface a short, useful excerpt. */
export function summarizeUpstreamError(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string; message?: string };
    const candidate =
      typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
    if (candidate) detail = candidate;
  } catch {
    // not JSON — keep the raw excerpt
  }
  detail = detail.replace(/\s+/g, " ");
  if (detail.length > 300) detail = `${detail.slice(0, 300)}…`;
  return `HTTP ${status}${detail ? `: ${detail}` : ""}`;
}
