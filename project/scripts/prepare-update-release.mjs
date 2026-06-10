#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const envPath = path.join(projectRoot, ".env");
const defaultNotesPath = path.join(projectRoot, "release-notes.md");
const serverRoot = path.join(workspaceRoot, "server", "gameaistudio");
const releasesDir = path.join(serverRoot, "releases");
const updateJsonPath = path.join(serverRoot, "update.json");
const DEFAULT_RELEASE_SSH_HOST = "tencent-clawdbot";
const DEFAULT_RELEASE_REMOTE_DIR = "/var/www/gameaistudio";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function printUsage() {
  console.log(`
用法：
  pnpm release:update                  默认 patch，可选更新
  pnpm release:update:patch            patch，可选更新
  pnpm release:update:minor            minor，强制更新
  pnpm release:update:major            major，强制更新
  pnpm release:update:version -- 1.2.3  精确版本，按版本差异判断是否强制

常用参数：
  --dry-run                 只打印计划，不写文件、不打包
  --skip-build              跳过 pnpm dist:win，复用 dist 中已有安装包
  --upload                  生成后上传到服务器
  --no-upload               只生成本地 server 目录，不上传
  --ssh-host <host>         SSH 主机，默认 tencent-clawdbot
  --remote-dir <path>       服务器目录，默认 /var/www/gameaistudio
  --server-url <url>        静态更新服务根地址，默认从 .env 推断
  --channel <name>          更新通道，默认读取 GAMEAISTUDIO_UPDATE_CHANNEL
  --notes <text>            更新说明
  --notes-file <path>       从文件读取更新说明
                           如果未传 --notes/--notes-file，会自动读取 project/release-notes.md
  --required                强制更新，覆盖默认策略
  --optional                可选更新，覆盖默认策略
  --min-supported <version> 设置 minSupportedVersion
  --next-env <path>         把指定 .env 写入 manifest.nextEnv
  --no-next-env             不写 manifest.nextEnv
`);
}

function parseArgs(argv) {
  const options = {
    mode: "patch",
    dryRun: false,
    skipBuild: false,
    upload: false,
    sshHost: process.env.GAMEAISTUDIO_RELEASE_SSH_HOST ?? DEFAULT_RELEASE_SSH_HOST,
    remoteDir: process.env.GAMEAISTUDIO_RELEASE_REMOTE_DIR ?? DEFAULT_RELEASE_REMOTE_DIR,
    serverUrl: undefined,
    channel: undefined,
    notes: undefined,
    notesFile: undefined,
    policyOverride: undefined,
    minSupportedVersion: undefined,
    nextEnvPath: envPath,
    includeNextEnv: true,
  };

  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (arg === "--upload") {
      options.upload = true;
      continue;
    }
    if (arg === "--no-upload") {
      options.upload = false;
      continue;
    }
    if (arg.startsWith("--ssh-host=")) {
      options.sshHost = arg.slice("--ssh-host=".length);
      continue;
    }
    if (arg === "--ssh-host") {
      options.sshHost = argv[++index];
      continue;
    }
    if (arg.startsWith("--remote-dir=")) {
      options.remoteDir = arg.slice("--remote-dir=".length);
      continue;
    }
    if (arg === "--remote-dir") {
      options.remoteDir = argv[++index];
      continue;
    }
    if (arg === "--required") {
      options.policyOverride = "required";
      continue;
    }
    if (arg === "--optional") {
      options.policyOverride = "optional";
      continue;
    }
    if (arg === "--no-next-env") {
      options.includeNextEnv = false;
      options.nextEnvPath = undefined;
      continue;
    }
    if (arg.startsWith("--server-url=")) {
      options.serverUrl = arg.slice("--server-url=".length);
      continue;
    }
    if (arg === "--server-url") {
      options.serverUrl = argv[++index];
      continue;
    }
    if (arg.startsWith("--channel=")) {
      options.channel = arg.slice("--channel=".length);
      continue;
    }
    if (arg === "--channel") {
      options.channel = argv[++index];
      continue;
    }
    if (arg.startsWith("--notes=")) {
      options.notes = arg.slice("--notes=".length);
      continue;
    }
    if (arg === "--notes") {
      options.notes = argv[++index];
      continue;
    }
    if (arg.startsWith("--notes-file=")) {
      options.notesFile = arg.slice("--notes-file=".length);
      continue;
    }
    if (arg === "--notes-file") {
      options.notesFile = argv[++index];
      continue;
    }
    if (arg.startsWith("--min-supported=")) {
      options.minSupportedVersion = arg.slice("--min-supported=".length);
      continue;
    }
    if (arg === "--min-supported") {
      options.minSupportedVersion = argv[++index];
      continue;
    }
    if (arg.startsWith("--next-env=")) {
      options.nextEnvPath = path.resolve(projectRoot, arg.slice("--next-env=".length));
      options.includeNextEnv = true;
      continue;
    }
    if (arg === "--next-env") {
      options.nextEnvPath = path.resolve(projectRoot, argv[++index]);
      options.includeNextEnv = true;
      continue;
    }
    positionals.push(arg);
  }

  if (positionals[0]) {
    options.mode = positionals[0];
  }
  if (options.mode === "version") {
    options.mode = positionals[1] ?? "";
  }

  return options;
}

