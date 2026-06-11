import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, app, dialog, type MessageBoxSyncOptions } from "electron";
import { AgentContextService } from "./services/agent-context-service";
import { AgentService } from "./services/agent-service";
import { AutoPreviewService } from "./services/auto-preview-service";
import { CliService } from "./services/cli-service";
import { EnvironmentService } from "./services/environment-service";
import { ExportService } from "./services/export-service";
import { GitService } from "./services/git-service";
import { IntentRouterService } from "./services/intent-router";
import { GodotRuntimeService } from "./services/godot-runtime-service";
import { GodotService } from "./services/godot-service";
import { PreviewServer } from "./services/preview-server";
import { ProcessRegistry } from "./services/process-runner";
import { ProjectFileChangeService } from "./services/project-file-change-service";
import { ProjectFilePreviewService } from "./services/project-file-preview-service";
import { ProjectLockService } from "./services/project-lock";
import { ProjectService } from "./services/project-service";
import { resolveResourceRoot, resolveStudioPaths, setGlobalStudioPathOverrides } from "./services/resource-paths";
import { RunService } from "./services/run-service";
import {
  flushAllLogs,
  getAppLogger,
  initAppLogger,
  installProcessErrorLogging,
} from "./services/logger";
import { StudioStore } from "./services/store";
import { StudioSettingsService } from "./services/studio-settings-service";
import { UpdateService } from "./services/update-service";
import { WebExportPipelineService } from "./services/web-export-pipeline-service";
import { WorkflowService } from "./services/workflow-service";
import { registerIpcHandlers } from "./ipc";

