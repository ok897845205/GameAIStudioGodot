import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flushAllLogs } from "../../services/logger";
import type { RuntimeEnvironment } from "../runtime-environment";
import type { AgentTurnRequest, TurnChunk } from "../adapter-contract";
import type { LocalCliAdapter } from "../adapters/local-cli-adapter";
import {
  acpUpdateToChunks,
  chooseAcpPermissionOption,
  createAcpAgentAdapter,
  type AcpAgentAdapter,
} from "./acp-agent-adapter";
import { createPreferAcpAdapter } from "./prefer-acp-adapter";

const FIXTURE = fileURLToPath(new URL("./fake-acp-agent.fixture.mjs", import.meta.url));

let workingDir: string;

beforeAll(async () => {
  workingDir = await mkdtemp(path.join(os.tmpdir(), "gas-acp-"));
});

afterAll(async () => {
  // The adapter writes project logs under workingDir; flush queued writes
  // before removing the directory (Windows reports EBUSY otherwise).
  await flushAllLogs();
  await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
});

function fakeEnv(found: boolean): RuntimeEnvironment {
  return {
    platform: process.platform,
    env: {},
    which: async (command: string) =>
      found && command === "fake-acp" ? process.execPath : undefined,
    npmGlobalBin: async () => undefined,
  } as unknown as RuntimeEnvironment;
}

function fixtureAdapter(mode: string): AcpAgentAdapter {
  return createAcpAgentAdapter({
    id: "claude",
    label: "Claude",
    agentCommand: "fake-acp",
    agentArgs: [FIXTURE, mode],
    installCommand: ["npm", "install", "-g", "fake-acp"],
    installHint: "install fake-acp",
    timeoutMs: 15000,
  });
}

function request(overrides: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return {
    prompt: "请修改项目。",
    workingDir,
    images: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("acpUpdateToChunks", () => {
  it("maps message chunks to sanitized text deltas", () => {
    const chunks = acpUpdateToChunks({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "你好" },
    });
    expect(chunks).toEqual([{ type: "text-delta", text: "你好" }]);
  });

  it("maps tool calls to step chunks and failed updates to stderr", () => {
    expect(acpUpdateToChunks({ sessionUpdate: "tool_call", title: "编辑 player.gd" })).toEqual([
      { type: "step", title: "工具：编辑 player.gd" },
    ]);
    expect(
      acpUpdateToChunks({ sessionUpdate: "tool_call_update", status: "failed", title: "运行命令" }),
    ).toEqual([{ type: "stderr-delta", text: "工具失败：运行命令\n" }]);
    expect(
      acpUpdateToChunks({ sessionUpdate: "tool_call_update", status: "completed" }),
    ).toEqual([]);
  });

  it("ignores thought chunks and plans in phase 1", () => {
    expect(acpUpdateToChunks({ sessionUpdate: "agent_thought_chunk", content: { text: "x" } })).toEqual([]);
    expect(acpUpdateToChunks({ sessionUpdate: "plan", entries: [] })).toEqual([]);
  });
});

describe("chooseAcpPermissionOption", () => {
  it("prefers allow_once, then any allow, never reject-first", () => {
    expect(
      chooseAcpPermissionOption([
        { optionId: "always", name: "Always", kind: "allow_always" },
        { optionId: "once", name: "Once", kind: "allow_once" },
      ])?.optionId,
    ).toBe("once");
    expect(
      chooseAcpPermissionOption([
        { optionId: "reject", name: "Reject", kind: "reject_once" },
        { optionId: "always", name: "Always", kind: "allow_always" },
      ])?.optionId,
    ).toBe("always");
    expect(chooseAcpPermissionOption([])).toBeUndefined();
    expect(chooseAcpPermissionOption(undefined)).toBeUndefined();
  });
});

describe("AcpAgentAdapter runTurn (against the fake ACP agent)", () => {
  it("streams text deltas, surfaces tool calls, auto-approves permissions and finishes", async () => {
    const adapter = fixtureAdapter("happy");
    const chunks = await collect(adapter.runTurn(request(), fakeEnv(true)));

    const text = chunks
      .filter((c): c is Extract<TurnChunk, { type: "text-delta" }> => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("正在分析项目。已完成修改。");

    const steps = chunks
      .filter((c): c is Extract<TurnChunk, { type: "step" }> => c.type === "step")
      .map((c) => c.title);
    expect(steps.some((title) => title.includes("ACP 模式启动"))).toBe(true);
    expect(steps).toContain("工具：读取 project.godot");
    expect(steps).toContain("已自动批准：写入 main.gd");

    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      content: "正在分析项目。已完成修改。",
      exitCode: 0,
      cancelled: false,
      timedOut: false,
    });
  }, 20000);

  it("fails the turn with a classified error when the agent process dies", async () => {
    const adapter = fixtureAdapter("crash");
    const chunks = await collect(adapter.runTurn(request(), fakeEnv(true)));

    expect(chunks.some((c) => c.type === "error")).toBe(true);
    const final = chunks.at(-1);
    expect(final).toMatchObject({ type: "final", exitCode: 1 });
    if (final?.type === "final") {
      expect(final.stderr).toContain("退出");
    }
  }, 20000);

  it("cancels via session/cancel and keeps streamed content", async () => {
    const adapter = fixtureAdapter("cancel");
    const controller = new AbortController();
    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      request({ signal: controller.signal }),
      fakeEnv(true),
    )) {
      chunks.push(chunk);
      if (chunk.type === "text-delta") {
        controller.abort();
      }
    }

    const final = chunks.at(-1);
    expect(final).toMatchObject({ type: "final", cancelled: true });
    if (final?.type === "final") {
      expect(final.content).toContain("开始处理");
    }
  }, 20000);

  it("returns a clear failure when the ACP agent executable is missing", async () => {
    const adapter = fixtureAdapter("happy");
    const chunks = await collect(adapter.runTurn(request(), fakeEnv(false)));
    expect(chunks.at(-1)).toMatchObject({ type: "final", exitCode: 1 });
  });
});