function parseVersion(version) {
  const match = SEMVER_RE.exec(String(version).trim());
  if (!match) {
    throw new Error(`版本号必须是 x.y.z 格式，当前收到：${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return 0;
}

function nextVersion(currentVersion, mode) {
  const current = parseVersion(currentVersion);
  if (!mode || mode === "patch") {
    return { version: formatVersion({ ...current, patch: current.patch + 1 }), source: "patch" };
  }
  if (mode === "minor") {
    return { version: formatVersion({ major: current.major, minor: current.minor + 1, patch: 0 }), source: "minor" };
  }
  if (mode === "major") {
    return { version: formatVersion({ major: current.major + 1, minor: 0, patch: 0 }), source: "major" };
  }
  parseVersion(mode);
  return { version: mode, source: "version" };
}

function classifyPolicy(currentVersion, targetVersion, source, override) {
  if (override) return override;
  if (source === "minor" || source === "major") return "required";
  if (compareVersions(targetVersion, currentVersion) <= 0) return "optional";
  const current = parseVersion(currentVersion);
  const target = parseVersion(targetVersion);
  if (target.major > current.major || target.minor > current.minor) return "required";
  return "optional";
}

function parseEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }
  return env;
}

function inferServerUrl(manifestUrl) {
  if (!manifestUrl) return undefined;
  try {
    const url = new URL(manifestUrl);
    url.pathname = url.pathname.replace(/\/update\.json$/i, "").replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(url) {
  if (!url) return "https://www.legoumarket.cloud/gameaistudio";
  return url.replace(/\/+$/, "");
}

function toUrlPathSegment(fileName) {
  return encodeURIComponent(fileName).replace(/%2D/g, "-").replace(/%2E/g, ".");
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function readReleaseNotes(options, targetVersion) {
  if (options.notesFile) {
    return {
      text: (await readFile(path.resolve(projectRoot, options.notesFile), "utf8")).trim(),
      source: options.notesFile,
    };
  }
  if (options.notes) {
    return { text: options.notes.trim(), source: "--notes" };
  }
  const defaultNotes = (await readOptionalFile(defaultNotesPath)).trim();
  if (defaultNotes) {
    return { text: defaultNotes, source: "release-notes.md" };
  }
  return { text: `GameAIStudio ${targetVersion} 更新。`, source: "默认文案" };
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} 失败，退出码：${code}`));
      }
    });
  });
}

function packageInstallerName(packageJson, version) {
  const productName = packageJson.build?.productName ?? packageJson.productName ?? "GameAIStudio";
  return `${productName}-Setup-${version}.exe`;
}

function fixedInstallerName(packageJson) {
  const productName = packageJson.build?.productName ?? packageJson.productName ?? "GameAIStudio";
  return `${productName}-Setup.exe`;
}

