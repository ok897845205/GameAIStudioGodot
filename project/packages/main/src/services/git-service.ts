import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitCommitInput, GitCommitResult, GitProjectStatus, ProjectDetails, StudioProject } from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import { runProcess, type ProcessRunResult, type ProcessRunOptions } from "./process-runner";

type CommandRunner = typeof runProcess;

const GIT_COMMIT_IDENTITY = ["-c", "user.name=GameAIStudio", "-c", "user.email=gameaistudio@local"];

export function buildProjectGitignore(): string {
  return [
    "# Godot generated data",
    ".godot/",
    "build/",
    "dist/",
    "*.tmp",
    "*.uid",
    "",
    "# GameAIStudio local runtime data",
    ".gameaistudio/snapshots/",
    ".gameaistudio/last-restore.json",
    "",
    "# Local dependencies",
    "node_modules/",
    ""
  ].join("\n");
}

export function parseGitStatusPorcelain(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function firstOutputLine(result: ProcessRunResult): string | undefined {
  return (result.stdout || result.stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function commitResultMessage(result: ProcessRunResult): string {
  return firstOutputLine(result) ?? "Git 命令未返回输出。";
}

export class GitService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly runner: CommandRunner = runProcess
  ) {}

  async getStatus(projectId: string): Promise<GitProjectStatus> {
    const project = await this.projectService.requireProject(projectId);
    const gitVersion = await this.runner("git", ["--version"], { timeoutMs: 4000 });
    const checkedAt = new Date().toISOString();

    if (gitVersion.exitCode !== 0) {
      return {
        projectId,
        available: false,
        initialized: false,
        clean: true,
        changedFiles: [],
        message: "未检测到 Git，无法启用项目版本管理。",
        error: commitResultMessage(gitVersion),
        lastCheckedAt: checkedAt
      };
    }

    if (!(await pathExists(path.join(project.rootPath, ".git")))) {
      return {
        projectId,
        available: true,
        initialized: false,
        clean: true,
        changedFiles: [],
        message: "此项目尚未启用 Git 版本管理。",
        lastCheckedAt: checkedAt
      };
    }

    const [status, branch, head] = await Promise.all([
      this.git(project, ["status", "--short"], { timeoutMs: 4000 }),
      this.git(project, ["rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 4000 }),
      this.git(project, ["rev-parse", "--short", "HEAD"], { timeoutMs: 4000 })
    ]);

    if (status.exitCode !== 0) {
      return {
        projectId,
        available: true,
        initialized: false,
        clean: true,
        changedFiles: [],
        message: "Git 仓库状态读取失败。",
        error: commitResultMessage(status),
        lastCheckedAt: checkedAt
      };
    }

    const changedFiles = parseGitStatusPorcelain(status.stdout);
    return {
      projectId,
      available: true,
      initialized: true,
      clean: changedFiles.length === 0,
      branch: branch.exitCode === 0 ? firstOutputLine(branch) : undefined,
      head: head.exitCode === 0 ? firstOutputLine(head) : undefined,
      changedFiles,
      message: changedFiles.length === 0 ? "Git 工作区干净。" : `Git 工作区有 ${changedFiles.length} 个未提交变更。`,
      lastCheckedAt: checkedAt
    };
  }

  async initializeProject(projectId: string, message = "初始化 GameAIStudio Godot 项目"): Promise<GitCommitResult> {
    const project = await this.projectService.requireProject(projectId);
    const unavailable = await this.unavailableResult(project, "未检测到 Git，已跳过 Git 初始化。");
    if (unavailable) {
      return unavailable;
    }

    await this.writeGitignore(project);
    if (!(await pathExists(path.join(project.rootPath, ".git")))) {
      const init = await this.git(project, ["init"], { timeoutMs: 10000 });
      if (init.exitCode !== 0) {
        return this.commandFailure(project, init, "Git 初始化失败。");
      }
    }

    return this.commitTrackedChanges(project, message);
  }

  async commit(input: GitCommitInput): Promise<GitCommitResult> {
    const project = await this.projectService.requireProject(input.projectId);
    const status = await this.getStatus(project.id);
    if (!status.available) {
      return this.withProject(project, {
        ok: false,
        status,
        message: status.message,
        stdout: "",
        stderr: status.error ?? status.message,
        exitCode: null
      });
    }
    if (!status.initialized) {
      return this.initializeProject(project.id, input.message);
    }

    await this.writeGitignore(project);
    return this.commitTrackedChanges(project, input.message);
  }

  private async unavailableResult(project: StudioProject, message: string): Promise<GitCommitResult | undefined> {
    const gitVersion = await this.runner("git", ["--version"], { timeoutMs: 4000 });
    if (gitVersion.exitCode === 0) {
      return undefined;
    }
    const status = await this.getStatus(project.id);
    return this.withProject(project, {
      ok: false,
      status,
      message,
      stdout: "",
      stderr: status.error ?? message,
      exitCode: gitVersion.exitCode
    });
  }

  private async commitTrackedChanges(project: StudioProject, message: string): Promise<GitCommitResult> {
    const add = await this.git(project, ["add", "--all"], { timeoutMs: 10000 });
    if (add.exitCode !== 0) {
      return this.commandFailure(project, add, "Git 暂存变更失败。");
    }

    const status = await this.git(project, ["status", "--short"], { timeoutMs: 4000 });
    if (status.exitCode !== 0) {
      return this.commandFailure(project, status, "Git 状态读取失败。");
    }
    if (parseGitStatusPorcelain(status.stdout).length === 0) {
      const cleanStatus = await this.getStatus(project.id);
      return this.withProject(project, {
        ok: true,
        status: cleanStatus,
        message: "没有需要提交的 Git 变更。",
        stdout: status.stdout,
        stderr: status.stderr,
        exitCode: status.exitCode
      });
    }

    const commitMessage = message.trim() || `保存 ${project.name} 当前版本`;
    const commit = await this.git(project, [...GIT_COMMIT_IDENTITY, "commit", "-m", commitMessage], { timeoutMs: 20000 });
    if (commit.exitCode !== 0) {
      return this.commandFailure(project, commit, "Git 提交失败。");
    }

    const nextStatus = await this.getStatus(project.id);
    return this.withProject(project, {
      ok: true,
      status: nextStatus,
      message: `Git 版本已提交：${commitMessage}`,
      stdout: commit.stdout,
      stderr: commit.stderr,
      exitCode: commit.exitCode
    });
  }

  private async commandFailure(project: StudioProject, result: ProcessRunResult, message: string): Promise<GitCommitResult> {
    const status = await this.getStatus(project.id);
    return this.withProject(project, {
      ok: false,
      status,
      message,
      stdout: result.stdout,
      stderr: result.stderr || commitResultMessage(result),
      exitCode: result.exitCode
    });
  }

  private async withProject(
    project: StudioProject,
    result: Omit<GitCommitResult, "project">
  ): Promise<GitCommitResult> {
    const details = await this.projectService.getProject(project.id);
    return {
      ...result,
      project: {
        ...details,
        gitStatus: result.status
      } satisfies ProjectDetails
    };
  }

  private async writeGitignore(project: StudioProject): Promise<void> {
    await writeFile(path.join(project.rootPath, ".gitignore"), buildProjectGitignore(), "utf8");
  }

  private git(project: StudioProject, args: string[], options: ProcessRunOptions = {}): Promise<ProcessRunResult> {
    return this.runner("git", args, {
      cwd: project.rootPath,
      ...options
    });
  }
}
