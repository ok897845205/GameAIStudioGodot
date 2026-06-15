import type { MediaModelConfig, MediaProviderConfig } from "@gameaistudio/shared";

/**
 * Built-in image providers/models shipped with the app so it works out of the
 * box without the user configuring anything. API keys are stored here as
 * secret-box ciphertext (never plaintext in source). Bump BUILTIN_MEDIA_VERSION
 * to re-seed existing installs after rotating a key or changing the routing.
 *
 * SECURITY: see secret-box.ts — embedding keys (even encrypted) is obfuscation,
 * recoverable by anyone with the app. Move to a server-side proxy for real
 * protection.
 */
export const BUILTIN_MEDIA_VERSION = 1;

interface BuiltinMediaDefaults {
  providers: MediaProviderConfig[];
  models: MediaModelConfig[];
}

const KSYUN_BASE = "https://kspmas.ksyun.com/v1";
const KSYUN_HEADERS = { "X-DashScope-Async": "enable" };
// Ciphertext for the embedded keys (decrypted at seed time by secret-box).
const KSYUN_KEY = "enc:v1:Lrz3gPn73S24n3a+lJAQV+QGOGr1u+/axfUufsgpMNZpUucxvKDhOCsiL+/y81b/RYhln51+PvbKMGcPTAxY2Q==";
const OPENROUTER_KEY =
  "enc:v1:HK+uxcSYOzaX1Y3L5uYxuNt7oiPR0ttLdn3E/+juFFezbTwHHAzW8a4Gma758Lh/eEYysvIOwBtMJtrd8QTgLv5aQ05jgX56rxApQX6cnd28WkVB1mOa1kKgSGOucvycimD1SOM=";

const PROVIDER_KSYUN_GEMINI = "builtin-ksyun-gemini";
const PROVIDER_KSYUN_OPENAI = "builtin-ksyun-openai";
const PROVIDER_OPENROUTER = "builtin-openrouter";

export function builtinMediaDefaults(): BuiltinMediaDefaults {
  const providers: MediaProviderConfig[] = [
    {
      id: PROVIDER_KSYUN_GEMINI,
      name: "金山云",
      protocol: "gemini-image-v1",
      baseUrl: KSYUN_BASE,
      extraHeaders: KSYUN_HEADERS,
      enabled: true,
      apiKey: KSYUN_KEY
    },
    {
      id: PROVIDER_KSYUN_OPENAI,
      name: "金山云 (OpenAI)",
      protocol: "openai-images-v1",
      baseUrl: KSYUN_BASE,
      extraHeaders: KSYUN_HEADERS,
      enabled: true,
      apiKey: KSYUN_KEY
    },
    {
      id: PROVIDER_OPENROUTER,
      name: "OpenRouter",
      protocol: "openai-chat-image-v1",
      baseUrl: "https://openrouter.ai/api/v1",
      enabled: true,
      apiKey: OPENROUTER_KEY
    }
  ];

  const models: MediaModelConfig[] = [
    {
      id: "nano-banana",
      kind: "image",
      displayName: "Nano Banana",
      order: 0,
      enabled: true,
      bindings: [
        { id: "b-nb-ksyun", providerId: PROVIDER_KSYUN_GEMINI, upstreamModelId: "mgg-5", order: 1, enabled: true },
        { id: "b-nb-or", providerId: PROVIDER_OPENROUTER, upstreamModelId: "google/gemini-2.5-flash-image", order: 2, enabled: true }
      ]
    },
    {
      id: "nano-banana-2",
      kind: "image",
      displayName: "Nano Banana 2",
      order: 1,
      enabled: true,
      bindings: [
        { id: "b-nb2-ksyun", providerId: PROVIDER_KSYUN_GEMINI, upstreamModelId: "mgg-9", order: 1, enabled: true },
        { id: "b-nb2-or", providerId: PROVIDER_OPENROUTER, upstreamModelId: "google/gemini-3.1-flash-image-preview", order: 2, enabled: true }
      ]
    },
    {
      id: "nano-banana-pro",
      kind: "image",
      displayName: "Nano Banana Pro",
      order: 2,
      enabled: true,
      bindings: [
        { id: "b-nbp-ksyun", providerId: PROVIDER_KSYUN_GEMINI, upstreamModelId: "mgg-6", order: 1, enabled: true },
        { id: "b-nbp-or", providerId: PROVIDER_OPENROUTER, upstreamModelId: "google/gemini-3-pro-image-preview", order: 2, enabled: true }
      ]
    },
    {
      id: "gpt-image-2",
      kind: "image",
      displayName: "GPT Image 2",
      order: 3,
      enabled: true,
      bindings: [{ id: "b-gpt2-ksyun", providerId: PROVIDER_KSYUN_OPENAI, upstreamModelId: "mog-7", order: 1, enabled: true }]
    }
  ];

  return { providers, models };
}
