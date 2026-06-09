import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { PreviewEvent, PreviewResult, PreviewStatus, ProjectFileChange } from "@gameaistudio/shared";
import { GodotService } from "./godot-service";
import { PreviewServer } from "./preview-server";
import { ProjectService } from "./project-service";
import { getProjectLogger } from "./logger";

export type PreviewEventSink = (event: PreviewEvent) => void;

interface AutoPreviewState {
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
  exporting: boolean;
  pending: boolean;
  lastChangedPath?: string;
}

interface StartAutoPreviewOptions {
  exportFirst?: boolean;
}

const WATCH_EXTENSIONS = new Set([
  ".gd",
  ".tscn",
  ".tres",
  ".res",
  ".godot",
  ".gdshader",
  ".shader",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".wav",
  ".ogg",
  ".mp3",
  ".json"
]);

export function addPreviewCacheBust(url: string, timestamp = Date.now()): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${timestamp}`;
}

function startsWithDirectory(candidate: string, directory: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedDirectory = path.resolve(directory);
  return normalizedCandidate === normalizedDirectory || normalizedCandidate.startsWith(`${normalizedDirectory}${path.sep}`);
}

export function shouldTriggerAutoPreview(projectRoot: string, webBuildPath: string, relativePath?: string | null): boolean {
  if (!relativePath) {
    return true;
  }

  const changedPath = path.resolve(projectRoot, relativePath);
  const ignoredDirectories = [
    webBuildPath,
    path.join(projectRoot, ".godot"),
    path.join(projectRoot, ".gameaistudio"),
    path.join(projectRoot, "dist"),
    path.join(projectRoot, "build", "windows")
  ];

  if (ignoredDirectories.some((directory) => startsWithDirectory(changedPath, directory))) {
    return false;
  }

  const basename = path.basename(changedPath);
  if (basename.endsWith(".tmp") || basename.endsWith(".uid") || basename.endsWith(".import")) {
    return false;
  }

  return WATCH_EXTENSIONS.has(path.extname(changedPath).toLowerCase());
}

export function shouldRefreshPreviewAfterFileChanges(
  projectRoot: string,
  webBuildPath: string,
  fileChanges: ProjectFileChange[] = []
): boolean {
  return fileChanges.some((change) => shouldTriggerAutoPreview(projectRoot, webBuildPath, change.path));
}

export class AutoPreviewService {
  private readonly states = new Map<string, AutoPreviewState>();

  constructor(
    private readonly projectService: ProjectService,
    private readonly godotService: GodotService,
    private readonly previewServer: PreviewServer,
    private readonly emit: PreviewEventSink = () => {},
    private readonly debounceMs = 1400
  ) {}

  async start(projectId: string, options: StartAutoPreviewOptions = {}): Promise<PreviewResult> {
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);
    log.info("preview", "请求启动实时预览", {
      projectId: project.id,
      project: project.name,
      rootPath: project.rootPath,
      webBuildPath: project.webBuildPath,
      exportFirst: options.exportFirst !== false
    });
    const existing = this.states.get(projectId);
    if (existing) {
      const preview = await this.previewServer.start(projectId);
      await this.markProject(projectId, "watching", preview.url);
      this.emitEvent(projectId, "watching", { url: preview.url, message: "实时预览已在监听项目变化。" });
      log.info("preview", "实时预览已在监听，复用现有预览服务", {
        projectId: project.id,
        project: project.name,
        url: preview.url
      });
      return { ...preview, watching: true };
    }

    if (options.exportFirst !== false) {
      this.emitEvent(projectId, "exporting", { message: "正在生成初始 Web 预览。" });
      const exportResult = await this.godotService.exportWeb(projectId);
      if (!exportResult.ok) {
        const message = exportResult.stderr || exportResult.stdout || "初始 Web 导出失败。";
        await this.markProject(projectId, "failed");
        log.warn("preview", "实时预览初始导出失败", {
          projectId: project.id,
          project: project.name,
          exitCode: exportResult.exitCode,
          durationMs: exportResult.durationMs,
          message
        });
        this.emitEvent(projectId, "failed", {
          message
        });
        throw new Error(message);
      }
    }

    const preview = await this.previewServer.start(projectId);
    const watcher = watch(project.rootPath, { recursive: true }, (_eventType, filename) => {
      const relativePath = filename ? String(filename) : undefined;
      if (!shouldTriggerAutoPreview(project.rootPath, project.webBuildPath, relativePath)) {
        return;
      }
      this.scheduleExport(projectId, relativePath);
    });

    this.states.set(projectId, {
      watcher,
      exporting: false,
      pending: false
    });
    await this.markProject(projectId, "watching", preview.url);
    this.emitEvent(projectId, "watching", { url: preview.url, message: "实时预览已启动。" });
    log.info("preview", "实时预览已启动", {
      projectId: project.id,
      project: project.name,
      url: preview.url
    });

    return {
      ...preview,
      watching: true
    };
  }

  async refresh(projectId: string, changedPath?: string): Promise<PreviewResult> {
    const project = await this.projectService.requireProject(projectId);
    getProjectLogger(project.rootPath).info("preview", "请求刷新实时预览", {
      projectId: project.id,
      project: project.name,
      changedPath
    });
    const state = this.states.get(projectId);
    if (!state) {
      return this.start(projectId, { exportFirst: true });
    }

    state.lastChangedPath = changedPath;
    await this.exportAndRefresh(projectId);
    const preview = await this.previewServer.start(projectId);
    return {
      ...preview,
      url: project.previewUrl ?? preview.url,
      watching: true
    };
  }

  async stop(projectId: string): Promise<PreviewEvent> {
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);
    const state = this.states.get(projectId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    state?.watcher.close();
    this.states.delete(projectId);
    await this.previewServer.stop(projectId);
    await this.markProject(projectId, "stopped");
    const event = this.createEvent(projectId, "stopped", { message: "实时预览已停止。" });
    this.emit(event);
    log.info("preview", "实时预览已停止", {
      projectId: project.id,
      project: project.name,
      hadWatcher: Boolean(state)
    });
    return event;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.states.keys()].map((projectId) => this.stop(projectId)));
  }

  private scheduleExport(projectId: string, changedPath?: string): void {
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }
    state.lastChangedPath = changedPath;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      void this.exportAndRefresh(projectId);
    }, this.debounceMs);
  }

  private async exportAndRefresh(projectId: string): Promise<void> {
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }
    const project = await this.projectService.requireProject(projectId);
    const log = getProjectLogger(project.rootPath);

    if (state.exporting) {
      state.pending = true;
      log.debug("preview", "实时预览刷新已排队", {
        projectId: project.id,
        project: project.name,
        changedPath: state.lastChangedPath
      });
      return;
    }

    state.exporting = true;
    state.pending = false;
    const changedPath = state.lastChangedPath;
    await this.markProject(projectId, "exporting");
    log.info("preview", "开始刷新实时预览", {
      projectId: project.id,
      project: project.name,
      changedPath
    });
    this.emitEvent(projectId, "exporting", {
      changedPath,
      message: changedPath ? `检测到 ${changedPath} 变化，正在刷新 Web 预览。` : "检测到项目变化，正在刷新 Web 预览。"
    });

    try {
      const exportResult = await this.godotService.exportWeb(projectId);
      if (!exportResult.ok) {
        await this.markProject(projectId, "failed");
        log.warn("preview", "实时预览刷新导出失败", {
          projectId: project.id,
          project: project.name,
          changedPath,
          exitCode: exportResult.exitCode,
          durationMs: exportResult.durationMs,
          message: exportResult.stderr || exportResult.stdout || "Web 导出失败。"
        });
        this.emitEvent(projectId, "failed", {
          changedPath,
          message: exportResult.stderr || exportResult.stdout || "Web 导出失败。"
        });
        return;
      }

      const preview = await this.previewServer.start(projectId);
      const refreshedUrl = addPreviewCacheBust(preview.url);
      await this.markProject(projectId, "ready", refreshedUrl);
      log.info("preview", "实时预览已刷新", {
        projectId: project.id,
        project: project.name,
        changedPath,
        url: refreshedUrl,
        durationMs: exportResult.durationMs
      });
      this.emitEvent(projectId, "ready", {
        url: refreshedUrl,
        changedPath,
        message: "Web 预览已刷新。"
      });
    } catch (error) {
      await this.markProject(projectId, "failed");
      log.error("preview", "实时预览刷新异常", {
        projectId: project.id,
        project: project.name,
        changedPath,
        error
      });
      this.emitEvent(projectId, "failed", {
        changedPath,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      state.exporting = false;
      if (state.pending) {
        this.scheduleExport(projectId, state.lastChangedPath);
      }
    }
  }

  private async markProject(projectId: string, status: PreviewStatus, url?: string): Promise<void> {
    const project = await this.projectService.requireProject(projectId);
    await this.projectService.updateProject({
      ...project,
      previewUrl: url ?? project.previewUrl,
      previewWatching: this.states.has(projectId) && status !== "stopped",
      previewStatus: status,
      previewUpdatedAt: new Date().toISOString()
    });
  }

  private emitEvent(
    projectId: string,
    status: PreviewStatus,
    patch: Omit<Partial<PreviewEvent>, "projectId" | "status" | "updatedAt"> = {}
  ): void {
    this.emit(this.createEvent(projectId, status, patch));
  }

  private createEvent(
    projectId: string,
    status: PreviewStatus,
    patch: Omit<Partial<PreviewEvent>, "projectId" | "status" | "updatedAt"> = {}
  ): PreviewEvent {
    return {
      projectId,
      status,
      updatedAt: new Date().toISOString(),
      ...patch
    };
  }
}
