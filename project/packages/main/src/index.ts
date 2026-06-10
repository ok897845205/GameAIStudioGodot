import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, app } from "electron";
import { AgentContextService } from "./services/agent-context-service";
import { AgentService } from "./services/agent-service";
import { AutoPreviewService } from "./services/auto-preview-service";
import { CliService } from "./services/cli-service";
import { EnvironmentService } from "./services/environment-service";
import { ExportService } from "./services/export-service";
import { GitService } from "./services/git-service";
import { GodotRuntimeService } from "./services/godot-runtime-service";
import { GodotService } from "./services/godot-service";
import { PreviewServer } from "./services/preview-server";
import { ProcessRegistry } from "./services/process-runner";
import { ProjectFileChangeService } from "./services/project-file-change-service";
import { ProjectFilePreviewService } from "./services/project-file-preview-service";
import { ProjectService } from "./services/project-service";
import { resolveStudioPaths } from "./services/resource-paths";
import { RunService } from "./services/run-service";
import {
  flushAllLogs,
  getAppLogger,
  initAppLogger,
  installProcessErrorLogging,
} from "./services/logger";
import { StudioStore } from "./services/store";
import { WebExportPipelineService } from "./services/web-export-pipeline-service";
import { WorkflowService } from "./services/workflow-service";
import { registerIpcHandlers } from "./ipc";

let previewServer: PreviewServer | undefined;
let autoPreviewService: AutoPreviewService | undefined;
let quitCleanupStarted = false;

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
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  const paths = resolveStudioPaths();
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.projectsRoot, { recursive: true });

  const log = initAppLogger({ dataRoot: paths.dataRoot, mirrorConsole: !app.isPackaged });
  installProcessErrorLogging();
  log.info("app", "应用启动", {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    dataRoot: paths.dataRoot,
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
    }
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
  const workflowService = new WorkflowService(projectService, cliService, agentService, godotService, exportService, autoPreviewService, runService, gitService);

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
    processRegistry
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
