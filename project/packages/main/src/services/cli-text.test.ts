import { describe, expect, it } from "vitest";
import { sanitizeCliText } from "./cli-text";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("sanitizeCliText", () => {
  it("strips ANSI colour and cursor sequences", () => {
    const input = `${ESC}[32m已完成${ESC}[0m ${ESC}[1;31m失败${ESC}[0m${ESC}[2K`;
    expect(sanitizeCliText(input)).toBe("已完成 失败");
  });

  it("strips OSC window-title sequences (BEL and ST terminated)", () => {
    expect(sanitizeCliText(`${ESC}]0;codex${BEL}正文`)).toBe("正文");
    expect(sanitizeCliText(`${ESC}]8;;https://x${ESC}\\链接`)).toBe("链接");
  });

  it("strips bare two-character escapes and control bytes", () => {
    const input = `${ESC}(B文本${String.fromCharCode(8)}${String.fromCharCode(0)}${BEL}结束${String.fromCharCode(0x7f)}`;
    expect(sanitizeCliText(input)).toBe("文本结束");
  });

  it("turns progress-bar carriage returns into line breaks", () => {
    expect(sanitizeCliText("10%\r50%\r100%")).toBe("10%\n50%\n100%");
    expect(sanitizeCliText("line1\r\nline2")).toBe("line1\nline2");
  });

  it("keeps Chinese text, newlines and tabs intact", () => {
    const input = "第一行\n\t缩进的中文内容，含标点：；、。";
    expect(sanitizeCliText(input)).toBe(input);
  });

  it("returns empty input unchanged", () => {
    expect(sanitizeCliText("")).toBe("");
  });
});
