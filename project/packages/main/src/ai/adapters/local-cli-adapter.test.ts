import { describe, it, expect } from "vitest";
import {
  createLocalCliAdapter,
  type LocalCliConfig,
} from "./local-cli-adapter";
import { claudeLocalConfig } from "./claude-local";
import { codexLocalConfig } from "./codex-local";
import { copilotLocalConfig } from "./copilot-local";
import { cursorLocalConfig } from "./cursor-local";
import { geminiLocalConfig } from "./gemini-local";
import { kimiLocalConfig } from "./kimi-local";
import { ksccLocalConfig } from "./kscc-local";
import { qwenLocalConfig } from "./qwen-local";
import type { RuntimeEnvironment } from "../runtime-environment";
import type {
  ProcessRunOptions,
  ProcessRunResult,
  runProcess,
} from "../../services/process-runner";
import type { TurnChunk } from "../adapter-contract";

const config: LocalCliConfig = {
  id: "claude",
  label: "Claude",
  command: "claude",
  versionArgs: ["--version"],
  promptArgs: ["--print"],
  installCommand: ["npm", "install", "-g", "@anthropic-ai/claude-code"],
  installHint: "",
  credentialEnvVars: ["ANTHROPIC_API_KEY"],
  credentialHint: "",
  capabilities: {
    runModel: "local",
    supportsImages: true,
    imageInputMode: "prompt-path-reference",
    supportsStream: true,
    supportsResume: false,
    headless: true,
  },
  headlessProbe: { prompt: "ping", timeoutMs: 1000 },
};

function fakeEnv(opts: {
  which?: (command: string) => Promise<string | undefined>;
  npmGlobalBin?: () => Promise<string | undefined>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): RuntimeEnvironment {
  return {
    platform: opts.platform ?? "linux",
    env: opts.env ?? {},
    which: opts.which ?? (async () => undefined),
    npmGlobalBin: opts.npmGlobalBin ?? (async () => undefined),
  } as unknown as RuntimeEnvironment;
}

type Resp = Partial<ProcessRunResult> & { stderrStream?: string[]; stream?: string[] };

function makeRunner(table: Record<string, Resp>): typeof runProcess {
  return ((command: string, args: string[], options?: ProcessRunOptions) => {
    const resp = table[`${command} ${args.join(" ")}`] ?? {};
    resp.stream?.forEach((chunk) => options?.onStdout?.(chunk));
    resp.stderrStream?.forEach((chunk) => options?.onStderr?.(chunk));
    return Promise.resolve<ProcessRunResult>({
      exitCode: resp.exitCode ?? 0,
      stdout: resp.stdout ?? "",
      stderr: resp.stderr ?? "",
      durationMs: resp.durationMs ?? 1,
      cancelled: resp.cancelled ?? false,
      timedOut: resp.timedOut ?? false,
    });
  }) as typeof runProcess;
}

describe("local-cli-adapter discover", () => {
  it("resolves an executable found on PATH", async () => {
    const adapter = createLocalCliAdapter(config, { runner: makeRunner({}) });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });
    expect(await adapter.discover(env)).toEqual({
      found: true,
      executablePath: "/usr/bin/claude",
      source: "path",
    });
  });

  it("reports not found when neither PATH nor npm bin has it", async () => {
    const adapter = createLocalCliAdapter(config, { runner: makeRunner({}) });
    expect(await adapter.discover(fakeEnv({}))).toEqual({ found: false });
  });
});

describe("codex-local config", () => {
  it("runs Codex exec without its internal sandbox so Windows ACL helpers cannot block project access", () => {
    const bypassIndex = codexLocalConfig.promptArgs.indexOf("--dangerously-bypass-approvals-and-sandbox");

    expect(bypassIndex).toBeGreaterThan(-1);
    expect(codexLocalConfig.promptArgs).toContain("--json");
    expect(codexLocalConfig.promptArgs).not.toContain("--sandbox");
    expect(codexLocalConfig.promptArgs).not.toContain("workspace-write");
    expect(codexLocalConfig.promptArgs).toContain("--skip-git-repo-check");
    expect(codexLocalConfig.promptArgs.at(-1)).toBe("-");
    expect(codexLocalConfig.capabilities.imageInputMode).toBe("file-flag");
  });
});

