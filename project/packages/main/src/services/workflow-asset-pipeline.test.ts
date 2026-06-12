import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENT_PROFILES,
  type AgentMessage,
  type CliTool,
  type CliToolId,
  type GenerateAudioInput,
  type GenerateImageInput,
  type GeneratedAssetRecord,
  type GeneratedAudioRecord,
  type ProjectDetails,
  type SetGeneratedAssetSlotInput,
  type SetGeneratedAudioSlotInput,
  type StudioProject
} from "@gameaistudio/shared";
import { describe, expect, it } from "vitest";
import { RunService } from "./run-service";
import { StudioStore } from "./store";
import { buildWorkflowPhases, buildWorkflowRunSteps, WorkflowService } from "./workflow-service";

function tool(id: CliToolId): CliTool {
  return {
    id,
    label: id,
    command: id,
    installed: true,
    status: "available",
    installCommand: [],
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
    lastCheckedAt: "2026-06-11T00:00:00.000Z"
  };
}

function agent(id: string) {
  const profile = AGENT_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown agent: ${id}`);
  return profile;
}

function createProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "横版射击",
    dimension: "2d",
    prompt: "做一个横版射击游戏",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
}

function record(id: string, slotless = true): GeneratedAssetRecord {
  return {
    id,
    projectId: "project_1",
    fileName: `${id}.png`,
    projectRelativePath: `assets/characters/${id}.png`,
    resPath: `res://assets/characters/${id}.png`,
    prompt: "spaceship",
    purpose: "character",
    modelId: "nano-banana",
    mimeType: "image/png",
    sizeBytes: 10,
    createdAt: new Date().toISOString(),
    ...(slotless ? {} : { slot: "player_ship" })
  };
}

const ARTIST_PLAN_REPLY = [
  "视觉方向：像素风。素材计划：",
  "```json",
  JSON.stringify({
    assets: [
      { key: "player_ship", description: "side-view spaceship", purpose: "character", transparentBackground: true },
      { key: "enemy_drone", description: "hostile drone", purpose: "enemy" }
    ]
  }),
  "```"
].join("\n");

describe("buildWorkflowPhases", () => {
  it("inserts the asset-generation phase right after the artist when enabled", () => {
    const agents = [agent("producer"), agent("artist"), agent("programmer")];
    const phases = buildWorkflowPhases(agents, {
      projectId: "p",
      message: "m",
      autoExportWeb: false,
      autoPackageWebZip: false,
      autoStartPreview: false,
      withAssetPipeline: true
    });
    expect(phases.map((phase) => (phase.kind === "agent" ? phase.agent.id : "asset-generation"))).toEqual([
      "producer",
      "artist",
      "asset-generation",
      "programmer"
    ]);
  });

  it("stays agent-only without the flag or without an artist", () => {
    const base = { projectId: "p", message: "m", autoExportWeb: false, autoPackageWebZip: false, autoStartPreview: false };
    expect(buildWorkflowPhases([agent("artist")], base)).toHaveLength(1);
    expect(buildWorkflowPhases([agent("programmer")], { ...base, withAssetPipeline: true })).toHaveLength(1);
  });
});

