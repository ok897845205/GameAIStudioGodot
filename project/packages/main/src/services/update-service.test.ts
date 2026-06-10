import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo as ElectronUpdateInfo } from "electron-updater";
import {
  UpdateService,
  classifyUpdatePolicy,
  compareVersions,
  inferUpdateFeedUrl,
  parseUpdateEnv,
  sha256Hex,
  type UpdateServiceOptions,
} from "./update-service";

const directUpdateOrigin = "http://101.33.218.121:6780/gameaistudio";
const directManifestUrl = `${directUpdateOrigin}/update.json`;
const directInstallerUrl = (version: string) =>
  `${directUpdateOrigin}/releases/GameAIStudio-Setup-${version}.exe`;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function electronInfo(version: string): ElectronUpdateInfo {
  return {
    version,
    files: [
      {
        url: `releases/GameAIStudio-Setup-${version}.exe`,
        sha512: "sha512-base64",
        size: 123456,
      },
    ],
    path: `releases/GameAIStudio-Setup-${version}.exe`,
    sha512: "sha512-base64",
    releaseDate: "2026-06-10T12:00:00.000Z",
    releaseNotes: `GameAIStudio ${version} 更新。`,
  };
}

function checkResult(isUpdateAvailable: boolean, info: ElectronUpdateInfo): UpdateCheckResult {
  return {
    isUpdateAvailable,
    updateInfo: info,
    versionInfo: info,
  };
}

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowDowngrade = true;
  channel: string | null = null;
  logger: unknown = null;
  feed?: { provider: "generic"; url: string };
  result: UpdateCheckResult | null = checkResult(true, electronInfo("1.4.4"));
  downloadedPaths = ["C:\\Users\\KSG\\AppData\\Roaming\\GameAIStudio\\pending\\GameAIStudio-Setup-1.4.4.exe"];
  quitArgs?: [boolean | undefined, boolean | undefined];

  setFeedURL(options: { provider: "generic"; url: string }): void {
    this.feed = options;
  }

  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    this.emit("checking-for-update");
    if (this.result?.isUpdateAvailable) {
      this.emit("update-available", this.result.updateInfo);
    } else if (this.result?.updateInfo) {
      this.emit("update-not-available", this.result.updateInfo);
    }
    return this.result;
  }

  async downloadUpdate(): Promise<string[]> {
    this.emit("download-progress", {
      total: 100,
      delta: 40,
      transferred: 40,
      percent: 40,
      bytesPerSecond: 1000,
    });
    const info = this.result?.updateInfo ?? electronInfo("1.4.4");
    this.emit("update-downloaded", {
      ...info,
      downloadedFile: this.downloadedPaths[0],
    } satisfies UpdateDownloadedEvent);
    return this.downloadedPaths;
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitArgs = [isSilent, isForceRunAfter];
  }
}

