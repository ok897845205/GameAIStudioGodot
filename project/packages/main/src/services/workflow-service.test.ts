import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  chooseAgentCli,
  type AgentMessage,
  type CliTool,
  type CliToolId,
  type ProjectFileChange,
  type ProjectDetails,
  type StudioProject,
  type WebBuildInspection
} from "@gameaistudio/shared";
import { describe, expect, it } from "vitest";
import { RunService } from "./run-service";
import { StudioStore } from "./store";
import { buildWorkflowRunSteps, isAgentWorkflowStepFailed, WorkflowService } from "./workflow-service";

function tool(id: CliToolId, installed = true): CliTool {
  return {
    id,
    label: CLI_TOOL_LABELS[id],
    command: id,
    installed,
    status: installed ? "available" : "missing",
    installCommand: ["npm", "install", "-g", id],
    installHint: `Install ${id}`,
    installManager: "npm",
    installManagerAvailable: true,
    defaultArgs: [],
    credentialStatus: "unknown",
    credentialEnvVars: [],
    detectedCredentialEnvVars: [],
    credentialHint: "",
    capabilities: {
      runModel: "local",
      supportsImages: true,
      imageInputMode: "prompt-path-reference",
      supportsStream: true,
      supportsResume: false,
      headless: true
    },
    health: {
      installed,
      authed: installed ? true : "unknown",
      headlessOk: installed ? true : "unknown"
    },
    diagnostics: [],
    lastCheckedAt: "2026-06-08T00:00:00.000Z"
  };
}

