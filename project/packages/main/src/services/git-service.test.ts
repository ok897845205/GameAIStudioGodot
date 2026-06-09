import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectDetails, StudioProject } from "@gameaistudio/shared";
import { describe, expect, it } from "vitest";
import { buildProjectGitignore, GitService, parseGitStatusPorcelain } from "./git-service";
import type { ProcessRunOptions, ProcessRunResult } from "./process-runner";

function processResult(exitCode: number | null, stdout = "", stderr = ""): ProcessRunResult {
  return {
    exitCode,
    stdout,
    stderr,
    durationMs: 1,
    cancelled: false,
    timedOut: false
  };
}

function createProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "黄金矿工",
    dimension: "2d",
    prompt: "我要创建一个黄金矿工",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    activeAgentId: "producer"
  };
}

function createProjectService(project: StudioProject) {
  return {
    requireProject: async () => project,
    getProject: async (): Promise<ProjectDetails> => ({
      ...project,
      messages: [],
      runs: [],
      snapshots: []
    })
  };
}

describe("parseGitStatusPorcelain", () => {
  it("extracts changed file paths from short Git status output", () => {
    expect(parseGitStatusPorcelain(" M scripts/player.gd\n?? assets/gold.png\nR  old.gd -> new.gd\n")).toEqual([
      "scripts/player.gd",
      "assets/gold.png",
      "old.gd -> new.gd"
    ]);
  });
});

describe("buildProjectGitignore", () => {
  it("ignores generated output while keeping project source trackable", () => {
    const content = buildProjectGitignore();

    expect(content).toContain(".godot/");
    expect(content).toContain("build/");
    expect(content).toContain("dist/");
    expect(content).toContain(".gameaistudio/snapshots/");
  });
});

describe("GitService", () => {
  it("reads the Git status for an initialized project", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-git-service-"));
    const project = createProject(dir);
    await mkdir(path.join(dir, ".git"), { recursive: true });

    const service = new GitService(createProjectService(project) as never, async (_command, args) => {
      if (args[0] === "--version") {
        return processResult(0, "git version 2.50.0\n");
      }
      if (args[0] === "status") {
        return processResult(0, " M scripts/player.gd\n?? assets/gold.png\n");
      }
      if (args.includes("--abbrev-ref")) {
        return processResult(0, "main\n");
      }
      if (args.includes("--short")) {
        return processResult(0, "abc123\n");
      }
      return processResult(0);
    });

    try {
      const status = await service.getStatus(project.id);

      expect(status.available).toBe(true);
      expect(status.initialized).toBe(true);
      expect(status.clean).toBe(false);
      expect(status.branch).toBe("main");
      expect(status.head).toBe("abc123");
      expect(status.changedFiles).toEqual(["scripts/player.gd", "assets/gold.png"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("initializes a project repository and commits the current files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-git-service-"));
    const project = createProject(dir);
    const calls: string[][] = [];
    let statusCalls = 0;
    await writeFile(path.join(dir, "project.godot"), "config/name=\"黄金矿工\"\n", "utf8");

    const service = new GitService(createProjectService(project) as never, async (_command, args, options?: ProcessRunOptions) => {
      calls.push(args);
      if (args[0] === "--version") {
        return processResult(0, "git version 2.50.0\n");
      }
      if (args[0] === "init") {
        await mkdir(path.join(options?.cwd ?? dir, ".git"), { recursive: true });
        return processResult(0, "Initialized empty Git repository\n");
      }
      if (args[0] === "add") {
        return processResult(0);
      }
      if (args[0] === "status") {
        statusCalls += 1;
        return processResult(0, statusCalls === 1 ? "A  project.godot\nA  .gitignore\n" : "");
      }
      if (args.includes("commit")) {
        return processResult(0, "[main (root-commit) abc123] 初始化\n");
      }
      if (args.includes("--abbrev-ref")) {
        return processResult(0, "main\n");
      }
      if (args.includes("--short")) {
        return processResult(0, "abc123\n");
      }
      return processResult(0);
    });

    try {
      const result = await service.initializeProject(project.id, "初始化");

      expect(result.ok).toBe(true);
      expect(result.status.initialized).toBe(true);
      expect(result.status.clean).toBe(true);
      expect(calls.some((args) => args[0] === "init")).toBe(true);
      expect(calls.some((args) => args.includes("commit") && args.includes("初始化"))).toBe(true);
      expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toContain(".gameaistudio/snapshots/");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
