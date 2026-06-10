import { describe, expect, it } from "vitest";
import { extractFileMentions, normalizeMentionPath } from "./file-mentions";

describe("extractFileMentions", () => {
  it("finds res:// paths and strips the scheme", () => {
    expect(extractFileMentions("加载了 res://scenes/main.tscn 作为主场景")).toEqual([
      "scenes/main.tscn",
    ]);
  });

  it("finds relative paths with known extensions", () => {
    const text = "修改了 scripts/player.gd 和 `assets/coin.png`，详见 docs/notes.md。";
    expect(extractFileMentions(text)).toEqual([
      "scripts/player.gd",
      "assets/coin.png",
      "docs/notes.md",
    ]);
  });

  it("converts absolute paths inside the project root to relative", () => {
    const text = String.raw`写入 E:\Games\proj\scenes\level_1.tscn 完成`;
    expect(extractFileMentions(text, { projectRoot: "E:\\Games\\proj" })).toEqual([
      "scenes/level_1.tscn",
    ]);
  });

  it("dedupes mentions and keeps first-appearance order", () => {
    const text = "a/b.gd 然后又改了 a/b.gd 和 c/d.gd";
    expect(extractFileMentions(text)).toEqual(["a/b.gd", "c/d.gd"]);
  });

  it("ignores bare filenames without a directory", () => {
    expect(extractFileMentions("版本号存放在 v1.2.json 中")).toEqual([]);
  });

  it("caps the number of mentions", () => {
    const text = Array.from({ length: 12 }, (_, i) => `dir/f${i}.gd`).join(" ");
    expect(extractFileMentions(text, { max: 5 })).toHaveLength(5);
  });

  it("strips markdown punctuation wrapping", () => {
    expect(extractFileMentions("（见 .gameaistudio/logs/project.log）")).toEqual([
      ".gameaistudio/logs/project.log",
    ]);
  });
});

describe("normalizeMentionPath", () => {
  it("normalizes backslashes and leading slashes", () => {
    expect(normalizeMentionPath("scenes\\main.tscn")).toBe("scenes/main.tscn");
    expect(normalizeMentionPath("/scenes/main.tscn")).toBe("scenes/main.tscn");
  });
});
