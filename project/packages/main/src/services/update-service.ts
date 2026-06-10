import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import type {
  ProgressInfo,
  UpdateCheckResult,
  UpdateDownloadedEvent,
  UpdateInfo as ElectronUpdateInfo,
} from "electron-updater";
import type {
  UpdateConfigSource,
  UpdateEvent,
  UpdateInfo,
  UpdateInstallResult,
  UpdatePackageInfo,
  UpdatePolicy,
  UpdateRequirementReason,
} from "@gameaistudio/shared";
import { flushAllLogs, getAppLogger } from "./logger";

const electronUpdaterRequire = createRequire(import.meta.url);

const MANIFEST_URL_KEY = "GAMEAISTUDIO_UPDATE_MANIFEST_URL";
const CHANNEL_KEY = "GAMEAISTUDIO_UPDATE_CHANNEL";
const ALLOW_INSECURE_KEY = "GAMEAISTUDIO_UPDATE_ALLOW_INSECURE";
const ALLOWED_ENV_KEYS = new Set([MANIFEST_URL_KEY, CHANNEL_KEY, ALLOW_INSECURE_KEY]);
const DEFAULT_CHANNEL = "stable";
const MANIFEST_TIMEOUT_MS = 20_000;
const NETWORK_ERROR_HINT = "请确认更新服务器可访问，或检查 userData/update.env 中的更新地址。";

interface UpdateConfig {
  source: UpdateConfigSource;
  path?: string;
  userConfigPath: string;
  manifestUrl?: string;
  feedUrl?: string;
  channel?: string;
  updaterChannel: string;
  allowInsecureHttp: boolean;
  configured: boolean;
  error?: string;
}

interface UpdateManifestPackage {
  platform: string;
  arch: string;
  url: string;
  sha256?: string;
  sha512?: string;
  size?: number;
  fileName?: string;
}

interface UpdateManifestNextEnv {
  content: string;
  sha256: string;
  effective?: "nextLaunch" | "immediate";
}

interface UpdateManifest {
  appId?: string;
  channel?: string;
  latestVersion: string;
  minSupportedVersion?: string;
  releaseDate?: string;
  releaseNotes?: string;
  force?: boolean;
  packages?: UpdateManifestPackage[];
  nextEnv?: UpdateManifestNextEnv;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface StandardUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall?: boolean;
  allowDowngrade?: boolean;
  channel: string | null;
  logger?: { info(message?: unknown): void; warn(message?: unknown): void; error(message?: unknown): void; debug?(message?: string): void } | null;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface UpdateServiceOptions {
  currentVersion?: string;
  userDataPath?: string;
  bundledEnvPath?: string;
  defaultEnv?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: FetchLike;
  now?: () => Date;
  allowInsecureLocalhost?: boolean;
  isPackaged?: boolean;
  updater?: StandardUpdaterLike;
  flushLogs?: () => Promise<void>;
  prepareQuitAndInstall?: () => void | Promise<void>;
  onEvent?: (event: UpdateEvent) => void;
}

export function parseUpdateEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return 0;
}

