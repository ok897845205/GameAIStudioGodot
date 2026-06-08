import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, app } from "electron";
import { AgentContextService } from "./services/agent-context-service";
import { AgentService } from "./services/agent-service";
import { AutoPreviewService } from "./services/auto-preview-service";
import { CliService } from "./services/cli-service";
import { ExportService } from "./services/export-service";
import { GodotRuntimeService } from "./services/godot-runtime-service";
import { GodotService } from "./services/godot-service";
import { PreviewServer } from "./services/preview-server";
import { ProcessRegistry } from "./services/process-runner";
import { ProjectFileChangeService } from "./services/project-file-change-service";
import { ProjectService } from "./services/project-service";
import { ProjectSnapshotService } from "./services/project-snapshot-service";
import { resolveStudioPaths } from "./services/resource-paths";
import { RunService } from "./services/run-service";
import { StudioStore } from "./services/store";
import { WebExportPipelineService } from "./services/web-export-pipeline-service";
import { WorkflowService } from "./services/workflow-service";
import { registerIpcHandlers } from "./ipc";

let previewServer: PreviewServer | undefined;
let autoPreviewService: AutoPreviewService | undefined;

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

  const store = new StudioStore(path.join(paths.dataRoot, "studio-state.json"));
  const cliService = new CliService();
  const projectService = new ProjectService(paths, store);
  const contextService = new AgentContextService();
  const snapshotService = new ProjectSnapshotService(projectService, store);
  const processRegistry = new ProcessRegistry();
  const fileChangeService = new ProjectFileChangeService();
  const runService = new RunService(store, (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("runs:event", event);
    }
  });
  const agentService = new AgentService(projectService, cliService, runService, processRegistry, fileChangeService, snapshotService, contextService);
  const godotService = new GodotService(paths, projectService);
  const godotRuntimeService = new GodotRuntimeService(paths);
  previewServer = new PreviewServer(projectService);
  autoPreviewService = new AutoPreviewService(projectService, godotService, previewServer, (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("preview:event", event);
    }
  });
  const exportService = new ExportService(projectService);
  const webExportPipelineService = new WebExportPipelineService(projectService, godotService, exportService, runService);
  const workflowService = new WorkflowService(projectService, cliService, agentService, godotService, autoPreviewService, runService);

  registerIpcHandlers({
    paths,
    cliService,
    projectService,
    snapshotService,
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

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", () => {
  void autoPreviewService?.stopAll();
  void previewServer?.stopAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
