import { describe, expect, it } from "vitest";
import { buildAssetPipelineNote, describeAssetPipelineOutcome, parseAssetPlan } from "./asset-plan";

describe("parseAssetPlan", () => {
  it("parses a fenced json block with an assets object", () => {
    const content = [
      "视觉方向：像素风横版射击。",
      "```json",
      JSON.stringify({
        assets: [
          { key: "player_ship", description: "side-view spaceship", purpose: "character", transparentBackground: true, count: 1 },
          { key: "forest_bg", description: "forest parallax background", purpose: "background", aspectRatio: "16:9" }
        ]
      }),
      "```",
      "以上是素材计划。"
    ].join("\n");

    const plan = parseAssetPlan(content);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ key: "player_ship", purpose: "character", transparentBackground: true, count: 1 });
    expect(plan[1]).toMatchObject({ key: "forest_bg", purpose: "background", aspectRatio: "16:9" });
  });

  it("parses a bare array embedded in prose", () => {
    const content = `计划如下 [{"key":"coin_icon","description":"gold coin icon","purpose":"ui-icon"}] 完毕`;
    const plan = parseAssetPlan(content);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.key).toBe("coin_icon");
  });

  it("coerces invalid fields instead of dropping the item", () => {
    const content = JSON.stringify({
      assets: [{ key: "Player Ship!", description: "ship", purpose: "spaceship", aspectRatio: "21:9", count: 99 }]
    });
    const plan = parseAssetPlan(content);
    expect(plan[0]).toMatchObject({ key: "player_ship", purpose: "other", aspectRatio: undefined, count: 2 });
  });

  it("drops items without a description and dedupes slot keys", () => {
    const content = JSON.stringify({
      assets: [
        { key: "enemy", description: "drone enemy", purpose: "enemy" },
        { key: "enemy", description: "tank enemy", purpose: "enemy" },
        { key: "empty", description: "  " }
      ]
    });
    const plan = parseAssetPlan(content);
    expect(plan.map((item) => item.key)).toEqual(["enemy", "enemy_2"]);
  });

  it("caps the plan size", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      key: `asset_${index}`,
      description: `asset ${index}`,
      purpose: "prop"
    }));
    expect(parseAssetPlan(JSON.stringify({ assets: items }))).toHaveLength(6);
  });

  it("returns [] for replies without parseable plans", () => {
    expect(parseAssetPlan("我建议使用像素风，主角是一只猫。")).toEqual([]);
    expect(parseAssetPlan("```json\n{broken\n```")).toEqual([]);
  });
});

describe("buildAssetPipelineNote", () => {
  const item = { key: "player_ship", description: "spaceship", purpose: "character" as const };
  const record = {
    id: "a1",
    projectId: "p1",
    fileName: "x.png",
    projectRelativePath: "assets/characters/x.png",
    resPath: "res://assets/characters/x.png",
    prompt: "spaceship",
    purpose: "character" as const,
    modelId: "m",
    mimeType: "image/png",
    sizeBytes: 1,
    createdAt: "2026-06-11T00:00:00.000Z"
  };

  it("tells downstream agents to use generated res:// paths and flag missing items", () => {
    const note = buildAssetPipelineNote({
      planItems: [item, { key: "enemy_drone", description: "drone", purpose: "enemy" }],
      generated: [{ item, records: [record] }],
      failed: [{ item: { key: "enemy_drone", description: "drone", purpose: "enemy" }, error: "quota" }]
    });
    expect(note).toContain("player_ship → res://assets/characters/x.png");
    expect(note).toContain("enemy_drone");
    expect(note).toContain("占位");
  });

  it("falls back to placeholder guidance when nothing was generated", () => {
    expect(buildAssetPipelineNote(undefined)).toContain("占位");
    expect(buildAssetPipelineNote({ planItems: [], generated: [], failed: [] })).toContain("占位");
  });

  it("turns into an acceptance checklist for the QA role", () => {
    const note = buildAssetPipelineNote(
      {
        planItems: [item],
        generated: [{ item, records: [record] }],
        failed: []
      },
      "qa"
    );
    expect(note).toContain("素材验收");
    expect(note).toContain("发现问题");
    expect(note).toContain("player_ship → res://assets/characters/x.png");
  });
});

describe("describeAssetPipelineOutcome", () => {
  it("lists slots for the first record and marks extras as alternates", () => {
    const item = { key: "player_ship", description: "spaceship", purpose: "character" as const };
    const record = (id: string) => ({
      id,
      projectId: "p1",
      fileName: `${id}.png`,
      projectRelativePath: `assets/characters/${id}.png`,
      resPath: `res://assets/characters/${id}.png`,
      prompt: "spaceship",
      purpose: "character" as const,
      modelId: "m",
      mimeType: "image/png",
      sizeBytes: 1,
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const lines = describeAssetPipelineOutcome({
      planItems: [item],
      generated: [{ item, records: [record("a"), record("b")] }],
      failed: []
    });
    expect(lines[0]).toContain("slot: player_ship");
    expect(lines[1]).toContain("备选");
  });
});
