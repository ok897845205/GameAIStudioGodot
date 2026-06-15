import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeProjectDir } from "./project-dir-cleanup";

describe("removeProjectDir", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "gas-rmdir-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("removes a populated project directory", async () => {
    const dir = path.join(base, "proj");
    await mkdir(path.join(dir, "assets", "characters"), { recursive: true });
    await writeFile(path.join(dir, "project.godot"), "config");
    await writeFile(path.join(dir, "assets", "characters", "hero.png"), "img");

    await removeProjectDir(dir);
    await expect(access(dir)).rejects.toThrow();
  });

  it("is a no-op-safe when the directory is already gone", async () => {
    await expect(removeProjectDir(path.join(base, "missing"))).resolves.toBeUndefined();
  });
});
