import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import type { StudioPaths } from "./resource-paths";
import { StudioStore } from "./store";

const WEB_EXPORT_PRESET = `[preset.0]

name="Web"
platform="Web"
export_path="build/web/index.html"
`;

function createPaths(root: string): StudioPaths {
  return {
    resourceRoot: root,
    dataRoot: path.join(root, "data"),
    projectsRoot: path.join(root, "data", "projects"),
    templatesRoot: path.join(root, "gameaistudio_template"),
    engineRoot: path.join(root, "engine"),
    godotGuiPath: undefined,
    godotConsolePath: undefined
  };
}

function message(projectId: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    projectId,
    agentId: "producer",
    role: "user",
    content: "你好",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe("project chat management", () => {
  let root: string;
  let projectService: ProjectService;
  let projectId: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-chat-"));
    const paths = createPaths(root);
    const templatePath = path.join(paths.templatesRoot, "gameaistudio_template_2d");
    await mkdir(templatePath, { recursive: true });
    await writeFile(path.join(templatePath, "project.godot"), 'config/name="T"\n', "utf8");
    await writeFile(path.join(templatePath, "export_presets.cfg"), WEB_EXPORT_PRESET, "utf8");
    const store = new StudioStore(path.join(paths.dataRoot, "studio-state.json"));
    projectService = new ProjectService(paths, store);
    const project = await projectService.createProject({ name: "Chat Demo", dimension: "2d", prompt: "聊天测试" });
    projectId = project.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("deletes a single message", async () => {
    const [kept, removed] = [message(projectId, { content: "保留" }), message(projectId, { content: "删除我" })];
    await projectService.appendMessages(projectId, [kept, removed]);

    const after = await projectService.deleteMessage(projectId, removed.id);
    expect(after.some((m) => m.id === removed.id)).toBe(false);
    expect(after.some((m) => m.id === kept.id)).toBe(true);
  });

  it("clears one Agent's thread and keeps other Agents' messages", async () => {
    await projectService.appendMessages(projectId, [
      message(projectId, { agentId: "qa", content: "QA 1" }),
      message(projectId, { agentId: "qa", content: "QA 2" }),
      message(projectId, { agentId: "artist", content: "美术 1" })
    ]);

    const after = await projectService.clearMessages(projectId, "qa");
    expect(after.filter((m) => m.agentId === "qa")).toHaveLength(0);
    expect(after.some((m) => m.agentId === "artist")).toBe(true);
  });

  it("exports the chat history as a markdown file with metadata", async () => {
    await projectService.appendMessages(projectId, [
      message(projectId, { content: "把跳跃调高一点", cliToolId: "codex" }),
      message(projectId, {
        role: "agent",
        content: "已调整 scripts/player.gd 的 jump_force。",
        cliToolId: "codex",
        exitCode: 0,
        durationMs: 4200,
        kind: "text",
        fileChanges: [
          { path: "scripts/player.gd", kind: "modified", isText: true }
        ]
      })
    ]);

    const result = await projectService.exportChatHistory(projectId);
    expect(result.messageCount).toBeGreaterThanOrEqual(2);
    const content = await readFile(result.path, "utf8");
    expect(content).toContain("聊天记录");
    expect(content).toContain("把跳跃调高一点");
    expect(content).toContain("Codex");
    expect(content).toContain("scripts/player.gd");
    expect(content).toContain("exit:0");
  });
});
