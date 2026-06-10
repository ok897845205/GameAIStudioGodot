import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentMessage, ProjectDetails, RunAgentTurnInput, RunAgentTurnResult } from "@gameaistudio/shared";
import { runAgentTurnWithOptionalPreview } from "./agent-turn-orchestrator";

function project(): ProjectDetails {
  const rootPath = path.join("C:", "GameAIStudio", "GoldMiner");
  return {
    id: "project_1",
    name: "Gold Miner",
    dimension: "2d",
    prompt: "我要创建一个黄金矿工",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    activeAgentId: "programmer",
    messages: [],
    runs: []
  };
}

function agentMessage(projectId: string, pathName: string): AgentMessage {
  return {
    id: "msg_agent",
    projectId,
    agentId: "programmer",
    role: "agent",
    content: "changed files",
    createdAt: "2026-06-08T00:00:00.000Z",
    cliToolId: "codex",
    exitCode: 0,
    fileChanges: [
      {
        path: pathName,
        kind: "added",
        afterSize: 64,
        afterHash: "abc",
        isText: true
      }
    ]
  };
}

function input(autoStartPreview = true): RunAgentTurnInput {
  return {
    projectId: "project_1",
    agentId: "programmer",
    cliToolId: "codex",
    message: "继续实现玩法。",
    autoStartPreview
  };
}

describe("runAgentTurnWithOptionalPreview", () => {
  it("returns a preview result when an Agent changes preview-relevant files", async () => {
    const baseProject = project();
    const message = agentMessage(baseProject.id, "scripts/hook.gd");
    const runResult: RunAgentTurnResult = {
      project: baseProject,
      messages: [message],
      runs: []
    };
    let changedPath: string | undefined;

    const result = await runAgentTurnWithOptionalPreview(
      {
        agentService: { runTurn: async () => runResult },
        autoPreviewService: {
          refresh: async (_projectId, nextChangedPath) => {
            changedPath = nextChangedPath;
            return {
              projectId: baseProject.id,
              url: "http://127.0.0.1:3123?v=1",
              webBuildPath: baseProject.webBuildPath,
              watching: true
            };
          }
        },
        projectService: {
          getProject: async () => ({
            ...baseProject,
            previewUrl: "http://127.0.0.1:3123?v=1",
            previewStatus: "ready"
          }),
          appendMessages: async (_projectId: string, appended: typeof runResult.messages) => [
            ...runResult.messages,
            ...appended
          ]
        }
      },
      input()
    );

    expect(changedPath).toBe("scripts/hook.gd");
    expect(result.previewResult?.url).toBe("http://127.0.0.1:3123?v=1");
    expect(result.project.previewStatus).toBe("ready");
  });

  it("keeps the Agent result when preview refresh fails", async () => {
    const baseProject = project();
    const message = agentMessage(baseProject.id, "scenes/main.tscn");
    const runResult: RunAgentTurnResult = {
      project: baseProject,
      messages: [message],
      runs: []
    };

    const result = await runAgentTurnWithOptionalPreview(
      {
        agentService: { runTurn: async () => runResult },
        autoPreviewService: {
          refresh: async () => {
            throw new Error("Godot Web export failed");
          }
        },
        projectService: {
          getProject: async () => baseProject,
          appendMessages: async (_projectId: string, appended: typeof runResult.messages) => [
            ...runResult.messages,
            ...appended
          ]
        }
      },
      input()
    );

    expect(result.messages).toEqual([message]);
    expect(result.previewResult).toBeUndefined();
    expect(result.previewError).toBe("Godot Web export failed");
  });

  it("does not refresh preview for non-preview project changes", async () => {
    const baseProject = project();
    const message = agentMessage(baseProject.id, "notes/design.txt");
    const runResult: RunAgentTurnResult = {
      project: baseProject,
      messages: [message],
      runs: []
    };
    let refreshCalled = false;

    const result = await runAgentTurnWithOptionalPreview(
      {
        agentService: { runTurn: async () => runResult },
        autoPreviewService: {
          refresh: async () => {
            refreshCalled = true;
            throw new Error("unexpected");
          }
        },
        projectService: {
          getProject: async () => baseProject,
          appendMessages: async (_projectId: string, appended: typeof runResult.messages) => [
            ...runResult.messages,
            ...appended
          ]
        }
      },
      input()
    );

    expect(refreshCalled).toBe(false);
    expect(result.previewResult).toBeUndefined();
    expect(result.previewError).toBeUndefined();
  });

  it("auto-commits successful Agent turns with project file changes", async () => {
    const baseProject = project();
    const message = agentMessage(baseProject.id, "scripts/hook.gd");
    const runResult: RunAgentTurnResult = {
      project: baseProject,
      messages: [message],
      runs: []
    };
    const commits: Array<{ projectId: string; message: string }> = [];

    await runAgentTurnWithOptionalPreview(
      {
        agentService: { runTurn: async () => runResult },
        autoPreviewService: {
          refresh: async () => ({
            projectId: baseProject.id,
            url: "http://127.0.0.1:3123?v=1",
            webBuildPath: baseProject.webBuildPath
          })
        },
        gitService: {
          commit: async (commit) => {
            commits.push(commit);
            return {} as never;
          }
        },
        projectService: {
          getProject: async () => baseProject,
          appendMessages: async (_projectId: string, appended: typeof runResult.messages) => [
            ...runResult.messages,
            ...appended
          ]
        }
      },
      input(false)
    );

    expect(commits).toEqual([
      {
        projectId: baseProject.id,
        message: "自动保存：programmer Agent 回合"
      }
    ]);
  });

  it("does not auto-commit failed Agent turns", async () => {
    const baseProject = project();
    const failedMessage = {
      ...agentMessage(baseProject.id, "scripts/hook.gd"),
      exitCode: 1
    };
    const runResult: RunAgentTurnResult = {
      project: baseProject,
      messages: [failedMessage],
      runs: []
    };
    let commitCalled = false;

    await runAgentTurnWithOptionalPreview(
      {
        agentService: { runTurn: async () => runResult },
        autoPreviewService: {
          refresh: async () => {
            throw new Error("unexpected");
          }
        },
        gitService: {
          commit: async () => {
            commitCalled = true;
            return {} as never;
          }
        },
        projectService: {
          getProject: async () => baseProject,
          appendMessages: async (_projectId: string, appended: typeof runResult.messages) => [
            ...runResult.messages,
            ...appended
          ]
        }
      },
      input(false)
    );

    expect(commitCalled).toBe(false);
  });
});
