import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioRunEvent } from "@gameaistudio/shared";
import { RunService } from "./run-service";
import { StudioStore } from "./store";

describe("RunService", () => {
  it("persists run lifecycle updates and emits events", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-run-"));
    const events: StudioRunEvent[] = [];

    try {
      const store = new StudioStore(path.join(dir, "state.json"));
      const runs = new RunService(store, (event) => events.push(event));

      const run = await runs.createRun({
        projectId: "proj_1",
        kind: "agent-turn",
        title: "程序 Agent 回合",
        steps: [{ title: "调用 Codex", agentId: "programmer", cliToolId: "codex" }]
      });

      await runs.startRun(run.id, run.steps[0]?.id);
      await runs.updateStep(run.id, run.steps[0]!.id, { status: "running" });
      await runs.updateStep(run.id, run.steps[0]!.id, { status: "completed", exitCode: 0 });
      const finished = await runs.finishRun(run.id, "completed", "done");

      const storedRuns = await runs.listRuns("proj_1");
      expect(storedRuns).toHaveLength(1);
      expect(storedRuns[0]?.status).toBe("completed");
      expect(storedRuns[0]?.steps[0]?.status).toBe("completed");
      expect(storedRuns[0]?.steps[0]?.exitCode).toBe(0);
      expect(finished.summary).toBe("done");
      expect(events.map((event) => event.type)).toContain("created");
      expect(events.filter((event) => event.type === "updated").length).toBeGreaterThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends step output and can cancel queued or running steps", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-run-"));

    try {
      const store = new StudioStore(path.join(dir, "state.json"));
      const runs = new RunService(store);
      const run = await runs.createRun({
        projectId: "proj_1",
        kind: "studio-workflow",
        title: "团队工作流",
        steps: [{ title: "制作人" }, { title: "程序" }]
      });

      await runs.startRun(run.id, run.steps[0]?.id);
      await runs.updateStep(run.id, run.steps[0]!.id, { status: "running" });
      await runs.appendStepOutput(run.id, run.steps[0]!.id, "streaming output");
      const cancelled = await runs.cancelRun(run.id);

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.steps[0]?.status).toBe("cancelled");
      expect(cancelled.steps[0]?.output).toContain("streaming output");
      expect(cancelled.steps[1]?.status).toBe("cancelled");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