describe("update service", () => {
  const tempDirs: string[] = [];

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-update-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("parses env, compares versions, and infers the standard updater feed URL", () => {
    expect(
      parseUpdateEnv(`
        export GAMEAISTUDIO_UPDATE_MANIFEST_URL="https://updates.example.com/gameaistudio/update.json"
        GAMEAISTUDIO_UPDATE_CHANNEL=stable
      `),
    ).toEqual({
      GAMEAISTUDIO_UPDATE_MANIFEST_URL: "https://updates.example.com/gameaistudio/update.json",
      GAMEAISTUDIO_UPDATE_CHANNEL: "stable",
    });
    expect(compareVersions("1.4.4", "1.4.3")).toBe(1);
    expect(classifyUpdatePolicy("1.4.3", { latestVersion: "1.4.4" })).toEqual({
      policy: "optional",
      reason: "patch",
    });
    expect(classifyUpdatePolicy("1.4.3", { latestVersion: "1.5.0" })).toEqual({
      policy: "required",
      reason: "minor",
    });
    expect(inferUpdateFeedUrl("https://updates.example.com/gameaistudio/update.json")).toBe(
      "https://updates.example.com/gameaistudio",
    );
  });

  it("prefers userData/update.env over bundled .env", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    await mkdir(userData, { recursive: true });
    await writeFile(
      path.join(userData, "update.env"),
      "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://user.example.com/gameaistudio/update.json\n",
      "utf8",
    );
    await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://bundled.example.com/update.json\n", "utf8");

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: false,
    });

    const status = await service.getStatus();
    expect(status.configSource).toBe("userData");
    expect(status.manifestUrl).toBe("https://user.example.com/gameaistudio/update.json");
  });

  it("falls back to bundled env when userData env is invalid", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(userData, "update.env"), "GAMEAISTUDIO_UPDATE_MANIFEST_URL=http://bad/update.json\n", "utf8");
    await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://bundled.example.com/update.json\n", "utf8");

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: false,
    });

    const status = await service.getStatus();
    expect(status.configSource).toBe("bundled");
    expect(status.manifestUrl).toBe("https://bundled.example.com/update.json");
  });

  it("allows explicit insecure HTTP update sources for IP and port direct mode", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    await mkdir(userData, { recursive: true });
    await writeFile(
      bundled,
      `GAMEAISTUDIO_UPDATE_MANIFEST_URL=${directManifestUrl}\nGAMEAISTUDIO_UPDATE_ALLOW_INSECURE=true\n`,
      "utf8",
    );

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: false,
      fetch: async (url) => {
        expect(String(url)).toBe(directManifestUrl);
        return jsonResponse({
          latestVersion: "1.4.4",
          releaseDate: "2026-06-10T12:00:00.000Z",
          packages: [
            {
              platform: "win32",
              arch: "x64",
              url: directInstallerUrl("1.4.4"),
              sha256: "abc",
              size: 10,
            },
          ],
        });
      },
    });

    const info = await service.checkForUpdates();
    expect(info.policy).toBe("optional");
    expect(info.package?.url).toBe(directInstallerUrl("1.4.4"));
  });

  it("configures electron-updater and maps custom update metadata into UI state", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    const updater = new FakeUpdater();
    await mkdir(userData, { recursive: true });
    await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/gameaistudio/update.json\n", "utf8");

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: true,
      updater: updater as UpdateServiceOptions["updater"],
      fetch: async () =>
        jsonResponse({
          latestVersion: "1.4.4",
          releaseDate: "2026-06-10T12:00:00.000Z",
          releaseNotes: "修复标准更新流程。",
          packages: [
            {
              platform: "win32",
              arch: "x64",
              url: "https://updates.example.com/gameaistudio/releases/GameAIStudio-Setup-1.4.4.exe",
              sha256: "abc",
              sha512: "sha512-base64",
              size: 456,
            },
          ],
        }),
    });

    const info = await service.checkForUpdates();
    expect(updater.feed).toEqual({ provider: "generic", url: "https://updates.example.com/gameaistudio" });
    expect(updater.channel).toBe("latest");
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(info.status).toBe("available");
    expect(info.policy).toBe("optional");
    expect(info.releaseNotes).toBe("修复标准更新流程。");
    expect(info.package?.size).toBe(456);
  });

  it("writes validated nextEnv to userData", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    const nextEnv = "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://next.example.com/gameaistudio/update.json\nGAMEAISTUDIO_UPDATE_CHANNEL=stable\n";
    await mkdir(userData, { recursive: true });
    await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/gameaistudio/update.json\n", "utf8");

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: false,
      fetch: async () =>
        jsonResponse({
          latestVersion: "1.4.4",
          packages: [
            {
              platform: "win32",
              arch: "x64",
              url: "https://updates.example.com/gameaistudio/releases/GameAIStudio-Setup-1.4.4.exe",
              sha256: "abc",
            },
          ],
          nextEnv: {
            content: nextEnv,
            sha256: sha256Hex(nextEnv),
            effective: "nextLaunch",
          },
        }),
    });

    await service.checkForUpdates();
    await expect(readFile(path.join(userData, "update.env"), "utf8")).resolves.toBe(nextEnv);
  });

  it("downloads with electron-updater and calls silent quitAndInstall", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    const updater = new FakeUpdater();
    let prepared = false;
    await mkdir(userData, { recursive: true });
    await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/gameaistudio/update.json\n", "utf8");

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: true,
      updater: updater as UpdateServiceOptions["updater"],
      prepareQuitAndInstall: () => {
        prepared = true;
      },
      flushLogs: async () => undefined,
      fetch: async () =>
        jsonResponse({
          latestVersion: "1.4.4",
          packages: [
            {
              platform: "win32",
              arch: "x64",
              url: "https://updates.example.com/gameaistudio/releases/GameAIStudio-Setup-1.4.4.exe",
              sha256: "abc",
              size: 123456,
            },
          ],
        }),
    });

    const result = await service.downloadAndInstall();
    expect(result.launched).toBe(true);
    expect(result.info.status).toBe("installing");
    expect(result.installerPath).toBe(updater.downloadedPaths[0]);
    expect(prepared).toBe(true);
    expect(updater.quitArgs).toEqual([true, true]);
  });

  it("keeps standard updater working when optional update.json metadata fails in packaged app", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    const updater = new FakeUpdater();
    await mkdir(userData, { recursive: true });
    await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/gameaistudio/update.json\n", "utf8");

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: true,
      updater: updater as UpdateServiceOptions["updater"],
      fetch: async () => {
        throw new TypeError("metadata unavailable");
      },
    });

    const info = await service.checkForUpdates();
    expect(updater.feed).toEqual({ provider: "generic", url: "https://updates.example.com/gameaistudio" });
    expect(info.status).toBe("available");
    expect(info.policy).toBe("optional");
    expect(info.releaseNotes).toBe("GameAIStudio 1.4.4 更新。");
    expect(info.package?.url).toBe("https://updates.example.com/gameaistudio/releases/GameAIStudio-Setup-1.4.4.exe");
  });

  it("returns actionable diagnostics when manifest fetch fails", async () => {
    const root = await tempDir();
    const userData = path.join(root, "userData");
    const bundled = path.join(root, ".env");
    const cause = new Error("connect ETIMEDOUT 1.2.3.4:443") as Error & { code?: string };
    cause.code = "ETIMEDOUT";
    const fetchError = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    fetchError.cause = cause;
    await mkdir(userData, { recursive: true });
    await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/gameaistudio/update.json\n", "utf8");

    const service = new UpdateService({
      currentVersion: "1.4.3",
      userDataPath: userData,
      bundledEnvPath: bundled,
      isPackaged: false,
      fetch: async () => {
        throw fetchError;
      },
    });

    const info = await service.checkForUpdates();
    expect(info.status).toBe("error");
    expect(info.error).toContain("更新 manifest 下载失败");
    expect(info.error).toContain("https://updates.example.com/gameaistudio/update.json");
    expect(info.error).toContain("fetch failed");
    expect(info.error).toContain("ETIMEDOUT");
    expect(info.error).toContain("userData/update.env");
  });
});
