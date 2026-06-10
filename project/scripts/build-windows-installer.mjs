#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const offline = !process.argv.includes("--online");

function quoteCmdArg(value) {
  const text = String(value);
  if (!text) return '""';
  if (!/[ \t&()^|<>"%]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function spawnCommand(command, args, options) {
  if (process.platform === "win32" && (command === "pnpm" || command === "electron-builder")) {
    const commandLine = [command, ...args].map(quoteCmdArg).join(" ");
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], options);
  }
  return spawn(command, args, options);
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, ...(options.env ?? {}) },
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

async function assertLocalElectronDist() {
  const electronExe = path.join(projectRoot, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  try {
    await access(electronExe);
  } catch {
    throw new Error(
      [
        "没有找到本地 Electron 运行时，无法离线打包。",
        `缺失文件：${electronExe}`,
        "请先执行 pnpm install，让 electron 包下载自己的 dist 目录。",
      ].join("\n"),
    );
  }
}

async function main() {
  await assertLocalElectronDist();
  await run("pnpm", ["build"]);

  const env = offline
    ? {
        ELECTRON_BUILDER_OFFLINE: "true",
      }
    : {};

  if (offline) {
    console.log("使用离线打包模式：ELECTRON_BUILDER_OFFLINE=true。");
    console.log("这会跳过签名时间戳联网，避免 GitHub/时间戳服务器 TLS 抖动导致打包失败。");
  } else {
    console.log("使用在线打包模式：允许 electron-builder 访问网络下载缺失缓存或请求签名时间戳。");
  }

  try {
    await run("electron-builder", ["--win"], { env });
  } catch (error) {
    if (offline) {
      console.error("");
      console.error("离线打包失败。常见原因是 electron-builder 的 NSIS/winCodeSign 缓存缺失。");
      console.error("可以先执行一次：pnpm dist:win:online");
      console.error("在线模式成功后，后续再执行 pnpm dist:win 就会优先使用缓存。");
      console.error("");
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
