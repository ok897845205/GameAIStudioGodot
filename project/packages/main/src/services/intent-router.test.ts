import { describe, expect, it } from "vitest";
import type { CliTool, CliToolId, StudioProject } from "@gameaistudio/shared";
import { CLI_TOOL_LABELS } from "@gameaistudio/shared";
import {
  buildClassifierPrompt,
  classifyByHeuristics,
  IntentRouterService,
  parseClassifierReply,
} from "./intent-router";
import type { CliService } from "./cli-service";

function tool(id: CliToolId, installed = true): CliTool {
  return {
    id,
    label: CLI_TOOL_LABELS[id],
    command: id,
    installed,
    status: installed ? "available" : "missing",
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
      supportsImages: false,
      imageInputMode: "unsupported",
      supportsStream: true,
      supportsResume: true,
      headless: true,
    },
    health: { installed, authed: installed ? true : "unknown", headlessOk: installed ? true : "unknown" },
    diagnostics: [],
    lastCheckedAt: new Date().toISOString(),
  };
}

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
  };
}

describe("classifyByHeuristics", () => {
  const cases: Array<[string, string | undefined, string?]> = [
    ["修复跳跃不能用的 bug", "programmer"],
    ["游戏导出失败了", "programmer"],
    ["画面改成像素风", "artist"],
    ["UI 太丑了，优化一下界面", "artist"],
    ["把难度调低一点，敌人太多了", "designer"],
    ["新增一个奖励道具", "designer"],
    ["帮我测试一下导出是否正常", "qa"],
    ["为什么金块有时候抓不到？", "producer"],
    ["这个游戏怎么操作？", "producer"],
  ];
  it.each(cases)("routes %s → %s", (message, agentId) => {
    const decision = classifyByHeuristics(message);
    expect(decision?.route).toBe("agent");
    expect(decision?.agentId).toBe(agentId);
    expect(decision?.scope).toBe("small");
    expect(decision?.source).toBe("heuristic");
  });

  it("routes large rebuilds to the team pipeline", () => {
    const decision = classifyByHeuristics("整体重新设计成赛博朋克跑酷游戏");
    expect(decision).toMatchObject({ route: "team", scope: "large", source: "heuristic" });
  });

  it("priority: bug-fixing beats styling when both appear", () => {
    expect(classifyByHeuristics("修复跳跃的 bug，顺便把画面调亮")?.agentId).toBe("programmer");
  });

  it("returns undefined for ambiguous phrasing (defer to classifier)", () => {
    expect(classifyByHeuristics("金币再多一些")).toBeUndefined();
    expect(classifyByHeuristics("")).toBeUndefined();
  });
});

describe("parseClassifierReply", () => {
  it("parses a clean one-line JSON decision", () => {
    expect(
      parseClassifierReply('{"route":"agent","agent":"designer","scope":"small","reason":"玩法调整"}'),
    ).toMatchObject({ route: "agent", agentId: "designer", scope: "small", source: "classifier" });
  });

  it("tolerates prose around the JSON", () => {
    const decision = parseClassifierReply(
      '好的，我的判断如下：\n{"route":"team","agent":"producer","scope":"large","reason":"新游戏"}\n以上。',
    );
    expect(decision).toMatchObject({ route: "team", scope: "large" });
  });

  it("rejects invalid enums and malformed payloads", () => {
    expect(parseClassifierReply('{"route":"swarm","agent":"producer","scope":"small"}')).toBeUndefined();
    expect(parseClassifierReply('{"route":"agent","agent":"hacker","scope":"small"}')).toBeUndefined();
    expect(parseClassifierReply("根本不是 JSON")).toBeUndefined();
  });

  it("clamps overlong reasons", () => {
    const decision = parseClassifierReply(
      `{"route":"agent","agent":"qa","scope":"small","reason":"${"长".repeat(100)}"}`,
    );
    expect(decision?.reason.length).toBeLessThanOrEqual(40);
  });
});

describe("buildClassifierPrompt", () => {
  it("contains the strict contract and the user message", () => {
    const prompt = buildClassifierPrompt({ message: "金币再多一些", projectName: "黄金矿工", dimension: "2d" });
    expect(prompt).toContain("只输出一行 JSON");
    expect(prompt).toContain("不要读取任何文件");
    expect(prompt).toContain("金币再多一些");
    expect(prompt).toContain("2D");
  });
});

describe("IntentRouterService.route", () => {
  function fakeCliService(reply: string | Error, calls: string[] = []): Pick<CliService, "runTurn"> {
    return {
      runTurn: (_toolId, req) => {
        calls.push(req.prompt);
        return (async function* () {
          if (reply instanceof Error) throw reply;
          yield { type: "final" as const, content: reply, exitCode: 0, durationMs: 1 };
        })();
      },
    } as Pick<CliService, "runTurn">;
  }

  it("uses heuristics without any CLI call when phrasing is clear", async () => {
    const calls: string[] = [];
    const router = new IntentRouterService(fakeCliService("ignored", calls));
    const decision = await router.route({ project: project(), message: "修复跳跃 bug", tools: [tool("kscc")] });
    expect(decision.agentId).toBe("programmer");
    expect(calls).toHaveLength(0);
  });

  it("falls through to the classifier turn for ambiguous messages", async () => {
    const calls: string[] = [];
    const router = new IntentRouterService(
      fakeCliService('{"route":"agent","agent":"designer","scope":"small","reason":"数值调整"}', calls),
    );
    const decision = await router.route({ project: project(), message: "金币再多一些", tools: [tool("kscc")] });
    expect(decision).toMatchObject({ agentId: "designer", source: "classifier" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("金币再多一些");
  });

  it("falls back safely when the classifier returns garbage or throws", async () => {
    const garbage = new IntentRouterService(fakeCliService("我觉得这个问题很复杂……"));
    expect((await garbage.route({ project: project(), message: "金币再多一些", tools: [tool("kscc")] })).source).toBe(
      "fallback",
    );

    const throwing = new IntentRouterService(fakeCliService(new Error("CLI exploded")));
    const decision = await throwing.route({ project: project(), message: "金币再多一些", tools: [tool("kscc")] });
    expect(decision).toMatchObject({ route: "agent", agentId: "producer", source: "fallback" });
  });

  it("skips the classifier when no CLI is available (straight to fallback)", async () => {
    const calls: string[] = [];
    const router = new IntentRouterService(fakeCliService("ignored", calls));
    const decision = await router.route({
      project: project(),
      message: "金币再多一些",
      tools: [tool("kscc", false)],
    });
    expect(decision.source).toBe("fallback");
    expect(calls).toHaveLength(0);
  });

  it("downgrades team routes to a single agent when attachments are present", async () => {
    const router = new IntentRouterService(fakeCliService("ignored"));
    const decision = await router.route({
      project: project(),
      message: "整体重新设计画面",
      hasAttachments: true,
      tools: [tool("kscc")],
    });
    expect(decision.route).toBe("agent");
    expect(decision.reason).toContain("含附件");
  });
});