let previewServer: PreviewServer | undefined;
let autoPreviewService: AutoPreviewService | undefined;
let updateService: UpdateService | undefined;
let quitCleanupStarted = false;
let allowQuitWithoutUpdateConfirm = false;

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, "../preload/index.mjs");
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "GameAIStudio",
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Embedded web tools (马良画卷 image canvas) render in a <webview> with
      // its own isolated guest session — the app renderer stays sandboxed.
      webviewTag: true
    }
  });

  win.on("close", (event) => {
    if (quitCleanupStarted || allowQuitWithoutUpdateConfirm || !updateService?.isDownloadOrInstallInProgress()) {
      return;
    }
    if (confirmQuitDuringUpdate(win)) {
      allowQuitWithoutUpdateConfirm = true;
      return;
    }
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function confirmQuitDuringUpdate(owner?: BrowserWindow): boolean {
  const options: MessageBoxSyncOptions = {
    type: "warning",
    title: "更新正在进行",
    message: "软件正在下载或安装更新。",
    detail: "现在关闭软件可能导致更新中断。确定要退出吗？",
    buttons: ["继续更新", "退出软件"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const target = owner ?? BrowserWindow.getFocusedWindow();
  const choice = target ? dialog.showMessageBoxSync(target, options) : dialog.showMessageBoxSync(options);
  const confirmed = choice === 1;
  getAppLogger().warn("update", confirmed ? "用户确认在更新过程中退出软件" : "用户取消在更新过程中退出软件");
  return confirmed;
}

// Single-instance guard. A second launch would share the same userData dir:
// Chromium's disk/GPU cache fails with "拒绝访问 (0x5)", and far worse, two
// processes would race studio-state.json (chat/project records) while the
// per-project work locks are process-local. The second launch hands off to
// the existing window instead.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  getAppLogger().info("app", "检测到重复启动，已聚焦现有窗口");
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }
  const studioSettingsService = new StudioSettingsService({
    defaultDataRoot: path.join(app.getPath("documents"), "GameAIStudio"),
    settingsPath: path.join(app.getPath("userData"), "studio-settings.json"),
    resourceRoot: resolveResourceRoot(),
  });
  await studioSettingsService.load();

  let paths = resolveStudioPaths(studioSettingsService.getPathOverrides());
  studioSettingsService.setActivePaths(paths);
  let startupDirectoryError: unknown;
  let failedStartupPaths: typeof paths | undefined;
  try {
    await mkdir(paths.dataRoot, { recursive: true });
    await mkdir(paths.projectsRoot, { recursive: true });
  } catch (error) {
    // The configured directories are unusable right now (unplugged drive,
    // disconnected network share, …). Fall back to the defaults FOR THIS
    // SESSION ONLY — never rewrite the stored settings over a transient
    // failure, or the user's configuration would be silently erased.
    startupDirectoryError = error;
    failedStartupPaths = paths;
    const fallbackDataRoot = studioSettingsService.defaultDataRoot;
    paths = resolveStudioPaths({
      dataRoot: fallbackDataRoot,
      projectsRoot: path.join(fallbackDataRoot, "projects"),
    });
    studioSettingsService.setActivePaths(paths);
    studioSettingsService.markStartupFallback();
    await mkdir(paths.dataRoot, { recursive: true });
    await mkdir(paths.projectsRoot, { recursive: true });
  }
  // Keep every lazy resolveStudioPaths() caller (e.g. the CLI runtime
  // environment) on the same directories this session actually uses.
  setGlobalStudioPathOverrides({ dataRoot: paths.dataRoot, projectsRoot: paths.projectsRoot });

  const log = initAppLogger({ dataRoot: paths.dataRoot, mirrorConsole: !app.isPackaged });
  installProcessErrorLogging();
  if (startupDirectoryError) {
    log.warn("settings", "已回退到默认软件目录，原目录不可用", {
      attemptedDataRoot: failedStartupPaths?.dataRoot,
      attemptedProjectsRoot: failedStartupPaths?.projectsRoot,
      dataRoot: paths.dataRoot,
      projectsRoot: paths.projectsRoot,
      error: startupDirectoryError,
    });
  }
  log.info("app", "应用启动", {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    dataRoot: paths.dataRoot,
    projectsRoot: paths.projectsRoot,
    appLogPath: studioSettingsService.getSettings().appLogPath,
    settingsPath: studioSettingsService.getSettings().settingsPath,
    resourceRoot: paths.resourceRoot,
    godot: paths.godotConsolePath ?? "(missing)",
  });

  const store = new StudioStore(path.join(paths.dataRoot, "studio-state.json"));
  const cliService = new CliService();
  const environmentService = new EnvironmentService();
  const projectService = new ProjectService(paths, store);
  const gitService = new GitService(projectService);
  const contextService = new AgentContextService();
  const processRegistry = new ProcessRegistry();
  const fileChangeService = new ProjectFileChangeService();
  const runService = new RunService(
    store,
    (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("runs:event", event);
      }
    },
    async (projectId) => {
      try {
        return await projectService.requireProject(projectId);
      } catch {
        return undefined;
      }
    }
  );
  // Runs persisted as running/queued at boot were interrupted by an app
  // close or crash — mark them failed so the UI doesn't show phantom work.
  await runService.recoverInterruptedRuns().catch(() => []);
  // One shared lock instance so chat turns and workflows exclude each other
  // per project (multi-project work stays parallel).
  const projectLocks = new ProjectLockService();
  const agentService = new AgentService(
    projectService,
    cliService,
    runService,
    processRegistry,
    fileChangeService,
    contextService,
    (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("agent:stream", event);
      }
    },
    projectLocks
  );
  const godotService = new GodotService(paths, projectService);
  const godotRuntimeService = new GodotRuntimeService(paths);
  previewServer = new PreviewServer(projectService);
  autoPreviewService = new AutoPreviewService(projectService, godotService, previewServer, (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("preview:event", event);
    }
  });
  const exportService = new ExportService(projectService);
  const filePreviewService = new ProjectFilePreviewService(projectService);
  const webExportPipelineService = new WebExportPipelineService(projectService, godotService, exportService, runService);
  const workflowService = new WorkflowService(projectService, cliService, agentService, godotService, exportService, autoPreviewService, runService, gitService, projectLocks);
  const appUpdateService = new UpdateService({
    prepareQuitAndInstall: () => {
      allowQuitWithoutUpdateConfirm = true;
    },
    onEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("update:event", event);
      }
    }
  });
  updateService = appUpdateService;

  registerIpcHandlers({
    paths,
    cliService,
    environmentService,
    gitService,
    filePreviewService,
    projectService,
    agentService,
    workflowService,
    godotRuntimeService,
    godotService,
    previewServer,
    autoPreviewService,
    exportService,
    webExportPipelineService,
    runService,
    processRegistry,
    updateService: appUpdateService,
    studioSettingsService,
    intentRouter: new IntentRouterService(cliService)
  });

  log.info("app", "服务装配完成，IPC 已注册");
  await createWindow();
  log.info("app", "主窗口已创建");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (quitCleanupStarted) {
    return;
  }
  if (allowQuitWithoutUpdateConfirm) {
    return;
  }
  if (!allowQuitWithoutUpdateConfirm && updateService?.isDownloadOrInstallInProgress()) {
    if (confirmQuitDuringUpdate()) {
      allowQuitWithoutUpdateConfirm = true;
    } else {
      event.preventDefault();
      return;
    }
  }
  event.preventDefault();
  quitCleanupStarted = true;

  const log = getAppLogger();
  log.info("app", "应用退出，清理预览服务");
  void (async () => {
    try {
      await autoPreviewService?.stopAll();
      await previewServer?.stopAll();
      log.info("app", "退出清理完成");
    } catch (error) {
      log.error("app", "退出清理失败", { error });
    } finally {
      await flushAllLogs();
      app.quit();
    }
  })();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
