import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStreamEvent, CliTool } from "@gameaistudio/shared";
import type { AgentContextBundle } from "./agent-context-service";
import { AgentContextService } from "./agent-context-service";
import { AgentService, buildAgentProcessMessage, buildAgentPrompt } from "./agent-service";
import type { CliService } from "./cli-service";
import { ProcessRegistry } from "./process-runner";
import { ProjectFileChangeService } from "./project-file-change-service";
import { ProjectService } from "./project-service";
import type { StudioPaths } from "./resource-paths";
import { RunService } from "./run-service";
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

async function writeTemplate(paths: StudioPaths): Promise<void> {
  const templatePath = path.join(paths.templatesRoot, "gameaistudio_template_2d");
  await mkdir(templatePath, { recursive: true });
  await writeFile(path.join(templatePath, "project.godot"), 'config/name="Template"\n', "utf8");
  await writeFile(path.join(templatePath, "export_presets.cfg"), WEB_EXPORT_PRESET, "utf8");
  await writeFile(path.join(templatePath, "main.tscn"), "[gd_scene format=3]\n", "utf8");
}

function fakeTool(executablePath: string): CliTool {
  return {
    id: "codex",
    label: "Codex",
    command: "codex",
    installed: true,
    status: "available",
    executablePath,
    version: "fake-codex 1.0.0",
    installCommand: ["npm", "install", "-g", "@openai/codex"],
    installHint: "fake",
    installManager: "npm",
    installManagerAvailable: true,
    defaultArgs: [],
    credentialStatus: "unknown",
    credentialEnvVars: [],
    detectedCredentialEnvVars: [],
    credentialHint: "fake",
    capabilities: {
      runModel: "local",
      supportsImages: true,
      imageInputMode: "prompt-path-reference",
      supportsStream: true,
      supportsResume: false,
      headless: true
    },
    health: {
      installed: true,
      authed: true,
      headlessOk: true,
      version: "fake-codex 1.0.0"
    },
    diagnostics: [],
    lastCheckedAt: new Date().toISOString()
  };
}

describe("buildAgentPrompt", () => {
  it("references the prepared Agent context file instead of inlining long markdown into CLI args", () => {
    const longMarkdown = `# Context\n${"large context line\n".repeat(400)}`;
    const context: AgentContextBundle = {
      contextPath: "E:/projects/gold-miner/.gameaistudio/agent-context.md",
      markdown: longMarkdown,
      files: [],
      recentMessages: [],
      agentJournal: ""
    };

    const prompt = buildAgentPrompt({
      agentId: "programmer",
      projectName: "Gold Miner",
      projectPrompt: "创建黄金矿工",
      projectRoot: "E:/projects/gold-miner",
      userMessage: "加入计分和抓钩反馈。",
      context
    });

    expect(prompt).toContain(context.contextPath);
    expect(prompt).toContain("本轮用户消息");
    expect(prompt).toContain("加入计分和抓钩反馈。");
    expect(prompt).not.toContain(longMarkdown);
    expect(prompt.length).toBeLessThan(longMarkdown.length);
  });
});

describe("buildAgentProcessMessage", () => {
  it("explains a CLI failure with exit code and stderr", () => {
    const message = buildAgentProcessMessage({
      toolLabel: "Codex",
      fileChangeCount: 0,
      result: {
        exitCode: 1,
        stdout: "",
        stderr: "authentication required",
        durationMs: 120,
        cancelled: false,
        timedOut: false
      }
    });

    expect(message).toContain("Codex CLI 执行失败（exitCode=1）");
    expect(message).toContain("authentication required");
  });

  it("explains a silent successful run differently when files changed", () => {
    expect(
      buildAgentProcessMessage({
        toolLabel: "Codex",
        fileChangeCount: 2,
        result: {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 120,
          cancelled: false,
          timedOut: false
        }
      })
    ).toContain("检测到 2 个项目文件变更");
  });

  it("gives a next action for a silent run with no file changes", () => {
    const message = buildAgentProcessMessage({
      toolLabel: "Codex",
      fileChangeCount: 0,
      result: {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 120,
        cancelled: false,
        timedOut: false
      }
    });

    expect(message).toContain("没有输出");
    expect(message).toContain("支持非交互运行");
  });

  it("adds a Claude non-interactive auth hint for invalid bearer token failures", () => {
    const message = buildAgentProcessMessage({
      toolLabel: "Claude",
      toolId: "claude",
      fileChangeCount: 0,
      result: {
        exitCode: 1,
        stdout: "",
        stderr: "Failed to authenticate. API Error: 401 Invalid bearer token",
        durationMs: 120,
        cancelled: false,
        timedOut: false
      }
    });

    expect(message).toContain("claude --print");
    expect(message).toContain("claude setup-token");
  });
});

