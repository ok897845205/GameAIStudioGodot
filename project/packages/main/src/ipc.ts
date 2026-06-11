import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import type { ClearProjectMessagesInput, CliToolId, CreateProjectInput, DeleteProjectMessageInput, DispatchChatInput, EnvironmentToolId, GitCommitInput, GitRestoreInput, ProjectFilePreviewInput, RunAgentTurnInput, RunStudioWorkflowInput, SelectDirectoryInput, StudioProject, UpdateProjectAgentClisInput, UpdateStudioDirectorySettingsInput } from "@gameaistudio/shared";
import { getAppLogger, type LogMeta } from "./services/logger";
import { AGENT_PROFILES } from "@gameaistudio/shared";
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
import { ProjectFilePreviewService } from "./services/project-file-preview-service";
import { ProjectService } from "./services/project-service";
import { RunService } from "./services/run-service";
import { UpdateService } from "./services/update-service";
import { WebExportPipelineService } from "./services/web-export-pipeline-service";
import { WorkflowService } from "./services/workflow-service";
import type { StudioPaths } from "./services/resource-paths";
import { runAgentTurnWithOptionalPreview } from "./services/agent-turn-orchestrator";
import { DispatchService } from "./services/dispatch-service";
import type { IntentRouterService } from "./services/intent-router";
import { openSystemPath } from "./services/system-open-service";
import { resolveProjectLogPath } from "./services/logger";
import { StudioSettingsService } from "./services/studio-settings-service";

interface IpcDependencies {
  paths: StudioPaths;
  cliService: CliService;
  environmentService: EnvironmentService;
  gitService: GitService;
  filePreviewService: ProjectFilePreviewService;
  projectService: ProjectService;
  agentService: AgentService;
  workflowService: WorkflowService;
  godotRuntimeService: GodotRuntimeService;
  godotService: GodotService;
  previewServer: PreviewServer;
  autoPreviewService: AutoPreviewService;
  exportService: ExportService;
  webExportPipelineService: WebExportPipelineService;
  runService: RunService;
  processRegistry: ProcessRegistry;
  updateService: UpdateService;
  studioSettingsService: StudioSettingsService;
  intentRouter: IntentRouterService;
}

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown | Promise<unknown>;

function summarizeArg(arg: unknown): LogMeta {
  if (typeof arg === "string") {
    return { arg: arg.length > 80 ? `${arg.slice(0, 80)}…` : arg };
  }
  if (arg && typeof arg === "object") {
    const source = arg as Record<string, unknown>;
    const meta: LogMeta = {};
    for (const key of ["projectId", "agentId", "cliToolId", "toolId", "name", "dimension", "runId", "message"]) {
      if (key in source && source[key] !== undefined) {
        const value = source[key];
        meta[key] =
          typeof value === "string" && value.length > 120 ? `${value.slice(0, 120)}…` : value;
      }
    }
    if ("attachments" in source && Array.isArray(source.attachments)) {
      meta.attachments = source.attachments.length;
    }
    return meta;
  }
  return {};
}

/** Wrap an IPC handler so every invocation, result timing, and error lands in app.log. */
function handle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const log = getAppLogger();
    const start = Date.now();
    log.info("ipc", `→ ${channel}`, summarizeArg(args[0]));
    try {
      const result = await handler(event, ...args);
      log.info("ipc", `✓ ${channel}`, { ms: Date.now() - start });
      return result;
    } catch (error) {
      log.error("ipc", `✗ ${channel}`, { ms: Date.now() - start, error });
      throw error;
    }
  });
}

async function projectDetailsWithGit(deps: IpcDependencies, projectId: string) {
  const [project, gitStatus] = await Promise.all([deps.projectService.getProject(projectId), deps.gitService.getStatus(projectId)]);
  return {
    ...projectWithLogPath(project),
    gitStatus
  };
}

function projectWithLogPath(project: StudioProject): StudioProject {
  return {
    ...project,
    projectLogPath: resolveProjectLogPath(project.rootPath),
  };
}

