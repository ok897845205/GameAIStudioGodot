import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { AgentService } from "./agent-service";
import { CliService } from "./cli-service";
import { AgentContextService } from "./agent-context-service";
import { ProjectFileChangeService } from "./project-file-change-service";
import { ProjectService } from "./project-service";
import { ProcessRegistry } from "./process-runner";
import { RunService } from "./run-service";
import { StudioStore } from "./store";
import type { StudioPaths } from "./resource-paths";
import type { AgentStreamEvent, CliToolId } from "@gameaistudio/shared";

// LIVE end-to-end: real CliService -> real adapter -> real CLI, through the
// full agent-turn path (prompt build + context + run recording + streaming).
// Opt-in (makes a real model call):
//   PROBE_LIVE=1 PROBE_CLI=claude ./node_modules/.bin/vitest run \
//     packages/main/src/services/agent-service.live.test.ts
const LIVE = process.env.PROBE_LIVE === "1";
const cliToolId = (process.env.PROBE_CLI ?? "claude") as CliToolId;

const WEB_EXPORT_PRESET = `[preset.0]\n\nname="Web"\nplatform="Web"\nexport_path="build/web/index.html"\n`;

function createPaths(root: string): StudioPaths {
  return {
    resourceRoot: root,
    dataRoot: path.join(root, "data"),
    projectsRoot: path.join(root, "data", "projects"),
    templatesRoot: path.join(root, "gameaistudio_template"),
    engineRoot: path.join(root, "engine"),
    godotGuiPath: undefined,
    godotConsolePath: undefined,
  };
}

async function writeTemplate(paths: StudioPaths): Promise<void> {
  const templatePath = path.join(paths.templatesRoot, "gameaistudio_template_2d");
  await mkdir(templatePath, { recursive: true });
  await writeFile(path.join(templatePath, "project.godot"), 'config/name="Template"\n', "utf8");
  await writeFile(path.join(templatePath, "export_presets.cfg"), WEB_EXPORT_PRESET, "utf8");
  await writeFile(path.join(templatePath, "main.tscn"), "[gd_scene format=3]\n", "utf8");
}

describe.skipIf(!LIVE)(`LIVE agent-service end-to-end (${cliToolId})`, () => {
  it("produces a non-empty agent message through the full turn path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gais-agent-live-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "studio-state.json"));
    const projectService = new ProjectService(paths, store);
    const runService = new RunService(store, () => {});
    const processRegistry = new ProcessRegistry();
    const fileChangeService = new ProjectFileChangeService();
    const contextService = new AgentContextService();
    const streamEvents: AgentStreamEvent[] = [];
    const agentService = new AgentService(
      projectService,
      new CliService(),
      runService,
      processRegistry,
      fileChangeService,
      contextService,
      (e) => streamEvents.push(e),
    );

    await writeTemplate(paths);
    const project = await projectService.createProject({
      name: "Live CLI Demo",
      dimension: "2d",
      prompt: "我要创建一个黄金矿工",
    });

    const result = await agentService.runTurn({
      projectId: project.id,
      agentId: "producer",
      cliToolId,
      message: "用一句话回答：你是什么模型？",
      autoStartPreview: false,
    });

    const agentMessage = [...result.messages].reverse().find((m) => m.role === "agent");
    // eslint-disable-next-line no-console
    console.log(
      `\n[LIVE e2e ${cliToolId}] exitCode=${agentMessage?.exitCode}` +
        `\n  streamDeltas=${streamEvents.filter((e) => !e.done).length}` +
        `\n  content: ${JSON.stringify(agentMessage?.content)}`,
    );

    expect(agentMessage?.content.trim().length ?? 0).toBeGreaterThan(0);
    expect(streamEvents.some((e) => !e.done && e.delta.length > 0)).toBe(true);
  }, 180_000);
});
