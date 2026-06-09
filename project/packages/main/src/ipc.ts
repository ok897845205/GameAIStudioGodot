import { ipcMain, shell } from "electron";
import type { CliToolId, CreateProjectInput, CreateSnapshotInput, RunAgentTurnInput, RunStudioWorkflowInput } from "@gameaistudio/shared";
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
import { ProjectService } from "./services/project-service";
import { ProjectSnapshotService } from "./services/project-snapshot-service";
import { RunService } from "./services/run-service";
import { WebExportPipelineService } from "./services/web-export-pipeline-service";
import { WorkflowService } from "./services/workflow-service";
import type { StudioPaths } from "./services/resource-paths";
import { runAgentTurnWithOptionalPreview } from "./services/agent-turn-orchestrator";
import { openSystemPath } from "./services/system-open-service";

interface IpcDependencies {
  paths: StudioPaths;
  cliService: CliService;
  environmentService: EnvironmentService;
  gitService: GitService;
  projectService: ProjectService;
  snapshotService: ProjectSnapshotService;
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
}

async function projectDetailsWithGit(deps: IpcDependencies, projectId: string) {
  const [project, gitStatus] = await Promise.all([deps.projectService.getProject(projectId), deps.gitService.getStatus(projectId)]);
  return {
    ...project,
    gitStatus
  };
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  ipcMain.handle("studio:bootstrap", async () => ({
    dataRoot: deps.paths.dataRoot,
    templatesRoot: deps.paths.templatesRoot,
    godotExecutablePath: deps.paths.godotConsolePath,
    godotRuntime: await deps.godotRuntimeService.inspect(),
    environment: await deps.environmentService.inspect(),
    projects: await deps.projectService.listProjects(),
    agents: AGENT_PROFILES,
    cliTools: await deps.cliService.discover()
  }));

  ipcMain.handle("environment:refresh", async () => deps.environmentService.inspect());
  ipcMain.handle("cli:refresh", async () => deps.cliService.discover());
  ipcMain.handle("cli:install", async (_event, toolId: CliToolId) => deps.cliService.install(toolId));

  ipcMain.handle("projects:create", async (_event, input: CreateProjectInput) => {
    const project = await deps.projectService.createProject(input);
    await deps.snapshotService.create({
      projectId: project.id,
      label: "初始模板",
      reason: "project-created"
    });
    await deps.gitService.initializeProject(project.id);
    return projectDetailsWithGit(deps, project.id);
  });
  ipcMain.handle("projects:list", async () => deps.projectService.listProjects());
  ipcMain.handle("projects:get", async (_event, projectId: string) => projectDetailsWithGit(deps, projectId));
  ipcMain.handle("snapshots:list", async (_event, projectId: string) => deps.snapshotService.list(projectId));
  ipcMain.handle("snapshots:create", async (_event, input: CreateSnapshotInput) => deps.snapshotService.create(input));
  ipcMain.handle("snapshots:restore", async (_event, projectId: string, snapshotId: string) => {
    const result = await deps.snapshotService.restore(projectId, snapshotId);
    return {
      ...result,
      project: await projectDetailsWithGit(deps, projectId)
    };
  });
  ipcMain.handle("projects:git-status", async (_event, projectId: string) => deps.gitService.getStatus(projectId));
  ipcMain.handle("projects:git-commit", async (_event, input: { projectId: string; message: string }) => deps.gitService.commit(input));
  ipcMain.handle("runs:list", async (_event, projectId: string) => deps.runService.listRuns(projectId));
  ipcMain.handle("runs:cancel", async (_event, runId: string) => {
    const cancelledProcesses = deps.processRegistry.cancelRun(runId);
    return deps.runService.cancelRun(
      runId,
      cancelledProcesses > 0 ? `已取消 ${cancelledProcesses} 个本地 CLI 进程。` : "取消请求已记录。"
    );
  });
  ipcMain.handle("projects:preview", async (_event, projectId: string) => deps.previewServer.start(projectId));
  ipcMain.handle("projects:auto-preview:start", async (_event, projectId: string) => deps.autoPreviewService.start(projectId));
  ipcMain.handle("projects:auto-preview:stop", async (_event, projectId: string) => deps.autoPreviewService.stop(projectId));
  ipcMain.handle("projects:godot-open-editor", async (_event, projectId: string) => deps.godotService.openEditor(projectId));
  ipcMain.handle("projects:godot-export", async (_event, projectId: string) => deps.godotService.exportWeb(projectId));
  ipcMain.handle("projects:validate", async (_event, projectId: string) => deps.godotService.validate(projectId));
  ipcMain.handle("projects:export-web", async (_event, projectId: string) => {
    const result = await deps.webExportPipelineService.exportWebZip(projectId);
    return {
      ...result,
      project: await projectDetailsWithGit(deps, projectId)
    };
  });

  ipcMain.handle("agents:run-turn", async (_event, input: RunAgentTurnInput) => {
    const result = await runAgentTurnWithOptionalPreview(deps, input);
    return {
      ...result,
      project: await projectDetailsWithGit(deps, input.projectId)
    };
  });
  ipcMain.handle("agents:run-workflow", async (_event, input: RunStudioWorkflowInput) => {
    const result = await deps.workflowService.run(input);
    return {
      ...result,
      project: await projectDetailsWithGit(deps, input.projectId)
    };
  });

  ipcMain.handle("system:open-path", async (_event, targetPath: string) => {
    await openSystemPath(targetPath, (nextPath) => shell.openPath(nextPath));
  });
}