describe("local CLI capability contracts", () => {
  it("only advertises image upload for local CLIs with a proven file flag", () => {
    expect(codexLocalConfig.capabilities.supportsImages).toBe(true);
    // Headless paths stay conservative; image support arrives dynamically via
    // the ACP run-mode upgrade for the CLIs that have one.
    for (const config of [
      claudeLocalConfig,
      ksccLocalConfig,
      kimiLocalConfig,
      geminiLocalConfig,
      qwenLocalConfig,
      cursorLocalConfig,
      copilotLocalConfig,
    ]) {
      expect(config.capabilities.supportsImages).toBe(false);
      expect(config.capabilities.imageInputMode).toBe("unsupported");
    }
  });

  it("uses non-interactive edit-accepting mode for Claude-compatible CLIs", () => {
    expect(claudeLocalConfig.promptArgs).toEqual([
      "--print",
      "-",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ]);
    expect(ksccLocalConfig.promptArgs).toEqual(claudeLocalConfig.promptArgs);
  });
});

describe("local-cli-adapter layered health", () => {
  it("flags headless 401 even when --version passes (the claude --print bug)", async () => {
    const runner = makeRunner({
      "/usr/bin/claude --version": { exitCode: 0, stdout: "claude 1.2.3" },
      "/usr/bin/claude --print": {
        exitCode: 1,
        stderr: "API error: 401 Unauthorized",
      },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
      env: {},
    });

    const health = await adapter.health(env);
    expect(health.installed).toBe(true); // --version ok
    expect(health.version).toBe("claude 1.2.3");
    expect(health.headlessOk).toBe(false); // but --print 401
    expect(health.authed).toBe(false);
  });

  it("reports healthy when the headless probe succeeds", async () => {
    const runner = makeRunner({
      "/usr/bin/claude --version": { exitCode: 0, stdout: "claude 1.2.3" },
      "/usr/bin/claude --print": { exitCode: 0, stdout: "pong" },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const health = await adapter.health(env);
    expect(health.installed).toBe(true);
    expect(health.headlessOk).toBe(true);
    expect(health.authed).toBe(true);
  });

  it("returns not-installed health when the CLI is absent", async () => {
    const adapter = createLocalCliAdapter(config, { runner: makeRunner({}) });
    const health = await adapter.health(fakeEnv({}));
    expect(health.installed).toBe(false);
    expect(health.headlessOk).toBe("unknown");
  });

  it("skips the headless probe (no API call) when probe is false", async () => {
    let printCalls = 0;
    const runner = ((command: string, args: string[]) => {
      if (args.join(" ") === "--print") printCalls += 1;
      return Promise.resolve({
        exitCode: 0,
        stdout: args.includes("--version") ? "claude 1.2.3" : "pong",
        stderr: "",
        durationMs: 1,
        cancelled: false,
        timedOut: false,
      });
    }) as typeof runProcess;
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const health = await adapter.health(env, { probe: false });
    expect(printCalls).toBe(0); // discovery never calls the model
    expect(health.installed).toBe(true); // but --version still ran
    expect(health.headlessOk).toBe("unknown");
  });
});

describe("local-cli-adapter runTurn", () => {
  it("streams stdout as text-delta and ends with a final chunk", async () => {
    const runner = makeRunner({
      "/usr/bin/claude --print": {
        exitCode: 0,
        stdout: "Hello world",
        stream: ["Hello ", "world"],
        durationMs: 7,
      },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      {
        prompt: "hi",
        workingDir: "/p",
        images: [],
        signal: new AbortController().signal,
      },
      env,
    )) {
      chunks.push(chunk);
    }

    const deltas = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => (c as { text: string }).text);
    expect(deltas).toEqual(["Hello ", "world"]);
    const final = chunks.at(-1);
    expect(final).toMatchObject({
      type: "final",
      content: "Hello world",
      exitCode: 0,
      durationMs: 7,
    });
  });

  it("streams stderr and preserves failure metadata in the final chunk", async () => {
    const runner = makeRunner({
      "/usr/bin/claude --print": {
        exitCode: 1,
        stdout: "",
        stderr: "401 Unauthorized",
        stderrStream: ["401 ", "Unauthorized"],
        durationMs: 9,
      },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      {
        prompt: "hi",
        workingDir: "/p",
        images: [],
        signal: new AbortController().signal,
      },
      env,
    )) {
      chunks.push(chunk);
    }

    const stderrDeltas = chunks
      .filter((c) => c.type === "stderr-delta")
      .map((c) => (c as { text: string }).text);
    expect(stderrDeltas).toEqual(["401 ", "Unauthorized"]);
    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      stderr: "401 Unauthorized",
      exitCode: 1,
      durationMs: 9,
      cancelled: false,
      timedOut: false,
    });
  });

  it("passes Codex image attachments with --image flags before stdin prompt", async () => {
    let seenArgs: string[] = [];
    let seenStdin: string | undefined;
    const runner = ((command: string, args: string[], options?: ProcessRunOptions) => {
      seenArgs = args;
      seenStdin = options?.stdin;
      return Promise.resolve<ProcessRunResult>({
        exitCode: 0,
        stdout: `ran ${command}`,
        stderr: "",
        durationMs: 4,
        cancelled: false,
        timedOut: false,
      });
    }) as typeof runProcess;
    const adapter = createLocalCliAdapter(codexLocalConfig, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "codex" ? "/usr/bin/codex" : undefined),
    });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      {
        prompt: "describe attached screenshot",
        workingDir: "/p",
        images: [
          {
            name: "screen.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,iVBORw==",
            path: "/p/.gameaistudio/attachments/screen.png",
          },
        ],
        signal: new AbortController().signal,
      },
      env,
    )) {
      chunks.push(chunk);
    }

    expect(seenArgs).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--image",
      "/p/.gameaistudio/attachments/screen.png",
      "-",
    ]);
    expect(seenStdin).toBe("describe attached screenshot");
    expect(chunks.at(-1)).toMatchObject({ type: "final", exitCode: 0 });
  });

  it("parses Codex JSONL output into user-visible text instead of raw events", async () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread_123" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "已完成 Godot 改动。" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } }),
      "",
    ].join("\n");
    const runner = makeRunner({
      "/usr/bin/codex exec --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -": {
        exitCode: 0,
        stdout,
        stream: stdout.split(/(?<=\n)/),
        durationMs: 11,
      },
    });
    const adapter = createLocalCliAdapter(codexLocalConfig, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "codex" ? "/usr/bin/codex" : undefined),
    });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      {
        prompt: "hi",
        workingDir: "/p",
        images: [],
        signal: new AbortController().signal,
      },
      env,
    )) {
      chunks.push(chunk);
    }

    const deltas = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => (c as { text: string }).text);
    expect(deltas).toEqual(["已完成 Godot 改动。"]);
    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      content: "已完成 Godot 改动。",
      exitCode: 0,
    });
  });

  it("turns Codex JSONL failure events into stderr diagnostics", async () => {
    const stdout = `${JSON.stringify({
      type: "turn.failed",
      error: { message: "ERROR: Selected model is at capacity. Please try a different model." },
    })}\n`;
    const runner = makeRunner({
      "/usr/bin/codex exec --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -": {
        exitCode: 1,
        stdout,
        stream: [stdout],
        durationMs: 12,
      },
    });
    const adapter = createLocalCliAdapter(codexLocalConfig, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "codex" ? "/usr/bin/codex" : undefined),
    });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      {
        prompt: "hi",
        workingDir: "/p",
        images: [],
        signal: new AbortController().signal,
      },
      env,
    )) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      content: "",
      stderr: "ERROR: Selected model is at capacity. Please try a different model.",
      exitCode: 1,
    });
  });

  it("parses Claude stream-json output into the final assistant result", async () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "claude_123", model: "sonnet" }),
      JSON.stringify({
        type: "assistant",
        session_id: "claude_123",
        message: { content: [{ type: "text", text: "正在实现。" }] },
      }),
      JSON.stringify({
        type: "result",
        session_id: "claude_123",
        result: "实现完成。",
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
      "",
    ].join("\n");
    const runner = makeRunner({
      "/usr/bin/claude --print - --output-format stream-json --verbose --dangerously-skip-permissions": {
        exitCode: 0,
        stdout,
        stream: stdout.split(/(?<=\n)/),
        durationMs: 13,
      },
    });
    const adapter = createLocalCliAdapter(claudeLocalConfig, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      {
        prompt: "hi",
        workingDir: "/p",
        images: [],
        signal: new AbortController().signal,
      },
      env,
    )) {
      chunks.push(chunk);
    }

    expect(
      chunks
        .filter((c) => c.type === "text-delta")
        .map((c) => (c as { text: string }).text),
    ).toEqual(["正在实现。"]);
    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      content: "实现完成。",
      exitCode: 0,
    });
  });
});

