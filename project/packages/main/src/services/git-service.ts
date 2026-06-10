import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  GitCommit,
  GitCommitInput,
  GitCommitResult,
  GitFileChange,
  GitProjectStatus,
  GitRestoreInput,
  GitRestoreResult,
  ProjectDetails,
  StudioProject
} from "@gameaistudio/shared";
import { ProjectService } from "./project-service";
import { runProcess, type ProcessRunResult, type ProcessRunOptions } from "./process-runner";
import { getProjectLogger } from "./logger";

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
    ".gameaistudio/project.json",
    ".gameaistudio/agent-context.md",
    ".gameaistudio/agent-journal.md",
    ".gameaistudio/logs/",
    ".gameaistudio/last-restore.json",
    ".gameaistudio/attachments/",
    "",
    "# Local dependencies",
    "node_modules/",
    ""
  ].join("\n");
}

export function parseGitStatusPorcelain(stdout: string): string[] {
  return parseGitStatusChanges(stdout).map((change) => change.path);
}

export function parseGitStatusChanges(stdout: string): GitFileChange[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawStatus = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const [originalPath, nextPath] =
        rawStatus.includes("R") || rawStatus.includes("C") ? rawPath.split(" -> ") : [undefined, rawPath];
      const path = (nextPath ?? rawPath).trim();
      return {
        path,
        kind: gitChangeKind(rawStatus),
        rawStatus,
        ...(originalPath && nextPath ? { originalPath: originalPath.trim() } : {})
      } satisfies GitFileChange;
    })
    .filter((change) => Boolean(change.path));
}

export function parseGitLog(stdout: string): GitCommit[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = "", shortHash = "", author = "", date = "", ...messageParts] = line.split("\u001f");
      return {
        hash,
        shortHash,
        author,
        date,
        message: messageParts.join("\u001f")
      };
    })
    .filter((commit) => commit.hash && commit.shortHash);
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

