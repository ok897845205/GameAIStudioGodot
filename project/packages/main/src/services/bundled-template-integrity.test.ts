import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(process.cwd(), "gameaistudio_template");

async function readTemplateFile(dimension: "2d" | "3d", relativePath: string): Promise<string> {
  return readFile(path.join(templatesRoot, `gameaistudio_template_${dimension}`, relativePath), "utf8");
}

describe("bundled Godot templates", () => {
  it("ships Web-ready 2D and 3D Godot templates", async () => {
    for (const dimension of ["2d", "3d"] as const) {
      const [projectFile, exportPresets, validationScript] = await Promise.all([
        readTemplateFile(dimension, "project.godot"),
        readTemplateFile(dimension, "export_presets.cfg"),
        readTemplateFile(dimension, "tools/ci/validate_project.gd")
      ]);

      expect(projectFile).toContain('run/main_scene="res://scenes/main.tscn"');
      expect(exportPresets).toContain('platform="Web"');
      expect(exportPresets).toContain('export_path="build/web/index.html"');
      expect(validationScript).toContain("Validation passed");
    }
  });

  it("keeps the 3D validation script aligned with the actual starter scene", async () => {
    const [mainScene, validationScript] = await Promise.all([
      readTemplateFile("3d", "scenes/main.tscn"),
      readTemplateFile("3d", "tools/ci/validate_project.gd")
    ]);

    expect(mainScene).toContain('[node name="Ground" type="StaticBody3D" parent="."]');
    expect(mainScene).toContain('[node name="Camera3D" type="Camera3D" parent="Player/CameraPivot/SpringArm3D"]');
    expect(validationScript).toContain("Player/CameraPivot/SpringArm3D/Camera3D");
    expect(validationScript).toContain("Ground");
  });
});
