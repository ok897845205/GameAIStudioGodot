import { describe, expect, it } from "vitest";
import { buildAudioPipelineNote, describeAudioPipelineOutcome, parseAudioPlan } from "./audio-plan";

describe("parseAudioPlan", () => {
  it("parses a fenced json block with an audio array", () => {
    const content = [
      "音乐方向：芯片音乐。计划：",
      "```json",
      JSON.stringify({
        audio: [
          { key: "bgm_level", kind: "bgm", description: "loopable chiptune", durationSeconds: 45, loopable: true },
          { key: "sfx_shoot", kind: "sfx", description: "retro laser", durationSeconds: 1 }
        ]
      }),
      "```"
    ].join("\n");
    const plan = parseAudioPlan(content);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ key: "bgm_level", kind: "bgm", durationSeconds: 45, loopable: true });
    expect(plan[1]).toMatchObject({ key: "sfx_shoot", kind: "sfx", durationSeconds: 1 });
  });

  it("drops items with an invalid kind, clamps duration and forces loop for bgm/ambience", () => {
    const content = JSON.stringify({
      audio: [
        { key: "x", kind: "song", description: "thing", durationSeconds: 9999 },
        { key: "bg", kind: "bgm", description: "tune" },
        { key: "amb", kind: "ambience", description: "rain", durationSeconds: 9999 }
      ]
    });
    const plan = parseAudioPlan(content);
    expect(plan.map((item) => item.key)).toEqual(["bg", "amb"]);
    expect(plan[0]).toMatchObject({ kind: "bgm", loopable: true });
    expect(plan[1]).toMatchObject({ kind: "ambience", durationSeconds: 180, loopable: true });
  });

  it("ignores an image-only assets array (no audio kinds)", () => {
    const content = JSON.stringify({ assets: [{ key: "hero", description: "x", purpose: "character" }] });
    expect(parseAudioPlan(content)).toEqual([]);
  });

  it("caps the plan and dedupes keys", () => {
    const audio = Array.from({ length: 8 }, (_, i) => ({ key: "sfx", kind: "sfx", description: `sfx ${i}` }));
    const plan = parseAudioPlan(JSON.stringify({ audio }));
    expect(plan).toHaveLength(4);
    expect(new Set(plan.map((item) => item.key)).size).toBe(4);
  });

  it("returns [] when no parseable plan exists", () => {
    expect(parseAudioPlan("建议加一首轻快的背景音乐。")).toEqual([]);
  });
});

describe("buildAudioPipelineNote", () => {
  const item = { key: "bgm_main", kind: "bgm" as const, description: "theme" };
  const record = {
    id: "a1",
    projectId: "p1",
    kind: "bgm" as const,
    fileName: "x.mp3",
    projectRelativePath: "assets/audio/bgm/x.mp3",
    resPath: "res://assets/audio/bgm/x.mp3",
    prompt: "theme",
    modelId: "ace",
    format: "mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 1,
    createdAt: "2026-06-11T00:00:00.000Z"
  };

  it("tells the programmer to wire AudioStreamPlayer to res:// paths", () => {
    const note = buildAudioPipelineNote({ planItems: [item], generated: [{ item, record }], failed: [] }, "programmer");
    expect(note).toContain("AudioStreamPlayer");
    expect(note).toContain("bgm_main（bgm）→ res://assets/audio/bgm/x.mp3");
  });

  it("turns into a QA checklist", () => {
    const note = buildAudioPipelineNote({ planItems: [item], generated: [{ item, record }], failed: [] }, "qa");
    expect(note).toContain("音频验收");
    expect(note).toContain("发现问题");
  });

  it("falls back when nothing was generated", () => {
    expect(buildAudioPipelineNote(undefined)).toContain("没有自动生成音频");
  });
});

describe("describeAudioPipelineOutcome", () => {
  it("lists generated clips with slot and failures", () => {
    const item = { key: "sfx_jump", kind: "sfx" as const, description: "jump blip" };
    const record = {
      id: "a",
      projectId: "p",
      kind: "sfx" as const,
      fileName: "j.mp3",
      projectRelativePath: "assets/audio/sfx/j.mp3",
      resPath: "res://assets/audio/sfx/j.mp3",
      prompt: "jump",
      modelId: "ace",
      format: "mp3",
      mimeType: "audio/mpeg",
      sizeBytes: 1,
      createdAt: "2026-06-11T00:00:00.000Z"
    };
    const lines = describeAudioPipelineOutcome({
      planItems: [item],
      generated: [{ item, record }],
      failed: [{ item: { key: "sfx_hit", kind: "sfx", description: "hit" }, error: "quota" }]
    });
    expect(lines[0]).toContain("slot: sfx_jump");
    expect(lines[1]).toContain("sfx_hit 生成失败");
  });
});
