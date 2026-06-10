import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProjectDirectoryWritable } from "./agent-service";

describe("verifyProjectDirectoryWritable", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("accepts a writable project directory and leaves no probe file behind", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gas-preflight-"));
    expect(await verifyProjectDirectoryWritable(dir)).toEqual({ ok: true });
    const leftovers = await readdir(path.join(dir, ".gameaistudio"));
    expect(leftovers.filter((name) => name.startsWith(".write-probe"))).toEqual([]);
  });

  it("classifies a missing directory as project-dir-missing", async () => {
    const missing = path.join(os.tmpdir(), `gas-preflight-missing-${Date.now()}`);
    const check = await verifyProjectDirectoryWritable(missing);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.kind).toBe("project-dir-missing");
      expect(check.reason).toBeTruthy();
    }
  });

  it("classifies a file (not a directory) as project-dir-missing", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gas-preflight-file-"));
    const filePath = path.join(dir, "not-a-dir");
    await writeFile(filePath, "x", "utf8");
    const check = await verifyProjectDirectoryWritable(filePath);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.kind).toBe("project-dir-missing");
    }
  });
});