describe("AgentService", () => {
  it("runs a discovered local CLI in the Godot project and records file changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-agent-service-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "studio-state.json"));
    const projectService = new ProjectService(paths, store);
    const runOutputs: string[] = [];
    const runService = new RunService(store, (event) => {
      const output = event.run.steps[0]?.output;
      if (output) {
        runOutputs.push(output);
      }
    });
    const processRegistry = new ProcessRegistry();
    const fileChangeService = new ProjectFileChangeService();
    const contextService = new AgentContextService();

    try {
      await writeTemplate(paths);
      const project = await projectService.createProject({
        name: "Fake CLI Demo",
        dimension: "2d",
        prompt: "我要创建一个黄金矿工"
      });
      const cliTool = fakeTool("fake-codex");
      const cliService = {
        discover: async () => [cliTool],
        runTurn: async function* (_toolId: string, req: { prompt: string; workingDir: string }) {
          await mkdir(path.join(req.workingDir, "scripts"), { recursive: true });
          await writeFile(
            path.join(req.workingDir, "scripts", "agent_generated.gd"),
            `# Generated by fake CLI\n# Context file referenced: ${req.prompt.includes(".gameaistudio")}\n`,
            "utf8"
          );
          yield { type: "text-delta", text: "fake " };
          yield { type: "text-delta", text: "CLI wrote scripts/agent_generated.gd" };
          yield {
            type: "final",
            content: "fake CLI wrote scripts/agent_generated.gd",
            exitCode: 0,
            durationMs: 7
          };
        }
      } as unknown as CliService;
      const streamEvents: AgentStreamEvent[] = [];
      const agentService = new AgentService(
        projectService,
        cliService,
        runService,
        processRegistry,
        fileChangeService,
        contextService,
        (event) => streamEvents.push(event)
      );

      const result = await agentService.runTurn({
        projectId: project.id,
        agentId: "programmer",
        cliToolId: "codex",
        message: "请实现第一版脚本。",
        autoStartPreview: false
      });

      // Live token stream: deltas are emitted as they arrive, then a `done`.
      const deltas = streamEvents.filter((e) => !e.done).map((e) => e.delta);
      expect(deltas).toEqual(["fake ", "CLI wrote scripts/agent_generated.gd"]);
      expect(streamEvents.at(-1)?.done).toBe(true);
      // The streamed message id is reused for the persisted assistant message.
      const streamedId = streamEvents[0]?.messageId;
      const persisted = [...result.messages].reverse().find((m) => m.role === "agent");
      expect(streamedId).toBe(persisted?.id);

      const generated = await readFile(path.join(project.rootPath, "scripts", "agent_generated.gd"), "utf8");
      expect(generated).toContain("Context file referenced: true");
      const agentMessage = [...result.messages].reverse().find((message) => message.role === "agent");
      expect(agentMessage?.content).toContain("fake CLI wrote");
      expect(agentMessage?.fileChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "scripts/agent_generated.gd",
            kind: "added"
          })
        ])
      );
      expect(result.runs[0]?.status).toBe("completed");
      expect(runOutputs.some((output) => output.includes("fake "))).toBe(true);
      expect(await readFile(path.join(project.rootPath, ".gameaistudio", "agent-journal.md"), "utf8")).toContain("scripts/agent_generated.gd");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists image attachments and points the Agent prompt at their project files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-agent-service-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "studio-state.json"));
    const projectService = new ProjectService(paths, store);
    const runService = new RunService(store);
    const processRegistry = new ProcessRegistry();
    const fileChangeService = new ProjectFileChangeService();
    const contextService = new AgentContextService();

    try {
      await writeTemplate(paths);
      const project = await projectService.createProject({
        name: "Attachment Demo",
        dimension: "2d",
        prompt: "用截图做 UI"
      });
      const cliTool = fakeTool(process.execPath);
      const cliService = {
        discover: async () => [cliTool],
        runTurn: async function* (_toolId: string, req: { prompt: string; workingDir: string }) {
          await writeFile(path.join(req.workingDir, "prompt.txt"), req.prompt, "utf8");
          yield { type: "text-delta", text: "saw attachment prompt" };
          yield { type: "final", content: "saw attachment prompt", exitCode: 0, durationMs: 3 };
        }
      } as unknown as CliService;
      const agentService = new AgentService(projectService, cliService, runService, processRegistry, fileChangeService, contextService);

      const result = await agentService.runTurn({
        projectId: project.id,
        agentId: "designer",
        cliToolId: "codex",
        message: "参考这张截图调整聊天区。",
        autoStartPreview: false,
        attachments: [
          {
            name: "chat.png",
            mimeType: "image/png",
            size: 4,
            dataUrl: "data:image/png;base64,iVBORw=="
          }
        ]
      });

      const userMessage = result.messages.find((message) => message.role === "user");
      expect(userMessage?.attachments?.[0]?.projectRelativePath).toContain(".gameaistudio/attachments/");
      expect(await readFile(path.join(project.rootPath, userMessage!.attachments![0]!.projectRelativePath), "base64")).toBe("iVBORw==");
      expect(await readFile(path.join(project.rootPath, "prompt.txt"), "utf8")).toContain("本轮图片附件");
      expect(await readFile(path.join(project.rootPath, "prompt.txt"), "utf8")).toContain("chat.png");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks sandbox ACL failures as failed even when the CLI exits with 0", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-agent-service-"));
    const paths = createPaths(root);
    const store = new StudioStore(path.join(paths.dataRoot, "studio-state.json"));
    const projectService = new ProjectService(paths, store);
    const runService = new RunService(store);
    const processRegistry = new ProcessRegistry();
    const fileChangeService = new ProjectFileChangeService();
    const contextService = new AgentContextService();

    try {
      await writeTemplate(paths);
      const project = await projectService.createProject({
        name: "Sandbox Failure Demo",
        dimension: "2d",
        prompt: "我要创建一个跑酷游戏"
      });
      const cliTool = fakeTool("fake-codex");
      const cliService = {
        discover: async () => [cliTool],
        runTurn: async function* () {
          yield {
            type: "text-delta",
            text: "OpenAI Codex\nsandbox: read-only\nexecution error: Io(Custom { kind: Other, error: \"windows sandbox: helper_unknown_error: apply deny-read ACLs\" })"
          };
          yield {
            type: "final",
            content:
              "execution error: Io(Custom { kind: Other, error: \"windows sandbox: helper_unknown_error: apply deny-read ACLs\" })",
            stderr: "",
            exitCode: 0,
            durationMs: 5
          };
        }
      } as unknown as CliService;
      const agentService = new AgentService(projectService, cliService, runService, processRegistry, fileChangeService, contextService);

      const result = await agentService.runTurn({
        projectId: project.id,
        agentId: "programmer",
        cliToolId: "codex",
        message: "请实现第一版跑酷玩法。",
        autoStartPreview: false
      });

      const agentMessage = [...result.messages].reverse().find((message) => message.role === "agent");
      expect(agentMessage?.exitCode).toBe(1);
      expect(agentMessage?.content).toContain("Codex CLI 执行失败（exitCode=1）");
      expect(agentMessage?.content).toContain("权限诊断");
      expect(result.runs[0]?.status).toBe("failed");
      expect(result.runs[0]?.steps[0]?.status).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