async function uploadArtifacts(options, artifacts) {
  if (!options.sshHost) {
    throw new Error("启用上传时必须配置 SSH 主机。");
  }
  const remoteDir = options.remoteDir.replace(/\/+$/, "");
  const remoteReleasesDir = `${remoteDir}/releases`;
  await run("ssh", [options.sshHost, `mkdir -p ${remoteReleasesDir}`], projectRoot);
  await run("scp", [artifacts.updateJsonPath, `${options.sshHost}:${remoteDir}/update.json`], projectRoot);
  await run(
    "scp",
    [
      artifacts.versionedInstallerPath,
      artifacts.fixedInstallerPath,
      `${options.sshHost}:${remoteReleasesDir}/`,
    ],
    projectRoot,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const packageRaw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageRaw);
  const envRaw = await readOptionalFile(envPath);
  const env = parseEnv(envRaw);
  const currentVersion = packageJson.version;
  const target = nextVersion(currentVersion, options.mode);

  if (compareVersions(target.version, currentVersion) < 0) {
    throw new Error(`目标版本 ${target.version} 不能低于当前版本 ${currentVersion}`);
  }
  if (options.minSupportedVersion) {
    parseVersion(options.minSupportedVersion);
  }

  const serverUrl = normalizeBaseUrl(
    options.serverUrl ??
      process.env.GAMEAISTUDIO_RELEASE_BASE_URL ??
      inferServerUrl(env.GAMEAISTUDIO_UPDATE_MANIFEST_URL),
  );
  const channel = options.channel ?? env.GAMEAISTUDIO_UPDATE_CHANNEL ?? "stable";
  const policy = classifyPolicy(currentVersion, target.version, target.source, options.policyOverride);
  const installerName = packageInstallerName(packageJson, target.version);
  const stableInstallerName = fixedInstallerName(packageJson);
  const distInstallerPath = path.join(projectRoot, "dist", installerName);
  const releaseInstallerPath = path.join(releasesDir, installerName);
  const fixedReleaseInstallerPath = path.join(releasesDir, stableInstallerName);
  const installerUrl = `${serverUrl}/releases/${toUrlPathSegment(installerName)}`;
  const fixedInstallerUrl = `${serverUrl}/releases/${toUrlPathSegment(stableInstallerName)}`;
  const releaseNotes = await readReleaseNotes(options, target.version);

  const plan = {
    currentVersion,
    targetVersion: target.version,
    source: target.source,
    policy,
    channel,
    serverUrl,
    installerName,
    updateJsonPath,
    releaseInstallerPath,
    fixedReleaseInstallerPath,
    fixedInstallerUrl,
    releaseNotesSource: releaseNotes.source,
    dryRun: options.dryRun,
    skipBuild: options.skipBuild,
    upload: options.upload,
    sshHost: options.upload ? options.sshHost : undefined,
    remoteDir: options.upload ? options.remoteDir : undefined,
  };

  console.log("GameAIStudio 更新发布计划：");
  console.log(JSON.stringify(plan, null, 2));

  if (options.dryRun) {
    console.log("dry-run 已结束，没有写入文件，也没有执行打包。");
    return;
  }

  const nextPackageJson = { ...packageJson, version: target.version };
  await writeFile(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`, "utf8");

  try {
    if (!options.skipBuild) {
      await run("pnpm", ["dist:win"], projectRoot);
    }

    const installerStat = await stat(distInstallerPath);
    const installerSha256 = await sha256File(distInstallerPath);
    await mkdir(releasesDir, { recursive: true });
    await copyFile(distInstallerPath, releaseInstallerPath);
    await copyFile(distInstallerPath, fixedReleaseInstallerPath);

    const manifest = {
      appId: packageJson.build?.appId ?? "com.gameaistudio.desktop",
      channel,
      latestVersion: target.version,
      downloadUrl: fixedInstallerUrl,
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes.text,
      packages: [
        {
          platform: "win32",
          arch: "x64",
          url: installerUrl,
          sha256: installerSha256,
          size: installerStat.size,
        },
      ],
    };

    if (options.minSupportedVersion) {
      manifest.minSupportedVersion = options.minSupportedVersion;
    }
    if (policy === "required" && options.policyOverride === "required") {
      manifest.force = true;
    }
    if (options.includeNextEnv && options.nextEnvPath) {
      const nextEnvContent = await readFile(options.nextEnvPath, "utf8");
      manifest.nextEnv = {
        content: nextEnvContent,
        sha256: createHash("sha256").update(nextEnvContent).digest("hex"),
        effective: "nextLaunch",
      };
    }

    await mkdir(serverRoot, { recursive: true });
    await writeFile(updateJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    console.log("更新发布资源已生成：");
    console.log(`- 安装包：${releaseInstallerPath}`);
    console.log(`- 固定下载包：${fixedReleaseInstallerPath}`);
    console.log(`- 更新清单：${updateJsonPath}`);
    console.log(`- 安装包 URL：${installerUrl}`);
    console.log(`- 固定下载 URL：${fixedInstallerUrl}`);

    if (options.upload) {
      await uploadArtifacts(options, {
        updateJsonPath,
        versionedInstallerPath: releaseInstallerPath,
        fixedInstallerPath: fixedReleaseInstallerPath,
      });
      console.log(`已上传到服务器：${options.sshHost}:${options.remoteDir}`);
    }
  } catch (error) {
    await writeFile(packageJsonPath, packageRaw, "utf8");
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
