import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { runProcess } from "../services/process-runner";
import { resolveStudioPaths, type StudioPaths } from "../services/resource-paths";

// ── Pure executable/path helpers ───────────────────────────────────────────
// (canonical home; re-exported from cli-service.ts for existing tests)

/** Pick the most relevant executable from a `where.exe` / `command -v` output. */
export function selectExecutableFromLocatorOutput(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const candidates = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (platform !== "win32") {
    return candidates[0];
  }
  return (
    candidates.find((candidate) => /\.(?:cmd|exe|bat|com)$/i.test(candidate)) ??
    candidates[0]
  );
}

/** Candidate executable paths for `command` inside `directory` (Windows shims). */
export function cliExecutableCandidates(
  command: string,
  directory: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  const basePath = pathModule.join(directory, command);
  if (platform !== "win32" || path.extname(command)) {
    return [basePath];
  }
  return [`${basePath}.cmd`, `${basePath}.exe`, `${basePath}.bat`, basePath];
}

/** First existing executable for `command` in `directory`, if any. */
export function findExecutableInDirectory(
  command: string,
  directory?: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!directory) {
    return undefined;
  }
  return cliExecutableCandidates(command, directory, platform).find(
    (candidate) => existsSync(candidate),
  );
}

/** Global bin directory for an npm prefix. */
export function npmGlobalBinPath(
  prefix: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const normalized = prefix.trim();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return undefined;
  }
  return platform === "win32"
    ? normalized
    : `${normalized.replace(/\/+$/, "")}/bin`;
}

/**
 * The single source of truth for "what does this machine look like".
 *
 * AI adapters (and the CLI services that will become them) ask this object for
 * platform, environment variables, well-known directories, PATH/npm discovery
 * and executable lookup — they never read `process.env` / `os` / hardcoded
 * user paths directly. That keeps each adapter portable and unit-testable: a
 * test injects a fake `RuntimeEnvironment` instead of mutating global state.
 */
export interface RuntimeEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;

  /** Current user's home directory. */
  readonly homeDir: string;
  /** Documents directory (where GameAIStudio data lives by default). */
  readonly documentsDir: string;
  /** Roaming app-data directory. */
  readonly appDataDir: string;
  /** Local app-data directory. */
  readonly localAppDataDir: string;
  /** Program Files directories (Windows), most-specific first. */
  readonly programFilesDirs: string[];
  /** Parsed PATH entries. */
  readonly pathEntries: string[];

  readonly isPackaged: boolean;
  /** Bundled resource root (engine/templates). */
  readonly resourceRoot: string;
  /** User data root (projects, studio state). */
  readonly userDataRoot: string;

  /** Locate an executable on PATH (where.exe / `command -v`). */
  which(command: string): Promise<string | undefined>;
  /** Resolve the global bin directory for an npm-like install manager. */
  npmGlobalBin(npmExecutable: string): Promise<string | undefined>;
}

/**
 * Production `RuntimeEnvironment`. App/path-dependent fields are lazy getters so
 * constructing it never touches Electron's `app` (which is unavailable in unit
 * tests) — only code that actually reads a path pays that cost.
 */
export function createRuntimeEnvironment(): RuntimeEnvironment {
  const platform = process.platform;
  const env = process.env;

  let cachedPaths: StudioPaths | undefined;
  const paths = (): StudioPaths => (cachedPaths ??= resolveStudioPaths());

  const which = async (command: string): Promise<string | undefined> => {
    const locator =
      platform === "win32"
        ? { command: "where.exe", args: [command] }
        : { command: "sh", args: ["-lc", `command -v ${command}`] };
    const result = await runProcess(locator.command, locator.args, {
      timeoutMs: 3000,
    });
    return result.exitCode === 0
      ? selectExecutableFromLocatorOutput(result.stdout, platform)
      : undefined;
  };

  const npmGlobalBin = async (
    npmExecutable: string,
  ): Promise<string | undefined> => {
    const prefix = await runProcess(
      npmExecutable,
      ["config", "get", "prefix"],
      { timeoutMs: 4000 },
    );
    if (prefix.exitCode !== 0) return undefined;
    return npmGlobalBinPath(
      (prefix.stdout || prefix.stderr).trim().split(/\r?\n/)[0] ?? "",
      platform,
    );
  };

  return {
    platform,
    env,
    get homeDir() {
      return os.homedir();
    },
    get documentsDir() {
      return app.getPath("documents");
    },
    get appDataDir() {
      return app.getPath("appData");
    },
    get localAppDataDir() {
      return env["LOCALAPPDATA"] ?? app.getPath("userData");
    },
    get programFilesDirs() {
      return [
        env["ProgramW6432"],
        env["ProgramFiles"],
        env["ProgramFiles(x86)"],
      ].filter((dir): dir is string => Boolean(dir));
    },
    get pathEntries() {
      return (env["PATH"] ?? env["Path"] ?? "")
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean);
    },
    get isPackaged() {
      return app.isPackaged;
    },
    get resourceRoot() {
      return paths().resourceRoot;
    },
    get userDataRoot() {
      return paths().dataRoot;
    },
    which,
    npmGlobalBin,
  };
}
