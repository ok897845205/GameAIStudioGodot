import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
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

const MANIFEST_URL_KEY = "GAMEAISTUDIO_UPDATE_MANIFEST_URL";
const CHANNEL_KEY = "GAMEAISTUDIO_UPDATE_CHANNEL";
const ALLOW_INSECURE_KEY = "GAMEAISTUDIO_UPDATE_ALLOW_INSECURE";
const ALLOWED_ENV_KEYS = new Set([MANIFEST_URL_KEY, CHANNEL_KEY, ALLOW_INSECURE_KEY]);
const DEFAULT_CHANNEL = "stable";
const MANIFEST_TIMEOUT_MS = 20_000;
const NETWORK_ERROR_HINT = "请确认域名 DNS 指向更新服务器、服务器 443/HTTPS 证书可用，或检查 userData/update.env 中的更新地址。";

interface UpdateConfig {
  source: UpdateConfigSource;
  path?: string;
  userConfigPath: string;
  manifestUrl?: string;
  channel?: string;
  allowInsecureHttp: boolean;
  configured: boolean;
  error?: string;
}

interface UpdateManifestPackage {
  platform: string;
  arch: string;
  url: string;
  sha256: string;
  size?: number;
  fileName?: string;
  installerArgs?: string[];
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
  packages: UpdateManifestPackage[];
  nextEnv?: UpdateManifestNextEnv;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface LaunchInstallerInput {
  installerPath: string;
  installerArgs: string[];
  appExePath: string;
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
  appExePath?: string;
  flushLogs?: () => Promise<void>;
  quit?: () => void | Promise<void>;
  launchInstaller?: (input: LaunchInstallerInput) => void | Promise<void>;
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

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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
  const allowInsecureHttp = parseBooleanEnv(values[ALLOW_INSECURE_KEY]);
  if (!manifestUrl) {
    return {
      source,
      path: configPath,
      userConfigPath,
      channel,
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
      channel,
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
    channel,
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

function selectedPackageInfo(pkg: UpdateManifestPackage): UpdatePackageInfo {
  return {
    platform: pkg.platform,
    arch: pkg.arch,
    url: pkg.url,
    sha256: pkg.sha256,
    size: pkg.size,
    fileName: pkg.fileName,
  };
}

function safeInstallerFileName(rawUrl: string, version: string, platform: NodeJS.Platform): string {
  try {
    const parsed = new URL(rawUrl);
    const base = path.basename(parsed.pathname);
    if (base && base !== "/" && !base.includes("..")) return base;
  } catch {
    // Fall through to deterministic name below.
  }
  return platform === "win32" ? `GameAIStudio-Setup-${version}.exe` : `GameAIStudio-${version}`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function defaultLaunchInstaller(input: LaunchInstallerInput): void {
  if (process.platform === "win32") {
    const argsLiteral = input.installerArgs.map(powerShellQuote).join(", ");
    const command = [
      `$installer = ${powerShellQuote(input.installerPath)};`,
      `$exe = ${powerShellQuote(input.appExePath)};`,
      `$args = @(${argsLiteral});`,
      "Start-Process -FilePath $installer -ArgumentList $args -Wait;",
      "Start-Process -FilePath $exe;",
    ].join(" ");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", command],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();
    return;
  }

  const child = spawn(input.installerPath, input.installerArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
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
  private readonly appExePath: string;
  private readonly flushLogs: () => Promise<void>;
  private readonly quit: () => void | Promise<void>;
  private readonly launchInstaller: (input: LaunchInstallerInput) => void | Promise<void>;
  private readonly onEvent?: (event: UpdateEvent) => void;

  private lastInfo?: UpdateInfo;
  private lastConfig?: UpdateConfig;
  private lastManifestPackage?: UpdateManifestPackage;
  private downloadedInstallerPath?: string;

  constructor(options: UpdateServiceOptions = {}) {
    this.currentVersion = options.currentVersion ?? app.getVersion();
    this.userDataPath = options.userDataPath ?? app.getPath("userData");
    this.userConfigPath = path.join(this.userDataPath, "update.env");
    this.bundledEnvPath = options.bundledEnvPath ?? path.join(app.getAppPath(), ".env");
    this.defaultEnv = options.defaultEnv ?? {
      [MANIFEST_URL_KEY]: process.env[MANIFEST_URL_KEY],
      [CHANNEL_KEY]: process.env[CHANNEL_KEY] ?? DEFAULT_CHANNEL,
      [ALLOW_INSECURE_KEY]: process.env[ALLOW_INSECURE_KEY],
    };
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.allowInsecureLocalhost = options.allowInsecureLocalhost ?? !app.isPackaged;
    this.appExePath = options.appExePath ?? process.execPath;
    this.flushLogs = options.flushLogs ?? flushAllLogs;
    this.quit = options.quit ?? (() => app.quit());
    this.launchInstaller = options.launchInstaller ?? defaultLaunchInstaller;
    this.onEvent = options.onEvent;
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

  async checkForUpdates(): Promise<UpdateInfo> {
    const log = getAppLogger();
    const config = await this.loadConfig();
    this.lastConfig = config;
    const checking = this.baseInfo(config, config.configured ? "checking" : "not-configured");
    this.lastInfo = checking;
    this.emit("checking", "正在检查软件更新", checking);

    if (!config.configured || !config.manifestUrl) {
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

  private async checkConfiguredSource(config: UpdateConfig): Promise<UpdateInfo> {
    const log = getAppLogger();
    if (!config.manifestUrl) {
      throw new Error(config.error ?? "未配置更新服务器地址");
    }

    log.info("update", "开始下载更新 manifest", {
      manifestUrl: config.manifestUrl,
      source: config.source,
      channel: config.channel,
    });
    const manifest = await this.fetchManifest(config.manifestUrl, config.allowInsecureHttp);
    if (manifest.channel && config.channel && manifest.channel !== config.channel) {
      log.warn("update", "manifest channel 与本地配置不一致", {
        localChannel: config.channel,
        manifestChannel: manifest.channel,
      });
    }
    await this.applyNextEnv(manifest.nextEnv);
    const selectedPackage = this.selectPackage(manifest);
    const policy = classifyUpdatePolicy(this.currentVersion, manifest);
    const info: UpdateInfo = {
      ...this.baseInfo(config, policy.policy === "none" ? "idle" : "available"),
      latestVersion: manifest.latestVersion,
      policy: policy.policy,
      reason: policy.reason,
      releaseDate: manifest.releaseDate,
      releaseNotes: manifest.releaseNotes,
      package: selectedPackage ? selectedPackageInfo(selectedPackage) : undefined,
      checkedAt: this.now().toISOString(),
    };

    this.lastConfig = config;
    this.lastInfo = info;
    this.lastManifestPackage = selectedPackage;
    this.downloadedInstallerPath = undefined;
    log.info("update", "更新 manifest 解析完成", {
      currentVersion: this.currentVersion,
      latestVersion: manifest.latestVersion,
      policy: info.policy,
      reason: info.reason,
      packageUrl: selectedPackage?.url,
    });
    this.emit(info.status, policy.policy === "none" ? "当前已是最新版本" : "发现可用更新", info);
    return info;
  }

  async downloadAndInstall(): Promise<UpdateInstallResult> {
    let info = this.lastInfo;
    if (!info || info.policy === "none" || !this.lastManifestPackage) {
      info = await this.checkForUpdates();
    }
    const pkg = this.lastManifestPackage;
    if (!pkg || !info.package || info.policy === "none") {
      throw new Error("当前没有可安装的更新。");
    }
    if (!isAllowedUpdateUrl(pkg.url, this.allowInsecureLocalhost, this.lastConfig?.allowInsecureHttp)) {
      throw new Error("安装包下载地址必须使用 HTTPS；如需 IP/端口直连 HTTP，请显式设置 GAMEAISTUDIO_UPDATE_ALLOW_INSECURE=true。");
    }

    const installerPath = this.downloadedInstallerPath ?? (await this.downloadPackage(pkg, info));
    this.downloadedInstallerPath = installerPath;
    const installerArgs = pkg.installerArgs ?? (this.platform === "win32" ? ["/S"] : []);
    const installingInfo: UpdateInfo = {
      ...info,
      status: "installing",
    };
    this.lastInfo = installingInfo;
    this.emit("installing", "安装器已启动，应用即将退出", installingInfo);
    getAppLogger().info("update", "启动更新安装器", {
      installerPath,
      installerArgs,
      appExePath: this.appExePath,
    });

    await this.launchInstaller({
      installerPath,
      installerArgs,
      appExePath: this.appExePath,
    });
    await this.flushLogs();
    await this.quit();

    return {
      launched: true,
      installerPath,
      message: "安装器已启动，应用即将退出并在安装完成后重启。",
      info: installingInfo,
    };
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
    if (!Array.isArray(manifest.packages)) {
      throw new Error("更新 manifest 缺少 packages。");
    }
    for (const pkg of manifest.packages) {
      if (!pkg.platform || !pkg.arch || !pkg.url || !pkg.sha256) {
        throw new Error("更新安装包信息缺少 platform/arch/url/sha256。");
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
    return manifest as UpdateManifest;
  }

  private selectPackage(manifest: UpdateManifest): UpdateManifestPackage | undefined {
    const pkg = manifest.packages.find(
      (candidate) => candidate.platform === this.platform && candidate.arch === this.arch,
    );
    if (!pkg && compareVersions(manifest.latestVersion, this.currentVersion) > 0) {
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

  private async downloadPackage(pkg: UpdateManifestPackage, info: UpdateInfo): Promise<string> {
    const version = info.latestVersion ?? this.currentVersion;
    const downloadDir = path.join(this.userDataPath, "updates", version);
    await mkdir(downloadDir, { recursive: true });
    const fileName = pkg.fileName ?? safeInstallerFileName(pkg.url, version, this.platform);
    const installerPath = path.join(downloadDir, fileName);
    const tempPath = `${installerPath}.download`;

    const existing = await this.verifyExistingDownload(installerPath, pkg.sha256);
    if (existing) {
      getAppLogger().info("update", "复用已下载并校验通过的安装包", { installerPath });
      return installerPath;
    }

    const downloadingInfo: UpdateInfo = {
      ...info,
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: pkg.size,
    };
    this.lastInfo = downloadingInfo;
    this.emit("downloading", "正在下载更新安装包", downloadingInfo, {
      receivedBytes: 0,
      totalBytes: pkg.size,
    });
    getAppLogger().info("update", "开始下载安装包", {
      url: pkg.url,
      installerPath,
      expectedSha256: pkg.sha256,
      size: pkg.size,
    });

    await unlink(tempPath).catch(() => undefined);
    let response: Response;
    try {
      response = await this.fetchImpl(pkg.url);
    } catch (error) {
      throw new Error(formatNetworkFetchError("安装包下载", pkg.url, error));
    }
    if (!response.ok) {
      throw new Error(`安装包下载失败：HTTP ${response.status}`);
    }
    const totalBytes = Number(response.headers.get("content-length") ?? pkg.size ?? 0) || undefined;
    const hash = createHash("sha256");
    let receivedBytes = 0;
    const file = await open(tempPath, "w");
    try {
      if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer());
        hash.update(buffer);
        await file.write(buffer);
        receivedBytes = buffer.length;
      } else {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const buffer = Buffer.from(value);
          hash.update(buffer);
          await file.write(buffer);
          receivedBytes += buffer.length;
          this.emit("downloading", "正在下载更新安装包", {
            ...downloadingInfo,
            downloadedBytes: receivedBytes,
            totalBytes,
          }, {
            receivedBytes,
            totalBytes,
          });
        }
      }
    } finally {
      await file.close();
    }

    const actual = hash.digest("hex");
    if (actual.toLowerCase() !== pkg.sha256.toLowerCase()) {
      await unlink(tempPath).catch(() => undefined);
      throw new Error("安装包 sha256 校验失败。");
    }
    await unlink(installerPath).catch(() => undefined);
    await rename(tempPath, installerPath);
    getAppLogger().info("update", "安装包下载并校验完成", {
      installerPath,
      bytes: receivedBytes,
      sha256: actual,
    });
    return installerPath;
  }

  private async verifyExistingDownload(filePath: string, expectedSha256: string): Promise<boolean> {
    try {
      const file = await stat(filePath);
      if (!file.isFile()) return false;
      const content = await readFile(filePath);
      return sha256Hex(content).toLowerCase() === expectedSha256.toLowerCase();
    } catch {
      return false;
    }
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