function agent(id: string) {
  const profile = AGENT_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Unknown agent: ${id}`);
  }
  return profile;
}

function createProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "Gold Miner",
    dimension: "2d",
    prompt: "创建黄金矿工",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
}

function createInspection(project: StudioProject, ok: boolean): WebBuildInspection {
  return {
    projectId: project.id,
    webBuildPath: project.webBuildPath,
    ok,
    files: ok ? ["game.pck", "game.wasm", "index.html"] : ["index.html"],
    totalBytes: ok ? 1024 : 12,
    requiredFiles: ["index.html", "*.wasm", "*.pck"],
    missingRequiredFiles: ok ? [] : ["*.wasm", "*.pck"],
    message: ok ? "Web build contains 3 files." : "Web build is missing required files: *.wasm, *.pck."
  };
}

function fileChange(filePath = "scripts/player.gd"): ProjectFileChange {
  return {
    path: filePath,
    kind: "modified",
    beforeSize: 10,
    afterSize: 20,
    beforeHash: "before",
    afterHash: "after",
    isText: true
  };
}

describe("chooseAgentCli", () => {
  it("uses each role's default CLI when it is installed (flagship: kscc)", () => {
    const tools = [tool("codex"), tool("claude"), tool("kscc"), tool("kimi")];

    expect(chooseAgentCli(agent("producer"), tools)).toBe("kscc");
    expect(chooseAgentCli(agent("designer"), tools)).toBe("kscc");
    expect(chooseAgentCli(agent("programmer"), tools)).toBe("kscc");
    expect(chooseAgentCli(agent("artist"), tools)).toBe("kscc");
    expect(chooseAgentCli(agent("qa"), tools)).toBe("kscc");
  });

  it("falls back to the first installed CLI when a role default is missing", () => {
    const tools = [tool("codex"), tool("claude", false), tool("kscc", false), tool("kimi", false)];

    expect(chooseAgentCli(agent("designer"), tools)).toBe("codex");
  });

  it("uses an explicitly preferred installed CLI as an override", () => {
    const tools = [tool("codex"), tool("claude"), tool("kscc"), tool("kimi")];

    expect(chooseAgentCli(agent("designer"), tools, "kimi")).toBe("kimi");
  });

  it("ignores a preferred CLI when it is not installed and returns the role default", () => {
    const tools = [tool("codex"), tool("kscc"), tool("kimi", false)];

    expect(chooseAgentCli(agent("designer"), tools, "kimi")).toBe("kscc");
  });

  it("skips installed CLI tools whose adapter health is unavailable", () => {
    const unhealthyClaude: CliTool = {
      ...tool("claude"),
      status: "error",
      health: {
        installed: true,
        authed: false,
        headlessOk: false,
        detail: "非交互模式返回未授权。"
      }
    };
    const tools = [unhealthyClaude, tool("codex")];

    expect(chooseAgentCli(agent("designer"), tools)).toBe("codex");
  });
});

describe("buildWorkflowRunSteps", () => {
  it("adds Web export, artifact inspection, zip packaging, and preview refresh steps after Agent steps", () => {
    const agents = [agent("producer"), agent("programmer")];
    const steps = buildWorkflowRunSteps(agents, [tool("codex")], {
      projectId: "project_1",
      message: "创建黄金矿工",
      autoExportWeb: true,
      autoPackageWebZip: true,
      autoStartPreview: true
    });

    expect(steps.map((step) => step.title)).toEqual([
      "1. 制作人：目标拆解、里程碑、取舍",
      "2. 程序：Godot 脚本、场景、导出",
      "Godot Web 自动导出",
      "Web 构建产物检查",
      "打包 Web zip",
      "刷新实时 Web 预览"
    ]);
  });

  it("uses per-Agent CLI selections for workflow steps", () => {
    const agents = [agent("producer"), agent("designer"), agent("artist")];
    const steps = buildWorkflowRunSteps(agents, [tool("codex"), tool("claude"), tool("kimi")], {
      projectId: "project_1",
      message: "创建黄金矿工",
      agentCliToolIds: {
        producer: "kimi",
        designer: "codex",
        artist: "claude"
      },
      autoExportWeb: false,
      autoPackageWebZip: false,
      autoStartPreview: false
    });

    expect(steps.map((step) => step.cliToolId)).toEqual(["kimi", "codex", "claude"]);
  });

  it("stops team zip packaging when the Web build inspection fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-workflow-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);
    const messages: AgentMessage[] = [];
    let zipCalled = false;

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages,
        runs: await runService.listRuns(project.id)
      }),
      appendMessages: async (_projectId: string, nextMessages: AgentMessage[]) => {
        messages.push(...nextMessages);
        return messages;
      }
    };
    const cliService = {
      discover: async () => [tool("codex")]
    };
    const agentService = {
      runTurn: async () => {
        const message: AgentMessage = {
          id: "msg_1",
          projectId: project.id,
          agentId: "producer",
          role: "agent",
          content: "done",
          createdAt: new Date().toISOString(),
          cliToolId: "codex",
          exitCode: 0,
          fileChanges: [fileChange()]
        };
        return {
          messages: [message],
          project: { ...project, messages: [message], runs: [] },
          runs: []
        };
      }
    };
    const godotService = {
      exportWeb: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      })
    };
    const exportService = {
      inspectWebBuild: async () => createInspection(project, false),
      zipWebBuild: async () => {
        zipCalled = true;
        return {
          projectId: project.id,
          zipPath: path.join(project.rootPath, "dist", "game.zip"),
          webBuildPath: project.webBuildPath
        };
      }
    };
    const autoPreviewService = {
      start: async () => ({
        projectId: project.id,
        url: "http://127.0.0.1:3000",
        webBuildPath: project.webBuildPath
      })
    };

    try {
      const workflow = new WorkflowService(
        projectService as never,
        cliService as never,
        agentService as never,
        godotService as never,
        exportService as never,
        autoPreviewService as never,
        runService
      );

      const result = await workflow.run({
        projectId: project.id,
        message: "创建黄金矿工",
        agentIds: ["producer"],
        autoExportWeb: true,
        autoPackageWebZip: true,
        autoStartPreview: false
      });

      expect(result.run.status).toBe("failed");
      expect(result.inspectionResult?.missingRequiredFiles).toEqual(["*.wasm", "*.pck"]);
      expect(zipCalled).toBe(false);
      expect(result.run.steps.map((step) => step.status)).toEqual(["completed", "completed", "failed", "failed"]);
      // Kickoff announcement + final summary, both system messages.
      expect(result.project.messages).toHaveLength(2);
      expect(result.project.messages[0]?.kind).toBe("workflow");
      expect(result.project.messages[0]?.content).toContain("团队工作流已启动");
      const summary = result.project.messages.at(-1);
      expect(summary?.role).toBe("system");
      expect(summary?.content).toContain("Web 构建产物检查");
      expect(summary?.content).toContain("*.wasm, *.pck");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips auto delivery steps when every Agent step fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-workflow-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);
    const messages: AgentMessage[] = [];
    let exportCalled = false;
    let inspectCalled = false;
    let zipCalled = false;
    let previewCalled = false;
    let commitCalled = false;

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages,
        runs: await runService.listRuns(project.id)
      }),
      appendMessages: async (_projectId: string, nextMessages: AgentMessage[]) => {
        messages.push(...nextMessages);
        return messages;
      }
    };
    const cliService = {
      discover: async () => [tool("codex")]
    };
    const agentService = {
      runTurn: async (input: { agentId: string; cliToolId: CliToolId }) => {
        const message: AgentMessage = {
          id: `msg_${input.agentId}`,
          projectId: project.id,
          agentId: input.agentId,
          role: "agent",
          content: `${CLI_TOOL_LABELS[input.cliToolId]} 执行失败（exitCode=1）。`,
          createdAt: new Date().toISOString(),
          cliToolId: input.cliToolId,
          exitCode: 1
        };
        return {
          messages: [message],
          project: { ...project, messages: [message], runs: [] },
          runs: []
        };
      }
    };
    const godotService = {
      exportWeb: async () => {
        exportCalled = true;
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1
        };
      }
    };
    const exportService = {
      inspectWebBuild: async () => {
        inspectCalled = true;
        return createInspection(project, true);
      },
      zipWebBuild: async () => {
        zipCalled = true;
        return {
          projectId: project.id,
          zipPath: path.join(project.rootPath, "dist", "game.zip"),
          webBuildPath: project.webBuildPath
        };
      }
    };
    const autoPreviewService = {
      start: async () => {
        previewCalled = true;
        return {
          projectId: project.id,
          url: "http://127.0.0.1:3000",
          webBuildPath: project.webBuildPath
        };
      }
    };

    try {
      const workflow = new WorkflowService(
        projectService as never,
        cliService as never,
        agentService as never,
        godotService as never,
        exportService as never,
        autoPreviewService as never,
        runService,
        {
          commit: async () => {
            commitCalled = true;
            return {} as never;
          }
        }
      );

      const result = await workflow.run({
        projectId: project.id,
        message: "创建黄金矿工",
        agentIds: ["producer", "programmer"],
        autoExportWeb: true,
        autoPackageWebZip: true,
        autoStartPreview: true
      });

      expect(result.run.status).toBe("failed");
      expect(result.exportResult).toBeUndefined();
      expect(result.inspectionResult).toBeUndefined();
      expect(result.zipResult).toBeUndefined();
      expect(result.previewResult).toBeUndefined();
      expect(exportCalled).toBe(false);
      expect(inspectCalled).toBe(false);
      expect(zipCalled).toBe(false);
      expect(previewCalled).toBe(false);
      expect(commitCalled).toBe(false);
      expect(result.run.steps.map((step) => step.status)).toEqual(["failed", "failed", "failed", "failed", "failed", "failed"]);
      expect(result.run.steps.slice(2).every((step) => step.message?.includes("所有 Agent 步骤都失败"))).toBe(true);
      expect(result.project.messages).toHaveLength(2);
      const failureSummary = result.project.messages.at(-1);
      expect(failureSummary?.content).toContain("Godot Web 导出: 未执行");
      expect(failureSummary?.content).toContain("Web zip: 未执行");
      expect(failureSummary?.content).toContain("所有 2 个 Agent 步骤失败");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips auto delivery and git auto-save when any Agent step fails after project changes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-workflow-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);
    const messages: AgentMessage[] = [];
    let exportCalled = false;
    let inspectCalled = false;
    let zipCalled = false;
    let previewCalled = false;
    let commitCalled = false;

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages,
        runs: await runService.listRuns(project.id)
      }),
      appendMessages: async (_projectId: string, nextMessages: AgentMessage[]) => {
        messages.push(...nextMessages);
        return messages;
      }
    };
    const cliService = {
      discover: async () => [tool("codex")]
    };
    const agentService = {
      runTurn: async (input: { agentId: string; cliToolId: CliToolId }) => {
        const failed = input.agentId === "programmer";
        const message: AgentMessage = {
          id: `msg_${input.agentId}`,
          projectId: project.id,
          agentId: input.agentId,
          role: "agent",
          content: failed ? "Codex CLI 执行失败（exitCode=1）。\n\nERROR: Selected model is at capacity." : "done",
          createdAt: new Date().toISOString(),
          cliToolId: input.cliToolId,
          exitCode: failed ? 1 : 0,
          fileChanges: [fileChange(failed ? "scripts/player.gd" : ".gameaistudio/producer-brief.md")]
        };
        return {
          messages: [message],
          project: { ...project, messages: [message], runs: [] },
          runs: []
        };
      }
    };
    const godotService = {
      exportWeb: async () => {
        exportCalled = true;
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1
        };
      }
    };
    const exportService = {
      inspectWebBuild: async () => {
        inspectCalled = true;
        return createInspection(project, true);
      },
      zipWebBuild: async () => {
        zipCalled = true;
        return {
          zipPath: path.join(project.rootPath, "dist", "game.zip"),
          webBuildPath: project.webBuildPath
        };
      }
    };
    const autoPreviewService = {
      start: async () => {
        previewCalled = true;
        return {
          projectId: project.id,
          url: "http://127.0.0.1:3000",
          webBuildPath: project.webBuildPath
        };
      }
    };

    try {
      const workflow = new WorkflowService(
        projectService as never,
        cliService as never,
        agentService as never,
        godotService as never,
        exportService as never,
        autoPreviewService as never,
        runService,
        {
          commit: async () => {
            commitCalled = true;
            return {} as never;
          }
        }
      );

      const result = await workflow.run({
        projectId: project.id,
        message: "创建跑酷游戏",
        agentIds: ["producer", "programmer"],
        autoExportWeb: true,
        autoPackageWebZip: true,
        autoStartPreview: true
      });

      expect(result.run.status).toBe("failed");
      expect(result.exportResult).toBeUndefined();
      expect(result.inspectionResult).toBeUndefined();
      expect(result.zipResult).toBeUndefined();
      expect(result.previewResult).toBeUndefined();
      expect(exportCalled).toBe(false);
      expect(inspectCalled).toBe(false);
      expect(zipCalled).toBe(false);
      expect(previewCalled).toBe(false);
      expect(commitCalled).toBe(false);
      expect(result.run.steps.map((step) => step.status)).toEqual(["completed", "failed", "failed", "failed", "failed", "failed"]);
      expect(result.run.steps.slice(2).every((step) => step.message?.includes("已有 1 个 Agent 步骤失败"))).toBe(true);
      expect(result.project.messages.at(-1)?.content).toContain("Godot Web 导出: 未执行");
      expect(result.project.messages.at(-1)?.content).toContain("失败步骤 5 个");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips auto delivery when Agent steps succeed but do not change project files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-workflow-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);
    const messages: AgentMessage[] = [];
    let exportCalled = false;
    let inspectCalled = false;
    let zipCalled = false;
    let previewCalled = false;
    let commitCalled = false;

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages,
        runs: await runService.listRuns(project.id)
      }),
      appendMessages: async (_projectId: string, nextMessages: AgentMessage[]) => {
        messages.push(...nextMessages);
        return messages;
      }
    };
    const cliService = {
      discover: async () => [tool("codex")]
    };
    const agentService = {
      runTurn: async () => {
        const message: AgentMessage = {
          id: "msg_1",
          projectId: project.id,
          agentId: "producer",
          role: "agent",
          content: "我给出了建议，但没有写入文件。",
          createdAt: new Date().toISOString(),
          cliToolId: "codex",
          exitCode: 0,
          fileChanges: []
        };
        return {
          messages: [message],
          project: { ...project, messages: [message], runs: [] },
          runs: []
        };
      }
    };
    const godotService = {
      exportWeb: async () => {
        exportCalled = true;
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1
        };
      }
    };
    const exportService = {
      inspectWebBuild: async () => {
        inspectCalled = true;
        return createInspection(project, true);
      },
      zipWebBuild: async () => {
        zipCalled = true;
        return {
          projectId: project.id,
          zipPath: path.join(project.rootPath, "dist", "game.zip"),
          webBuildPath: project.webBuildPath
        };
      }
    };
    const autoPreviewService = {
      start: async () => {
        previewCalled = true;
        return {
          projectId: project.id,
          url: "http://127.0.0.1:3000",
          webBuildPath: project.webBuildPath
        };
      }
    };

    try {
      const workflow = new WorkflowService(
        projectService as never,
        cliService as never,
        agentService as never,
        godotService as never,
        exportService as never,
        autoPreviewService as never,
        runService,
        {
          commit: async () => {
            commitCalled = true;
            return {} as never;
          }
        }
      );

      const result = await workflow.run({
        projectId: project.id,
        message: "创建黄金矿工",
        agentIds: ["producer"],
        autoExportWeb: true,
        autoPackageWebZip: true,
        autoStartPreview: true
      });

      expect(result.run.status).toBe("failed");
      expect(result.exportResult).toBeUndefined();
      expect(result.inspectionResult).toBeUndefined();
      expect(result.zipResult).toBeUndefined();
      expect(result.previewResult).toBeUndefined();
      expect(exportCalled).toBe(false);
      expect(inspectCalled).toBe(false);
      expect(zipCalled).toBe(false);
      expect(previewCalled).toBe(false);
      expect(commitCalled).toBe(false);
      expect(result.run.steps.map((step) => step.status)).toEqual(["completed", "failed", "failed", "failed", "failed"]);
      expect(result.run.summary).toContain("没有产生项目文件变更");
      expect(result.run.steps.slice(1).every((step) => step.message?.includes("没有产生项目文件变更"))).toBe(true);
      expect(result.project.messages.at(-1)?.content).toContain("Godot Web 导出: 未执行");
      expect(result.project.messages.at(-1)?.content).toContain("Web zip: 未执行");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends the export manifest path to the team workflow summary when zip succeeds", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-workflow-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    const inspection = createInspection(project, true);
    const manifestPath = path.join(project.webBuildPath, "gameaistudio-export.json");
    await store.upsertProject(project);
    const messages: AgentMessage[] = [];
    const commits: Array<{ projectId: string; message: string }> = [];

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({
        ...project,
        messages,
        runs: await runService.listRuns(project.id)
      }),
      appendMessages: async (_projectId: string, nextMessages: AgentMessage[]) => {
        messages.push(...nextMessages);
        return messages;
      }
    };
    const cliService = {
      discover: async () => [tool("codex")]
    };
    const agentService = {
      runTurn: async () => {
        const message: AgentMessage = {
          id: "msg_1",
          projectId: project.id,
          agentId: "producer",
          role: "agent",
          content: "done",
          createdAt: new Date().toISOString(),
          cliToolId: "codex",
          exitCode: 0,
          fileChanges: [fileChange()]
        };
        return {
          messages: [message],
          project: { ...project, messages: [message], runs: [] },
          runs: []
        };
      }
    };
    const godotService = {
      exportWeb: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1
      })
    };
    const exportService = {
      inspectWebBuild: async () => inspection,
      zipWebBuild: async () => ({
        projectId: project.id,
        zipPath: path.join(project.rootPath, "dist", "game.zip"),
        manifestPath,
        webBuildPath: project.webBuildPath,
        inspection
      })
    };
    const autoPreviewService = {
      start: async () => ({
        projectId: project.id,
        url: "http://127.0.0.1:3000",
        webBuildPath: project.webBuildPath
      })
    };

    try {
      const workflow = new WorkflowService(
        projectService as never,
        cliService as never,
        agentService as never,
        godotService as never,
        exportService as never,
        autoPreviewService as never,
        runService,
        {
          commit: async (commit) => {
            commits.push(commit);
            return {} as never;
          }
        }
      );

      const result = await workflow.run({
        projectId: project.id,
        message: "创建黄金矿工",
        agentIds: ["producer"],
        autoExportWeb: true,
        autoPackageWebZip: true,
        autoStartPreview: false
      });

      expect(result.run.status).toBe("completed");
      expect(result.zipResult?.manifestPath).toBe(manifestPath);
      // Kickoff + summary + git auto-save announcement.
      expect(result.project.messages).toHaveLength(3);
      expect(result.project.messages[0]?.kind).toBe("workflow");
      const zipSummary = result.project.messages[1];
      expect(zipSummary?.role).toBe("system");
      expect(zipSummary?.content).toContain("导出清单");
      expect(zipSummary?.content).toContain("gameaistudio-export.json");
      expect(zipSummary?.content).toContain(manifestPath);
      const gitNote = result.project.messages.at(-1);
      expect(gitNote?.kind).toBe("git");
      expect(gitNote?.content).toContain("已自动保存 Git 版本");
      expect(commits).toHaveLength(1);
      expect(commits[0]?.projectId).toBe(project.id);
      expect(commits[0]?.message).toContain("自动保存：团队工作流");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("isAgentWorkflowStepFailed", () => {
  it("treats an installed CLI with exit code 0 as successful", () => {
    expect(
      isAgentWorkflowStepFailed({
        cliToolId: "codex",
        tools: [tool("codex")],
        message: {
          id: "msg_1",
          projectId: "project_1",
          agentId: "producer",
          role: "agent",
          content: "done",
          createdAt: new Date().toISOString(),
          cliToolId: "codex",
          exitCode: 0
        }
      })
    ).toBe(false);
  });

  it("treats missing or unknown exit codes as failed", () => {
    expect(
      isAgentWorkflowStepFailed({
        cliToolId: "codex",
        tools: [tool("codex")],
        message: {
          id: "msg_1",
          projectId: "project_1",
          agentId: "producer",
          role: "agent",
          content: "Codex CLI 执行失败（exitCode=unknown）。",
          createdAt: new Date().toISOString(),
          cliToolId: "codex"
        }
      })
    ).toBe(true);
  });

  it("treats system fallback messages and missing tools as failed", () => {
    expect(
      isAgentWorkflowStepFailed({
        cliToolId: "codex",
        tools: [tool("codex")],
        message: {
          id: "msg_1",
          projectId: "project_1",
          agentId: "producer",
          role: "system",
          content: "CLI 未检测到。",
          createdAt: new Date().toISOString(),
          cliToolId: "codex"
        }
      })
    ).toBe(true);
    expect(
      isAgentWorkflowStepFailed({
        cliToolId: "codex",
        tools: [tool("codex", false)]
      })
    ).toBe(true);
  });

  it("treats an installed but unhealthy CLI as failed", () => {
    expect(
      isAgentWorkflowStepFailed({
        cliToolId: "claude",
        tools: [{ ...tool("claude"), status: "error" }],
        message: {
          id: "msg_1",
          projectId: "project_1",
          agentId: "designer",
          role: "agent",
          content: "done",
          createdAt: new Date().toISOString(),
          cliToolId: "claude",
          exitCode: 0
        }
      })
    ).toBe(true);
  });
});
