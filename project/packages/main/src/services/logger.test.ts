import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLogger, getProjectLogger } from "./logger";

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "gais-log-"));
}

describe("FileLogger", () => {
  it("writes a formatted line with timestamp, level, scope and message", async () => {
    const dir = await tmpDir();
    const filePath = path.join(dir, "app.log");
    const logger = new FileLogger({ filePath, minLevel: "debug" });

    logger.info("scope", "hello world", { a: 1 });
    await logger.flush();

    const content = await readFile(filePath, "utf8");
    expect(content).toMatch(/\dT[\d:.]+Z INFO {2}\[scope] hello world \{"a":1\}\n/);
  });

  it("drops messages below the configured minimum level", async () => {
    const dir = await tmpDir();
    const filePath = path.join(dir, "app.log");
    const logger = new FileLogger({ filePath, minLevel: "warn" });

    logger.info("s", "should be dropped");
    logger.error("s", "should be kept");
    await logger.flush();

    const content = await readFile(filePath, "utf8");
    expect(content).not.toContain("should be dropped");
    expect(content).toContain("should be kept");
  });

  it("rotates the file once it exceeds maxBytes", async () => {
    const dir = await tmpDir();
    const filePath = path.join(dir, "app.log");
    const logger = new FileLogger({ filePath, minLevel: "debug", maxBytes: 200, maxFiles: 2 });

    for (let i = 0; i < 30; i += 1) {
      logger.info("s", `line number ${i} with some padding to grow the file`);
    }
    await logger.flush();

    const files = await readdir(dir);
    expect(files).toContain("app.log");
    expect(files).toContain("app.log.1");
  });

  it("tees formatted lines into another logger", async () => {
    const dir = await tmpDir();
    const mainPath = path.join(dir, "app.log");
    const teePath = path.join(dir, "tee.log");
    const teeLogger = new FileLogger({ filePath: teePath, minLevel: "debug" });
    const logger = new FileLogger({ filePath: mainPath, minLevel: "debug", tee: teeLogger });

    logger.warn("scope", "teed message");
    await logger.flush();

    expect(await readFile(mainPath, "utf8")).toContain("teed message");
    expect(await readFile(teePath, "utf8")).toContain("teed message");
  });

  it("never throws on serialization of circular meta", async () => {
    const dir = await tmpDir();
    const filePath = path.join(dir, "app.log");
    const logger = new FileLogger({ filePath, minLevel: "debug" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logger.info("s", "circular", circular)).not.toThrow();
    await logger.flush();
    expect(await readFile(filePath, "utf8")).toContain("circular");
  });
});

describe("getProjectLogger", () => {
  const created: string[] = [];
  afterEach(() => {
    created.length = 0;
  });

  it("writes under <projectRoot>/.gameaistudio/logs/project.log", async () => {
    const root = await tmpDir();
    created.push(root);
    const logger = getProjectLogger(root);

    logger.info("project", "created", { project: "demo" });
    await logger.flush();

    const logPath = path.join(root, ".gameaistudio", "logs", "project.log");
    const content = await readFile(logPath, "utf8");
    expect(content).toContain("[project] created");
    expect(content).toContain('"project":"demo"');
  });

  it("returns the same cached logger for the same root", () => {
    const a = getProjectLogger(path.join(os.tmpdir(), "gais-cache-x"));
    const b = getProjectLogger(path.join(os.tmpdir(), "gais-cache-x"));
    expect(a).toBe(b);
  });
});
