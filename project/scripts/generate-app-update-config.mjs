#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const buildDir = path.join(projectRoot, "build");
const outputPath = path.join(buildDir, "app-update.yml");
const envPath = path.join(projectRoot, ".env");
const releaseEnvPath = path.join(projectRoot, "release.env");
const fallbackFeedUrl = "https://example.invalid/gameaistudio";

function parseEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function readOptionalEnv(filePath) {
  try {
    return parseEnv(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function firstConfigured(...values) {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return undefined;
}

function inferFeedUrl(manifestUrl) {
  if (!manifestUrl) return undefined;
  try {
    const url = new URL(manifestUrl);
    url.pathname = url.pathname.replace(/\/(?:update\.json|latest\.ya?ml|[\w.-]+\.ya?ml)$/i, "");
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function yamlString(value) {
  return JSON.stringify(value);
}

async function main() {
  const env = await readOptionalEnv(envPath);
  const releaseEnv = await readOptionalEnv(releaseEnvPath);
  const feedUrl =
    firstConfigured(
      process.env.GAMEAISTUDIO_UPDATE_FEED_URL,
      process.env.GAMEAISTUDIO_RELEASE_BASE_URL,
      releaseEnv.GAMEAISTUDIO_RELEASE_BASE_URL,
      env.GAMEAISTUDIO_RELEASE_BASE_URL,
      inferFeedUrl(process.env.GAMEAISTUDIO_UPDATE_MANIFEST_URL),
      inferFeedUrl(env.GAMEAISTUDIO_UPDATE_MANIFEST_URL),
    ) ?? fallbackFeedUrl;

  await mkdir(buildDir, { recursive: true });
  await writeFile(
    outputPath,
    [
      "provider: generic",
      `url: ${yamlString(feedUrl)}`,
      "updaterCacheDirName: gameaistudio-updater",
      "",
    ].join("\n"),
    "utf8",
  );

  const source = feedUrl === fallbackFeedUrl ? "fallback" : "configured";
  console.log(`Generated build/app-update.yml (${source}): ${feedUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