describe("local-cli-adapter well-known directory discovery", () => {
  it("falls back to ~/.local/bin when PATH and npm global miss", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "gas-home-"));
    try {
      const binDir = path.join(home, ".local", "bin");
      await mkdir(binDir, { recursive: true });
      const executable = path.join(binDir, "claude");
      await writeFile(executable, "#!/bin/sh\n", "utf8");

      const adapter = createLocalCliAdapter(config, { runner: makeRunner({}) });
      // Use the host platform so the well-known directory paths join with the
      // native separator (the temp home is a real on-disk directory).
      const env = {
        ...fakeEnv({ platform: process.platform }),
        homeDir: home,
        localAppDataDir: undefined,
      } as unknown as RuntimeEnvironment;

      expect(await adapter.discover(env)).toEqual({
        found: true,
        executablePath: executable,
        source: "well-known",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("local-cli-adapter output sanitization", () => {
  const ESC = String.fromCharCode(0x1b);

  it("strips ANSI sequences from plain streaming deltas and the final output", async () => {
    const raw = `${ESC}[32m已完成${ESC}[0m\r\n下一步`;
    const runner = makeRunner({
      "/usr/bin/claude --print": {
        exitCode: 0,
        stdout: raw,
        stream: [raw],
        stderrStream: [`${ESC}[31mwarn${ESC}[0m`],
      },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      { prompt: "hi", workingDir: "/p", images: [], signal: new AbortController().signal },
      env,
    )) {
      chunks.push(chunk);
    }

    const text = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => (c as { text: string }).text)
      .join("");
    expect(text).toBe("已完成\n下一步");
    const stderr = chunks
      .filter((c) => c.type === "stderr-delta")
      .map((c) => (c as { text: string }).text)
      .join("");
    expect(stderr).toBe("warn");
    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      content: "已完成\n下一步",
      exitCode: 0,
    });
  });
});

describe("local-cli-adapter quota health", () => {
  it("marks quota=false and keeps the evidence when the probe is rate limited", async () => {
    const runner = makeRunner({
      "/usr/bin/claude --version": { exitCode: 0, stdout: "claude 1.2.3" },
      "/usr/bin/claude --print": {
        exitCode: 1,
        stderr: "API error: 429 rate limit reached for requests",
      },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const health = await adapter.health(env);
    expect(health.headlessOk).toBe(false);
    expect(health.quota).toBe(false);
    expect(health.lastErrorKind).toBe("quota");
    expect(health.detail).toContain("429");
  });

  it("marks quota=true when the probe succeeds", async () => {
    const runner = makeRunner({
      "/usr/bin/claude --version": { exitCode: 0, stdout: "claude 1.2.3" },
      "/usr/bin/claude --print": { exitCode: 0, stdout: "pong" },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    expect((await adapter.health(env)).quota).toBe(true);
  });
});

describe("local-cli-adapter broken version detection", () => {
  it("treats an error-looking --version output as not installed (Copilot stub case)", async () => {
    const runner = makeRunner({
      "/usr/bin/copilot --version": {
        exitCode: 0,
        stdout: "Cannot find GitHub Copilot CLI (https://docs.github.com/copilot/how-tos/set-up).",
      },
    });
    const adapter = createLocalCliAdapter(
      { ...config, id: "copilot", label: "Copilot", command: "copilot" },
      { runner },
    );
    const env = fakeEnv({
      which: async (c) => (c === "copilot" ? "/usr/bin/copilot" : undefined),
    });

    const health = await adapter.health(env, { probe: false });
    expect(health.installed).toBe(false);
    expect(health.headlessOk).toBe(false);
    expect(health.detail).toContain("无法正常运行");
  });

  it("keeps a normal version line as installed", async () => {
    const runner = makeRunner({
      "/usr/bin/claude --version": { exitCode: 0, stdout: "2.1.170 (Claude Code)" },
    });
    const adapter = createLocalCliAdapter(config, { runner });
    const env = fakeEnv({
      which: async (c) => (c === "claude" ? "/usr/bin/claude" : undefined),
    });

    const health = await adapter.health(env, { probe: false });
    expect(health.installed).toBe(true);
    expect(health.version).toBe("2.1.170 (Claude Code)");
  });
});

describe("local-cli-adapter headless session resume (KSCC flagship path)", () => {
  const resumeConfig: LocalCliConfig = {
    ...config,
    id: "kscc",
    label: "KSCC",
    command: "kscc",
    promptArgs: ["--print", "-", "--output-format", "stream-json"],
    outputFormat: "claude-stream-json",
    resumeArgs: (sessionId) => ["--resume", sessionId],
  };
  const streamJson = (sessionId: string, text: string) =>
    [
      JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }),
      JSON.stringify({ type: "result", session_id: sessionId, result: text }),
      "",
    ].join("\n");

  async function runResumeTurn(
    dir: string,
    table: Record<string, Resp>,
    calls: string[],
  ): Promise<TurnChunk[]> {
    const runner = ((command: string, args: string[], options?: ProcessRunOptions) => {
      calls.push(`${command} ${args.join(" ")}`);
      return makeRunner(table)(command, args, options);
    }) as typeof runProcess;
    const adapter = createLocalCliAdapter(resumeConfig, { runner });
    const env = fakeEnv({ which: async (c) => (c === "kscc" ? "/usr/bin/kscc" : undefined) });
    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      {
        prompt: "继续",
        workingDir: dir,
        sessionKey: "p1:producer",
        images: [],
        signal: new AbortController().signal,
      },
      env,
    )) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it("persists the session id and appends --resume on the next turn", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "gas-headless-resume-"));
    try {
      const calls: string[] = [];
      const base = "/usr/bin/kscc --print - --output-format stream-json";
      const table: Record<string, Resp> = {
        [base]: { exitCode: 0, stdout: streamJson("sess_abc", "第一轮完成") },
        [`${base} --resume sess_abc`]: { exitCode: 0, stdout: streamJson("sess_abc", "第二轮完成") },
      };

      const first = await runResumeTurn(dir, table, calls);
      expect(first.at(-1)).toMatchObject({ type: "final", content: "第一轮完成", exitCode: 0 });
      const stored = JSON.parse(
        await readFile(path.join(dir, ".gameaistudio", "acp-session-ids.json"), "utf8"),
      ) as Record<string, { sessionId: string }>;
      expect(stored["cli:kscc:p1:producer"]?.sessionId).toBe("sess_abc");

      const second = await runResumeTurn(dir, table, calls);
      expect(calls.at(-1)).toContain("--resume sess_abc");
      expect(second.at(-1)).toMatchObject({ type: "final", content: "第二轮完成", exitCode: 0 });
      expect(
        second.some((c) => c.type === "step" && c.title.includes("继续上次会话")),
      ).toBe(true);
    } finally {
      const { flushAllLogs } = await import("../../services/logger");
      await flushAllLogs();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("clears the stored session when a resumed turn fails", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "gas-headless-resume-"));
    try {
      const calls: string[] = [];
      const base = "/usr/bin/kscc --print - --output-format stream-json";
      const table: Record<string, Resp> = {
        [base]: { exitCode: 0, stdout: streamJson("sess_old", "ok") },
        [`${base} --resume sess_old`]: { exitCode: 1, stderr: "No conversation found" },
      };

      await runResumeTurn(dir, table, calls); // seeds sess_old
      await runResumeTurn(dir, table, calls); // resumed turn fails → cleared
      const stored = JSON.parse(
        await readFile(path.join(dir, ".gameaistudio", "acp-session-ids.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(stored["cli:kscc:p1:producer"]).toBeUndefined();
    } finally {
      const { flushAllLogs } = await import("../../services/logger");
      await flushAllLogs();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe("structured streaming paragraph separation", () => {
  it("separates consecutive Codex agent messages as paragraphs (stream and final)", async () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "先读取上下文。" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "现在开始改脚本。" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "已完成全部修改。" } }),
      "",
    ].join("\n");
    const runner = makeRunner({
      "/usr/bin/codex exec --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -": {
        exitCode: 0,
        stdout,
        stream: stdout.split(/(?<=\n)/),
      },
    });
    const adapter = createLocalCliAdapter(codexLocalConfig, { runner });
    const env = fakeEnv({ which: async (c) => (c === "codex" ? "/usr/bin/codex" : undefined) });

    const chunks: TurnChunk[] = [];
    for await (const chunk of adapter.runTurn(
      { prompt: "go", workingDir: "/p", images: [], signal: new AbortController().signal },
      env,
    )) {
      chunks.push(chunk);
    }

    const streamed = chunks
      .filter((c): c is Extract<TurnChunk, { type: "text-delta" }> => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(streamed).toBe("先读取上下文。\n\n现在开始改脚本。\n\n已完成全部修改。");
    expect(chunks.at(-1)).toMatchObject({
      type: "final",
      content: "先读取上下文。\n\n现在开始改脚本。\n\n已完成全部修改。",
      exitCode: 0,
    });
  });
});
