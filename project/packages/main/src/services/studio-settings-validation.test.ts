import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isFilesystemRoot,
  isInsideDirectory,
  StudioSettingsService,
} from "./studio-settings-service";

async function createService(root: string, resourceRoot?: string): Promise<StudioSettingsService> {
  const service = new StudioSettingsService({
    defaultDataRoot: path.join(root, "default-data"),
    settingsPath: path.join(root, "userData", "studio-settings.json"),
    ...(resourceRoot ? { resourceRoot } : {}),
  });
  await service.load();
  return service;
}

describe("directory guards", () => {
  it("identifies filesystem roots", () => {
    if (process.platform === "win32") {
      expect(isFilesystemRoot("C:\\")).toBe(true);
      expect(isFilesystemRoot("E:\\")).toBe(true);
      expect(isFilesystemRoot("C:\\Users")).toBe(false);
    } else {
      expect(isFilesystemRoot("/")).toBe(true);
      expect(isFilesystemRoot("/home")).toBe(false);
    }
  });

  it("identifies nesting inside a parent directory (case-insensitive on Windows)", () => {
    const parent = path.join(os.tmpdir(), "GasApp");
    expect(isInsideDirectory(path.join(parent, "resources"), parent)).toBe(true);
    expect(isInsideDirectory(parent, parent)).toBe(true);
    expect(isInsideDirectory(path.join(os.tmpdir(), "GasApp-data"), parent)).toBe(false);
  });
});

describe("StudioSettingsService directory validation", () => {
  it("rejects a filesystem root as data or projects directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-guard-"));
    const service = await createService(root);
    const fsRoot = process.platform === "win32" ? "C:\\" : "/";

    await expect(service.update({ dataRoot: fsRoot })).rejects.toThrow("磁盘根目录");
    await expect(service.update({ projectsRoot: fsRoot })).rejects.toThrow("磁盘根目录");
  });

  it("rejects directories inside the app install root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-guard-"));
    const resourceRoot = path.join(root, "install");
    const service = await createService(root, resourceRoot);

    await expect(
      service.update({ projectsRoot: path.join(resourceRoot, "projects") }),
    ).rejects.toThrow("软件安装目录");
    await expect(service.update({ dataRoot: resourceRoot })).rejects.toThrow("软件安装目录");
  });

  it("accepts a normal custom directory and persists it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-guard-"));
    const service = await createService(root, path.join(root, "install"));
    const projectsRoot = path.join(root, "my-games");

    const settings = await service.update({ projectsRoot, setupCompleted: true });
    expect(settings.resolvedProjectsRoot).toBe(path.resolve(projectsRoot));
  });
});

describe("startup fallback keeps stored configuration", () => {
  it("flags the fallback without touching the settings file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-fallback-"));
    const service = await createService(root);
    const customData = path.join(root, "removable-drive", "data");
    await service.update({ dataRoot: customData, setupCompleted: true });
    const persistedBefore = await readFile(path.join(root, "userData", "studio-settings.json"), "utf8");

    // Startup discovers the directory is unusable → session fallback only.
    service.markStartupFallback();

    const settings = service.getSettings();
    expect(settings.startupFallbackActive).toBe(true);
    expect(settings.dataRoot).toBe(path.resolve(customData)); // config preserved
    const persistedAfter = await readFile(path.join(root, "userData", "studio-settings.json"), "utf8");
    expect(persistedAfter).toBe(persistedBefore); // file untouched
  });
});
