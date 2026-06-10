import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  UpdateService,
  classifyUpdatePolicy,
  compareVersions,
  parseUpdateEnv,
  sha256Hex,
  type UpdateServiceOptions,
} from "./update-service";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(content: Uint8Array): Response {
  const body = new ArrayBuffer(content.byteLength);
  new Uint8Array(body).set(content);
  return new Response(body, {
    status: 200,
    headers: { "content-length": String(content.length) },
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-update-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("update service", () => {
  it("parses simple update env files", () => {
    expect(
      parseUpdateEnv(`
        # comment
        GAMEAISTUDIO_UPDATE_MANIFEST_URL="https://updates.example.com/update.json"
        GAMEAISTUDIO_UPDATE_CHANNEL=stable
      `),
    ).toEqual({
      GAMEAISTUDIO_UPDATE_MANIFEST_URL: "https://updates.example.com/update.json",
      GAMEAISTUDIO_UPDATE_CHANNEL: "stable",
    });
  });

  it("compares major.minor.patch versions", () => {
    expect(compareVersions("1.4.4", "1.4.3")).toBe(1);
    expect(compareVersions("1.4.3", "1.4.3")).toBe(0);
    expect(compareVersions("1.4.3", "1.5.0")).toBe(-1);
  });

  it("classifies patch as optional and minor/major as required", () => {
    expect(classifyUpdatePolicy("1.4.3", { latestVersion: "1.4.4" })).toEqual({
      policy: "optional",
      reason: "patch",
    });
    expect(classifyUpdatePolicy("1.4.3", { latestVersion: "1.5.0" })).toEqual({
      policy: "required",
      reason: "minor",
    });
    expect(classifyUpdatePolicy("1.4.3", { latestVersion: "2.0.0" })).toEqual({
      policy: "required",
      reason: "major",
    });
    expect(classifyUpdatePolicy("1.4.3", { latestVersion: "1.4.3", force: true })).toEqual({
      policy: "required",
      reason: "force",
    });
    expect(classifyUpdatePolicy("1.4.3", { latestVersion: "1.4.3", minSupportedVersion: "1.4.4" })).toEqual({
      policy: "required",
      reason: "unsupported",
    });
  });

  it("prefers userData/update.env over bundled .env", async () =>
    withTempDir(async (dir) => {
      const userData = path.join(dir, "userData");
      const bundled = path.join(dir, ".env");
      await mkdir(userData, { recursive: true });
      await writeFile(
        path.join(userData, "update.env"),
        "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://user.example.com/update.json\n",
        "utf8",
      );
      await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://bundled.example.com/update.json\n", "utf8");

      const service = new UpdateService({
        currentVersion: "1.4.3",
        userDataPath: userData,
        bundledEnvPath: bundled,
        defaultEnv: {},
        allowInsecureLocalhost: false,
      });

      const status = await service.getStatus();
      expect(status.configSource).toBe("userData");
      expect(status.manifestUrl).toBe("https://user.example.com/update.json");
    }));

  it("falls back to bundled env when userData env is invalid", async () =>
    withTempDir(async (dir) => {
      const userData = path.join(dir, "userData");
      const bundled = path.join(dir, ".env");
      await mkdir(userData, { recursive: true });
      await writeFile(path.join(userData, "update.env"), "GAMEAISTUDIO_UPDATE_MANIFEST_URL=http://bad/update.json\n", "utf8");
      await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://bundled.example.com/update.json\n", "utf8");

      const service = new UpdateService({
        currentVersion: "1.4.3",
        userDataPath: userData,
        bundledEnvPath: bundled,
        defaultEnv: {},
        allowInsecureLocalhost: false,
      });

      const status = await service.getStatus();
      expect(status.configSource).toBe("bundled");
      expect(status.manifestUrl).toBe("https://bundled.example.com/update.json");
    }));

  it("checks manifest and writes validated nextEnv to userData", async () =>
    withTempDir(async (dir) => {
      const userData = path.join(dir, "userData");
      const bundled = path.join(dir, ".env");
      const nextEnv = "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://next.example.com/update.json\nGAMEAISTUDIO_UPDATE_CHANNEL=stable\n";
      await mkdir(userData, { recursive: true });
      await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/update.json\n", "utf8");

      const service = new UpdateService({
        currentVersion: "1.4.3",
        userDataPath: userData,
        bundledEnvPath: bundled,
        defaultEnv: {},
        platform: "win32",
        arch: "x64",
        allowInsecureLocalhost: false,
        fetch: async () =>
          jsonResponse({
            latestVersion: "1.4.4",
            packages: [
              {
                platform: "win32",
                arch: "x64",
                url: "https://cdn.example.com/GameAIStudio-Setup-1.4.4.exe",
                sha256: "abc",
                size: 123,
              },
            ],
            nextEnv: {
              content: nextEnv,
              sha256: sha256Hex(nextEnv),
            },
          }),
      });

      const info = await service.checkForUpdates();
      expect(info.policy).toBe("optional");
      expect(info.latestVersion).toBe("1.4.4");
      await expect(readFile(path.join(userData, "update.env"), "utf8")).resolves.toBe(nextEnv);
    }));

  it("downloads, verifies, and launches the selected installer", async () =>
    withTempDir(async (dir) => {
      const userData = path.join(dir, "userData");
      const bundled = path.join(dir, ".env");
      const installerBytes = new TextEncoder().encode("installer");
      const launched: Array<{ installerPath: string; installerArgs: string[]; appExePath: string }> = [];
      let quitCalled = false;
      await mkdir(userData, { recursive: true });
      await writeFile(bundled, "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/update.json\n", "utf8");

      const fetchImpl: UpdateServiceOptions["fetch"] = async (url) => {
        if (url === "https://updates.example.com/update.json") {
          return jsonResponse({
            latestVersion: "1.4.4",
            packages: [
              {
                platform: "win32",
                arch: "x64",
                url: "https://cdn.example.com/GameAIStudio-Setup-1.4.4.exe",
                sha256: sha256Hex(installerBytes),
                size: installerBytes.length,
              },
            ],
          });
        }
        return bytesResponse(installerBytes);
      };

      const service = new UpdateService({
        currentVersion: "1.4.3",
        userDataPath: userData,
        bundledEnvPath: bundled,
        defaultEnv: {},
        platform: "win32",
        arch: "x64",
        allowInsecureLocalhost: false,
        appExePath: "C:\\Program Files\\GameAIStudio\\GameAIStudio.exe",
        fetch: fetchImpl,
        flushLogs: async () => undefined,
        quit: () => {
          quitCalled = true;
        },
        launchInstaller: (input) => {
          launched.push(input);
        },
      });

      const result = await service.downloadAndInstall();
      expect(result.launched).toBe(true);
      expect(quitCalled).toBe(true);
      expect(launched).toHaveLength(1);
      expect(launched[0]?.installerArgs).toEqual(["/S"]);
      expect(launched[0]?.installerPath).toContain("GameAIStudio-Setup-1.4.4.exe");
      await expect(readFile(launched[0]!.installerPath)).resolves.toEqual(Buffer.from(installerBytes));
    }));
});
