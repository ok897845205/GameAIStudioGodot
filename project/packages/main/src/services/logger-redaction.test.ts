import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLogger, redactSensitiveText } from "./logger";

describe("redactSensitiveText", () => {
  it("masks OpenAI/Anthropic style secret keys", () => {
    expect(redactSensitiveText("using sk-proj-AbCdEf1234567890XyZ now")).toBe(
      "using sk-*** now",
    );
  });

  it("masks bearer tokens", () => {
    expect(redactSensitiveText('header "Authorization: Bearer eyJhbGciOi.payload.sig"')).toContain(
      "Bearer ***",
    );
  });

  it("masks KEY/TOKEN/SECRET assignments while keeping the variable name", () => {
    expect(redactSensitiveText("OPENAI_API_KEY=abc123secret")).toBe("OPENAI_API_KEY=***");
    expect(redactSensitiveText('"MOONSHOT_API_KEY": "abc123"')).toContain("MOONSHOT_API_KEY");
    expect(redactSensitiveText('"MOONSHOT_API_KEY": "abc123"')).not.toContain("abc123");
  });

  it("masks the local username in home-directory paths", () => {
    expect(redactSensitiveText("C:\\Users\\Alice\\Documents\\GameAIStudio")).toBe(
      "C:\\Users\\<user>\\Documents\\GameAIStudio",
    );
    expect(redactSensitiveText("/home/alice/.config/app")).toBe("/home/<user>/.config/app");
    expect(redactSensitiveText("/Users/alice/Library")).toBe("/Users/<user>/Library");
  });

  it("leaves ordinary Chinese log lines untouched", () => {
    const line = "启动本地 CLI adapter=Codex exitCode=0 耗时=120ms";
    expect(redactSensitiveText(line)).toBe(line);
  });
});

describe("FileLogger redaction integration", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("redacts secrets in message and meta before writing", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gas-logger-redact-"));
    const filePath = path.join(dir, "app.log");
    const logger = new FileLogger({ filePath, minLevel: "debug" });
    logger.info("cli", "probe OPENAI_API_KEY=abc123secret", {
      args: ["--api-key", "sk-live-1234567890abcdef"],
      cwd: "C:\\Users\\Alice\\Documents\\proj",
    });
    await logger.flush();
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("OPENAI_API_KEY=***");
    expect(content).toContain("sk-***");
    expect(content).not.toContain("abc123secret");
    expect(content).not.toContain("1234567890abcdef");
    expect(content).toContain("C:\\\\Users\\\\<user>");
  });
});
