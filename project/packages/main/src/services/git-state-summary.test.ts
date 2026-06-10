import { describe, expect, it } from "vitest";
import { summarizeGitState } from "./git-service";
import type { ProcessRunResult, runProcess } from "./process-runner";

function makeRunner(table: Record<string, Partial<ProcessRunResult>>): typeof runProcess {
  return ((command: string, args: string[]) => {
    const resp = table[`${command} ${args.join(" ")}`] ?? {};
    return Promise.resolve<ProcessRunResult>({
      exitCode: resp.exitCode === undefined ? 0 : resp.exitCode,
      stdout: resp.stdout ?? "",
      stderr: resp.stderr ?? "",
      durationMs: 1,
      cancelled: false,
      timedOut: false
    });
  }) as typeof runProcess;
}

describe("summarizeGitState", () => {
  it("summarizes branch, head and changed file count", async () => {
    const runner = makeRunner({
      "git status --porcelain": { exitCode: 0, stdout: " M scripts/player.gd\n?? assets/new.png\n" },
      "git rev-parse --abbrev-ref HEAD": { exitCode: 0, stdout: "main\n" },
      "git rev-parse --short HEAD": { exitCode: 0, stdout: "abc1234\n" }
    });

    expect(await summarizeGitState("/project", runner)).toEqual({
      available: true,
      initialized: true,
      branch: "main",
      head: "abc1234",
      changedCount: 2
    });
  });

  it("reports an uninitialized repository when git status fails", async () => {
    const runner = makeRunner({
      "git status --porcelain": { exitCode: 128, stderr: "fatal: not a git repository" }
    });

    expect(await summarizeGitState("/project", runner)).toEqual({
      available: true,
      initialized: false,
      changedCount: 0
    });
  });

  it("reports git unavailable when the binary is missing", async () => {
    const runner = makeRunner({
      "git status --porcelain": { exitCode: null, stderr: "spawn git ENOENT" }
    });

    expect(await summarizeGitState("/project", runner)).toEqual({
      available: false,
      initialized: false,
      changedCount: 0
    });
  });
});