describe("workflow asset pipeline", () => {
  async function runPipelineWorkflow(options: {
    artistReply: string;
    generateImage: (input: GenerateImageInput) => Promise<{ ok: boolean; modelId: string; assets: GeneratedAssetRecord[]; attempts: never[]; error?: string }>;
  }) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-asset-flow-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);
    const messages: AgentMessage[] = [];
    const turnMessages: Record<string, string> = {};
    const slotCalls: SetGeneratedAssetSlotInput[] = [];

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({ ...project, messages, runs: await runService.listRuns(project.id) }),
      appendMessages: async (_projectId: string, next: AgentMessage[]) => {
        messages.push(...next);
        return messages;
      }
    };
    const agentService = {
      runTurn: async (input: { agentId: string; cliToolId: CliToolId; message: string }) => {
        turnMessages[input.agentId] = input.message;
        const message: AgentMessage = {
          id: `msg_${input.agentId}`,
          projectId: project.id,
          agentId: input.agentId,
          role: "agent",
          content: input.agentId === "artist" ? options.artistReply : "done",
          createdAt: new Date().toISOString(),
          cliToolId: input.cliToolId,
          exitCode: 0,
          fileChanges: input.agentId === "programmer" ? [{ path: "main.tscn", kind: "modified" as const, isText: true }] : []
        };
        return { messages: [message], project: { ...project, messages: [message], runs: [] }, runs: [] };
      }
    };
    const imageGenerationService = { generateImage: options.generateImage };
    const assetLibraryService = {
      setSlot: async (input: SetGeneratedAssetSlotInput) => {
        slotCalls.push(input);
        return { projectId: input.projectId, assets: [] };
      }
    };

    try {
      const workflow = new WorkflowService(
        projectService as never,
        { discover: async () => [tool("codex")] } as never,
        agentService as never,
        {} as never,
        {} as never,
        {} as never,
        runService,
        undefined,
        undefined,
        imageGenerationService as never,
        assetLibraryService as never
      );
      const result = await workflow.run({
        projectId: project.id,
        message: "做一个横版射击游戏",
        agentIds: ["artist", "programmer"],
        autoExportWeb: false,
        autoPackageWebZip: false,
        autoStartPreview: false,
        withAssetPipeline: true
      });
      return { result, messages, turnMessages, slotCalls };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("generates planned assets, binds slots and hands res:// paths to the programmer", async () => {
    const generateCalls: GenerateImageInput[] = [];
    const { result, messages, turnMessages, slotCalls } = await runPipelineWorkflow({
      artistReply: ARTIST_PLAN_REPLY,
      generateImage: async (input) => {
        generateCalls.push(input);
        if (input.prompt.includes("drone")) {
          return { ok: false, modelId: "nano-banana", assets: [], attempts: [], error: "上游超时" };
        }
        return { ok: true, modelId: "nano-banana", assets: [record("ship1")], attempts: [] };
      }
    });

    expect(result.run.steps.map((step) => step.title)).toEqual([
      "1. 美术：视觉风格、素材清单、占位资产",
      "AI 素材生成",
      "2. 程序：Godot 脚本、场景、导出"
    ]);
    const assetStep = result.run.steps[1]!;
    expect(assetStep.status).toBe("completed");
    expect(assetStep.output).toContain("res://assets/characters/ship1.png");
    expect(assetStep.output).toContain("enemy_drone 生成失败");

    // The artist was asked for a machine-readable plan.
    expect(turnMessages.artist).toContain("```json");
    // Generation calls mirror the plan items.
    expect(generateCalls).toHaveLength(2);
    expect(generateCalls[0]).toMatchObject({ purpose: "character", transparentBackground: true });
    // The first asset of the item got the slot.
    expect(slotCalls).toEqual([{ projectId: "project_1", assetId: "ship1", slot: "player_ship" }]);
    // The programmer round received the asset note with paths and missing items.
    expect(turnMessages.programmer).toContain("player_ship → res://assets/characters/ship1.png");
    expect(turnMessages.programmer).toContain("enemy_drone");
    expect(turnMessages.programmer).toContain("占位");
    // The chat got a visible asset-generation message.
    expect(messages.some((message) => message.kind === "workflow" && message.content.includes("AI 素材生成完成"))).toBe(true);
    expect(result.run.status).toBe("completed");
  });

  it("skips the asset step gracefully when the artist gives no plan", async () => {
    const { result, turnMessages } = await runPipelineWorkflow({
      artistReply: "建议像素风格，主角是一艘飞船。",
      generateImage: async () => {
        throw new Error("should not be called");
      }
    });

    const assetStep = result.run.steps[1]!;
    expect(assetStep.status).toBe("skipped");
    expect(assetStep.message).toContain("未输出可解析的素材计划");
    expect(turnMessages.programmer).toContain("占位");
    expect(result.run.status).toBe("completed");
  });

  it("marks the asset step failed but continues when every item fails", async () => {
    const { result, turnMessages } = await runPipelineWorkflow({
      artistReply: ARTIST_PLAN_REPLY,
      generateImage: async () => ({ ok: false, modelId: "m", assets: [], attempts: [], error: "未配置模型" })
    });

    const assetStep = result.run.steps[1]!;
    expect(assetStep.status).toBe("failed");
    // The workflow itself keeps going: the programmer round still runs with placeholder guidance.
    expect(result.run.steps[2]?.status).toBe("completed");
    expect(turnMessages.programmer).toContain("占位");
    expect(result.run.status).toBe("failed");
  });
});

const ARTIST_AUDIO_REPLY = [
  "音频方向：芯片音乐。",
  "```json",
  JSON.stringify({
    audio: [
      { key: "bgm_level", kind: "bgm", description: "loopable chiptune", durationSeconds: 40, loopable: true },
      { key: "sfx_shoot", kind: "sfx", description: "retro laser", durationSeconds: 1 }
    ]
  }),
  "```"
].join("\n");

function audioRecord(id: string): GeneratedAudioRecord {
  return {
    id,
    projectId: "project_1",
    kind: "bgm",
    fileName: `${id}.mp3`,
    projectRelativePath: `assets/audio/bgm/${id}.mp3`,
    resPath: `res://assets/audio/bgm/${id}.mp3`,
    prompt: "theme",
    modelId: "ace",
    format: "mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 10,
    createdAt: new Date().toISOString()
  };
}

