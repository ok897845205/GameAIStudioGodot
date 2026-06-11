import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioDirectorySettings, UpdateStudioDirectorySettingsInput } from "@gameaistudio/shared";
import { getAppLogger, resolveAppLogPath, resolveProjectLogPath } from "./logger";
import type { StudioPaths } from "./resource-paths";

const SETTINGS_KIND = "studio-directories";

interface StoredStudioSettings {
  kind?: string;
  dataRoot?: string;
  projectsRoot?: string;
  setupCompleted?: boolean;
}

export interface StudioSettingsServiceOptions {
  defaultDataRoot: string;
  settingsPath: string;
  /** App install/resource root — user directories must never live inside it. */
  resourceRoot?: string;
}

/** Is `candidate` a filesystem root (C:\, E:\, /)? Those are never valid here. */
export function isFilesystemRoot(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  return path.dirname(resolved) === resolved;
}

/** Is `candidate` equal to or inside `parent`? (case-insensitive on Windows) */
export function isInsideDirectory(candidate: string, parent: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const child = normalize(candidate);
  const base = normalize(parent);
  return child === base || child.startsWith(base + path.sep);
}

function expandDirectoryInput(value: string): string {
  let expanded = value.trim();
  if (expanded === "~" || expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }
  expanded = expanded.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match);
  expanded = expanded.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (match, name: string) => process.env[name] ?? match);
  expanded = expanded.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => process.env[name] ?? match);
  return expanded;
}

function cleanDir(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const expanded = expandDirectoryInput(trimmed);
  if (!path.isAbsolute(expanded)) {
    throw new Error(`目录必须使用绝对路径：${trimmed}`);
  }
  return path.resolve(expanded);
}

function samePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return left === right;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function copyIfSourceExistsAndTargetMissing(source: string, target: string): Promise<boolean> {
  try {
    await access(source);
  } catch {
    return false;
  }
  try {
    await access(target);
    return false;
  } catch {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    return true;
  }
}

export class StudioSettingsService {
  private settings: StoredStudioSettings = {};
  private activePaths?: StudioPaths;
  private startupFallbackActive = false;

  constructor(private readonly options: StudioSettingsServiceOptions) {}

  /**
   * Marks that the configured directories were unusable at startup and this
   * session fell back to the defaults. The stored configuration is NOT
   * touched — a transient failure (unplugged drive) must never erase it.
   */
  markStartupFallback(): void {
    this.startupFallbackActive = true;
  }

  get defaultDataRoot(): string {
    return path.resolve(this.options.defaultDataRoot);
  }

  async load(): Promise<StoredStudioSettings> {
    try {
      const raw = await readFile(this.options.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredStudioSettings>;
      this.settings = {
        kind: parsed.kind,
        dataRoot: cleanDir(parsed.dataRoot),
        projectsRoot: cleanDir(parsed.projectsRoot),
        setupCompleted: parsed.kind === SETTINGS_KIND && parsed.setupCompleted === true,
      };
    } catch {
      this.settings = { kind: SETTINGS_KIND, setupCompleted: false };
    }
    return this.settings;
  }

  getPathOverrides(): { dataRoot?: string; projectsRoot?: string } {
    return {
      dataRoot: this.settings.dataRoot,
      projectsRoot: this.settings.projectsRoot,
    };
  }

  setActivePaths(paths: StudioPaths): void {
    this.activePaths = paths;
  }

  getSettings(projectRoot?: string): StudioDirectorySettings {
    const hasConfiguredDataRoot = Boolean(this.settings.dataRoot);
    const resolvedDataRoot = this.settings.dataRoot ?? this.activePaths?.dataRoot ?? this.defaultDataRoot;
    const defaultProjectsRoot = path.join(resolvedDataRoot, "projects");
    const resolvedProjectsRoot =
      this.settings.projectsRoot ?? (hasConfiguredDataRoot ? defaultProjectsRoot : this.activePaths?.projectsRoot ?? defaultProjectsRoot);
    const setupCompleted = this.settings.kind === SETTINGS_KIND && this.settings.setupCompleted === true;
    const requiresRestart = this.activePaths
      ? !samePath(resolvedDataRoot, this.activePaths.dataRoot) || !samePath(resolvedProjectsRoot, this.activePaths.projectsRoot)
      : false;

    return {
      dataRoot: this.settings.dataRoot,
      projectsRoot: this.settings.projectsRoot,
      setupCompleted,
      setupRequired: !setupCompleted,
      settingsPath: this.options.settingsPath,
      defaultDataRoot: this.defaultDataRoot,
      defaultProjectsRoot,
      resolvedDataRoot,
      resolvedProjectsRoot,
      appLogPath: resolveAppLogPath(resolvedDataRoot),
      selectedProjectLogPath: projectRoot ? resolveProjectLogPath(projectRoot) : undefined,
      requiresRestart,
      startupFallbackActive: this.startupFallbackActive,
    };
  }

  /** Rejects directories that would corrupt the install or sweep a whole drive. */
  private validateDirectory(label: string, candidate: string): void {
    if (isFilesystemRoot(candidate)) {
      throw new Error(`${label}不能是磁盘根目录（${candidate}），请选择一个具体的文件夹。`);
    }
    if (this.options.resourceRoot && isInsideDirectory(candidate, this.options.resourceRoot)) {
      throw new Error(`${label}不能位于软件安装目录内（${this.options.resourceRoot}），以免被升级或卸载覆盖。`);
    }
  }

  async update(input: UpdateStudioDirectorySettingsInput = {}): Promise<StudioDirectorySettings> {
    const dataRoot = cleanDir(input.dataRoot);
    const projectsRoot = cleanDir(input.projectsRoot);
    if (dataRoot) this.validateDirectory("软件数据目录", dataRoot);
    if (projectsRoot) this.validateDirectory("游戏项目目录", projectsRoot);
    const candidate: StoredStudioSettings = {
      kind: SETTINGS_KIND,
      dataRoot,
      projectsRoot,
      setupCompleted: input.setupCompleted ?? this.settings.setupCompleted ?? false,
    };

    const resolvedDataRoot = dataRoot ?? this.defaultDataRoot;
    const resolvedProjectsRoot = projectsRoot ?? path.join(resolvedDataRoot, "projects");
    await mkdir(resolvedDataRoot, { recursive: true });
    await mkdir(resolvedProjectsRoot, { recursive: true });

    const stateMigrated =
      this.activePaths && !samePath(resolvedDataRoot, this.activePaths.dataRoot)
        ? await copyIfSourceExistsAndTargetMissing(
            path.join(this.activePaths.dataRoot, "studio-state.json"),
            path.join(resolvedDataRoot, "studio-state.json"),
          )
        : false;

    await mkdir(path.dirname(this.options.settingsPath), { recursive: true });
    await writeFile(this.options.settingsPath, JSON.stringify(candidate, null, 2), "utf8");

    this.settings = candidate;
    getAppLogger().info("settings", "软件目录配置已更新", {
      dataRoot: candidate.dataRoot ?? "(default)",
      projectsRoot: candidate.projectsRoot ?? "(default)",
      settingsPath: this.options.settingsPath,
      stateMigrated,
      requiresRestart: this.getSettings().requiresRestart,
    });
    return this.getSettings();
  }
}
