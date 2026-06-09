import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGodotEditorLaunchPlan } from "./godot-service";
import type { StudioPaths } from "./resource-paths";

function createPaths(root: string): StudioPaths {
  return {
    resourceRoot: root,
    dataRoot: path.join(root, "data"),
    projectsRoot: path.join(root, "data", "projects"),
    templatesRoot: path.join(root, "gameaistudio_template"),
    engineRoot: path.join(root, "engine"),
    godotGuiPath: path.join(root, "engine", "Godot_v4.6.2-stable_win64.exe"),
    godotConsolePath: path.join(root, "engine", "Godot_v4.6.2-stable_win64_console.exe")
  };
}

describe("buildGodotEditorLaunchPlan", () => {
  it("builds a GUI editor command for a Godot project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-godot-open-"));

    try {
      const paths = createPaths(root);
      await mkdir(paths.engineRoot, { recursive: true });
      await writeFile(paths.godotGuiPath!, "", "utf8");

      const projectRoot = path.join(root, "projects", "gold-miner");
      const plan = buildGodotEditorLaunchPlan(paths, projectRoot);

      expect(plan.ok).toBe(true);
      expect(plan.command).toBe(paths.godotGuiPath);
      expect(plan.args).toEqual(["--path", projectRoot, "--editor"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a clear failure when the bundled GUI executable is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-godot-open-"));

    try {
      const paths = createPaths(root);
      const plan = buildGodotEditorLaunchPlan(paths, path.join(root, "project"));

      expect(plan.ok).toBe(false);
      expect(plan.command).toBeUndefined();
      expect(plan.message).toContain("Godot GUI");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