describe("buildWorkflowPhases (audio)", () => {
  it("inserts asset then audio generation after the artist when both are enabled", () => {
    const agents = [agent("artist"), agent("programmer")];
    const phases = buildWorkflowPhases(agents, {
      projectId: "p",
      message: "m",
      autoExportWeb: false,
      autoPackageWebZip: false,
      autoStartPreview: false,
      withAssetPipeline: true,
      withAudioPipeline: true
    });
    expect(phases.map((phase) => (phase.kind === "agent" ? phase.agent.id : phase.kind))).toEqual([
      "artist",
      "asset-generation",
      "audio-generation",
      "programmer"
    ]);
  });
});

describe("workflow audio pipeline", () => {
  it("generates planned audio, binds slots and hands res:// paths to the programmer", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-audio-flow-"));
    const store = new StudioStore(path.join(dir, "state.json"));
    const runService = new RunService(store);
    const project = createProject(path.join(dir, "project"));
    await store.upsertProject(project);
    const messages: AgentMessage[] = [];
    const turnMessages: Record<string, string> = {};
    const audioSlotCalls: SetGeneratedAudioSlotInput[] = [];
    const generateCalls: GenerateAudioInput[] = [];

    const projectService = {
      requireProject: async () => project,
      getProject: async (): Promise<ProjectDetails> => ({ ...project, messages, runs: await runService.listRuns(project.id) }),
      appendMessages: async (_projectId: string, next: AgentMessage[]) => {
        messages.push(...next);
        return messages;
      }
    };
    const agentService = {
      runTurn: async (input: { agentId: string; cliToolId: CliToolId; message: string }) => {
        turnMessages[input.agentId] = input.message;
        const message: AgentMessage = {
          id: `msg_${input.agentId}`,
          projectId: project.id,
          agentId: input.agentId,
          role: "agent",
          content: input.agentId === "artist" ? ARTIST_AUDIO_REPLY : "done",
          createdAt: new Date().toISOString(),
          cliToolId: input.cliToolId,
          exitCode: 0,
          fileChanges: input.agentId === "programmer" ? [{ path: "main.tscn", kind: "modified" as const, isText: true }] : []
        };
        return { messages: [message], project: { ...project, messages: [message], runs: [] }, runs: [] };
      }
    };
    const audioGenerationService = {
      generateAudio: async (input: GenerateAudioInput) => {
        generateCalls.push(input);
        if (input.kind === "sfx") {
          return { ok: false, audios: [], attempts: [], error: "上游超时" };
        }
        return { ok: true, audios: [audioRecord("bgm1")], attempts: [] };
      }
    };
    const assetLibraryService = {
      setSlot: async () => ({ projectId: project.id, assets: [] }),
      setAudioSlot: async (input: SetGeneratedAudioSlotInput) => {
        audioSlotCalls.push(input);
        return { projectId: input.projectId, audios: [] };
      }
    };

    try {
      const workflow = new WorkflowService(
        projectService as never,
        { discover: async () => [tool("codex")] } as never,
        agentService as never,
        {} as never,
        {} as never,
        {} as never,
        runService,
        undefined,
        undefined,
        undefined,
        assetLibraryService as never,
        audioGenerationService as never
      );
      const result = await workflow.run({
        projectId: project.id,
        message: "做一个像素风横版射击游戏",
        agentIds: ["artist", "programmer"],
        autoExportWeb: false,
        autoPackageWebZip: false,
        autoStartPreview: false,
        withAudioPipeline: true
      });

      expect(result.run.steps.map((step) => step.title)).toEqual([
        "1. 美术：视觉风格、素材清单、占位资产",
        "AI 音频生成",
        "2. 程序：Godot 脚本、场景、导出"
      ]);
      const audioStep = result.run.steps[1]!;
      expect(audioStep.status).toBe("completed");
      expect(audioStep.output).toContain("res://assets/audio/bgm/bgm1.mp3");
      expect(audioStep.output).toContain("sfx_shoot 生成失败");

      // Artist got the audio plan instruction; generation mirrored the plan.
      expect(turnMessages.artist).toContain("音频计划");
      expect(generateCalls.map((call) => call.kind)).toEqual(["bgm", "sfx"]);
      expect(audioSlotCalls).toEqual([{ projectId: "project_1", audioId: "bgm1", slot: "bgm_level" }]);
      // Programmer round received the audio note with res:// paths.
      expect(turnMessages.programmer).toContain("bgm_level（bgm）→ res://assets/audio/bgm/bgm1.mp3");
      expect(turnMessages.programmer).toContain("AudioStreamPlayer");
      expect(messages.some((message) => message.kind === "workflow" && message.content.includes("AI 音频生成完成"))).toBe(true);
      expect(result.run.status).toBe("completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
