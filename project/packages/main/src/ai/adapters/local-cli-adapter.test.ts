import { describe, it, expect } from "vitest";
import {
  createLocalCliAdapter,
  type LocalCliConfig,
} from "./local-cli-adapter";
import { claudeLocalConfig } from "./claude-local";
import { codexLocalConfig } from "./codex-local";
import { kimiLocalConfig } from "./kimi-local";
import { ksccLocalConfig } from "./kscc-local";
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
    for (const config of [claudeLocalConfig, ksccLocalConfig, kimiLocalConfig]) {
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
