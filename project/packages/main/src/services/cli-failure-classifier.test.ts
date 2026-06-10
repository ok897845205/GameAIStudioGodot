import { describe, expect, it } from "vitest";
import { classifyCliFailure } from "./cli-diagnostics";

describe("classifyCliFailure", () => {
  it("returns undefined for successful runs", () => {
    expect(classifyCliFailure({ exitCode: 0, output: "done" })).toBeUndefined();
  });

  it("flags cancellation before any pattern", () => {
    expect(
      classifyCliFailure({ exitCode: null, output: "401 unauthorized", cancelled: true })?.kind,
    ).toBe("cancelled");
  });

  it("flags timeouts", () => {
    expect(
      classifyCliFailure({ exitCode: null, output: "Process timed out after 900000ms.", timedOut: true })?.kind,
    ).toBe("timeout");
  });

  it("detects a missing executable", () => {
    expect(
      classifyCliFailure({ exitCode: null, output: "Error: spawn codex ENOENT" })?.kind,
    ).toBe("not-installed");
    expect(
      classifyCliFailure({ exitCode: 1, output: "'kimi' 不是内部或外部命令" })?.kind,
    ).toBe("not-installed");
  });

  it("detects auth failures and keeps the evidence line", () => {
    const diagnosis = classifyCliFailure({
      exitCode: 1,
      output: "Some banner\nAPI Error: 401 invalid bearer token\nmore",
    });
    expect(diagnosis?.kind).toBe("auth");
    expect(diagnosis?.evidence).toContain("401");
    expect(diagnosis?.hint).toBeTruthy();
  });

  it("detects quota / rate-limit failures", () => {
    expect(
      classifyCliFailure({ exitCode: 1, output: "429 Too Many Requests: rate limit reached" })?.kind,
    ).toBe("quota");
    expect(
      classifyCliFailure({ exitCode: 1, output: "You exceeded your current quota, please check billing" })?.kind,
    ).toBe("quota");
  });

  it("detects model unavailability (Codex capacity message)", () => {
    expect(
      classifyCliFailure({
        exitCode: 1,
        output: "ERROR: Selected model is at capacity. Please try a different model.",
      })?.kind,
    ).toBe("model-unavailable");
  });

  it("detects network failures", () => {
    expect(
      classifyCliFailure({ exitCode: 1, output: "FetchError: getaddrinfo ENOTFOUND api.openai.com" })?.kind,
    ).toBe("network");
  });

  it("detects sandbox / ACL permission failures", () => {
    expect(
      classifyCliFailure({ exitCode: 1, output: "failed to apply deny-read ACLs to project" })?.kind,
    ).toBe("permission");
    expect(classifyCliFailure({ exitCode: 1, output: "EACCES: permission denied" })?.kind).toBe(
      "permission",
    );
  });

  it("detects non-interactive mode failures", () => {
    expect(
      classifyCliFailure({ exitCode: 1, output: "Raw mode is not supported on the current process.stdin" })?.kind,
    ).toBe("non-interactive");
  });

  it("detects a missing project directory", () => {
    expect(
      classifyCliFailure({ exitCode: 1, output: "chdir failed: no such file or directory" })?.kind,
    ).toBe("project-dir-missing");
    expect(
      classifyCliFailure({ exitCode: 1, output: "系统找不到指定的路径。" })?.kind,
    ).toBe("project-dir-missing");
  });

  it("detects file-write failures", () => {
    expect(classifyCliFailure({ exitCode: 1, output: "ENOSPC: no space left on device" })?.kind).toBe(
      "file-write",
    );
  });

  it("falls back to unknown with a generic summary", () => {
    const diagnosis = classifyCliFailure({ exitCode: 1, output: "something exploded" });
    expect(diagnosis?.kind).toBe("unknown");
    expect(diagnosis?.summary).toBeTruthy();
  });
});
