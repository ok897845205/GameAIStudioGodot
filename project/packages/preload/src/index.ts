import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentStreamEvent,
  CliToolId,
  CreateProjectInput,
  GitCommitInput,
  GitRestoreInput,
  ProjectFilePreviewInput,
  PreviewEvent,
  RunAgentTurnInput,
  RunStudioWorkflowInput,
  StudioApi,
  StudioRunEvent,
  UpdateProjectAgentClisInput
} from "@gameaistudio/shared";

const api: StudioApi = {
  bootstrap: () => ipcRenderer.invoke("studio:bootstrap"),
  refreshEnvironment: () => ipcRenderer.invoke("environment:refresh"),
  refreshCliTools: () => ipcRenderer.invoke("cli:refresh"),
  testCliTool: (toolId: CliToolId) => ipcRenderer.invoke("cli:test", toolId),
  installCliTool: (toolId: CliToolId) => ipcRenderer.invoke("cli:install", toolId),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
  updateProjectAgentClis: (input: UpdateProjectAgentClisInput) => ipcRenderer.invoke("projects:update-agent-clis", input),
  deleteProject: (projectId: string) => ipcRenderer.invoke("projects:delete", projectId),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  getProject: (projectId: string) => ipcRenderer.invoke("projects:get", projectId),
  getProjectGitStatus: (projectId: string) => ipcRenderer.invoke("projects:git-status", projectId),
  commitProjectGit: (input: GitCommitInput) => ipcRenderer.invoke("projects:git-commit", input),
  restoreProjectGit: (input: GitRestoreInput) => ipcRenderer.invoke("projects:git-restore", input),
  readProjectFile: (input: ProjectFilePreviewInput) => ipcRenderer.invoke("projects:file-preview", input),
  runAgentTurn: (input: RunAgentTurnInput) => ipcRenderer.invoke("agents:run-turn", input),
  runStudioWorkflow: (input: RunStudioWorkflowInput) => ipcRenderer.invoke("agents:run-workflow", input),
  listRuns: (projectId: string) => ipcRenderer.invoke("runs:list", projectId),
  cancelRun: (runId: string) => ipcRenderer.invoke("runs:cancel", runId),
  onRunEvent: (callback: (event: StudioRunEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: StudioRunEvent) => callback(event);
    ipcRenderer.on("runs:event", handler);
    return () => ipcRenderer.removeListener("runs:event", handler);
  },
  onAgentStream: (callback: (event: AgentStreamEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: AgentStreamEvent) => callback(event);
    ipcRenderer.on("agent:stream", handler);
    return () => ipcRenderer.removeListener("agent:stream", handler);
  },
  startPreview: (projectId: string) => ipcRenderer.invoke("projects:preview", projectId),
  startAutoPreview: (projectId: string) => ipcRenderer.invoke("projects:auto-preview:start", projectId),
  stopAutoPreview: (projectId: string) => ipcRenderer.invoke("projects:auto-preview:stop", projectId),
  onPreviewEvent: (callback: (event: PreviewEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: PreviewEvent) => callback(event);
    ipcRenderer.on("preview:event", handler);
    return () => ipcRenderer.removeListener("preview:event", handler);
  },
  exportWeb: (projectId: string) => ipcRenderer.invoke("projects:export-web", projectId),
  runGodotExport: (projectId: string) => ipcRenderer.invoke("projects:godot-export", projectId),
  validateProject: (projectId: string) => ipcRenderer.invoke("projects:validate", projectId),
  openGodotEditor: (projectId: string) => ipcRenderer.invoke("projects:godot-open-editor", projectId),
  openPath: (targetPath: string) => ipcRenderer.invoke("system:open-path", targetPath)
};

contextBridge.exposeInMainWorld("studio", api);
