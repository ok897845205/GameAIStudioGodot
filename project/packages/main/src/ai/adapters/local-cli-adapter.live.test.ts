import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalCliAdapter } from "./local-cli-adapter";
import { claudeLocalConfig } from "./claude-local";
import { codexLocalConfig } from "./codex-local";
import { createRuntimeEnvironment } from "../runtime-environment";
import { collectTurn } from "../adapter-contract";

// LIVE diagnostic — exercises the REAL adapter.runTurn code path (resolve via
// where.exe → cmd-wrap → stdin → async-queue stream) against an actually
// installed CLI, to confirm the app's execution path produces model output.
// Makes a real model call, so it's opt-in:
//   PROBE_LIVE=1 PROBE_CLI=claude ./node_modules/.bin/vitest run \
//     packages/main/src/ai/adapters/local-cli-adapter.live.test.ts
const LIVE = process.env.PROBE_LIVE === "1";
const cli = process.env.PROBE_CLI ?? "claude";
const config = cli === "codex" ? codexLocalConfig : claudeLocalConfig;

describe.skipIf(!LIVE)(`LIVE adapter runTurn (${cli})`, () => {
  it("produces model output via the real adapter code path", async () => {
    const adapter = createLocalCliAdapter(config);
    const env = createRuntimeEnvironment();
    const workingDir = await mkdtemp(path.join(os.tmpdir(), "gais-live-"));
    const controller = new AbortController();

    const result = await collectTurn(
      adapter.runTurn(
        {
          prompt: "用一句话回答：你是什么模型？",
          workingDir,
          images: [],
          signal: controller.signal,
        },
        env,
      ),
    );

    // eslint-disable-next-line no-console
    console.log(
      `\n[LIVE ${cli}] exitCode=${result.exitCode} durationMs=${result.durationMs}` +
        `\n  content: ${JSON.stringify(result.content)}` +
        `\n  stderr:  ${JSON.stringify(result.stderr)}` +
        (result.error ? `\n  error:   ${result.error}` : ""),
    );

    expect(result.content.trim().length).toBeGreaterThan(0);
  }, 180_000);
});