describe("createPreferAcpAdapter", () => {
  function fallbackAdapter(): LocalCliAdapter {
    return {
      id: "claude",
      label: "Claude",
      capabilities: {} as never,
      config: {} as never,
      discover: async () => ({ found: true }),
      health: async () => ({ installed: true, authed: true, headlessOk: true }),
      runTurn: async function* () {
        yield { type: "text-delta", text: "headless 路径" } as TurnChunk;
        yield { type: "final", content: "headless 路径", exitCode: 0, durationMs: 1 } as TurnChunk;
      },
    } as unknown as LocalCliAdapter;
  }

  it("falls back to the headless adapter when the ACP agent is absent", async () => {
    const composite = createPreferAcpAdapter(fixtureAdapter("happy"), fallbackAdapter());
    const chunks = await collect(composite.runTurn(request(), fakeEnv(false)));
    expect(chunks.at(-1)).toMatchObject({ type: "final", content: "headless 路径" });
  });

  it("prefers the ACP path when the agent executable is available", async () => {
    const composite = createPreferAcpAdapter(fixtureAdapter("happy"), fallbackAdapter());
    const chunks = await collect(composite.runTurn(request(), fakeEnv(true)));
    const final = chunks.at(-1);
    expect(final).toMatchObject({ type: "final", exitCode: 0 });
    if (final?.type === "final") {
      expect(final.content).toContain("已完成修改");
    }
  }, 20000);
});

