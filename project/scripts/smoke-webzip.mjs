import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const godotConsole = path.join(root, "engine", "Godot_v4.6.2-stable_win64_console.exe");
const templatesRoot = path.join(root, "gameaistudio_template");
const ignoredTopLevel = new Set([".godot", "build", "dist"]);
const requiredWebFiles = ["index.html", "*.wasm", "*.pck"];
const manifestFileName = "gameaistudio-export.json";
const reservedWindowsNames = new Set(["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"]);

function sanitizeProjectName(input) {
  const cleaned = input
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  if (!cleaned) {
    return "game-project";
  }
  return reservedWindowsNames.has(cleaned.toLowerCase()) ? `${cleaned}-project` : cleaned;
}

function psQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => resolve({ exitCode: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function copyCleanTemplate(source, destination) {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const relativePath = path.relative(source, sourcePath);
      if (!relativePath) {
        return true;
      }
      const firstSegment = relativePath.split(path.sep)[0];
      return !ignoredTopLevel.has(firstSegment);
    }
  });
}

async function collectFiles(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(rootPath, absolutePath);
      }
      if (!entry.isFile()) {
        return [];
      }
      const fileStat = await stat(absolutePath);
      return [
        {
          relativePath: path.relative(rootPath, absolutePath).replace(/\\/g, "/"),
          size: fileStat.size
        }
      ];
    })
  );
  return files.flat();
}

async function inspectWebBuild(projectId, webBuildPath) {
  const artifacts = await collectFiles(webBuildPath).catch(() => []);
  const files = artifacts.map((artifact) => artifact.relativePath).sort((left, right) => left.localeCompare(right));
  const lowerFiles = files.map((file) => file.toLowerCase());
  const missingRequiredFiles = [
    lowerFiles.includes("index.html") ? undefined : "index.html",
    lowerFiles.some((file) => file.endsWith(".wasm")) ? undefined : "*.wasm",
    lowerFiles.some((file) => file.endsWith(".pck")) ? undefined : "*.pck"
  ].filter(Boolean);
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
  return {
    projectId,
    webBuildPath,
    ok: missingRequiredFiles.length === 0,
    files,
    totalBytes,
    requiredFiles: requiredWebFiles,
    missingRequiredFiles,
    message:
      missingRequiredFiles.length === 0
        ? `Web build contains ${files.length} files (${totalBytes} bytes).`
        : `Web build is missing required files: ${missingRequiredFiles.join(", ")}.`
  };
}

function buildExportManifest(project, inspection, exportedAt = new Date().toISOString()) {
  return JSON.stringify(
    {
      formatVersion: 1,
      generator: "GameAIStudio",
      exportedAt,
      project: {
        id: project.id,
        name: project.name,
        dimension: project.dimension,
        prompt: project.prompt
      },
      webBuild: {
        ok: inspection.ok,
        totalBytes: inspection.totalBytes,
        files: inspection.files,
        requiredFiles: inspection.requiredFiles,
        missingRequiredFiles: inspection.missingRequiredFiles
      }
    },
    null,
    2
  );
}

async function writeExportManifest(project, inspection) {
  const manifestPath = path.join(project.webBuildPath, manifestFileName);
  await writeFile(manifestPath, `${buildExportManifest(project, inspection)}\n`, "utf8");
  return manifestPath;
}

async function compressWebBuild(webBuildPath, zipPath) {
  await mkdir(path.dirname(zipPath), { recursive: true });
  if (process.platform === "win32") {
    const sourceGlob = `${webBuildPath}${path.sep}*`;
    const command = `Compress-Archive -Path ${psQuote(sourceGlob)} -DestinationPath ${psQuote(zipPath)} -Force`;
    const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "Compress-Archive failed.");
    }
    return;
  }

  const result = await run("zip", ["-r", zipPath, "."], { cwd: webBuildPath });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "zip failed.");
  }
}

async function listZipEntries(zipPath) {
  if (process.platform !== "win32") {
    const result = await run("unzip", ["-Z1", zipPath]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "Could not inspect zip.");
    }
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `$zip = [System.IO.Compression.ZipFile]::OpenRead(${psQuote(zipPath)});`,
    "try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }"
  ].join(" ");
  const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "Could not inspect zip.");
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function assertZipEntries(zipPath) {
  const entries = (await listZipEntries(zipPath)).map((entry) => entry.replace(/\\/g, "/").toLowerCase());
  if (!entries.includes("index.html")) {
    throw new Error(`Zip is missing index.html: ${zipPath}`);
  }
  if (!entries.includes(manifestFileName)) {
    throw new Error(`Zip is missing ${manifestFileName}: ${zipPath}`);
  }
  if (!entries.some((entry) => entry.endsWith(".wasm"))) {
    throw new Error(`Zip is missing a wasm file: ${zipPath}`);
  }
  if (!entries.some((entry) => entry.endsWith(".pck"))) {
    throw new Error(`Zip is missing a pck file: ${zipPath}`);
  }
}

async function smokeWebZip(dimension, smokeRoot) {
  const projectName = `Smoke ${dimension.toUpperCase()} 黄金矿工`;
  const project = {
    id: `smoke_${dimension}`,
    name: projectName,
    dimension,
    prompt: "我要创建一个黄金矿工，玩家用钩子抓金块，限时得分。",
    rootPath: path.join(smokeRoot, `project_${dimension}`)
  };
  project.webBuildPath = path.join(project.rootPath, "build", "web");

  await copyCleanTemplate(path.join(templatesRoot, `gameaistudio_template_${dimension}`), project.rootPath);

  const validation = await run(godotConsole, ["--headless", "--path", project.rootPath, "-s", "tools/ci/validate_project.gd"]);
  if (validation.exitCode !== 0) {
    throw new Error(`${dimension} Godot validation failed.`);
  }

  await mkdir(project.webBuildPath, { recursive: true });
  const exportResult = await run(godotConsole, ["--headless", "--path", project.rootPath, "--export-release", "Web", path.join(project.webBuildPath, "index.html")]);
  if (exportResult.exitCode !== 0) {
    throw new Error(`${dimension} Godot Web export failed.`);
  }

  const inspection = await inspectWebBuild(project.id, project.webBuildPath);
  if (!inspection.ok) {
    throw new Error(inspection.message);
  }

  const manifestPath = await writeExportManifest(project, inspection);
  const zipPath = path.join(project.rootPath, "dist", `${sanitizeProjectName(project.name)}-web.zip`);
  await compressWebBuild(project.webBuildPath, zipPath);
  await assertZipEntries(zipPath);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.generator !== "GameAIStudio" || manifest.webBuild.ok !== true) {
    throw new Error(`Invalid export manifest: ${manifestPath}`);
  }

  console.log(`[GameAIStudio] ${dimension.toUpperCase()} Web zip smoke passed: ${zipPath}`);
}

if (!existsSync(godotConsole)) {
  throw new Error(`Bundled Godot console executable is missing: ${godotConsole}`);
}

const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-webzip-smoke-"));
let keepOutput = false;
try {
  await smokeWebZip("2d", smokeRoot);
  await smokeWebZip("3d", smokeRoot);
  console.log(`[GameAIStudio] Web zip smoke completed: ${smokeRoot}`);
} catch (error) {
  keepOutput = true;
  console.error(`[GameAIStudio] Web zip smoke failed. Output kept at: ${smokeRoot}`);
  throw error;
} finally {
  if (!keepOutput && process.env.GAMEAISTUDIO_KEEP_SMOKE_OUTPUT !== "1") {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}
