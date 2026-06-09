import { describe, it, expect } from "vitest";
import {
  createLocalCliAdapter,
  type LocalCliConfig,
} from "./local-cli-adapter";
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
});
