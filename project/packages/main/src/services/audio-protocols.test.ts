import { describe, expect, it } from "vitest";
import { audioMimeToExtension, buildAudioPrompt, buildAudioProbeRequest, buildAudioRequest, parseAudioResponse } from "./audio-protocols";

const aceProvider = {
  protocol: "ace-music-v1" as const,
  baseUrl: "https://api.acemusic.ai/v1",
  apiKey: "k",
  modelId: "acemusic/acestep-v1.5-turbo",
  outputFormat: "mp3"
};

describe("buildAudioPrompt", () => {
  it("folds BGM knobs into the prompt text", () => {
    const prompt = buildAudioPrompt({
      projectId: "p",
      kind: "bgm",
      prompt: "main menu theme",
      style: "chiptune",
      mood: "energetic",
      bpm: 140,
      instrumental: true,
      loopable: true,
      durationSeconds: 45
    });
    expect(prompt).toContain("background music");
    expect(prompt).toContain("Style: chiptune");
    expect(prompt).toContain("140 BPM");
    expect(prompt).toContain("Instrumental only");
    expect(prompt).toContain("loop seamlessly");
    expect(prompt).toContain("45 seconds");
    expect(prompt).toContain("main menu theme");
  });

  it("frames SFX as a short single event", () => {
    const prompt = buildAudioPrompt({ projectId: "p", kind: "sfx", prompt: "laser shot", intensity: "strong", dry: true });
    expect(prompt).toContain("sound effect");
    expect(prompt).toContain("Intensity: strong");
    expect(prompt).toContain("Dry");
  });

  it("frames ambience as a melody-free soundscape", () => {
    const prompt = buildAudioPrompt({ projectId: "p", kind: "ambience", prompt: "forest", ambienceKeywords: "birds, wind", seamlessLoop: true });
    expect(prompt).toContain("ambience");
    expect(prompt).toContain("Scene: birds, wind");
    expect(prompt).toContain("Seamless loop");
  });
});

describe("buildAudioRequest", () => {
  it("builds an ACE chat/completions request with the audio modality", () => {
    const request = buildAudioRequest(aceProvider, { projectId: "p", kind: "bgm", prompt: "boss theme" });
    expect(request.url).toBe("https://api.acemusic.ai/v1/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer k");
    expect(request.body).toMatchObject({
      model: "acemusic/acestep-v1.5-turbo",
      modalities: ["audio", "text"],
      audio: { format: "mp3" }
    });
    const body = request.body as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("boss theme");
  });

  it("falls back to mp3 for unknown output formats", () => {
    const request = buildAudioRequest({ ...aceProvider, outputFormat: "flac" }, { projectId: "p", kind: "sfx", prompt: "x" });
    expect((request.body as { audio: { format: string } }).audio.format).toBe("mp3");
  });
});

describe("parseAudioResponse", () => {
  it("decodes the ACE data URL and captures the caption note", () => {
    const dataUrl = `data:audio/mpeg;base64,${Buffer.from("song").toString("base64")}`;
    const results = parseAudioResponse("ace-music-v1", {
      choices: [{ message: { content: "## Metadata\nCaption: upbeat", audio: [{ audio_url: { url: dataUrl }, type: "audio_url" }] } }]
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.mimeType).toBe("audio/mpeg");
    expect(results[0]?.bytes?.toString()).toBe("song");
    expect(results[0]?.note).toContain("Caption");
  });

  it("keeps a remote URL when the audio is not inlined", () => {
    const results = parseAudioResponse("ace-music-v1", {
      choices: [{ message: { audio: [{ audio_url: "https://cdn/song.mp3" }] } }]
    });
    expect(results[0]?.url).toBe("https://cdn/song.mp3");
  });

  it("returns empty for malformed payloads", () => {
    expect(parseAudioResponse("ace-music-v1", {})).toEqual([]);
    expect(parseAudioResponse("ace-music-v1", { choices: [{ message: {} }] })).toEqual([]);
  });
});

describe("audioMimeToExtension", () => {
  it("maps common audio mimes and defaults to mp3", () => {
    expect(audioMimeToExtension("audio/mpeg")).toBe("mp3");
    expect(audioMimeToExtension("audio/wav")).toBe("wav");
    expect(audioMimeToExtension("audio/ogg")).toBe("ogg");
    expect(audioMimeToExtension("audio/weird")).toBe("mp3");
  });
});

describe("buildAudioProbeRequest", () => {
  it("targets the models endpoint with auth and no content-type", () => {
    const probe = buildAudioProbeRequest(aceProvider);
    expect(probe.url).toBe("https://api.acemusic.ai/v1/models");
    expect(probe.headers.Authorization).toBe("Bearer k");
    expect(probe.headers["Content-Type"]).toBeUndefined();
  });
});
