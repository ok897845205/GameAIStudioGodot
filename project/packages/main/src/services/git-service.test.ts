import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectDetails, StudioProject } from "@gameaistudio/shared";
import { describe, expect, it } from "vitest";
import { buildProjectGitignore, GitService, parseGitLog, parseGitStatusPorcelain } from "./git-service";
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
      runs: []
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

describe("parseGitLog", () => {
  it("parses the five-field log format used by GitService", () => {
    expect(parseGitLog("abc123\u001fa1b2c3\u001fGameAIStudio\u001f2026-06-09T10:00:00+08:00\u001fInitial commit\n")).toEqual([
      {
        hash: "abc123",
        shortHash: "a1b2c3",
        author: "GameAIStudio",
        date: "2026-06-09T10:00:00+08:00",
        message: "Initial commit"
      }
    ]);
  });
});

describe("buildProjectGitignore", () => {
  it("ignores generated output while keeping project source trackable", () => {
    const content = buildProjectGitignore();

    expect(content).toContain(".godot/");
    expect(content).toContain("build/");
    expect(content).toContain("dist/");
    expect(content).toContain(".gameaistudio/attachments/");
    expect(content).not.toContain(".gameaistudio/snapshots/");
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
      if (args[0] === "log") {
        return processResult(0, "abc123\u001fabc123\u001fGameAIStudio\u001f2026-06-09T10:00:00+08:00\u001fInitial\n");
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
      expect(status.recentCommits[0]?.message).toBe("Initial");
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
      if (args[0] === "log") {
        return processResult(0, "abc123\u001fabc123\u001fGameAIStudio\u001f2026-06-09T10:00:00+08:00\u001f初始化\n");
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
      expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toContain(".gameaistudio/attachments/");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("restores an existing commit with a hard reset", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-git-service-"));
    const project = createProject(dir);
    const calls: string[][] = [];
    await mkdir(path.join(dir, ".git"), { recursive: true });

    const service = new GitService(createProjectService(project) as never, async (_command, args) => {
      calls.push(args);
      if (args[0] === "--version") {
        return processResult(0, "git version 2.50.0\n");
      }
      if (args[0] === "status") {
        return processResult(0, "");
      }
      if (args.includes("--abbrev-ref")) {
        return processResult(0, "main\n");
      }
      if (args.includes("--short")) {
        return processResult(0, "abc123\n");
      }
      if (args[0] === "log") {
        return processResult(0, "abc123456\u001fabc123\u001fGameAIStudio\u001f2026-06-09T10:00:00+08:00\u001fPlayable version\n");
      }
      if (args[0] === "reset") {
        return processResult(0, "HEAD is now at abc123 Playable version\n");
      }
      return processResult(0);
    });

    try {
      const result = await service.restore({
        projectId: project.id,
        commitHash: "abc123456"
      });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("Playable version");
      expect(calls.some((args) => args.join(" ") === "reset --hard abc123456")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("restores any valid commit hash even when it is outside the recent list", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-git-service-"));
    const project = createProject(dir);
    const calls: string[][] = [];
    await mkdir(path.join(dir, ".git"), { recursive: true });

    const service = new GitService(createProjectService(project) as never, async (_command, args) => {
      calls.push(args);
      if (args[0] === "--version") {
        return processResult(0, "git version 2.50.0\n");
      }
      if (args[0] === "status") {
        return processResult(0, "");
      }
      if (args.includes("--abbrev-ref")) {
        return processResult(0, "main\n");
      }
      if (args.includes("--short")) {
        return processResult(0, "abc123\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return processResult(0, "def456789\n");
      }
      if (args[0] === "log" && args[1] === "-1") {
        return processResult(0, "def456789\u001fdef456\u001fGameAIStudio\u001f2026-06-08T10:00:00+08:00\u001fOlder playable version\n");
      }
      if (args[0] === "log") {
        return processResult(0, "abc123456\u001fabc123\u001fGameAIStudio\u001f2026-06-09T10:00:00+08:00\u001fRecent version\n");
      }
      if (args[0] === "reset") {
        return processResult(0, "HEAD is now at def456 Older playable version\n");
      }
      return processResult(0);
    });

    try {
      const result = await service.restore({
        projectId: project.id,
        commitHash: "def456"
      });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("Older playable version");
      expect(calls.some((args) => args.join(" ") === "rev-parse --verify def456^{commit}")).toBe(true);
      expect(calls.some((args) => args.join(" ") === "reset --hard def456789")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
