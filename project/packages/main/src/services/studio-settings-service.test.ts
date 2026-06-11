import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StudioSettingsService } from "./studio-settings-service";

async function createService(root: string): Promise<StudioSettingsService> {
  const service = new StudioSettingsService({
    defaultDataRoot: path.join(root, "default-data"),
    settingsPath: path.join(root, "userData", "studio-settings.json"),
  });
  await service.load();
  return service;
}

describe("StudioSettingsService", () => {
  it("does not treat the removed log-directory settings as completed setup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-"));
    const settingsPath = path.join(root, "userData", "studio-settings.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({ appLogDir: "D:\\logs", projectLogDir: "D:\\project-logs", setupCompleted: true }),
      "utf8",
    );

    const service = await createService(root);
    const settings = service.getSettings();

    expect(settings.setupRequired).toBe(true);
    expect(settings.dataRoot).toBeUndefined();
    expect(settings.projectsRoot).toBeUndefined();
  });

  it("persists data and project roots and reports restart when active paths differ", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-"));
    const service = await createService(root);
    service.setActivePaths({
      resourceRoot: root,
      dataRoot: path.join(root, "default-data"),
      projectsRoot: path.join(root, "default-data", "projects"),
      templatesRoot: path.join(root, "gameaistudio_template"),
      engineRoot: path.join(root, "engine"),
    });

    const settings = await service.update({
      dataRoot: path.join(root, "custom-data"),
      projectsRoot: path.join(root, "custom-projects"),
      setupCompleted: true,
    });

    expect(settings.setupRequired).toBe(false);
    expect(settings.resolvedDataRoot).toBe(path.join(root, "custom-data"));
    expect(settings.resolvedProjectsRoot).toBe(path.join(root, "custom-projects"));
    expect(settings.requiresRestart).toBe(true);
  });

  it("expands environment variables in user-entered directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-"));
    const service = await createService(root);
    process.env.GAMEAISTUDIO_TEST_ROOT = root;
    try {
      const settings = await service.update({
        dataRoot: "${GAMEAISTUDIO_TEST_ROOT}/expanded-data",
        setupCompleted: true,
      });

      expect(settings.resolvedDataRoot).toBe(path.join(root, "expanded-data"));
    } finally {
      delete process.env.GAMEAISTUDIO_TEST_ROOT;
    }
  });

  it("rejects relative user-entered directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-"));
    const service = await createService(root);

    await expect(
      service.update({
        dataRoot: "relative-data",
        setupCompleted: true,
      }),
    ).rejects.toThrow("绝对路径");
  });

  it("copies studio state when the software data directory changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gas-settings-"));
    const oldDataRoot = path.join(root, "old-data");
    const newDataRoot = path.join(root, "new-data");
    const service = await createService(root);
    await mkdir(oldDataRoot, { recursive: true });
    await writeFile(path.join(oldDataRoot, "studio-state.json"), "{\"projects\":[{\"id\":\"p1\"}]}", "utf8");
    service.setActivePaths({
      resourceRoot: root,
      dataRoot: oldDataRoot,
      projectsRoot: path.join(oldDataRoot, "projects"),
      templatesRoot: path.join(root, "gameaistudio_template"),
      engineRoot: path.join(root, "engine"),
    });

    await service.update({
      dataRoot: newDataRoot,
      setupCompleted: true,
    });

    await expect(readFile(path.join(newDataRoot, "studio-state.json"), "utf8")).resolves.toContain("\"p1\"");
  });
});
