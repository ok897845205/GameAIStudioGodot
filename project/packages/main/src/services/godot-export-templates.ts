import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Self-contained Godot data: every Godot child process (validate, import,
 * Web export, editor GUI) runs with its config/data directory redirected to
 * an app-managed folder under the studio data root, instead of the user's
 * real %APPDATA%\Godot.
 *
 * Why redirection instead of relying on the user environment:
 * - Web export needs the export templates (`web_nothreads_*.zip`), which ship
 *   separately from the editor binary. A fresh install has none in the user
 *   dir, and we must not require a download.
 * - The user's real Godot dir may be redirected, locked, missing, or contain
 *   editor settings from their own Godot installs that change headless
 *   behavior. Redirecting makes our runs deterministic in every environment
 *   and never touches (or depends on) the user's own Godot setup.
 * - On Windows, Godot resolves its config/data dir from the APPDATA
 *   environment variable of the process, so a per-child override is enough —
 *   no project files are modified.
 *
 * The bundled templates live in `engine/export_templates/<version>/` inside
 * the app resources and are copied once into the managed dir on demand.
 */

export const GODOT_TEMPLATE_VERSION = "4.6.2.stable";

const WEB_TEMPLATES = ["web_nothreads_debug.zip", "web_nothreads_release.zip"];

/** Root handed to Godot as its platform data dir (via env redirection). */
export function managedGodotDataRoot(dataRoot: string): string {
  return path.join(dataRoot, "godot-editor-data");
}

/**
 * Environment overrides that point a spawned Godot at the managed data root.
 * Windows: Godot reads APPDATA. Linux: XDG dirs. macOS resolves from HOME.
 */
export function godotSpawnEnv(dataRoot: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const managed = managedGodotDataRoot(dataRoot);
  if (platform === "win32") {
    return { APPDATA: managed };
  }
  if (platform === "darwin") {
    return { HOME: managed };
  }
  return { XDG_DATA_HOME: managed, XDG_CONFIG_HOME: managed, XDG_CACHE_HOME: managed };
}

/** Where Godot will look for export templates inside the managed root. */
export function managedTemplatesDir(dataRoot: string, platform: NodeJS.Platform = process.platform): string {
  const managed = managedGodotDataRoot(dataRoot);
  if (platform === "win32") {
    return path.join(managed, "Godot", "export_templates", GODOT_TEMPLATE_VERSION);
  }
  if (platform === "darwin") {
    return path.join(managed, "Library", "Application Support", "Godot", "export_templates", GODOT_TEMPLATE_VERSION);
  }
  return path.join(managed, "godot", "export_templates", GODOT_TEMPLATE_VERSION);
}

/** Bundled templates inside the app's engine resources. */
export function bundledExportTemplatesDir(engineRoot: string): string {
  return path.join(engineRoot, "export_templates", GODOT_TEMPLATE_VERSION);
}

/** The user's real per-user Godot templates dir — used only as a copy SOURCE fallback (dev machines). */
export function userExportTemplatesDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Godot", "export_templates", GODOT_TEMPLATE_VERSION);
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Godot", "export_templates", GODOT_TEMPLATE_VERSION);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "godot", "export_templates", GODOT_TEMPLATE_VERSION);
}

export interface WebTemplateStatus {
  /** Required Web templates are present in the managed dir (after any copy). */
  ok: boolean;
  managedDir: string;
  copied: string[];
  missing: string[];
  /** Where the copies came from this call (bundled preferred). */
  source: "bundled" | "user" | "none";
}

/**
 * Ensures the Web export templates exist in the managed dir, copying from the
 * app bundle (preferred) or, on dev machines, from the user's real Godot dir.
 * Idempotent and cheap once installed.
 */
export async function ensureWebExportTemplates(engineRoot: string | undefined, dataRoot: string): Promise<WebTemplateStatus> {
  const managedDir = managedTemplatesDir(dataRoot);
  const sources: Array<{ kind: "bundled" | "user"; dir: string }> = [
    ...(engineRoot ? [{ kind: "bundled" as const, dir: bundledExportTemplatesDir(engineRoot) }] : []),
    { kind: "user" as const, dir: userExportTemplatesDir() }
  ];

  const copied: string[] = [];
  let source: WebTemplateStatus["source"] = "none";
  for (const name of WEB_TEMPLATES) {
    const target = path.join(managedDir, name);
    if (existsSync(target)) continue;
    for (const candidate of sources) {
      const from = path.join(candidate.dir, name);
      if (!existsSync(from)) continue;
      await mkdir(managedDir, { recursive: true });
      await copyFile(from, target);
      copied.push(name);
      if (source === "none" || candidate.kind === "bundled") source = candidate.kind;
      break;
    }
  }

  const missing = WEB_TEMPLATES.filter((name) => !existsSync(path.join(managedDir, name)));
  return { ok: missing.length === 0, managedDir, copied, missing, source };
}

/** Actionable message when templates can't be made available at all. */
export function missingTemplatesMessage(engineRoot: string | undefined, status: WebTemplateStatus): string {
  const bundledDir = engineRoot ? bundledExportTemplatesDir(engineRoot) : "(engine 资源目录未找到)";
  return [
    `缺少 Godot Web 导出模板：${status.missing.join("、")}。`,
    `模板应内置在安装包中：请确认 ${bundledDir} 下存在这些 zip（重新安装最新版本可恢复）。`,
    `应用会自动把模板装入 ${status.managedDir}，无需手动下载。`
  ].join("");
}
