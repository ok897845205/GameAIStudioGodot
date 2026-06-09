import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const godotConsole = path.join(root, "engine", "Godot_v4.6.2-stable_win64_console.exe");
const templatesRoot = path.join(root, "gameaistudio_template");
const ignoredTopLevel = new Set([".godot", "build", "dist"]);

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

async function assertRequiredWebFiles(webBuildPath, dimension) {
  const files = await readdir(webBuildPath);
  const hasHtml = files.includes("index.html");
  const hasWasm = files.some((file) => file.toLowerCase().endsWith(".wasm"));
  const hasPck = files.some((file) => file.toLowerCase().endsWith(".pck"));
  if (!hasHtml || !hasWasm || !hasPck) {
    throw new Error(`${dimension} Web export missing required files in ${webBuildPath}.`);
  }
}

async function smokeTemplate(dimension, smokeRoot) {
  const source = path.join(templatesRoot, `gameaistudio_template_${dimension}`);
  const destination = path.join(smokeRoot, `created_${dimension}`);
  const webBuildPath = path.join(destination, "build", "web");
  await copyCleanTemplate(source, destination);

  const validation = await run(godotConsole, ["--headless", "--path", destination, "-s", "tools/ci/validate_project.gd"]);
  if (validation.exitCode !== 0) {
    throw new Error(`${dimension} Godot validation failed.`);
  }

  await mkdir(webBuildPath, { recursive: true });
  const exportResult = await run(godotConsole, ["--headless", "--path", destination, "--export-release", "Web", path.join(webBuildPath, "index.html")]);
  if (exportResult.exitCode !== 0) {
    throw new Error(`${dimension} Godot Web export failed.`);
  }

  await assertRequiredWebFiles(webBuildPath, dimension);
  console.log(`[GameAIStudio] ${dimension.toUpperCase()} clean template smoke passed: ${webBuildPath}`);
}

if (!existsSync(godotConsole)) {
  throw new Error(`Bundled Godot console executable is missing: ${godotConsole}`);
}

for (const dimension of ["2d", "3d"]) {
  const templatePath = path.join(templatesRoot, `gameaistudio_template_${dimension}`);
  if (!existsSync(templatePath)) {
    throw new Error(`Bundled ${dimension.toUpperCase()} template is missing: ${templatePath}`);
  }
}

const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-template-smoke-"));
let keepOutput = false;
try {
  await smokeTemplate("2d", smokeRoot);
  await smokeTemplate("3d", smokeRoot);
  console.log(`[GameAIStudio] Template smoke completed: ${smokeRoot}`);
} catch (error) {
  keepOutput = true;
  console.error(`[GameAIStudio] Template smoke failed. Output kept at: ${smokeRoot}`);
  throw error;
} finally {
  if (!keepOutput && process.env.GAMEAISTUDIO_KEEP_SMOKE_OUTPUT !== "1") {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}