describe("AcpAgentAdapter session resume", () => {
  it("persists the session id and resumes via session/load without re-streaming history", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gas-acp-resume-"));
    try {
      const adapter = fixtureAdapter("resume");
      const env = fakeEnv(true);
      const sessionKey = "project_1:producer";

      // Turn 1: cold start (no stored session) → session/new.
      const first = await collect(
        adapter.runTurn(request({ workingDir: dir, sessionKey }), env),
      );
      expect(first.at(-1)).toMatchObject({ type: "final", content: "继续推进。", exitCode: 0 });
      const { readFile } = await import("node:fs/promises");
      const stored = JSON.parse(
        await readFile(path.join(dir, ".gameaistudio", "acp-session-ids.json"), "utf8"),
      ) as Record<string, { sessionId: string }>;
      expect(stored["claude:project_1:producer"]?.sessionId).toBe("sess_1");

      // Turn 2: stored id + loadSession capability → session/load. The replayed
      // history must not enter the live stream.
      const second = await collect(
        adapter.runTurn(request({ workingDir: dir, sessionKey }), env),
      );
      const secondText = second
        .filter((c): c is Extract<TurnChunk, { type: "text-delta" }> => c.type === "text-delta")
        .map((c) => c.text)
        .join("");
      expect(secondText).toBe("继续推进。");
      expect(secondText).not.toContain("旧历史");
      const steps = second
        .filter((c): c is Extract<TurnChunk, { type: "step" }> => c.type === "step")
        .map((c) => c.title);
      expect(steps.some((title) => title.includes("已恢复上次 ACP 会话"))).toBe(true);
    } finally {
      const { flushAllLogs: flush } = await import("../../services/logger");
      await flush();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 30000);
});

describe("AcpAgentAdapter probeCapabilities", () => {
  it("reads image and loadSession capabilities from the initialize handshake", async () => {
    const resume = fixtureAdapter("resume");
    const probe = await resume.probeCapabilities(fakeEnv(true));
    expect(probe).toMatchObject({ ok: true, imageSupport: true, loadSession: true });

    const happy = fixtureAdapter("happy");
    const happyProbe = await happy.probeCapabilities(fakeEnv(true));
    expect(happyProbe).toMatchObject({ ok: true, imageSupport: true, loadSession: false });
  }, 20000);

  it("reports a clear error when the agent executable is missing", async () => {
    const probe = await fixtureAdapter("happy").probeCapabilities(fakeEnv(false));
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain("fake-acp");
  });
});

describe("createPreferAcpAdapter exposure and health merge", () => {
  it("exposes the ACP adapter for status reporting (hasAcpUpgrade)", async () => {
    const { hasAcpUpgrade } = await import("./prefer-acp-adapter");
    const acp = fixtureAdapter("happy");
    const composite = createPreferAcpAdapter(acp, {
      id: "claude",
      label: "Claude",
      capabilities: {} as never,
      config: {} as never,
      discover: async () => ({ found: true }),
      health: async () => ({ installed: true, authed: true, headlessOk: true }),
      runTurn: async function* () {
        yield { type: "final", content: "", exitCode: 0, durationMs: 1 } as TurnChunk;
      },
    } as unknown as LocalCliAdapter);
    expect(hasAcpUpgrade(composite)).toBe(true);
    expect(hasAcpUpgrade({ acp: undefined } as never)).toBe(false);
  });

  it("adds handshake-derived imagesOk to the probed health when ACP is available", async () => {
    const composite = createPreferAcpAdapter(fixtureAdapter("happy"), {
      id: "claude",
      label: "Claude",
      capabilities: {} as never,
      config: {} as never,
      discover: async () => ({ found: true }),
      health: async () => ({ installed: true, authed: true, headlessOk: true }),
      runTurn: async function* () {
        yield { type: "final", content: "", exitCode: 0, durationMs: 1 } as TurnChunk;
      },
    } as unknown as LocalCliAdapter);

    const probed = await composite.health(fakeEnv(true), { probe: true });
    expect(probed.imagesOk).toBe(true);

    const fast = await composite.health(fakeEnv(true), { probe: false });
    expect(fast.imagesOk).toBeUndefined();
  }, 20000);
});

describe("resolveAcpAgentExecutable alternates", () => {
  it("falls back to alternate executable names (cursor-agent → agent)", async () => {
    const { resolveAcpAgentExecutable } = await import("./acp-agent-adapter");
    const env = {
      platform: process.platform,
      env: {},
      which: async (command: string) =>
        command === "agent" ? "/usr/local/bin/agent" : undefined,
      npmGlobalBin: async () => undefined,
    } as unknown as RuntimeEnvironment;

    expect(await resolveAcpAgentExecutable(env, "cursor-agent", ["agent"])).toBe(
      "/usr/local/bin/agent",
    );
    expect(await resolveAcpAgentExecutable(env, "cursor-agent")).toBeUndefined();
  });
});

describe("AcpAgentAdapter hostCli (claude-code-acp driving KSCC)", () => {
  function hostAdapter(): AcpAgentAdapter {
    return createAcpAgentAdapter({
      id: "kscc",
      label: "KSCC",
      agentCommand: "fake-acp",
      agentArgs: [FIXTURE, "happy"],
      hostCli: { command: "kscc", envVar: "CLAUDE_CODE_EXECUTABLE" },
      installCommand: ["npm", "install", "-g", "fake-acp"],
      installHint: "install fake-acp",
      timeoutMs: 15000,
    });
  }

  function envWith(commands: Record<string, string>): RuntimeEnvironment {
    return {
      platform: process.platform,
      env: {},
      which: async (command: string) => commands[command],
      npmGlobalBin: async () => undefined,
    } as unknown as RuntimeEnvironment;
  }

  it("is only available when both the adapter and the host CLI exist", async () => {
    const adapter = hostAdapter();
    expect(
      await adapter.isAvailable(envWith({ "fake-acp": process.execPath, kscc: "/usr/bin/kscc" })),
    ).toBe(true);
    // Adapter installed but host CLI missing → not available.
    expect(await adapter.isAvailable(envWith({ "fake-acp": process.execPath }))).toBe(false);
    // Host CLI installed but adapter missing → not available.
    expect(await adapter.isAvailable(envWith({ kscc: "/usr/bin/kscc" }))).toBe(false);
  });

  it("completes the handshake with the host CLI path exported", async () => {
    const adapter = hostAdapter();
    const probe = await adapter.probeCapabilities(
      envWith({ "fake-acp": process.execPath, kscc: "/usr/bin/kscc" }),
    );
    expect(probe.ok).toBe(true);
  }, 20000);
});
