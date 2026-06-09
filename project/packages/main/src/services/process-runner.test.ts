import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildProcessLaunch, ProcessRegistry, runProcess } from "./process-runner";

describe("runProcess", () => {
  it("wraps Windows command shims with cmd.exe", () => {
    const launch = buildProcessLaunch(
      "C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex.cmd",
      ["exec", "--skip-git-repo-check", "hello world"],
      "win32",
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" }
    );

    expect(launch).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/v:off",
        "/c",
        "\"\"C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex.cmd\" \"exec\" \"--skip-git-repo-check\" \"hello world\"\""
      ],
      windowsVerbatimArguments: true
    });
  });

  it("compacts multiline arguments when wrapping Windows command shims", () => {
    const launch = buildProcessLaunch("C:\\tools\\fake-ai.cmd", ["line one\nline two\r\nline three"], "win32", {
      ComSpec: "cmd.exe"
    });

    expect(launch.args[3]).toBe("\"\"C:\\tools\\fake-ai.cmd\" \"line one line two line three\"\"");
  });

  it("streams stdout and stderr while collecting the final result", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await runProcess(
      process.execPath,
      ["-e", "console.log('hello from stdout'); console.error('hello from stderr');"],
      {
        onStdout: (chunk) => stdoutChunks.push(chunk),
        onStderr: (chunk) => stderrChunks.push(chunk)
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello from stdout");
    expect(result.stderr).toContain("hello from stderr");
    expect(stdoutChunks.join("")).toContain("hello from stdout");
    expect(stderrChunks.join("")).toContain("hello from stderr");
  });

  it("can cancel a registered process by run id", async () => {
    const registry = new ProcessRegistry();
    const running = runProcess(process.execPath, ["-e", "setTimeout(() => {}, 30000);"], {
      registry,
      processKey: "run_test:step_1",
      timeoutMs: 30000
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(registry.cancelRun("run_test")).toBe(1);
    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("Process cancelled by user.");
  });

  it("runs Windows npm-style .cmd shims", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const parent = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-cmd-shim-"));
    const shimDir = path.join(parent, "folder with spaces");
    await mkdir(shimDir);
    const scriptPath = path.join(shimDir, "tool.js");
    const shimPath = path.join(shimDir, "tool.cmd");
    await writeFile(scriptPath, "console.log(JSON.stringify(process.argv.slice(2)))\n", "utf8");
    await writeFile(shimPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");

    const result = await runProcess(shimPath, ["hello world", 'quote " inside'], { timeoutMs: 5000 });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual(["hello world", 'quote " inside']);
  });
});
