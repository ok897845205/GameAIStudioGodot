import type { AudioProtocolId, GenerateAudioInput } from "@gameaistudio/shared";

/** A fully prepared upstream HTTP call for audio generation. */
export interface AudioRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface AudioProviderLike {
  protocol: AudioProtocolId;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  outputFormat: string;
}

/** Decoded audio extracted from an upstream response. */
export interface GeneratedAudioPayload {
  mimeType: string;
  bytes?: Buffer;
  url?: string;
  /** Free-form metadata/caption the model returned alongside the audio. */
  note?: string;
}

/** Format → MIME, for the upstream `audio.format` hint and our file extension. */
const FORMAT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg"
};

const MIME_EXTENSION: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm"
};

export function audioMimeToExtension(mimeType: string): string {
  return MIME_EXTENSION[mimeType.toLowerCase()] ?? "mp3";
}

function baseHeaders(provider: AudioProviderLike): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
  };
}

/**
 * Builds the natural-language prompt that ACE-Step (a text-to-music model)
 * actually conditions on. The structured BGM/SFX/Ambience knobs are folded
 * into the text since the chat endpoint has no dedicated parameter fields.
 */
export function buildAudioPrompt(input: GenerateAudioInput): string {
  const parts: string[] = [];
  if (input.kind === "bgm") {
    parts.push("Game background music (BGM).");
    if (input.style) parts.push(`Style: ${input.style}.`);
    if (input.mood) parts.push(`Mood: ${input.mood}.`);
    if (input.bpm) parts.push(`Tempo: ${input.bpm} BPM.`);
    if (input.instrumental || input.hasLyrics === false) parts.push("Instrumental only, no vocals.");
    else if (input.hasLyrics) parts.push("With lyrics.");
    if (input.loopable) parts.push("Should loop seamlessly.");
  } else if (input.kind === "sfx") {
    parts.push("Short game sound effect (SFX), single event, no music bed.");
    if (input.intensity) parts.push(`Intensity: ${input.intensity}.`);
    if (input.dry) parts.push("Dry, no reverb or tail.");
    if (input.loopable) parts.push("Loopable.");
  } else {
    parts.push("Ambient background soundscape (ambience), no melody, no rhythm.");
    if (input.ambienceKeywords) parts.push(`Scene: ${input.ambienceKeywords}.`);
    if (input.seamlessLoop || input.loopable) parts.push("Seamless loop, no obvious seam.");
  }
  if (input.durationSeconds) parts.push(`Target duration: about ${input.durationSeconds} seconds.`);
  parts.push(input.prompt.trim());
  return parts.filter(Boolean).join(" ");
}

export function buildAudioRequest(provider: AudioProviderLike, input: GenerateAudioInput): AudioRequestSpec {
  const prompt = buildAudioPrompt(input);
  switch (provider.protocol) {
    case "ace-music-v1": {
      const format = provider.outputFormat?.toLowerCase() || "mp3";
      return {
        url: `${provider.baseUrl}/chat/completions`,
        headers: baseHeaders(provider),
        body: {
          model: provider.modelId,
          messages: [{ role: "user", content: prompt }],
          modalities: ["audio", "text"],
          audio: { format: FORMAT_MIME[format] ? format : "mp3" }
        }
      };
    }
    default: {
      const exhaustive: never = provider.protocol;
      throw new Error(`未知音频协议：${exhaustive as string}`);
    }
  }
}

function decodeDataUrl(value: string): GeneratedAudioPayload | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return undefined;
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

function parseAceMusic(payload: unknown): GeneratedAudioPayload[] {
  const choices = (payload as {
    choices?: Array<{ message?: { content?: string; audio?: Array<{ audio_url?: { url?: string } | string }> } }>;
  }).choices;
  if (!Array.isArray(choices)) return [];
  const results: GeneratedAudioPayload[] = [];
  for (const choice of choices) {
    const note = typeof choice?.message?.content === "string" ? choice.message.content : undefined;
    for (const audio of choice?.message?.audio ?? []) {
      const url = typeof audio === "string" ? audio : typeof audio?.audio_url === "string" ? audio.audio_url : audio?.audio_url?.url;
      if (!url) continue;
      const inline = decodeDataUrl(url);
      results.push(inline ? { ...inline, note } : { mimeType: "audio/mpeg", url, note });
    }
  }
  return results;
}

export function parseAudioResponse(protocol: AudioProtocolId, payload: unknown): GeneratedAudioPayload[] {
  switch (protocol) {
    case "ace-music-v1":
      return parseAceMusic(payload);
    default: {
      const exhaustive: never = protocol;
      throw new Error(`未知音频协议：${exhaustive as string}`);
    }
  }
}

/** Read-only probe (model listing) to validate base URL + key without generating. */
export function buildAudioProbeRequest(provider: AudioProviderLike): { url: string; headers: Record<string, string> } {
  const headers = baseHeaders(provider);
  delete headers["Content-Type"];
  return { url: `${provider.baseUrl}/models`, headers };
}
