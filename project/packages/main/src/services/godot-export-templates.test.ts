import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GODOT_TEMPLATE_VERSION,
  bundledExportTemplatesDir,
  ensureWebExportTemplates,
  godotSpawnEnv,
  managedGodotDataRoot,
  managedTemplatesDir,
  missingTemplatesMessage
} from "./godot-export-templates";

describe("godotSpawnEnv", () => {
  it("redirects the platform config dir into the managed data root", () => {
    const managed = managedGodotDataRoot("D:\\data");
    expect(godotSpawnEnv("D:\\data", "win32")).toEqual({ APPDATA: managed });
    expect(godotSpawnEnv("D:\\data", "linux")).toMatchObject({ XDG_DATA_HOME: managed, XDG_CONFIG_HOME: managed });
    expect(godotSpawnEnv("D:\\data", "darwin")).toEqual({ HOME: managed });
  });

  it("managed templates dir matches where Godot will look per platform", () => {
    const managed = managedGodotDataRoot("/data");
    expect(managedTemplatesDir("/data", "win32")).toBe(path.join(managed, "Godot", "export_templates", GODOT_TEMPLATE_VERSION));
    expect(managedTemplatesDir("/data", "linux")).toBe(path.join(managed, "godot", "export_templates", GODOT_TEMPLATE_VERSION));
    expect(managedTemplatesDir("/data", "darwin")).toBe(
      path.join(managed, "Library", "Application Support", "Godot", "export_templates", GODOT_TEMPLATE_VERSION)
    );
  });
});

describe("ensureWebExportTemplates", () => {
  let dataRoot: string;
  let engineRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), "gas-data-"));
    engineRoot = await mkdtemp(path.join(os.tmpdir(), "gas-engine-"));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(engineRoot, { recursive: true, force: true });
  });

  async function seedBundled() {
    const dir = bundledExportTemplatesDir(engineRoot);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "web_nothreads_debug.zip"), "debug-zip");
    await writeFile(path.join(dir, "web_nothreads_release.zip"), "release-zip");
  }

  it("installs bundled templates into the managed dir and is idempotent", async () => {
    await seedBundled();
    const first = await ensureWebExportTemplates(engineRoot, dataRoot);
    expect(first.ok).toBe(true);
    expect(first.source).toBe("bundled");
    expect(first.copied.sort()).toEqual(["web_nothreads_debug.zip", "web_nothreads_release.zip"]);
    const installed = path.join(managedTemplatesDir(dataRoot), "web_nothreads_release.zip");
    expect((await readFile(installed, "utf8")).toString()).toBe("release-zip");

    const second = await ensureWebExportTemplates(engineRoot, dataRoot);
    expect(second.ok).toBe(true);
    expect(second.copied).toEqual([]);
  });

  it("reports missing templates with an actionable, no-download message", async () => {
    const status = await ensureWebExportTemplates(engineRoot, dataRoot);
    if (status.ok) {
      // Dev machine fallback: the user's real Godot dir provided the zips.
      expect(status.source).toBe("user");
      return;
    }
    expect(status.missing.length).toBeGreaterThan(0);
    const message = missingTemplatesMessage(engineRoot, status);
    expect(message).toContain("内置在安装包");
    expect(message).toContain("无需手动下载");
  });

  it("handles an undefined engine root gracefully", async () => {
    const status = await ensureWebExportTemplates(undefined, dataRoot);
    // Either fails clearly or succeeds via the dev-machine user fallback.
    expect(typeof status.ok).toBe("boolean");
    expect(status.managedDir).toBe(managedTemplatesDir(dataRoot));
  });

  it("repairs a partially installed managed dir", async () => {
    await seedBundled();
    const managedDir = managedTemplatesDir(dataRoot);
    await mkdir(managedDir, { recursive: true });
    await writeFile(path.join(managedDir, "web_nothreads_debug.zip"), "already-there");
    const status = await ensureWebExportTemplates(engineRoot, dataRoot);
    expect(status.ok).toBe(true);
    expect(status.copied).toEqual(["web_nothreads_release.zip"]);
    // The pre-existing file is left untouched.
    await access(path.join(managedDir, "web_nothreads_debug.zip"));
    expect((await readFile(path.join(managedDir, "web_nothreads_debug.zip"), "utf8")).toString()).toBe("already-there");
  });
});
