import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAgentLogger, getProjectLogger } from "./logger";

describe("getAgentLogger", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("writes to .gameaistudio/logs/agents/<agentId>.log and cascades into the project log", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "gas-agent-log-"));
    const agentLogger = getAgentLogger(root, "programmer");

    agentLogger.info("agent-turn", "程序 Agent 回合开始", { cli: "Codex" });
    await agentLogger.flush();
    await getProjectLogger(root).flush();

    const agentLog = await readFile(
      path.join(root, ".gameaistudio", "logs", "agents", "programmer.log"),
      "utf8"
    );
    expect(agentLog).toContain("程序 Agent 回合开始");

    const projectLog = await readFile(
      path.join(root, ".gameaistudio", "logs", "project.log"),
      "utf8"
    );
    expect(projectLog).toContain("程序 Agent 回合开始");
  });

  it("sanitizes unusual agent ids into safe filenames and caches loggers", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "gas-agent-log-"));
    const first = getAgentLogger(root, "fx/sound:agent");
    const second = getAgentLogger(root, "fx/sound:agent");
    expect(first).toBe(second);

    first.info("agent-turn", "test line");
    await first.flush();
    const log = await readFile(
      path.join(root, ".gameaistudio", "logs", "agents", "fx_sound_agent.log"),
      "utf8"
    );
    expect(log).toContain("test line");
  });
});
