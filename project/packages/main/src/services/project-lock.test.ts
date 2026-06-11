import { describe, expect, it } from "vitest";
import { ProjectLockService } from "./project-lock";

describe("ProjectLockService", () => {
  it("excludes work within one project but stays parallel across projects", () => {
    const locks = new ProjectLockService();

    expect(locks.tryAcquire("p1", "studio-workflow")).toBe(true);
    expect(locks.tryAcquire("p1", "agent-turn")).toBe(false); // same project busy
    expect(locks.tryAcquire("p2", "agent-turn")).toBe(true); // other project fine

    locks.release("p1");
    expect(locks.tryAcquire("p1", "agent-turn")).toBe(true); // released → reusable
  });

  it("describes the active work and builds a friendly busy message", () => {
    const locks = new ProjectLockService();
    locks.tryAcquire("p1", "studio-workflow");

    expect(locks.describe("p1")?.kind).toBe("studio-workflow");
    expect(locks.busyMessage("p1")).toContain("团队工作流");
    expect(locks.busyMessage("p1")).toContain("未执行");

    locks.tryAcquire("p2", "agent-turn");
    expect(locks.busyMessage("p2")).toContain("Agent 回合");
  });
});
