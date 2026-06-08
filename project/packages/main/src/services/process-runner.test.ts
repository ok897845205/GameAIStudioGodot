import { describe, expect, it } from "vitest";
import { ProcessRegistry, runProcess } from "./process-runner";

describe("runProcess", () => {
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
});