export function classifyUpdatePolicy(
  currentVersion: string,
  manifest: Pick<UpdateManifest, "latestVersion" | "minSupportedVersion" | "force">,
): { policy: UpdatePolicy; reason: UpdateRequirementReason } {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(manifest.latestVersion);

  if (manifest.minSupportedVersion && compareVersions(currentVersion, manifest.minSupportedVersion) < 0) {
    return { policy: "required", reason: "unsupported" };
  }
  if (manifest.force) {
    return { policy: "required", reason: "force" };
  }
  if (compareVersions(manifest.latestVersion, currentVersion) <= 0) {
    return { policy: "none", reason: "none" };
  }
  if (latest.major > current.major) return { policy: "required", reason: "major" };
  if (latest.minor > current.minor) return { policy: "required", reason: "minor" };
  return { policy: "optional", reason: "patch" };
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function inferUpdateFeedUrl(manifestUrl: string): string {
  const url = new URL(manifestUrl);
  if (/\/(?:update\.json|latest\.ya?ml|[\w.-]+\.ya?ml)$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/(?:update\.json|latest\.ya?ml|[\w.-]+\.ya?ml)$/i, "");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) {
    throw new Error(`版本号格式无效：${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function electronAppIsPackaged(): boolean {
  return Boolean((app as { isPackaged?: boolean } | undefined)?.isPackaged);
}

function electronAppVersion(): string {
  const electronApp = app as { getVersion?: () => string } | undefined;
  return electronApp?.getVersion ? electronApp.getVersion() : "0.0.0";
}

function electronAppPath(name: "userData"): string {
  const electronApp = app as { getPath?: (pathName: "userData") => string } | undefined;
  if (!electronApp?.getPath) {
    throw new Error(`Electron app.getPath(${name}) 不可用。`);
  }
  return electronApp.getPath(name);
}

function electronAppRootPath(): string {
  const electronApp = app as { getAppPath?: () => string } | undefined;
  if (!electronApp?.getAppPath) {
    throw new Error("Electron app.getAppPath() 不可用。");
  }
  return electronApp.getAppPath();
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function updaterChannelFromConfig(channel: string | undefined): string {
  const normalized = channel?.trim();
  if (!normalized || normalized === DEFAULT_CHANNEL) return "latest";
  return normalized;
}

function isAllowedUpdateUrl(
  rawUrl: string,
  allowInsecureLocalhost: boolean,
  allowInsecureHttp = false,
): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:") return true;
    if (allowInsecureHttp && url.protocol === "http:") return true;
    if (
      allowInsecureLocalhost &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function errorDetail(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { name?: unknown; message?: unknown; code?: unknown };
  const parts: string[] = [];
  if (typeof value.name === "string" && value.name && value.name !== "Error") parts.push(value.name);
  if (typeof value.message === "string" && value.message) parts.push(value.message);
  if (typeof value.code === "string" && value.code) parts.push(value.code);
  return parts.length > 0 ? parts.join(" · ") : String(error);
}

function errorCause(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("cause" in error)) return undefined;
  return (error as { cause?: unknown }).cause;
}

function formatNetworkFetchError(action: string, url: string, error: unknown): string {
  const details: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const detail = errorDetail(current);
    if (detail && !details.includes(detail)) details.push(detail);
    current = errorCause(current);
  }
  const reason = details.length > 0 ? `原因：${details.join("；")}` : "原因：网络请求失败";
  return `${action}失败：无法访问 ${url}。${reason}。${NETWORK_ERROR_HINT}`;
}

function envToConfig(
  values: Record<string, string | undefined>,
  source: UpdateConfigSource,
  userConfigPath: string,
  configPath: string | undefined,
  allowInsecureLocalhost: boolean,
): UpdateConfig {
  const manifestUrl = values[MANIFEST_URL_KEY]?.trim();
  const channel = values[CHANNEL_KEY]?.trim() || DEFAULT_CHANNEL;
  const updaterChannel = updaterChannelFromConfig(channel);
  const allowInsecureHttp = parseBooleanEnv(values[ALLOW_INSECURE_KEY]);
  if (!manifestUrl) {
    return {
      source,
      path: configPath,
      userConfigPath,
      channel,
      updaterChannel,
      allowInsecureHttp,
      configured: false,
      error: `${MANIFEST_URL_KEY} 未配置`,
    };
  }
  if (!isAllowedUpdateUrl(manifestUrl, allowInsecureLocalhost, allowInsecureHttp)) {
    return {
      source,
      path: configPath,
      userConfigPath,
      manifestUrl,
      feedUrl: undefined,
      channel,
      updaterChannel,
      allowInsecureHttp,
      configured: false,
      error: "更新地址必须使用 HTTPS；如需 IP/端口直连 HTTP，请显式设置 GAMEAISTUDIO_UPDATE_ALLOW_INSECURE=true",
    };
  }
  return {
    source,
    path: configPath,
    userConfigPath,
    manifestUrl,
    feedUrl: inferUpdateFeedUrl(manifestUrl),
    channel,
    updaterChannel,
    allowInsecureHttp,
    configured: true,
  };
}

function validateNextEnvContent(content: string, allowInsecureLocalhost: boolean): void {
  const values = parseUpdateEnv(content);
  for (const key of Object.keys(values)) {
    if (!ALLOWED_ENV_KEYS.has(key)) {
      throw new Error(`服务器下发的 update.env 包含不允许的字段：${key}`);
    }
  }
  const config = envToConfig(values, "userData", "", undefined, allowInsecureLocalhost);
  if (!config.configured) {
    throw new Error(config.error ?? "服务器下发的 update.env 无效");
  }
}

function releaseNotesToText(releaseNotes: ElectronUpdateInfo["releaseNotes"]): string | undefined {
  if (!releaseNotes) return undefined;
  if (typeof releaseNotes === "string") return releaseNotes;
  return releaseNotes
    .map((item) => [item.version, item.note].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

function selectedPackageInfo(pkg: UpdateManifestPackage): UpdatePackageInfo {
  return {
    platform: pkg.platform,
    arch: pkg.arch,
    url: pkg.url,
    sha256: pkg.sha256,
    sha512: pkg.sha512,
    size: pkg.size,
    fileName: pkg.fileName,
  };
}

function electronPackageInfo(
  info: ElectronUpdateInfo | undefined,
  feedUrl: string | undefined,
  platform: NodeJS.Platform,
  arch: string,
): UpdatePackageInfo | undefined {
  const file = info?.files?.[0];
  const rawUrl = file?.url ?? info?.path;
  if (!rawUrl) return undefined;
  const url = feedUrl ? new URL(rawUrl, `${feedUrl.replace(/\/$/, "")}/`).toString() : rawUrl;
  let fileName: string | undefined;
  try {
    fileName = path.basename(new URL(url).pathname);
  } catch {
    fileName = path.basename(rawUrl);
  }
  return {
    platform,
    arch,
    url,
    sha512: file?.sha512 ?? info?.sha512,
    size: file?.size,
    fileName,
  };
}

function createUpdaterLogger() {
  const write = (level: "info" | "warn" | "error", message?: unknown): void => {
    const text = typeof message === "string" ? message : JSON.stringify(message);
    getAppLogger()[level]("electron-updater", text ?? "");
  };
  return {
    info: (message?: unknown) => write("info", message),
    warn: (message?: unknown) => write("warn", message),
    error: (message?: unknown) => write("error", message),
    debug: (message?: string) => getAppLogger().info("electron-updater", message ?? ""),
  };
}

function createNoopUpdater(): StandardUpdaterLike {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    allowDowngrade: false,
    channel: null,
    logger: null,
    setFeedURL: () => undefined,
    checkForUpdates: async () => null,
    downloadUpdate: async () => {
      throw new Error("开发模式不会下载更新。");
    },
    quitAndInstall: () => undefined,
    on: () => undefined,
  };
}

function getElectronAutoUpdater(): StandardUpdaterLike {
  const electronUpdater = electronUpdaterRequire("electron-updater") as typeof import("electron-updater");
  return electronUpdater.autoUpdater as unknown as StandardUpdaterLike;
}

export class UpdateService {
  private readonly currentVersion: string;
  private readonly userDataPath: string;
  private readonly userConfigPath: string;
  private readonly bundledEnvPath: string;
  private readonly defaultEnv: Record<string, string | undefined>;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly allowInsecureLocalhost: boolean;
  private readonly isPackaged: boolean;
  private readonly updater: StandardUpdaterLike;
  private readonly flushLogs: () => Promise<void>;
  private readonly prepareQuitAndInstall: () => void | Promise<void>;
  private readonly onEvent?: (event: UpdateEvent) => void;

  private lastInfo?: UpdateInfo;
  private lastConfig?: UpdateConfig;
  private lastElectronInfo?: ElectronUpdateInfo;
  private hasAvailableElectronUpdate = false;

  constructor(options: UpdateServiceOptions = {}) {
    this.currentVersion = options.currentVersion ?? electronAppVersion();
    this.userDataPath = options.userDataPath ?? electronAppPath("userData");
    this.userConfigPath = path.join(this.userDataPath, "update.env");
    this.bundledEnvPath = options.bundledEnvPath ?? path.join(electronAppRootPath(), ".env");
    this.defaultEnv = options.defaultEnv ?? {
      [MANIFEST_URL_KEY]: process.env[MANIFEST_URL_KEY],
      [CHANNEL_KEY]: process.env[CHANNEL_KEY] ?? DEFAULT_CHANNEL,
      [ALLOW_INSECURE_KEY]: process.env[ALLOW_INSECURE_KEY],
    };
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.isPackaged = options.isPackaged ?? electronAppIsPackaged();
    this.allowInsecureLocalhost = options.allowInsecureLocalhost ?? !this.isPackaged;
    this.updater = options.updater ?? (this.isPackaged ? getElectronAutoUpdater() : createNoopUpdater());
    this.flushLogs = options.flushLogs ?? flushAllLogs;
    this.prepareQuitAndInstall = options.prepareQuitAndInstall ?? (() => undefined);
    this.onEvent = options.onEvent;

    this.configureUpdaterDefaults();
    this.bindUpdaterEvents();
  }

  async getStatus(): Promise<UpdateInfo> {
    if (this.lastInfo) return this.lastInfo;
    const config = await this.loadConfig();
    this.lastConfig = config;
    const info = this.baseInfo(config, config.configured ? "idle" : "not-configured");
    if (config.error) info.error = config.error;
    this.lastInfo = info;
    return info;
  }

  isDownloadOrInstallInProgress(): boolean {
    return this.lastInfo?.status === "downloading" || this.lastInfo?.status === "installing";
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    const log = getAppLogger();
    const config = await this.loadConfig();
    this.lastConfig = config;
    const checking = this.baseInfo(config, config.configured ? "checking" : "not-configured");
    this.lastInfo = checking;
    this.emit("checking", "正在检查软件更新", checking);

    if (!config.configured || !config.manifestUrl || !config.feedUrl) {
      const info = {
        ...checking,
        status: "not-configured" as const,
        error: config.error ?? "未配置更新服务器地址",
      };
      this.lastInfo = info;
      log.warn("update", "更新检查跳过：未配置更新源", {
        source: config.source,
        path: config.path,
        error: info.error,
      });
      this.emit("not-configured", "未配置更新服务器地址", info);
      return info;
    }

    try {
      return await this.checkConfiguredSource(config);
    } catch (error) {
      if (config.source === "userData") {
        const fallback = await this.loadConfig({ skipUserData: true });
        if (fallback.configured && fallback.manifestUrl && fallback.manifestUrl !== config.manifestUrl) {
          log.warn("update", "userData 更新源检查失败，尝试回退内置更新源", {
            userManifestUrl: config.manifestUrl,
            fallbackManifestUrl: fallback.manifestUrl,
            error,
          });
          const fallbackChecking = this.baseInfo(fallback, "checking");
          this.lastConfig = fallback;
          this.lastInfo = fallbackChecking;
          this.emit("checking", "用户目录更新源失败，正在尝试内置更新源", fallbackChecking);
          try {
            return await this.checkConfiguredSource(fallback);
          } catch (fallbackError) {
            const info: UpdateInfo = {
              ...fallbackChecking,
              status: "error",
              error: `用户目录更新源失败：${error instanceof Error ? error.message : String(error)}；内置更新源也失败：${
                fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
              }`,
              checkedAt: this.now().toISOString(),
            };
            this.lastInfo = info;
            log.error("update", "更新检查失败：userData 与内置更新源均失败", { error, fallbackError });
            this.emit("error", "更新检查失败", info);
            return info;
          }
        }
      }

      const info: UpdateInfo = {
        ...checking,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: this.now().toISOString(),
      };
      this.lastInfo = info;
      log.error("update", "更新检查失败", { error });
      this.emit("error", "更新检查失败", info);
      return info;
    }
  }

  async downloadAndInstall(): Promise<UpdateInstallResult> {
    let info = this.lastInfo;
    if (!info || info.policy === "none" || !this.hasAvailableElectronUpdate) {
      info = await this.checkForUpdates();
    }
    if (!this.isPackaged) {
      throw new Error("开发模式不会执行安装。请在打包后的应用中测试更新。");
    }
    if (!info || info.policy === "none" || !this.hasAvailableElectronUpdate) {
      throw new Error("当前没有可安装的更新。");
    }

    const downloadingInfo: UpdateInfo = {
      ...info,
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: info.package?.size,
    };
    this.lastInfo = downloadingInfo;
    this.emit("downloading", "正在下载更新安装包", downloadingInfo, {
      receivedBytes: 0,
      totalBytes: info.package?.size,
    });

    try {
      getAppLogger().info("update", "开始通过 electron-updater 下载更新", {
        currentVersion: this.currentVersion,
        latestVersion: info.latestVersion,
        feedUrl: this.lastConfig?.feedUrl,
        channel: this.lastConfig?.updaterChannel,
      });
      const downloadedPaths = await this.updater.downloadUpdate();
      const installerPath = downloadedPaths[0];
      const installingInfo: UpdateInfo = {
        ...(this.lastInfo ?? info),
        status: "installing",
      };
      this.lastInfo = installingInfo;
      this.emit("installing", "更新已下载，正在安装并重启", installingInfo);
      getAppLogger().info("update", "更新已下载，调用 electron-updater quitAndInstall", {
        installerPath,
        downloadedPaths,
        latestVersion: installingInfo.latestVersion,
      });

      await this.flushLogs();
      await this.prepareQuitAndInstall();
      this.updater.quitAndInstall(true, true);

      return {
        launched: true,
        installerPath,
        message: "更新已下载，正在安装并重启。",
        info: installingInfo,
      };
    } catch (error) {
      const errorInfo: UpdateInfo = {
        ...info,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: this.now().toISOString(),
      };
      this.lastInfo = errorInfo;
      this.emit("error", "更新安装失败", errorInfo);
      throw error;
    }
  }

  private configureUpdaterDefaults(): void {
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.autoRunAppAfterInstall = true;
    this.updater.allowDowngrade = false;
    this.updater.logger = createUpdaterLogger();
  }

  private bindUpdaterEvents(): void {
    this.updater.on("checking-for-update", () => {
      const info = this.lastConfig ? this.baseInfo(this.lastConfig, "checking") : this.lastInfo;
      if (info) {
        this.lastInfo = info;
        this.emit("checking", "正在检查软件更新", info);
      }
    });
    this.updater.on("update-available", (electronInfo: ElectronUpdateInfo) => {
      this.lastElectronInfo = electronInfo;
      this.hasAvailableElectronUpdate = true;
      const info = this.infoFromElectronUpdate(electronInfo, "available");
      this.lastInfo = info;
      this.emit("available", "发现可用更新", info);
    });
    this.updater.on("update-not-available", (electronInfo: ElectronUpdateInfo) => {
      this.lastElectronInfo = electronInfo;
      this.hasAvailableElectronUpdate = false;
      const info = this.infoFromElectronUpdate(electronInfo, "idle");
      this.lastInfo = info;
      this.emit("idle", "当前已是最新版本", info);
    });
    this.updater.on("download-progress", (progress: ProgressInfo) => {
      const info: UpdateInfo = {
        ...(this.lastInfo ?? this.infoFromElectronUpdate(this.lastElectronInfo, "downloading")),
        status: "downloading",
        downloadedBytes: progress.transferred,
        totalBytes: progress.total,
      };
      this.lastInfo = info;
      this.emit("downloading", "正在下载更新安装包", info, {
        receivedBytes: progress.transferred,
        totalBytes: progress.total,
      });
    });
    this.updater.on("update-downloaded", (event: UpdateDownloadedEvent) => {
      this.lastElectronInfo = event;
      const info: UpdateInfo = {
        ...this.infoFromElectronUpdate(event, "downloading"),
        downloadedBytes: event.files?.[0]?.size,
        totalBytes: event.files?.[0]?.size,
      };
      this.lastInfo = info;
      this.emit("downloading", "更新安装包已下载", info, {
        receivedBytes: info.downloadedBytes,
        totalBytes: info.totalBytes,
      });
    });
    this.updater.on("error", (error: Error) => {
      const base = this.lastInfo ?? (this.lastConfig ? this.baseInfo(this.lastConfig, "error") : undefined);
      if (!base) return;
      const info: UpdateInfo = {
        ...base,
        status: "error",
        error: error.message,
        checkedAt: this.now().toISOString(),
      };
      this.lastInfo = info;
      this.emit("error", "更新失败", info);
    });
  }

  private async checkConfiguredSource(config: UpdateConfig): Promise<UpdateInfo> {
    const log = getAppLogger();
    if (!config.manifestUrl || !config.feedUrl) {
      throw new Error(config.error ?? "未配置更新服务器地址");
    }

    log.info("update", "开始检查更新", {
      manifestUrl: config.manifestUrl,
      feedUrl: config.feedUrl,
      source: config.source,
      channel: config.channel,
      updaterChannel: config.updaterChannel,
      packaged: this.isPackaged,
    });

    const manifest = await this.fetchOptionalManifest(config);
    const selectedPackage = manifest ? this.selectPackage(manifest) : undefined;
    const manifestPolicy = manifest ? classifyUpdatePolicy(this.currentVersion, manifest) : undefined;

    if (!this.isPackaged) {
      if (!manifest || !manifestPolicy) {
        throw new Error("开发模式需要可读取的 update.json 元数据；打包后应用会使用 latest.yml 执行标准更新。");
      }
      const info = this.infoFromManifest(config, manifest, selectedPackage, manifestPolicy);
      this.lastInfo = info;
      this.hasAvailableElectronUpdate = info.policy !== "none";
      this.emit(info.status, manifestPolicy.policy === "none" ? "当前已是最新版本" : "发现可用更新", info);
      return info;
    }

    this.configureFeed(config);
    const result = await this.updater.checkForUpdates();
    const electronInfo = result?.updateInfo;
    this.lastElectronInfo = electronInfo;
    this.hasAvailableElectronUpdate = Boolean(result?.isUpdateAvailable);
    const info = manifest && manifestPolicy
      ? this.infoFromManifestAndElectron(config, manifest, selectedPackage, manifestPolicy, electronInfo, result)
      : this.infoFromElectronResult(config, electronInfo, result);
    this.lastInfo = info;
    log.info("update", "更新检查完成", {
      currentVersion: this.currentVersion,
      latestVersion: info.latestVersion,
      policy: info.policy,
      reason: info.reason,
      feedUrl: config.feedUrl,
      electronUpdateAvailable: result?.isUpdateAvailable ?? false,
      packageUrl: info.package?.url,
    });
    this.emit(info.status, info.policy === "none" ? "当前已是最新版本" : "发现可用更新", info);
    return info;
  }

  private async fetchOptionalManifest(config: UpdateConfig): Promise<UpdateManifest | undefined> {
    if (!config.manifestUrl) return undefined;
    try {
      const manifest = await this.fetchManifest(config.manifestUrl, config.allowInsecureHttp);
      if (manifest.channel && config.channel && manifest.channel !== config.channel) {
        getAppLogger().warn("update", "update.json channel 与本地配置不一致", {
          localChannel: config.channel,
          manifestChannel: manifest.channel,
        });
      }
      await this.applyNextEnv(manifest.nextEnv);
      return manifest;
    } catch (error) {
      if (!this.isPackaged) {
        throw error;
      }
      getAppLogger().warn("update", "update.json 元数据读取失败，继续使用 latest.yml 标准更新清单", {
        manifestUrl: config.manifestUrl,
        error,
      });
      return undefined;
    }
  }

  private configureFeed(config: UpdateConfig): void {
    if (!config.feedUrl) return;
    this.updater.channel = config.updaterChannel;
    this.updater.allowDowngrade = false;
    this.updater.setFeedURL({
      provider: "generic",
      url: config.feedUrl,
    });
  }

  private async loadConfig(options: { skipUserData?: boolean } = {}): Promise<UpdateConfig> {
    if (!options.skipUserData) {
      const user = await this.tryReadEnvConfig("userData", this.userConfigPath);
      if (user?.configured) return user;
      if (user?.error) {
        getAppLogger().warn("update", "userData update.env 无效，回退内置配置", {
          path: this.userConfigPath,
          error: user.error,
        });
      }
    }

    const bundled = await this.tryReadEnvConfig("bundled", this.bundledEnvPath);
    if (bundled?.configured) return bundled;
    if (bundled?.error) {
      getAppLogger().warn("update", "内置 .env 无效，回退默认配置", {
        path: this.bundledEnvPath,
        error: bundled.error,
      });
    }

    return envToConfig(
      this.defaultEnv,
      this.defaultEnv[MANIFEST_URL_KEY] ? "default" : "missing",
      this.userConfigPath,
      undefined,
      this.allowInsecureLocalhost,
    );
  }

  private async tryReadEnvConfig(source: UpdateConfigSource, filePath: string): Promise<UpdateConfig | undefined> {
    try {
      const content = await readFile(filePath, "utf8");
      return envToConfig(parseUpdateEnv(content), source, this.userConfigPath, filePath, this.allowInsecureLocalhost);
    } catch {
      return undefined;
    }
  }

  private baseInfo(config: UpdateConfig, status: UpdateInfo["status"]): UpdateInfo {
    return {
      currentVersion: this.currentVersion,
      status,
      policy: "none",
      reason: "none",
      configured: config.configured,
      configSource: config.source,
      configPath: config.path,
      userConfigPath: config.userConfigPath,
      manifestUrl: config.manifestUrl,
      channel: config.channel,
    };
  }

  private infoFromManifest(
    config: UpdateConfig,
    manifest: UpdateManifest,
    selectedPackage: UpdateManifestPackage | undefined,
    policy: { policy: UpdatePolicy; reason: UpdateRequirementReason },
  ): UpdateInfo {
    return {
      ...this.baseInfo(config, policy.policy === "none" ? "idle" : "available"),
      latestVersion: manifest.latestVersion,
      policy: policy.policy,
      reason: policy.reason,
      releaseDate: manifest.releaseDate,
      releaseNotes: manifest.releaseNotes,
      package: selectedPackage ? selectedPackageInfo(selectedPackage) : undefined,
      checkedAt: this.now().toISOString(),
    };
  }

  private infoFromManifestAndElectron(
    config: UpdateConfig,
    manifest: UpdateManifest,
    selectedPackage: UpdateManifestPackage | undefined,
    manifestPolicy: { policy: UpdatePolicy; reason: UpdateRequirementReason },
    electronInfo: ElectronUpdateInfo | undefined,
    result: UpdateCheckResult | null,
  ): UpdateInfo {
    const latestVersion = electronInfo?.version ?? manifest.latestVersion;
    const policy =
      latestVersion === manifest.latestVersion
        ? manifestPolicy
        : classifyUpdatePolicy(this.currentVersion, { latestVersion });
    const effectivePolicy =
      result?.isUpdateAvailable === false
        ? ({ policy: "none", reason: "none" } as const)
        : policy;
    return {
      ...this.baseInfo(config, effectivePolicy.policy === "none" ? "idle" : "available"),
      latestVersion,
      policy: effectivePolicy.policy,
      reason: effectivePolicy.reason,
      releaseDate: electronInfo?.releaseDate ?? manifest.releaseDate,
      releaseNotes: manifest.releaseNotes ?? releaseNotesToText(electronInfo?.releaseNotes),
      package:
        selectedPackage
          ? selectedPackageInfo(selectedPackage)
          : electronPackageInfo(electronInfo, config.feedUrl, this.platform, this.arch),
      checkedAt: this.now().toISOString(),
    };
  }

  private infoFromElectronResult(
    config: UpdateConfig,
    electronInfo: ElectronUpdateInfo | undefined,
    result: UpdateCheckResult | null,
  ): UpdateInfo {
    const latestVersion = electronInfo?.version ?? this.currentVersion;
    const policy = result?.isUpdateAvailable
      ? classifyUpdatePolicy(this.currentVersion, { latestVersion })
      : ({ policy: "none", reason: "none" } as const);
    return {
      ...this.baseInfo(config, policy.policy === "none" ? "idle" : "available"),
      latestVersion,
      policy: policy.policy,
      reason: policy.reason,
      releaseDate: electronInfo?.releaseDate,
      releaseNotes: releaseNotesToText(electronInfo?.releaseNotes),
      package: electronPackageInfo(electronInfo, config.feedUrl, this.platform, this.arch),
      checkedAt: this.now().toISOString(),
    };
  }

  private infoFromElectronUpdate(
    electronInfo: ElectronUpdateInfo | undefined,
    status: UpdateInfo["status"],
  ): UpdateInfo {
    const config =
      this.lastConfig ??
      envToConfig(this.defaultEnv, "default", this.userConfigPath, undefined, this.allowInsecureLocalhost);
    const latestVersion = electronInfo?.version ?? this.currentVersion;
    const policy = classifyUpdatePolicy(this.currentVersion, { latestVersion });
    return {
      ...this.baseInfo(config, status),
      latestVersion,
      policy: status === "idle" ? "none" : policy.policy,
      reason: status === "idle" ? "none" : policy.reason,
      releaseDate: electronInfo?.releaseDate,
      releaseNotes: releaseNotesToText(electronInfo?.releaseNotes),
      package: electronPackageInfo(electronInfo, config.feedUrl, this.platform, this.arch),
      checkedAt: this.now().toISOString(),
    };
  }

  private async fetchManifest(manifestUrl: string, allowInsecureHttp: boolean): Promise<UpdateManifest> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(manifestUrl, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
      } catch (error) {
        throw new Error(formatNetworkFetchError("更新 manifest 下载", manifestUrl, error));
      }
      if (!response.ok) {
        throw new Error(`更新 manifest 下载失败：HTTP ${response.status}`);
      }
      const payload = (await response.json()) as unknown;
      return this.parseManifest(payload, allowInsecureHttp);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseManifest(payload: unknown, allowInsecureHttp: boolean): UpdateManifest {
    if (!payload || typeof payload !== "object") {
      throw new Error("更新 manifest 格式无效。");
    }
    const manifest = payload as Partial<UpdateManifest>;
    if (!manifest.latestVersion || typeof manifest.latestVersion !== "string") {
      throw new Error("更新 manifest 缺少 latestVersion。");
    }
    parseVersion(manifest.latestVersion);
    if (manifest.minSupportedVersion) parseVersion(manifest.minSupportedVersion);
    if (manifest.packages !== undefined && !Array.isArray(manifest.packages)) {
      throw new Error("更新 manifest 的 packages 必须是数组。");
    }
    for (const pkg of manifest.packages ?? []) {
      if (!pkg.platform || !pkg.arch || !pkg.url || (!pkg.sha256 && !pkg.sha512)) {
        throw new Error("更新安装包信息缺少 platform/arch/url/sha256 或 sha512。");
      }
      if (!isAllowedUpdateUrl(pkg.url, this.allowInsecureLocalhost, allowInsecureHttp)) {
        throw new Error("更新安装包地址必须使用 HTTPS；如需 IP/端口直连 HTTP，请显式设置 GAMEAISTUDIO_UPDATE_ALLOW_INSECURE=true。");
      }
    }
    if (manifest.nextEnv) {
      if (!manifest.nextEnv.content || !manifest.nextEnv.sha256) {
        throw new Error("nextEnv 缺少 content 或 sha256。");
      }
    }
    return {
      ...manifest,
      packages: manifest.packages ?? [],
    } as UpdateManifest;
  }

  private selectPackage(manifest: UpdateManifest): UpdateManifestPackage | undefined {
    const pkg = (manifest.packages ?? []).find(
      (candidate) => candidate.platform === this.platform && candidate.arch === this.arch,
    );
    if (!pkg && (manifest.packages?.length ?? 0) > 0 && compareVersions(manifest.latestVersion, this.currentVersion) > 0) {
      throw new Error(`没有适用于 ${this.platform}/${this.arch} 的更新安装包。`);
    }
    return pkg;
  }

  private async applyNextEnv(nextEnv: UpdateManifestNextEnv | undefined): Promise<void> {
    if (!nextEnv) return;
    const actual = sha256Hex(nextEnv.content);
    if (actual.toLowerCase() !== nextEnv.sha256.toLowerCase()) {
      throw new Error("服务器下发的 update.env sha256 校验失败。");
    }
    validateNextEnvContent(nextEnv.content, this.allowInsecureLocalhost);
    await mkdir(path.dirname(this.userConfigPath), { recursive: true });
    const tempPath = `${this.userConfigPath}.tmp`;
    await writeFile(tempPath, nextEnv.content, "utf8");
    await rm(this.userConfigPath, { force: true });
    await rename(tempPath, this.userConfigPath);
    getAppLogger().info("update", "已写入 userData/update.env", {
      path: this.userConfigPath,
      effective: nextEnv.effective ?? "nextLaunch",
    });
  }

  private emit(
    status: UpdateEvent["status"],
    message: string,
    info: UpdateInfo,
    progress?: Pick<UpdateEvent, "receivedBytes" | "totalBytes">,
  ): void {
    const percent =
      progress?.receivedBytes !== undefined && progress.totalBytes
        ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
        : undefined;
    this.onEvent?.({
      status,
      message,
      info,
      receivedBytes: progress?.receivedBytes,
      totalBytes: progress?.totalBytes,
      percent,
      updatedAt: this.now().toISOString(),
    });
  }
}