function shortOutput(value?: string, maxLength = 1200): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(+${text.length - maxLength})` : text;
}

function gitChangeKind(rawStatus: string): GitFileChange["kind"] {
  if (rawStatus === "??") return "untracked";
  if (rawStatus.includes("U") || rawStatus === "AA" || rawStatus === "DD") return "conflicted";
  if (rawStatus.includes("R")) return "renamed";
  if (rawStatus.includes("C")) return "copied";
  if (rawStatus.includes("D")) return "deleted";
  if (rawStatus.includes("A")) return "added";
  if (rawStatus.includes("M")) return "modified";
  return "unknown";
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
        recentCommits: [],
        changes: [],
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
        recentCommits: [],
        changes: [],
        changedFiles: [],
        message: "此项目尚未启用 Git 版本管理。",
        lastCheckedAt: checkedAt
      };
    }

    const [status, branch, head, log] = await Promise.all([
      this.git(project, ["status", "--short"], { timeoutMs: 4000 }),
      this.git(project, ["rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 4000 }),
      this.git(project, ["rev-parse", "--short", "HEAD"], { timeoutMs: 4000 }),
      this.git(project, ["log", "-5", "--pretty=format:%H\u001f%h\u001f%an\u001f%ad\u001f%s", "--date=iso-strict"], { timeoutMs: 4000 })
    ]);

    if (status.exitCode !== 0) {
      return {
        projectId,
        available: true,
        initialized: false,
        clean: true,
        recentCommits: [],
        changes: [],
        changedFiles: [],
        message: "Git 仓库状态读取失败。",
        error: commitResultMessage(status),
        lastCheckedAt: checkedAt
      };
    }

    const changes = parseGitStatusChanges(status.stdout);
    const changedFiles = changes.map((change) => change.path);
    return {
      projectId,
      available: true,
      initialized: true,
      clean: changedFiles.length === 0,
      branch: branch.exitCode === 0 ? firstOutputLine(branch) : undefined,
      head: head.exitCode === 0 ? firstOutputLine(head) : undefined,
      recentCommits: log.exitCode === 0 ? parseGitLog(log.stdout) : [],
      changes,
      changedFiles,
      message: changedFiles.length === 0 ? "Git 工作区干净。" : `Git 工作区有 ${changedFiles.length} 个未提交变更。`,
      lastCheckedAt: checkedAt
    };
  }

  async initializeProject(projectId: string, message = "初始化 GameAIStudio Godot 项目"): Promise<GitCommitResult> {
    const project = await this.projectService.requireProject(projectId);
    getProjectLogger(project.rootPath).info("git", "开始初始化 Git 版本库", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      message
    });
    const unavailable = await this.unavailableResult(project, "未检测到 Git，已跳过 Git 初始化。");
    if (unavailable) {
      this.logGitResult(project, "Git 初始化跳过", unavailable);
      return unavailable;
    }

    await this.writeGitignore(project);
    if (!(await pathExists(path.join(project.rootPath, ".git")))) {
      const init = await this.git(project, ["init"], { timeoutMs: 10000 });
      if (init.exitCode !== 0) {
        const failed = await this.commandFailure(project, init, "Git 初始化失败。");
        this.logGitResult(project, "Git 初始化失败", failed);
        return failed;
      }
    }

    const result = await this.commitTrackedChanges(project, message);
    this.logGitResult(project, "Git 初始化完成", result);
    return result;
  }

  async commit(input: GitCommitInput): Promise<GitCommitResult> {
    const project = await this.projectService.requireProject(input.projectId);
    getProjectLogger(project.rootPath).info("git", "开始保存 Git 版本", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      message: input.message
    });
    const status = await this.getStatus(project.id);
    if (!status.available) {
      const result = await this.withProject(project, {
        ok: false,
        status,
        message: status.message,
        stdout: "",
        stderr: status.error ?? status.message,
        exitCode: null
      });
      this.logGitResult(project, "Git 保存失败", result);
      return result;
    }
    if (!status.initialized) {
      getProjectLogger(project.rootPath).info("git", "项目尚未启用 Git，保存动作将先初始化版本库", {
        projectId: project.id,
        project: project.name
      });
      return this.initializeProject(project.id, input.message);
    }

    await this.writeGitignore(project);
    const result = await this.commitTrackedChanges(project, input.message);
    this.logGitResult(project, "Git 保存完成", result);
    return result;
  }

  async restore(input: GitRestoreInput): Promise<GitRestoreResult> {
    const project = await this.projectService.requireProject(input.projectId);
    getProjectLogger(project.rootPath).info("git", "开始还原 Git 版本", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      commitHash: input.commitHash
    });
    const status = await this.getStatus(project.id);
    if (!status.available || !status.initialized) {
      const result = await this.withProject(project, {
        ok: false,
        status,
        message: status.initialized ? "Git 不可用，无法还原版本。" : "项目尚未启用 Git，无法还原版本。",
        stdout: "",
        stderr: status.error ?? status.message,
        exitCode: null
      });
      this.logGitResult(project, "Git 还原失败", result);
      return result;
    }

    const target = await this.resolveCommit(project, status, input.commitHash.trim());
    if (!target) {
      const result = await this.withProject(project, {
        ok: false,
        status,
        message: "未找到要还原的 Git 提交。",
        stdout: "",
        stderr: input.commitHash,
        exitCode: null
      });
      this.logGitResult(project, "Git 还原失败", result, { requestedCommitHash: input.commitHash });
      return result;
    }

    const result = await this.git(project, ["reset", "--hard", target.hash], { timeoutMs: 20000 });
    if (result.exitCode !== 0) {
      const nextStatus = await this.getStatus(project.id);
      const failed = await this.withProject(project, {
        ok: false,
        status: nextStatus,
        message: "Git 版本还原失败。",
        stdout: result.stdout,
        stderr: result.stderr || commitResultMessage(result),
        exitCode: result.exitCode
      });
      this.logGitResult(project, "Git 还原失败", failed, {
        targetHash: target.hash,
        targetShortHash: target.shortHash
      });
      return failed;
    }

    const nextStatus = await this.getStatus(project.id);
    const restored = await this.withProject(project, {
      ok: true,
      status: nextStatus,
      message: `已还原到 Git 版本：${target.shortHash} ${target.message}`,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    });
    this.logGitResult(project, "Git 还原完成", restored, {
      targetHash: target.hash,
      targetShortHash: target.shortHash,
      targetMessage: target.message
    });
    return restored;
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

  private async resolveCommit(project: StudioProject, status: GitProjectStatus, commitHash: string): Promise<GitCommit | undefined> {
    if (!commitHash) {
      return undefined;
    }

    const recent = status.recentCommits.find((commit) => commit.hash === commitHash || commit.shortHash === commitHash);
    if (recent) {
      return recent;
    }

    const verified = await this.git(project, ["rev-parse", "--verify", `${commitHash}^{commit}`], { timeoutMs: 4000 });
    if (verified.exitCode !== 0) {
      return undefined;
    }

    const hash = firstOutputLine(verified);
    if (!hash) {
      return undefined;
    }

    const log = await this.git(project, ["log", "-1", "--pretty=format:%H\u001f%h\u001f%an\u001f%ad\u001f%s", "--date=iso-strict", hash], {
      timeoutMs: 4000
    });
    const commit = log.exitCode === 0 ? parseGitLog(log.stdout)[0] : undefined;
    return (
      commit ?? {
        hash,
        shortHash: hash.slice(0, 7),
        author: "",
        date: "",
        message: "指定提交"
      }
    );
  }

  private async withProject<T extends Omit<GitCommitResult, "project"> | Omit<GitRestoreResult, "project">>(
    project: StudioProject,
    result: T
  ): Promise<T & { project: ProjectDetails }> {
    const details = await this.projectService.getProject(project.id);
    return {
      ...result,
      project: {
        ...details,
        gitStatus: result.status
      } satisfies ProjectDetails
    };
  }

  private logGitResult(
    project: StudioProject,
    message: string,
    result: Omit<GitCommitResult, "project"> | Omit<GitRestoreResult, "project">,
    extra: Record<string, unknown> = {}
  ): void {
    const changedFiles = result.status.changedFiles ?? [];
    getProjectLogger(project.rootPath).log(result.ok ? "info" : "warn", "git", message, {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      ok: result.ok,
      exitCode: result.exitCode,
      resultMessage: result.message,
      branch: result.status.branch,
      head: result.status.head,
      initialized: result.status.initialized,
      clean: result.status.clean,
      changedFileCount: changedFiles.length,
      changedFiles: changedFiles.slice(0, 20),
      stdout: shortOutput(result.stdout, 600),
      stderr: shortOutput(result.stderr),
      ...extra
    });
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
