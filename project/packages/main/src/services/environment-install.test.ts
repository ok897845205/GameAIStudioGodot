import { describe, expect, it } from "vitest";
import { EnvironmentService, mergePathEntries } from "./environment-service";
import type { ProcessRunResult, runProcess } from "./process-runner";

function makeRunner(
  table: Record<string, Partial<ProcessRunResult>>,
  calls: string[] = []
): typeof runProcess {
  return ((command: string, args: string[]) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    const match = Object.entries(table).find(([prefix]) => key.startsWith(prefix));
    const resp = match?.[1] ?? {};
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

describe("mergePathEntries", () => {
  it("appends only registry entries the process PATH is missing (case-insensitive)", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const current = ["C:\\Windows", "C:\\Tools"].join(sep);
    const registry = ["c:\\windows", "C:\\Program Files\\Git\\cmd", ""].join(sep);
    const merged = mergePathEntries(current, registry);
    expect(merged.split(sep)).toEqual(["C:\\Windows", "C:\\Tools", "C:\\Program Files\\Git\\cmd"]);
  });

  it("returns the current PATH unchanged when nothing is new", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const current = ["C:\\Windows"].join(sep);
    expect(mergePathEntries(current, "c:\\windows")).toBe(current);
  });
});

describe("EnvironmentService.install", () => {
  it("installs via winget with silent agreement flags", async () => {
    const calls: string[] = [];
    const runner = makeRunner(
      {
        "where.exe winget": { exitCode: 0, stdout: "C:\\winget.exe" },
        winget: { exitCode: 0, stdout: "Successfully installed" },
        powershell: { exitCode: 0, stdout: "C:\\Program Files\\Git\\cmd" }
      },
      calls
    );
    const service = new EnvironmentService(runner, "win32");

    const result = await service.install("git");
    expect(result.ok).toBe(true);
    const wingetCall = calls.find((call) => call.startsWith("winget "));
    expect(wingetCall).toContain("install --id Git.Git -e --silent");
    expect(wingetCall).toContain("--accept-source-agreements");
    expect(wingetCall).toContain("--accept-package-agreements");
    // PATH refresh happens after a successful install.
    expect(calls.some((call) => call.startsWith("powershell "))).toBe(true);
  });

  it("uses the Node.js LTS winget id for node", async () => {
    const calls: string[] = [];
    const runner = makeRunner(
      {
        "where.exe winget": { exitCode: 0, stdout: "C:\\winget.exe" },
        winget: { exitCode: 0 },
        powershell: { exitCode: 0, stdout: "" }
      },
      calls
    );
    const service = new EnvironmentService(runner, "win32");
    await service.install("node");
    expect(calls.find((call) => call.startsWith("winget "))).toContain("OpenJS.NodeJS.LTS");
  });

  it("fails with a manual hint when winget is unavailable", async () => {
    const runner = makeRunner({ "where.exe winget": { exitCode: 1 } });
    const service = new EnvironmentService(runner, "win32");
    const result = await service.install("git");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("winget");
    expect(result.stderr).toContain("git-scm.com");
  });

  it("rejects one-click install on non-Windows platforms", async () => {
    const service = new EnvironmentService(makeRunner({}), "linux");
    const result = await service.install("node");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("手动安装");
  });

  it("reports installAvailable on missing tools when winget exists", async () => {
    const runner = makeRunner({
      "where.exe winget": { exitCode: 0, stdout: "C:\\winget.exe" },
      "where.exe git": { exitCode: 1 },
      "where.exe node": { exitCode: 1 },
      git: { exitCode: null },
      node: { exitCode: null }
    });
    const service = new EnvironmentService(runner, "win32");
    const environment = await service.inspect();
    for (const tool of environment.tools) {
      expect(tool.installed).toBe(false);
      expect(tool.installAvailable).toBe(true);
      expect(tool.installHint).toBeTruthy();
    }
  });
});
