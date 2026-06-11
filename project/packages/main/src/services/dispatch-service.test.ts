import { describe, expect, it } from "vitest";
import type {
  AgentMessage,
  DispatchDecision,
  RunAgentTurnInput,
  RunStudioWorkflowInput,
  StudioProject,
} from "@gameaistudio/shared";
import { describeDispatchDecision, DispatchService } from "./dispatch-service";

function project(): StudioProject {
  return {
    id: "p1",
    name: "黄金矿工",
    dimension: "2d",
    prompt: "黄金矿工",
    rootPath: "E:/games/2D_game_20260611",
    webBuildPath: "E:/games/2D_game_20260611/build/web",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer",
    agentCliToolIds: { designer: "codex" },
  };
}

function harness(decision: DispatchDecision) {
  const appended: AgentMessage[] = [];
  const turnInputs: RunAgentTurnInput[] = [];
  const workflowInputs: RunStudioWorkflowInput[] = [];
  const service = new DispatchService({
    router: { route: async () => decision },
    projectService: {
      requireProject: async () => project(),
      appendMessages: async (_id: string, next: AgentMessage[]) => {
        appended.push(...next);
        return appended;
      },
    } as never,
    workflowService: {
      run: async (input: RunStudioWorkflowInput) => {
        workflowInputs.push(input);
        return { project: { ...project(), messages: [], runs: [] }, run: { steps: [] } } as never;
      },
    } as never,
    runAgentTurn: async (input) => {
      turnInputs.push(input);
      return { project: { ...project(), messages: [], runs: [] }, messages: [], runs: [] };
    },
    discoverTools: async () => [],
  });
  return { service, appended, turnInputs, workflowInputs };
}

describe("DispatchService", () => {
  it("routes agent decisions to a single turn with the project-configured CLI", async () => {
    const { service, appended, turnInputs, workflowInputs } = harness({
      route: "agent",
      agentId: "designer",
      scope: "small",
      reason: "数值调整",
      source: "classifier",
    });

    const result = await service.dispatch({ projectId: "p1", message: "金币再多一些", autoStartPreview: true });

    expect(result.kind).toBe("agent-turn");
    expect(turnInputs).toHaveLength(1);
    expect(turnInputs[0]).toMatchObject({ agentId: "designer", cliToolId: "codex", message: "金币再多一些" });
    expect(workflowInputs).toHaveLength(0);
    // Routing decision is announced in the chat before the work.
    expect(appended[0]?.role).toBe("system");
    expect(appended[0]?.kind).toBe("log");
    expect(appended[0]?.content).toContain("策划");
    expect(appended[0]?.content).toContain("数值调整");
  });

  it("routes team+small to the trimmed pipeline (programmer+qa, no zip)", async () => {
    const { service, workflowInputs, turnInputs } = harness({
      route: "team",
      agentId: "producer",
      scope: "small",
      reason: "需要修复并验证",
      source: "classifier",
    });

    const result = await service.dispatch({ projectId: "p1", message: "修复并验证导出", autoStartPreview: true });

    expect(result.kind).toBe("workflow");
    expect(turnInputs).toHaveLength(0);
    expect(workflowInputs[0]).toMatchObject({
      agentIds: ["programmer", "qa"],
      autoExportWeb: true,
      autoPackageWebZip: false,
      autoStartPreview: true,
      withQualityLoop: true,
    });
  });

  it("routes team+large to the full five-role pipeline with delivery", async () => {
    const { service, workflowInputs } = harness({
      route: "team",
      agentId: "producer",
      scope: "large",
      reason: "整体改造",
      source: "heuristic",
    });

    await service.dispatch({ projectId: "p1", message: "重做成跑酷", autoStartPreview: true });

    expect(workflowInputs[0]).toMatchObject({
      agentIds: ["producer", "designer", "programmer", "artist", "qa"],
      autoPackageWebZip: true,
      withQualityLoop: true,
    });
  });
});

describe("describeDispatchDecision", () => {
  it("labels both routes in user language", () => {
    expect(
      describeDispatchDecision({ route: "agent", agentId: "programmer", scope: "small", reason: "修 bug", source: "heuristic" }),
    ).toContain("程序");
    expect(
      describeDispatchDecision({ route: "team", agentId: "producer", scope: "small", reason: "验证", source: "classifier" }),
    ).toContain("精简团队流程");
    expect(
      describeDispatchDecision({ route: "team", agentId: "producer", scope: "large", reason: "新游戏", source: "classifier" }),
    ).toContain("完整团队工作流");
  });
});
