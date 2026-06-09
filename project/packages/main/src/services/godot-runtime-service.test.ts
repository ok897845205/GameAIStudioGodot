import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGodotRuntime } from "./godot-runtime-service";
import type { StudioPaths } from "./resource-paths";

const WEB_EXPORT_PRESET = `[preset.0]

name="Web"
platform="Web"
export_path="build/web/index.html"
`;

async function createPaths(): Promise<{ root: string; paths: StudioPaths }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-godot-runtime-"));
  const paths: StudioPaths = {
    resourceRoot: root,
    dataRoot: path.join(root, "data"),
    projectsRoot: path.join(root, "data", "projects"),
    templatesRoot: path.join(root, "gameaistudio_template"),
    engineRoot: path.join(root, "engine"),
    godotGuiPath: path.join(root, "engine", "Godot_v4.6.2-stable_win64.exe"),
    godotConsolePath: path.join(root, "engine", "Godot_v4.6.2-stable_win64_console.exe")
  };
  return { root, paths };
}

async function writeRuntimeFiles(paths: StudioPaths, options: { includeWebExportPresets?: boolean } = {}): Promise<void> {
  const includeWebExportPresets = options.includeWebExportPresets ?? true;

  await mkdir(paths.engineRoot, { recursive: true });
  await mkdir(path.join(paths.templatesRoot, "gameaistudio_template_2d"), { recursive: true });
  await mkdir(path.join(paths.templatesRoot, "gameaistudio_template_3d"), { recursive: true });
  await writeFile(paths.godotGuiPath!, "", "utf8");
  await writeFile(paths.godotConsolePath!, "", "utf8");
  await writeFile(path.join(paths.templatesRoot, "gameaistudio_template_2d", "project.godot"), "config/name=\"2D\"\n", "utf8");
  await writeFile(path.join(paths.templatesRoot, "gameaistudio_template_3d", "project.godot"), "config/name=\"3D\"\n", "utf8");

  if (includeWebExportPresets) {
    await writeFile(path.join(paths.templatesRoot, "gameaistudio_template_2d", "export_presets.cfg"), WEB_EXPORT_PRESET, "utf8");
    await writeFile(path.join(paths.templatesRoot, "gameaistudio_template_3d", "export_presets.cfg"), WEB_EXPORT_PRESET, "utf8");
  }
}

describe("buildGodotRuntime", () => {
  it("reports a ready runtime when bundled engine and templates are present", async () => {
    const { root, paths } = await createPaths();

    try {
      await writeRuntimeFiles(paths);
      const runtime = buildGodotRuntime(paths, {
        exitCode: 0,
        stdout: "Godot Engine v4.6.2.stable.official\n",
        stderr: ""
      });

      expect(runtime.status).toBe("ready");
      expect(runtime.version).toBe("Godot Engine v4.6.2.stable.official");
      expect(runtime.templates.every((template) => template.available)).toBe(true);
      expect(runtime.templates.every((template) => template.webExportPresetAvailable)).toBe(true);
      expect(runtime.diagnostics.map((diagnostic) => diagnostic.id)).toContain("console-found");
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "version-ok")?.severity).toBe("ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports missing runtime when the console executable and templates are absent", async () => {
    const { root, paths } = await createPaths();

    try {
      await mkdir(paths.engineRoot, { recursive: true });
      const runtime = buildGodotRuntime({
        ...paths,
        godotGuiPath: undefined,
        godotConsolePath: undefined
      });

      expect(runtime.status).toBe("missing");
      expect(runtime.version).toBeUndefined();
      expect(runtime.templates.map((template) => template.available)).toEqual([false, false]);
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "console-missing")?.severity).toBe("error");
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "template-2d")?.severity).toBe("error");
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "template-2d-web-export")?.severity).toBe("error");
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "gui-missing")?.severity).toBe("warning");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports an error when templates do not include Web export presets", async () => {
    const { root, paths } = await createPaths();

    try {
      await writeRuntimeFiles(paths, { includeWebExportPresets: false });
      const runtime = buildGodotRuntime(paths, {
        exitCode: 0,
        stdout: "Godot Engine v4.6.2.stable.official\n",
        stderr: ""
      });

      expect(runtime.status).toBe("error");
      expect(runtime.templates.map((template) => template.projectFileAvailable)).toEqual([true, true]);
      expect(runtime.templates.map((template) => template.webExportPresetAvailable)).toEqual([false, false]);
      expect(runtime.templates.map((template) => template.available)).toEqual([false, false]);
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "template-2d")?.severity).toBe("ok");
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "template-2d-web-export")?.severity).toBe("error");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports an error when the Godot version probe fails", async () => {
    const { root, paths } = await createPaths();

    try {
      await writeRuntimeFiles(paths);
      const runtime = buildGodotRuntime(paths, {
        exitCode: 1,
        stdout: "",
        stderr: "cannot start Godot"
      });

      expect(runtime.status).toBe("error");
      expect(runtime.diagnostics.find((diagnostic) => diagnostic.id === "version-error")?.detail).toBe("cannot start Godot");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
