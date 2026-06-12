import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentStreamEvent,
  ClearProjectMessagesInput,
  CliToolId,
  CreateProjectInput,
  DeleteGeneratedAssetInput,
  DeleteGeneratedAudioInput,
  DeleteProjectMessageInput,
  DispatchChatInput,
  EnvironmentToolId,
  GenerateAudioInput,
  GenerateImageInput,
  GitCommitInput,
  GitRestoreInput,
  ProjectFilePreviewInput,
  PreviewEvent,
  RunAgentTurnInput,
  RunStudioWorkflowInput,
  SaveAudioProviderInput,
  SaveMediaModelInput,
  SaveMediaProviderInput,
  SelectDirectoryInput,
  SetGeneratedAssetSlotInput,
  SetGeneratedAudioSlotInput,
  StudioApi,
  StudioRunEvent,
  UpdateEvent,
  UpdateStudioDirectorySettingsInput,
  UpdateProjectAgentClisInput
} from "@gameaistudio/shared";

const api: StudioApi = {
  bootstrap: () => ipcRenderer.invoke("studio:bootstrap"),
  getUpdateStatus: () => ipcRenderer.invoke("updates:status"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("updates:download-install"),
  updateDirectorySettings: (input: UpdateStudioDirectorySettingsInput) => ipcRenderer.invoke("settings:update-directories", input),
  selectDirectory: (input?: SelectDirectoryInput) => ipcRenderer.invoke("system:select-directory", input),
  restartApp: () => ipcRenderer.invoke("system:restart-app"),
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: UpdateEvent) => callback(event);
    ipcRenderer.on("update:event", handler);
    return () => ipcRenderer.removeListener("update:event", handler);
  },
  refreshEnvironment: () => ipcRenderer.invoke("environment:refresh"),
  installEnvironmentTool: (toolId: EnvironmentToolId) => ipcRenderer.invoke("environment:install", toolId),
  refreshCliTools: () => ipcRenderer.invoke("cli:refresh"),
  testCliTool: (toolId: CliToolId) => ipcRenderer.invoke("cli:test", toolId),
  installCliTool: (toolId: CliToolId) => ipcRenderer.invoke("cli:install", toolId),
  installCliAcp: (toolId: CliToolId) => ipcRenderer.invoke("cli:install-acp", toolId),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
  updateProjectAgentClis: (input: UpdateProjectAgentClisInput) => ipcRenderer.invoke("projects:update-agent-clis", input),
  deleteProject: (projectId: string) => ipcRenderer.invoke("projects:delete", projectId),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  getProject: (projectId: string) => ipcRenderer.invoke("projects:get", projectId),
  getProjectGitStatus: (projectId: string) => ipcRenderer.invoke("projects:git-status", projectId),
  commitProjectGit: (input: GitCommitInput) => ipcRenderer.invoke("projects:git-commit", input),
  restoreProjectGit: (input: GitRestoreInput) => ipcRenderer.invoke("projects:git-restore", input),
  readProjectFile: (input: ProjectFilePreviewInput) => ipcRenderer.invoke("projects:file-preview", input),
  readProjectLog: (projectId: string) => ipcRenderer.invoke("projects:project-log-preview", projectId),
  runAgentTurn: (input: RunAgentTurnInput) => ipcRenderer.invoke("agents:run-turn", input),
  dispatchChat: (input: DispatchChatInput) => ipcRenderer.invoke("agents:dispatch", input),
  deleteProjectMessage: (input: DeleteProjectMessageInput) => ipcRenderer.invoke("projects:delete-message", input),
  clearProjectMessages: (input: ClearProjectMessagesInput) => ipcRenderer.invoke("projects:clear-messages", input),
  exportProjectChat: (projectId: string) => ipcRenderer.invoke("projects:export-chat", projectId),
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
  openPath: (targetPath: string) => ipcRenderer.invoke("system:open-path", targetPath),
  openExternalUrl: (url: string) => ipcRenderer.invoke("system:open-external", url),
  getMediaSettings: () => ipcRenderer.invoke("media:get-settings"),
  saveMediaProvider: (input: SaveMediaProviderInput) => ipcRenderer.invoke("media:save-provider", input),
  deleteMediaProvider: (providerId: string) => ipcRenderer.invoke("media:delete-provider", providerId),
  saveMediaModel: (input: SaveMediaModelInput) => ipcRenderer.invoke("media:save-model", input),
  deleteMediaModel: (modelId: string) => ipcRenderer.invoke("media:delete-model", modelId),
  testMediaProvider: (providerId: string) => ipcRenderer.invoke("media:test-provider", providerId),
  generateImage: (input: GenerateImageInput) => ipcRenderer.invoke("media:generate-image", input),
  listGeneratedAssets: (projectId: string) => ipcRenderer.invoke("media:list-assets", projectId),
  deleteGeneratedAsset: (input: DeleteGeneratedAssetInput) => ipcRenderer.invoke("media:delete-asset", input),
  setGeneratedAssetSlot: (input: SetGeneratedAssetSlotInput) => ipcRenderer.invoke("media:set-asset-slot", input),
  getAudioSettings: () => ipcRenderer.invoke("audio:get-settings"),
  saveAudioProvider: (input: SaveAudioProviderInput) => ipcRenderer.invoke("audio:save-provider", input),
  deleteAudioProvider: (providerId: string) => ipcRenderer.invoke("audio:delete-provider", providerId),
  setAudioAutoGenerate: (enabled: boolean) => ipcRenderer.invoke("audio:set-auto-generate", enabled),
  testAudioProvider: (providerId: string) => ipcRenderer.invoke("audio:test-provider", providerId),
  generateAudio: (input: GenerateAudioInput) => ipcRenderer.invoke("audio:generate", input),
  listGeneratedAudio: (projectId: string) => ipcRenderer.invoke("audio:list", projectId),
  deleteGeneratedAudio: (input: DeleteGeneratedAudioInput) => ipcRenderer.invoke("audio:delete", input),
  setGeneratedAudioSlot: (input: SetGeneratedAudioSlotInput) => ipcRenderer.invoke("audio:set-slot", input)
};

contextBridge.exposeInMainWorld("studio", api);
