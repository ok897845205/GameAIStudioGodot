import { mkdir, mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectFileChangeService } from "./project-file-change-service";

describe("ProjectFileChangeService", () => {
  it("detects added, modified, and deleted project files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-files-"));
    const service = new ProjectFileChangeService();

    try {
      await mkdir(path.join(dir, "scripts"), { recursive: true });
      await writeFile(path.join(dir, "scripts", "player.gd"), "extends Node\n", "utf8");
      await writeFile(path.join(dir, "project.godot"), "config/name=\"Demo\"\n", "utf8");
      const before = await service.createSnapshot(dir);

      await writeFile(path.join(dir, "scripts", "player.gd"), "extends Node\nfunc _ready(): pass\n", "utf8");
      await writeFile(path.join(dir, "scripts", "enemy.gd"), "extends Node\n", "utf8");
      await unlink(path.join(dir, "project.godot"));
      const after = await service.createSnapshot(dir);

      const changes = service.compareSnapshots(before, after);
      expect(changes.map((change) => `${change.kind}:${change.path}`)).toEqual([
        "deleted:project.godot",
        "added:scripts/enemy.gd",
        "modified:scripts/player.gd"
      ]);
      expect(changes.find((change) => change.path === "scripts/player.gd")?.isText).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores generated Godot and export artifacts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-files-"));
    const service = new ProjectFileChangeService();

    try {
      await mkdir(path.join(dir, "build", "web"), { recursive: true });
      await mkdir(path.join(dir, ".godot", "imported"), { recursive: true });
      await mkdir(path.join(dir, ".gameaistudio"), { recursive: true });
      await writeFile(path.join(dir, "build", "web", "index.html"), "old", "utf8");
      await writeFile(path.join(dir, ".godot", "imported", "cache.md5"), "old", "utf8");
      await writeFile(path.join(dir, ".gameaistudio", "project.json"), "old", "utf8");
      await writeFile(path.join(dir, "icon.svg.import"), "old", "utf8");

      const snapshot = await service.createSnapshot(dir);
      expect([...snapshot.keys()]).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
