import { describe, expect, it } from "vitest";
import {
  buildImageRequest,
  buildProbeRequest,
  classifyMediaHttpStatus,
  classifyMediaThrownError,
  parseImageResponse,
  summarizeUpstreamError
} from "./media-protocols";

const openAiProvider = {
  protocol: "openai-images-v1" as const,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  extraHeaders: { "X-Custom": "yes" }
};

describe("buildImageRequest", () => {
  it("builds an openai images/generations request with size and transparency", () => {
    const request = buildImageRequest({
      provider: openAiProvider,
      upstreamModelId: "gpt-image-1",
      prompt: "a cat knight",
      count: 2,
      aspectRatio: "16:9",
      transparentBackground: true
    });

    expect(request.url).toBe("https://api.openai.com/v1/images/generations");
    expect(request.headers.Authorization).toBe("Bearer sk-test");
    expect(request.headers["X-Custom"]).toBe("yes");
    expect(request.body).toMatchObject({
      model: "gpt-image-1",
      prompt: "a cat knight",
      n: 2,
      size: "1536x1024",
      background: "transparent"
    });
    expect(request.body).not.toHaveProperty("response_format");
  });

  it("omits size for unmapped aspect ratios", () => {
    const request = buildImageRequest({
      provider: openAiProvider,
      upstreamModelId: "gpt-image-1",
      prompt: "x",
      count: 1,
      aspectRatio: "4:3"
    });
    expect(request.body).not.toHaveProperty("size");
  });

  it("builds a chat-image request with aspect hint riding in the prompt", () => {
    const request = buildImageRequest({
      provider: { protocol: "openai-chat-image-v1", baseUrl: "https://openrouter.ai/api/v1", apiKey: "or-key" },
      upstreamModelId: "google/gemini-2.5-flash-image",
      prompt: "a coin icon",
      count: 1,
      aspectRatio: "1:1"
    });

    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = request.body as { messages: Array<{ content: string }>; modalities: string[] };
    expect(body.modalities).toContain("image");
    expect(body.messages[0]?.content).toContain("a coin icon");
    expect(body.messages[0]?.content).toContain("Aspect ratio: 1:1");
  });

  it("builds a gemini generateContent request with both auth headers", () => {
    const request = buildImageRequest({
      provider: { protocol: "gemini-image-v1", baseUrl: "https://kspmas.ksyun.com/v1", apiKey: "ks-key" },
      upstreamModelId: "mgg-5",
      prompt: "a forest background",
      count: 1,
      aspectRatio: "9:16"
    });

    expect(request.url).toBe("https://kspmas.ksyun.com/v1/models/mgg-5:generateContent");
    expect(request.headers.Authorization).toBe("Bearer ks-key");
    expect(request.headers["x-goog-api-key"]).toBe("ks-key");
    expect(request.body).toMatchObject({
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } }
    });
  });
});

describe("parseImageResponse", () => {
  it("parses openai b64 and url entries", () => {
    const images = parseImageResponse("openai-images-v1", {
      data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }, { url: "https://cdn/img.png" }]
    });
    expect(images).toHaveLength(2);
    expect(images[0]?.bytes?.toString()).toBe("png-bytes");
    expect(images[1]?.url).toBe("https://cdn/img.png");
  });

  it("parses chat-image data URLs and remote URLs", () => {
    const dataUrl = `data:image/webp;base64,${Buffer.from("webp-bytes").toString("base64")}`;
    const images = parseImageResponse("openai-chat-image-v1", {
      choices: [{ message: { images: [{ image_url: { url: dataUrl } }, { image_url: { url: "https://cdn/x.png" } }] } }]
    });
    expect(images).toHaveLength(2);
    expect(images[0]?.mimeType).toBe("image/webp");
    expect(images[0]?.bytes?.toString()).toBe("webp-bytes");
    expect(images[1]?.url).toBe("https://cdn/x.png");
  });

  it("parses gemini inlineData parts and ignores text parts", () => {
    const images = parseImageResponse("gemini-image-v1", {
      candidates: [
        {
          content: {
            parts: [{ text: "here you go" }, { inlineData: { mimeType: "image/png", data: Buffer.from("g").toString("base64") } }]
          }
        }
      ]
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
  });

  it("returns empty for malformed payloads instead of throwing", () => {
    expect(parseImageResponse("openai-images-v1", {})).toEqual([]);
    expect(parseImageResponse("openai-chat-image-v1", { choices: [{}] })).toEqual([]);
    expect(parseImageResponse("gemini-image-v1", { candidates: [{}] })).toEqual([]);
  });
});

describe("buildProbeRequest", () => {
  it("hits the models listing endpoint with auth but no content-type", () => {
    const probe = buildProbeRequest(openAiProvider);
    expect(probe.url).toBe("https://api.openai.com/v1/models");
    expect(probe.headers.Authorization).toBe("Bearer sk-test");
    expect(probe.headers["Content-Type"]).toBeUndefined();
  });

  it("adds the gemini api-key header for the gemini protocol", () => {
    const probe = buildProbeRequest({ protocol: "gemini-image-v1", baseUrl: "https://x.com/v1", apiKey: "k" });
    expect(probe.url).toBe("https://x.com/v1/models");
    expect(probe.headers["x-goog-api-key"]).toBe("k");
  });
});

describe("classifyMediaHttpStatus", () => {
  it("maps statuses to actionable causes", () => {
    expect(classifyMediaHttpStatus(401).kind).toBe("auth");
    expect(classifyMediaHttpStatus(403).kind).toBe("auth");
    expect(classifyMediaHttpStatus(404).kind).toBe("not-found");
    expect(classifyMediaHttpStatus(429).kind).toBe("rate-limit");
    expect(classifyMediaHttpStatus(400).kind).toBe("protocol");
    expect(classifyMediaHttpStatus(503).kind).toBe("server");
    expect(classifyMediaHttpStatus(418).kind).toBe("unknown");
  });
});

describe("classifyMediaThrownError", () => {
  it("recognizes timeouts and connection failures as network issues", () => {
    expect(classifyMediaThrownError(new Error("The operation was aborted due to timeout")).kind).toBe("network");
    expect(classifyMediaThrownError(new Error("fetch failed")).kind).toBe("network");
    expect(classifyMediaThrownError(new Error("getaddrinfo ENOTFOUND api.x.com")).kind).toBe("network");
    expect(classifyMediaThrownError(new Error("weird")).kind).toBe("unknown");
  });
});

describe("summarizeUpstreamError", () => {
  it("extracts the nested error message from JSON bodies", () => {
    expect(summarizeUpstreamError(401, JSON.stringify({ error: { message: "Invalid API key" } }))).toBe(
      "HTTP 401: Invalid API key"
    );
  });

  it("keeps a truncated raw excerpt for non-JSON bodies", () => {
    const summary = summarizeUpstreamError(502, "x".repeat(500));
    expect(summary.startsWith("HTTP 502: ")).toBe(true);
    expect(summary.length).toBeLessThan(330);
  });
});