async function listProjectsWithLogPath(deps: IpcDependencies): Promise<StudioProject[]> {
  const projects = await deps.projectService.listProjects();
  return projects.map((project) => projectWithLogPath(project));
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  handle("studio:bootstrap", async () => ({
    dataRoot: deps.paths.dataRoot,
    templatesRoot: deps.paths.templatesRoot,
    godotExecutablePath: deps.paths.godotConsolePath,
    godotRuntime: await deps.godotRuntimeService.inspect(),
    environment: await deps.environmentService.inspect(),
    projects: await listProjectsWithLogPath(deps),
    agents: AGENT_PROFILES,
    cliTools: await deps.cliService.discover(),
    update: await deps.updateService.getStatus(),
    directorySettings: deps.studioSettingsService.getSettings()
  }));

  handle("updates:status", async () => deps.updateService.getStatus());
  handle("updates:check", async () => deps.updateService.checkForUpdates());
  handle("updates:download-install", async () => deps.updateService.downloadAndInstall());
  handle("settings:update-directories", async (_event, input: UpdateStudioDirectorySettingsInput) =>
    deps.studioSettingsService.update(input)
  );
  handle("system:select-directory", async (event, input?: SelectDirectoryInput) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: input?.title ?? "选择目录",
      defaultPath: input?.defaultPath,
      properties: ["openDirectory", "createDirectory"],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });

  handle("environment:refresh", async () => deps.environmentService.inspect());
  handle("environment:install", async (_event, toolId: EnvironmentToolId) => deps.environmentService.install(toolId));
  handle("cli:refresh", async () => deps.cliService.discover());
  handle("cli:test", async (_event, toolId: CliToolId) => deps.cliService.testTool(toolId));
  handle("cli:install", async (_event, toolId: CliToolId) => deps.cliService.install(toolId));
  handle("cli:install-acp", async (_event, toolId: CliToolId) => deps.cliService.installAcp(toolId));

  handle("projects:create", async (_event, input: CreateProjectInput) => {
    const project = await deps.projectService.createProject(input);
    await deps.gitService.initializeProject(project.id);
    return projectDetailsWithGit(deps, project.id);
  });
  handle("projects:update-agent-clis", async (_event, input: UpdateProjectAgentClisInput) => {
    const project = await deps.projectService.requireProject(input.projectId);
    await deps.projectService.updateProject({
      ...project,
      agentCliToolIds: { ...project.agentCliToolIds, ...input.agentCliToolIds }
    });
    return projectDetailsWithGit(deps, input.projectId);
  });
  handle("projects:delete", async (_event, projectId: string) => {
    await deps.autoPreviewService.stop(projectId).catch(() => undefined);
    await deps.previewServer.stop(projectId).catch(() => undefined);
    const deleted = await deps.projectService.deleteProject(projectId);
    const projects = await listProjectsWithLogPath(deps);
    const selectedProject = projects[0] ? await projectDetailsWithGit(deps, projects[0].id) : undefined;
    return {
      deletedProjectId: deleted.id,
      deletedRootPath: deleted.rootPath,
      projects,
      selectedProject
    };
  });
  handle("projects:list", async () => listProjectsWithLogPath(deps));
  handle("projects:get", async (_event, projectId: string) => projectDetailsWithGit(deps, projectId));
  handle("projects:git-status", async (_event, projectId: string) => deps.gitService.getStatus(projectId));
  handle("projects:git-commit", async (_event, input: GitCommitInput) => deps.gitService.commit(input));
  handle("projects:git-restore", async (_event, input: GitRestoreInput) => deps.gitService.restore(input));
  handle("projects:file-preview", async (_event, input: ProjectFilePreviewInput) => deps.filePreviewService.read(input));
  handle("projects:project-log-preview", async (_event, projectId: string) => deps.filePreviewService.readProjectLog(projectId));
  handle("projects:delete-message", async (_event, input: DeleteProjectMessageInput) =>
    deps.projectService.deleteMessage(input.projectId, input.messageId)
  );
  handle("projects:clear-messages", async (_event, input: ClearProjectMessagesInput) =>
    deps.projectService.clearMessages(input.projectId, input.agentId)
  );
  handle("projects:export-chat", async (_event, projectId: string) => deps.projectService.exportChatHistory(projectId));
  handle("runs:list", async (_event, projectId: string) => deps.runService.listRuns(projectId));
  handle("runs:cancel", async (_event, runId: string) => {
    const cancelledProcesses = deps.processRegistry.cancelRun(runId);
    return deps.runService.cancelRun(
      runId,
      cancelledProcesses > 0 ? `已取消 ${cancelledProcesses} 个本地 CLI 进程。` : "取消请求已记录。"
    );
  });
  handle("projects:preview", async (_event, projectId: string) => deps.previewServer.start(projectId));
  handle("projects:auto-preview:start", async (_event, projectId: string) => deps.autoPreviewService.start(projectId));
  handle("projects:auto-preview:stop", async (_event, projectId: string) => deps.autoPreviewService.stop(projectId));
  handle("projects:godot-open-editor", async (_event, projectId: string) => deps.godotService.openEditor(projectId));
  handle("projects:godot-export", async (_event, projectId: string) => deps.godotService.exportWeb(projectId));
  handle("projects:validate", async (_event, projectId: string) => deps.godotService.validate(projectId));
  handle("projects:export-web", async (_event, projectId: string) => {
    const result = await deps.webExportPipelineService.exportWebZip(projectId);
    return {
      ...result,
      project: await projectDetailsWithGit(deps, projectId)
    };
  });

  handle("agents:run-turn", async (_event, input: RunAgentTurnInput) => {
    const result = await runAgentTurnWithOptionalPreview(deps, input);
    return {
      ...result,
      project: await projectDetailsWithGit(deps, input.projectId)
    };
  });
  const dispatchService = new DispatchService({
    router: deps.intentRouter,
    projectService: deps.projectService,
    workflowService: deps.workflowService,
    runAgentTurn: (input) => runAgentTurnWithOptionalPreview(deps, input),
    discoverTools: () => deps.cliService.discover()
  });
  handle("agents:dispatch", async (_event, input: DispatchChatInput) => {
    const result = await dispatchService.dispatch(input);
    const project = await projectDetailsWithGit(deps, input.projectId);
    return {
      ...result,
      ...(result.turn ? { turn: { ...result.turn, project } } : {}),
      ...(result.workflow ? { workflow: { ...result.workflow, project } } : {})
    };
  });
  handle("agents:run-workflow", async (_event, input: RunStudioWorkflowInput) => {
    const result = await deps.workflowService.run(input);
    return {
      ...result,
      project: await projectDetailsWithGit(deps, input.projectId)
    };
  });

  handle("system:open-path", async (_event, targetPath: string) => {
    await openSystemPath(targetPath, (nextPath) => shell.openPath(nextPath));
  });
  handle("system:restart-app", async () => {
    getAppLogger().info("app", "用户请求重启以应用目录设置");
    app.relaunch();
    app.quit();
  });
}
