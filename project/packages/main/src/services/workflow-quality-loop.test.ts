import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type AgentMessage,
  type CliTool,
  type CliToolId,
  type ProjectDetails,
  type ProjectFileChange,
  type StudioProject
} from "@gameaistudio/shared";
import { RunService } from "./run-service";
import { StudioStore } from "./store";
import {
  buildFixRoundMessage,
  buildWorkflowRunSteps,
  parseQaVerdict,
  WorkflowService
} from "./workflow-service";

function tool(id: CliToolId): CliTool {
  return {
    id,
    label: CLI_TOOL_LABELS[id],
    command: id,
    installed: true,
    status: "available",
    installCommand: ["npm", "install", "-g", id],
    installHint: "",
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
    health: { installed: true, authed: true, headlessOk: true },
    diagnostics: [],
    lastCheckedAt: new Date().toISOString()
  };
}

function fileChange(filePath: string): ProjectFileChange {
  return { path: filePath, kind: "modified", isText: true };
}

describe("parseQaVerdict", () => {
  it("reads the explicit pass / issues verdict line", () => {
    expect(parseQaVerdict("QA结论：通过\n核心玩法可玩。")).toBe("pass");
    expect(parseQaVerdict("  QA 结论： 发现问题\n- 跳跃无效")).toBe("issues");
  });

  it("falls back to pass-like phrasing, otherwise unknown", () => {
    expect(parseQaVerdict("本轮测试未发现明显问题。")).toBe("pass");
    expect(parseQaVerdict("跳跃高度有点低，建议修复。")).toBe("unknown");
  });
});

describe("buildFixRoundMessage", () => {
  it("includes QA findings and validation errors", () => {
    const message = buildFixRoundMessage({
      userMessage: "做一个跑酷",
      qaVerdict: "issues",
      qaFindings: "QA结论：发现问题\n- 角色无法跳跃",
      validationFailed: true,
      validationOutput: "SCRIPT ERROR: Parse Error in player.gd"
    });
    expect(message).toContain("修复与打磨");
    expect(message).toContain("角色无法跳跃");
    expect(message).toContain("player.gd");
    expect(message).toContain("做一个跑酷");
  });
});

describe("buildWorkflowRunSteps withQualityLoop", () => {
  it("inserts validate / fix / git-save phases between agents and delivery", () => {
    const agents = [AGENT_PROFILES.find((a) => a.id === "programmer")!, AGENT_PROFILES.find((a) => a.id === "qa")!];
    const steps = buildWorkflowRunSteps(agents, [tool("codex")], {
      projectId: "p",
      message: "做游戏",
      autoExportWeb: true,
      autoPackageWebZip: false,
      autoStartPreview: false,
      withQualityLoop: true
    });
    expect(steps.map((step) => step.title)).toEqual([
      "1. 程序：Godot 脚本、场景、导出",
      "2. QA：测试、缺陷、验收",
      "Godot 可运行校验",
      "修复与打磨",
      "Git 保存版本",
      "Godot Web 自动导出"
    ]);
    expect(steps[3]?.agentId).toBe("programmer");
  });
});

interface QualityHarnessOptions {
  qaReply: string;
  validateResults: boolean[];
  fixReply?: string;
}

