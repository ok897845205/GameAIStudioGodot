import { cp, mkdir, mkdtemp, readFile, rm, readdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "./process-runner";
import { ensureWebExportTemplates, godotSpawnEnv, managedTemplatesDir } from "./godot-export-templates";

// LIVE verification against the real bundled Godot binary. Proves the
// self-contained engine mechanism end to end:
//  1. the APPDATA redirection is load-bearing (empty managed dir → export
//     fails pointing AT the managed dir, even though this dev machine has
//     templates in its real %APPDATA%),
//  2. export succeeds in a "complex environment" (data root with Chinese
//     characters and spaces) without modifying any project file,
//  3. the validation gate fails on GDScript parse errors (no false greens).
// Opt-in (slow, spawns Godot several times):
//   RUN_LIVE_GODOT=1 ./node_modules/.bin/vitest run \
//     packages/main/src/services/godot-live-verify.test.ts
const LIVE = process.env.RUN_LIVE_GODOT === "1";

const projectRootDir = path.resolve(__dirname, "../../../..");
const engineRoot = path.join(projectRootDir, "engine");
const godotConsole = path.join(engineRoot, "Godot_v4.6.2-stable_win64_console.exe");
const template3d = path.join(projectRootDir, "gameaistudio_template", "gameaistudio_template_3d");

async function makeProject(base: string): Promise<string> {
  const projectDir = path.join(base, "测试 项目");
  await cp(template3d, projectDir, { recursive: true });
  return projectDir;
}

describe.runIf(LIVE)("LIVE bundled Godot (self-contained data dir)", () => {
  it(
    "export fails against an EMPTY managed dir — proving the redirection is load-bearing",
    async () => {
      const base = await mkdtemp(path.join(os.tmpdir(), "gas-live-redirect-"));
      const dataRoot = path.join(base, "数据 root");
      await mkdir(dataRoot, { recursive: true });
      const project = await makeProject(base);
      const env = godotSpawnEnv(dataRoot);

      await runProcess(godotConsole, ["--headless", "--path", project, "--import"], { timeoutMs: 240_000, env });
      const out = path.join(project, "build", "web", "index.html");
      await mkdir(path.dirname(out), { recursive: true });
      const result = await runProcess(
        godotConsole,
        ["--headless", "--path", project, "--export-release", "Web", out],
        { timeoutMs: 240_000, env }
      );

      expect(result.exitCode).not.toBe(0);
      // The error must point at OUR managed dir, not the user's real APPDATA.
      const managedForwardSlash = managedTemplatesDir(dataRoot).replace(/\\/g, "/");
      expect(result.stderr).toContain(managedForwardSlash);

      await rm(base, { recursive: true, force: true });
    },
    300_000
  );

  it(
    "export succeeds with bundled templates in a data root containing Chinese + spaces, without touching project files",
    async () => {
      const base = await mkdtemp(path.join(os.tmpdir(), "gas-live-export-"));
      const dataRoot = path.join(base, "数据 root");
      await mkdir(dataRoot, { recursive: true });
      const project = await makeProject(base);
      const env = godotSpawnEnv(dataRoot);

      const status = await ensureWebExportTemplates(engineRoot, dataRoot);
      expect(status.ok).toBe(true);
      expect(status.source).toBe("bundled");

      const presetsBefore = await readFile(path.join(project, "export_presets.cfg"), "utf8");
      await runProcess(godotConsole, ["--headless", "--path", project, "--import"], { timeoutMs: 240_000, env });
      const out = path.join(project, "build", "web", "index.html");
      await mkdir(path.dirname(out), { recursive: true });
      const result = await runProcess(
        godotConsole,
        ["--headless", "--path", project, "--export-release", "Web", out],
        { timeoutMs: 240_000, env }
      );

      expect(result.exitCode).toBe(0);
      const files = await readdir(path.join(project, "build", "web"));
      expect(files).toContain("index.html");
      expect(files.some((f) => f.endsWith(".wasm"))).toBe(true);
      expect(files.some((f) => f.endsWith(".pck"))).toBe(true);
      // Zero project mutation: the presets file is byte-identical.
      const presetsAfter = await readFile(path.join(project, "export_presets.cfg"), "utf8");
      expect(presetsAfter).toBe(presetsBefore);
      // Godot actually wrote its editor data into the managed root.
      expect(existsSync(managedTemplatesDir(dataRoot))).toBe(true);

      await rm(base, { recursive: true, force: true });
    },
    300_000
  );

  it(
    "validation gate: clean template passes, a GDScript parse error fails it",
    async () => {
      const base = await mkdtemp(path.join(os.tmpdir(), "gas-live-validate-"));
      const dataRoot = path.join(base, "数据 root");
      await mkdir(dataRoot, { recursive: true });
      const project = await makeProject(base);
      const env = godotSpawnEnv(dataRoot);

      await runProcess(godotConsole, ["--headless", "--path", project, "--import"], { timeoutMs: 240_000, env });
      const clean = await runProcess(
        godotConsole,
        ["--headless", "--path", project, "-s", "tools/ci/validate_project.gd"],
        { timeoutMs: 240_000, env }
      );
      expect(clean.exitCode).toBe(0);
      expect(clean.stdout).toContain("Validation passed");

      // Inject a guaranteed parse error into a game script.
      await appendFile(path.join(project, "scripts", "player.gd"), "\nfunc broken(:\n", "utf8");
      const broken = await runProcess(
        godotConsole,
        ["--headless", "--path", project, "-s", "tools/ci/validate_project.gd"],
        { timeoutMs: 240_000, env }
      );
      expect(broken.exitCode).not.toBe(0);
      expect(broken.stderr).toContain("Script failed to load");

      await rm(base, { recursive: true, force: true });
    },
    300_000
  );
});
