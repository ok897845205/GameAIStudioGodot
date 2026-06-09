import { describe, expect, it } from "vitest";
import { EnvironmentService, environmentStatus } from "./environment-service";
import type { ProcessRunResult } from "./process-runner";

function result(exitCode: number | null, stdout = "", stderr = ""): ProcessRunResult {
  return {
    exitCode,
    stdout,
    stderr,
    durationMs: 1,
    cancelled: false,
    timedOut: false
  };
}

describe("environmentStatus", () => {
  it("reports ready only when every environment tool is available", () => {
    expect(
      environmentStatus([
        {
          id: "git",
          label: "Git",
          command: "git",
          installed: true,
          status: "available",
          diagnostics: [],
          lastCheckedAt: "2026-06-09T00:00:00.000Z"
        },
        {
          id: "node",
          label: "Node.js",
          command: "node",
          installed: true,
          status: "available",
          diagnostics: [],
          lastCheckedAt: "2026-06-09T00:00:00.000Z"
        }
      ])
    ).toBe("ready");
  });
});

describe("EnvironmentService", () => {
  it("detects Git and Node.js with versions and executable paths", async () => {
    const service = new EnvironmentService(async (command, args) => {
      if (command === "where.exe" || command === "sh") {
        const target = command === "where.exe" ? args[0] : args.at(-1)?.split(" ").at(-1);
        return result(0, target === "git" ? "C:\\Program Files\\Git\\cmd\\git.exe\n" : "C:\\Program Files\\nodejs\\node.exe\n");
      }
      if (command.includes("git")) {
        return result(0, "git version 2.50.0\n");
      }
      return result(0, "v22.15.0\n");
    });

    const environment = await service.inspect();

    expect(environment.status).toBe("ready");
    expect(environment.tools.map((tool) => [tool.id, tool.status])).toEqual([
      ["git", "available"],
      ["node", "available"]
    ]);
    expect(environment.tools.find((tool) => tool.id === "git")?.version).toBe("git version 2.50.0");
    expect(environment.tools.find((tool) => tool.id === "node")?.executablePath).toContain("node");
  });

  it("reports a partial environment when Node.js is available but Git is missing", async () => {
    const service = new EnvironmentService(async (command, args) => {
      if (command === "where.exe" || command === "sh") {
        const target = command === "where.exe" ? args[0] : args.at(-1)?.split(" ").at(-1);
        return target === "git" ? result(1, "", "not found") : result(0, "/usr/local/bin/node\n");
      }
      return command.includes("node") ? result(0, "v22.15.0\n") : result(null, "", "spawn git ENOENT");
    });

    const environment = await service.inspect();

    expect(environment.status).toBe("partial");
    expect(environment.tools.find((tool) => tool.id === "git")?.status).toBe("missing");
    expect(environment.tools.find((tool) => tool.id === "git")?.diagnostics[0]?.action).toContain("安装 Git");
  });
});