async function runQualityWorkflow(dir: string, options: QualityHarnessOptions) {
  const store = new StudioStore(path.join(dir, "state.json"));
  const runService = new RunService(store);
  const project: StudioProject = {
    id: "project_1",
    name: "Quality Demo",
    dimension: "2d",
    prompt: "做一个跑酷",
    rootPath: path.join(dir, "project"),
    webBuildPath: path.join(dir, "project", "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
  await store.upsertProject(project);
  const messages: AgentMessage[] = [];
  const agentTurns: Array<{ agentId: string; message: string }> = [];
  const commits: string[] = [];
  let validateCalls = 0;

  const projectService = {
    requireProject: async () => project,
    getProject: async (): Promise<ProjectDetails> => ({
      ...project,
      messages,
      runs: await runService.listRuns(project.id)
    }),
    appendMessages: async (_projectId: string, next: AgentMessage[]) => {
      messages.push(...next);
      return messages;
    }
  };
  const agentService = {
    runTurn: async (input: { agentId: string; message: string }) => {
      agentTurns.push({ agentId: input.agentId, message: input.message });
      const isFixRound = input.message.includes("修复与打磨");
      const content =
        input.agentId === "qa"
          ? options.qaReply
          : isFixRound
            ? options.fixReply ?? "已修复 QA 问题。"
            : "已实现基础玩法。";
      const message: AgentMessage = {
        id: `msg_${agentTurns.length}`,
        projectId: project.id,
        agentId: input.agentId,
        role: "agent",
        content,
        createdAt: new Date().toISOString(),
        cliToolId: "codex",
        exitCode: 0,
        fileChanges: input.agentId === "qa" ? [] : [fileChange(isFixRound ? "scripts/fix.gd" : "scripts/player.gd")]
      };
      return {
        messages: [message],
        project: { ...project, messages: [message], runs: [] },
        runs: []
      };
    }
  };
  const godotService = {
    validate: async () => {
      const ok = options.validateResults[Math.min(validateCalls, options.validateResults.length - 1)] ?? true;
      validateCalls += 1;
      return { ok, exitCode: ok ? 0 : 1, stdout: "", stderr: ok ? "" : "SCRIPT ERROR: bad.gd", durationMs: 1 };
    },
    exportWeb: async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", durationMs: 1 })
  };
  const exportService = {};
  const autoPreviewService = {};
  const gitService = {
    commit: async (input: { message: string }) => {
      commits.push(input.message);
      return {} as never;
    }
  };

  const workflow = new WorkflowService(
    projectService as never,
    { discover: async () => [tool("codex"), tool("kscc")] } as never,
    agentService as never,
    godotService as never,
    exportService as never,
    autoPreviewService as never,
    runService,
    gitService as never
  );

  const result = await workflow.run({
    projectId: project.id,
    message: "做一个跑酷",
    agentIds: ["programmer", "qa"],
    autoExportWeb: false,
    autoPackageWebZip: false,
    autoStartPreview: false,
    withQualityLoop: true
  });

  return { result, agentTurns, commits, validateCalls };
}

describe("WorkflowService quality loop", () => {
  it("runs the fix round when QA reports issues, then saves a Git version", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-quality-"));
    try {
      const { result, agentTurns, commits } = await runQualityWorkflow(dir, {
        qaReply: "QA结论：发现问题\n- 角色跳跃无效",
        validateResults: [true]
      });

      expect(result.run.steps.map((step) => `${step.title}:${step.status}`)).toEqual([
        "1. 程序：Godot 脚本、场景、导出:completed",
        "2. QA：测试、缺陷、验收:completed",
        "Godot 可运行校验:completed",
        "修复与打磨:completed",
        "Git 保存版本:completed"
      ]);
      // programmer round + qa round + fix round
      expect(agentTurns.map((turn) => turn.agentId)).toEqual(["programmer", "qa", "programmer"]);
      expect(agentTurns[2]?.message).toContain("角色跳跃无效");
      expect(commits).toHaveLength(1);
      expect(result.run.status).toBe("completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips the fix round when QA passes and validation is clean", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-quality-"));
    try {
      const { result, agentTurns, commits } = await runQualityWorkflow(dir, {
        qaReply: "QA结论：通过\n核心玩法可玩，导出正常。",
        validateResults: [true]
      });

      const fixStep = result.run.steps.find((step) => step.title === "修复与打磨");
      expect(fixStep?.status).toBe("skipped");
      expect(agentTurns.map((turn) => turn.agentId)).toEqual(["programmer", "qa"]);
      expect(commits).toHaveLength(1); // agent changes still saved
      expect(result.run.status).toBe("completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("re-validates after a fix triggered by a failed Godot validation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-quality-"));
    try {
      const { result, validateCalls } = await runQualityWorkflow(dir, {
        qaReply: "QA结论：通过",
        validateResults: [false, true]
      });

      const validateStep = result.run.steps.find((step) => step.title === "Godot 可运行校验");
      const fixStep = result.run.steps.find((step) => step.title === "修复与打磨");
      expect(validateStep?.status).toBe("failed");
      expect(fixStep?.status).toBe("completed");
      expect(fixStep?.message).toContain("复检通过");
      expect(validateCalls).toBe(2);
      expect(result.run.status).toBe("completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("WorkflowService per-project exclusion", () => {
  it("rejects a second workflow on the same project while the first is running", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-wf-lock-"));
    try {
      const store = new StudioStore(path.join(dir, "state.json"));
      const runService = new RunService(store);
      const project: StudioProject = {
        id: "project_lock",
        name: "Lock Demo",
        dimension: "2d",
        prompt: "test",
        rootPath: path.join(dir, "project"),
        webBuildPath: path.join(dir, "project", "build", "web"),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activeAgentId: "producer"
      };
      await store.upsertProject(project);
      const messages: AgentMessage[] = [];
      let releaseTurn: (() => void) | undefined;
      const turnGate = new Promise<void>((resolve) => {
        releaseTurn = resolve;
      });

      const workflow = new WorkflowService(
        {
          requireProject: async () => project,
          getProject: async (): Promise<ProjectDetails> => ({ ...project, messages, runs: [] }),
          appendMessages: async (_id: string, next: AgentMessage[]) => {
            messages.push(...next);
            return messages;
          }
        } as never,
        { discover: async () => [tool("codex")] } as never,
        {
          runTurn: async (input: { agentId: string }) => {
            await turnGate;
            const message: AgentMessage = {
              id: `m_${Date.now()}`,
              projectId: project.id,
              agentId: input.agentId,
              role: "agent",
              content: "QA结论：通过",
              createdAt: new Date().toISOString(),
              cliToolId: "codex",
              exitCode: 0,
              fileChanges: []
            };
            return { messages: [message], project: { ...project, messages: [message], runs: [] }, runs: [] };
          }
        } as never,
        { validate: async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", durationMs: 1 }) } as never,
        {} as never,
        {} as never,
        runService
      );

      const input = {
        projectId: project.id,
        message: "并发",
        agentIds: ["producer"],
        autoExportWeb: false,
        autoPackageWebZip: false,
        autoStartPreview: false
      };
      const first = workflow.run(input);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(workflow.run(input)).rejects.toThrow("正有");

      releaseTurn?.();
      await first;
      // Lock released → a new workflow may start again.
      releaseTurn = undefined;
      const second = workflow.run(input);
      await expect(second).resolves.toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20000);
});
