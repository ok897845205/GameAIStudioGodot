import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioProject } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import { ProjectSnapshotService } from "./project-snapshot-service";
import { StudioStore } from "./store";

async function createHarness() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-snapshot-"));
  const projectRoot = path.join(dir, "project");
  await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
  await mkdir(path.join(projectRoot, "build", "web"), { recursive: true });
  await mkdir(path.join(projectRoot, ".gameaistudio"), { recursive: true });
  await writeFile(path.join(projectRoot, "project.godot"), "config/name=\"Demo\"\n", "utf8");
  await writeFile(path.join(projectRoot, "scripts", "player.gd"), "extends Node\n", "utf8");
  await writeFile(path.join(projectRoot, "scripts", "player.gd.uid"), "uid", "utf8");
  await writeFile(path.join(projectRoot, "build", "web", "index.html"), "generated", "utf8");
  await writeFile(path.join(projectRoot, ".gameaistudio", "project.json"), "state", "utf8");

  const store = new StudioStore(path.join(dir, "state.json"));
  const project: StudioProject = {
    id: "proj_1",
    name: "Demo",
    dimension: "2d",
    prompt: "demo",
    rootPath: projectRoot,
    webBuildPath: path.join(projectRoot, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
  await store.upsertProject(project);

  const projectService = new ProjectService(
    {
      resourceRoot: dir,
      dataRoot: dir,
      projectsRoot: dir,
      templatesRoot: dir,
      engineRoot: dir
    },
    store
  );
  const snapshots = new ProjectSnapshotService(projectService, store);

  return { dir, projectRoot, snapshots, store };
}

describe("ProjectSnapshotService", () => {
  it("creates snapshots while ignoring generated project artifacts", async () => {
    const harness = await createHarness();

    try {
      const snapshot = await harness.snapshots.create({
        projectId: "proj_1",
        label: "Initial",
        reason: "test"
      });

      expect(snapshot.fileCount).toBe(2);
      expect(snapshot.totalBytes).toBeGreaterThan(0);
      expect(await readFile(path.join(snapshot.storagePath, "files", "scripts", "player.gd"), "utf8")).toContain("extends Node");
      await expect(readFile(path.join(snapshot.storagePath, "files", "build", "web", "index.html"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(snapshot.storagePath, "files", "scripts", "player.gd.uid"), "utf8")).rejects.toThrow();
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("restores a snapshot and creates a safety snapshot first", async () => {
    const harness = await createHarness();

    try {
      const snapshot = await harness.snapshots.create({
        projectId: "proj_1",
        label: "Before changes",
        reason: "test"
      });

      await writeFile(path.join(harness.projectRoot, "scripts", "player.gd"), "extends Node\nfunc _ready(): pass\n", "utf8");
      await writeFile(path.join(harness.projectRoot, "scripts", "enemy.gd"), "extends Node\n", "utf8");

      const result = await harness.snapshots.restore("proj_1", snapshot.id);
      expect(result.snapshot.id).toBe(snapshot.id);
      expect(result.safetySnapshot.reason).toBe(`before-restore:${snapshot.id}`);
      expect(await readFile(path.join(harness.projectRoot, "scripts", "player.gd"), "utf8")).toBe("extends Node\n");
      await expect(readFile(path.join(harness.projectRoot, "scripts", "enemy.gd"), "utf8")).rejects.toThrow();
      expect(result.project.snapshots.map((candidate) => candidate.id)).toEqual(
        expect.arrayContaining([snapshot.id, result.safetySnapshot.id])
      );
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });
});
