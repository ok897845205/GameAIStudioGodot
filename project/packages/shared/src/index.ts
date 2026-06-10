export type GameDimension = "2d" | "3d";

export type CliToolId = "codex" | "claude" | "kscc" | "kimi";

export type CliToolStatus = "available" | "missing" | "error";

export type CliCredentialStatus = "configured" | "missing" | "unknown";

export type CliDiagnosticSeverity = "ok" | "info" | "warning" | "error";

export type CliRunModel = "local" | "cloud" | "gateway";

export type CliImageInputMode = "file-flag" | "prompt-path-reference" | "base64" | "unsupported";

export type CliHealthValue = boolean | "unknown";

/** Where a CLI executable was found during discovery. */
export type CliDiscoverySource = "path" | "npm-global" | "well-known";

/**
 * Structured reason for a failed CLI invocation. The UI shows the short
 * summary; logs carry the kind plus the raw evidence line.
 */
export type CliFailureKind =
  | "cancelled"
  | "timeout"
  | "not-installed"
  | "auth"
  | "quota"
  | "network"
  | "permission"
  | "non-interactive"
  | "model-unavailable"
  | "project-dir-missing"
  | "file-write"
  | "parse"
  | "unknown";

export interface CliToolCapabilities {
  runModel: CliRunModel;
  supportsImages: boolean;
  imageInputMode: CliImageInputMode;
  supportsStream: boolean;
  supportsResume: boolean;
  headless: boolean;
}

export interface CliToolHealth {
  installed: boolean;
  authed: CliHealthValue;
  headlessOk: CliHealthValue;
  imagesOk?: CliHealthValue;
  writable?: CliHealthValue;
  /** `false` when the latest probe hit a rate limit / quota ceiling. */
  quota?: CliHealthValue;
  version?: string;
  detail?: string;
  /** Classified kind of the most recent failure, if any. */
  lastErrorKind?: CliFailureKind;
}

export interface CliDiagnostic {
  id: string;
  severity: CliDiagnosticSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface CliTool {
  id: CliToolId;
  label: string;
  command: string;
  installed: boolean;
  status: CliToolStatus;
  executablePath?: string;
  /** Where the executable was discovered (PATH / npm global bin / well-known dir). */
  source?: CliDiscoverySource;
  version?: string;
  installCommand: string[];
  installHint: string;
  installManager: string;
  installManagerPath?: string;
  installManagerAvailable: boolean;
  installManagerVersion?: string;
  installGlobalBinPath?: string;
  defaultArgs: string[];
  credentialStatus: CliCredentialStatus;
  credentialEnvVars: string[];
  detectedCredentialEnvVars: string[];
  credentialHint: string;
  capabilities: CliToolCapabilities;
  health: CliToolHealth;
  diagnostics: CliDiagnostic[];
  lastCheckedAt: string;
}

export interface AgentProfile {
  id: string;
  title: string;
  specialty: string;
  defaultCli: CliToolId;
  accent: string;
  systemPrompt: string;
}

export type AgentAttachmentKind = "image";

/**
 * Visual/semantic category of a chat message. `text` (default) is a normal
 * conversation turn; the rest are milestone/system events that render with
 * their own icon and accent in the chat thread.
 */
export type AgentMessageKind =
  | "text"
  | "tool"
  | "error"
  | "file-change"
  | "git"
  | "preview"
  | "export"
  | "workflow"
  | "log";

export interface AgentAttachment {
  id: string;
  kind: AgentAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  projectRelativePath: string;
}

export interface AgentAttachmentInput {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface AgentMessage {
  id: string;
  projectId: string;
  agentId: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
  /** Semantic category — defaults to "text" when absent. */
  kind?: AgentMessageKind;
  /** Groups the user message and the agent reply of one conversation turn. */
  turnId?: string;
  cliToolId?: CliToolId;
  exitCode?: number;
  durationMs?: number;
  fileChanges?: ProjectFileChange[];
  attachments?: AgentAttachment[];
}

export type StudioRunKind = "agent-turn" | "studio-workflow" | "godot-export" | "preview";

export type StudioRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";

export type ProjectFileChangeKind = "added" | "modified" | "deleted";

export interface ProjectFileChange {
  path: string;
  kind: ProjectFileChangeKind;
  beforeSize?: number;
  afterSize?: number;
  beforeHash?: string;
  afterHash?: string;
  isText: boolean;
}

export interface StudioRunStep {
  id: string;
  title: string;
  status: StudioRunStatus;
  agentId?: string;
  cliToolId?: CliToolId;
  message?: string;
  output?: string;
  outputUpdatedAt?: string;
  fileChanges?: ProjectFileChange[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
}

export interface StudioRun {
  id: string;
  projectId: string;
  kind: StudioRunKind;
  title: string;
  status: StudioRunStatus;
  steps: StudioRunStep[];
  currentStepId?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StudioRunEvent {
  type: "created" | "updated";
  run: StudioRun;
}

/**
 * Incremental token stream for an in-flight agent turn. The renderer
 * accumulates `delta`s into a streaming assistant message (id `messageId`,
 * authored by `agentId`) so the chat bubble types live; `runAgentTurn`'s
 * resolved canonical messages replace it when the turn settles.
 */
export interface AgentStreamEvent {
  projectId: string;
  agentId: string;
  messageId: string;
  delta: string;
  done: boolean;
  /** CLI executing this turn, so the streaming bubble can show it live. */
  cliToolId?: CliToolId;
}

export type PreviewStatus = "watching" | "exporting" | "ready" | "failed" | "stopped";

export interface PreviewEvent {
  projectId: string;
  status: PreviewStatus;
  updatedAt: string;
  url?: string;
  changedPath?: string;
  message?: string;
}

export interface StudioProject {
  id: string;
  name: string;
  dimension: GameDimension;
  prompt: string;
  agentCliToolIds?: Partial<Record<string, CliToolId>>;
  rootPath: string;
  webBuildPath: string;
  createdAt: string;
  updatedAt: string;
  activeAgentId: string;
  previewUrl?: string;
  previewWatching?: boolean;
  previewStatus?: PreviewStatus;
  previewUpdatedAt?: string;
  exportZipPath?: string;
  latestExportManifestPath?: string;
  latestWebBuildInspection?: WebBuildInspection;
}

export interface ProjectDetails extends StudioProject {
  messages: AgentMessage[];
  runs: StudioRun[];
  gitStatus?: GitProjectStatus;
}

export interface CreateProjectInput {
  name: string;
  dimension: GameDimension;
  prompt: string;
  agentCliToolIds?: Partial<Record<string, CliToolId>>;
}

export interface UpdateProjectAgentClisInput {
  projectId: string;
  agentCliToolIds: Partial<Record<string, CliToolId>>;
}

export interface DeleteProjectMessageInput {
  projectId: string;
  messageId: string;
}

export interface ClearProjectMessagesInput {
  projectId: string;
  /** When set, only this Agent's thread is cleared; otherwise the whole project chat. */
  agentId?: string;
}

export interface ExportChatResult {
  projectId: string;
  /** Absolute path of the exported markdown file. */
  path: string;
  messageCount: number;
}

export interface RunAgentTurnInput {
  projectId: string;
  agentId: string;
  cliToolId: CliToolId;
  message: string;
  autoStartPreview: boolean;
  attachments?: AgentAttachmentInput[];
  /**
   * Re-run of an earlier user message ("重新生成"): the turn executes normally
   * but no new user message is appended to the history.
   */
  regenerate?: boolean;
}

export interface RunAgentTurnResult {
  messages: AgentMessage[];
  project: ProjectDetails;
  runs: StudioRun[];
  previewResult?: PreviewResult;
  previewError?: string;
}

export interface RunStudioWorkflowInput {
  projectId: string;
  message: string;
  agentIds?: string[];
  agentCliToolIds?: Partial<Record<string, CliToolId>>;
  preferredCliToolId?: CliToolId;
  autoExportWeb: boolean;
  autoPackageWebZip: boolean;
  autoStartPreview: boolean;
  /**
   * Adds the quality phases after the Agent rounds: Godot runnable validation,
   * a QA-driven fix round (修复与打磨) and a visible Git save step.
   */
  withQualityLoop?: boolean;
}

export interface RunStudioWorkflowResult {
  project: ProjectDetails;
  run: StudioRun;
  exportResult?: GodotRunResult;
  inspectionResult?: WebBuildInspection;
  zipResult?: ExportResult;
  previewResult?: PreviewResult;
}

export interface PreviewResult {
  projectId: string;
  url: string;
  webBuildPath: string;
  watching?: boolean;
}

export interface ExportResult {
  projectId: string;
  zipPath: string;
  webBuildPath: string;
  manifestPath: string;
  inspection?: WebBuildInspection;
}

export interface WebBuildInspection {
  projectId: string;
  webBuildPath: string;
  ok: boolean;
  files: string[];
  totalBytes: number;
  requiredFiles: string[];
  missingRequiredFiles: string[];
  message: string;
}

export interface WebExportResult {
  ok: boolean;
  project: ProjectDetails;
  run: StudioRun;
  webBuildPath: string;
  zipPath?: string;
  manifestPath?: string;
  inspectionResult?: WebBuildInspection;
  validationResult: GodotRunResult;
  exportResult?: GodotRunResult;
  error?: string;
}

export interface GodotRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface GodotOpenResult {
  ok: boolean;
  executablePath?: string;
  projectRoot?: string;
  message: string;
}

export type RuntimeDiagnosticSeverity = "ok" | "info" | "warning" | "error";

export interface RuntimeDiagnostic {
  id: string;
  severity: RuntimeDiagnosticSeverity;
  title: string;
  detail: string;
  action?: string;
}

export type GodotRuntimeStatus = "ready" | "partial" | "missing" | "error";

export interface GodotTemplateRuntime {
  dimension: GameDimension;
  path: string;
  projectFileAvailable: boolean;
  exportPresetsPath: string;
  webExportPresetAvailable: boolean;
  available: boolean;
}

export interface GodotRuntime {
  status: GodotRuntimeStatus;
  resourceRoot: string;
  engineRoot: string;
  templatesRoot: string;
  guiPath?: string;
  consolePath?: string;
  version?: string;
  templates: GodotTemplateRuntime[];
  diagnostics: RuntimeDiagnostic[];
  lastCheckedAt: string;
}

export type EnvironmentToolId = "git" | "node";

export type EnvironmentToolStatus = "available" | "missing" | "error";

export type SystemEnvironmentStatus = "ready" | "partial" | "missing";

export interface EnvironmentTool {
  id: EnvironmentToolId;
  label: string;
  command: string;
  installed: boolean;
  status: EnvironmentToolStatus;
  executablePath?: string;
  version?: string;
  diagnostics: RuntimeDiagnostic[];
  lastCheckedAt: string;
}

export interface SystemEnvironment {
  status: SystemEnvironmentStatus;
  tools: EnvironmentTool[];
  lastCheckedAt: string;
}

export interface GitProjectStatus {
  projectId: string;
  available: boolean;
  initialized: boolean;
  clean: boolean;
  branch?: string;
  head?: string;
  recentCommits: GitCommit[];
  changes: GitFileChange[];
  changedFiles: string[];
  message: string;
  error?: string;
  lastCheckedAt: string;
}

export type GitFileChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted" | "unknown";

export interface GitFileChange {
  path: string;
  kind: GitFileChangeKind;
  rawStatus: string;
  originalPath?: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitCommitInput {
  projectId: string;
  message: string;
}

export interface GitCommitResult {
  ok: boolean;
  project: ProjectDetails;
  status: GitProjectStatus;
  message: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface GitRestoreInput {
  projectId: string;
  commitHash: string;
}

export interface GitRestoreResult {
  ok: boolean;
  project: ProjectDetails;
  status: GitProjectStatus;
  message: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type ProjectFilePreviewKind = "text" | "image" | "binary";

export interface ProjectFilePreview {
  projectId: string;
  relativePath: string;
  absolutePath: string;
  name: string;
  size: number;
  kind: ProjectFilePreviewKind;
  mimeType: string;
  content?: string;
  dataUrl?: string;
  truncated?: boolean;
}

export interface ProjectFilePreviewInput {
  projectId: string;
  relativePath: string;
}

export interface DeleteProjectResult {
  deletedProjectId: string;
  deletedRootPath: string;
  projects: StudioProject[];
  selectedProject?: ProjectDetails;
}

export type UpdateConfigSource = "userData" | "bundled" | "default" | "missing";

export type UpdatePolicy = "none" | "optional" | "required";

export type UpdateStatus =
  | "not-configured"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export type UpdateRequirementReason =
  | "none"
  | "patch"
  | "minor"
  | "major"
  | "force"
  | "unsupported";

export interface UpdatePackageInfo {
  platform: string;
  arch: string;
  url: string;
  sha256?: string;
  sha512?: string;
  size?: number;
  fileName?: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion?: string;
  status: UpdateStatus;
  policy: UpdatePolicy;
  reason: UpdateRequirementReason;
  configured: boolean;
  configSource: UpdateConfigSource;
  configPath?: string;
  userConfigPath: string;
  manifestUrl?: string;
  channel?: string;
  releaseDate?: string;
  releaseNotes?: string;
  package?: UpdatePackageInfo;
  checkedAt?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

export interface UpdateEvent {
  status: UpdateStatus;
  message: string;
  updatedAt: string;
  info?: UpdateInfo;
  receivedBytes?: number;
  totalBytes?: number;
  percent?: number;
}

export interface UpdateInstallResult {
  launched: boolean;
  installerPath?: string;
  message: string;
  info: UpdateInfo;
}

export interface StudioBootstrap {
  dataRoot: string;
  templatesRoot: string;
  godotExecutablePath?: string;
  godotRuntime: GodotRuntime;
  environment: SystemEnvironment;
  projects: StudioProject[];
  agents: AgentProfile[];
  cliTools: CliTool[];
  update: UpdateInfo;
}

export interface StudioApi {
  bootstrap(): Promise<StudioBootstrap>;
  getUpdateStatus(): Promise<UpdateInfo>;
  checkForUpdates(): Promise<UpdateInfo>;
  downloadAndInstallUpdate(): Promise<UpdateInstallResult>;
  onUpdateEvent(callback: (event: UpdateEvent) => void): () => void;
  refreshEnvironment(): Promise<SystemEnvironment>;
  refreshCliTools(): Promise<CliTool[]>;
  testCliTool(toolId: CliToolId): Promise<CliTool>;
  installCliTool(toolId: CliToolId): Promise<GodotRunResult>;
  createProject(input: CreateProjectInput): Promise<ProjectDetails>;
  updateProjectAgentClis(input: UpdateProjectAgentClisInput): Promise<ProjectDetails>;
  deleteProject(projectId: string): Promise<DeleteProjectResult>;
  listProjects(): Promise<StudioProject[]>;
  getProject(projectId: string): Promise<ProjectDetails>;
  runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult>;
  deleteProjectMessage(input: DeleteProjectMessageInput): Promise<AgentMessage[]>;
  clearProjectMessages(input: ClearProjectMessagesInput): Promise<AgentMessage[]>;
  exportProjectChat(projectId: string): Promise<ExportChatResult>;
  runStudioWorkflow(input: RunStudioWorkflowInput): Promise<RunStudioWorkflowResult>;
  listRuns(projectId: string): Promise<StudioRun[]>;
  cancelRun(runId: string): Promise<StudioRun>;
  onRunEvent(callback: (event: StudioRunEvent) => void): () => void;
  onAgentStream(callback: (event: AgentStreamEvent) => void): () => void;
  getProjectGitStatus(projectId: string): Promise<GitProjectStatus>;
  commitProjectGit(input: GitCommitInput): Promise<GitCommitResult>;
  restoreProjectGit(input: GitRestoreInput): Promise<GitRestoreResult>;
  readProjectFile(input: ProjectFilePreviewInput): Promise<ProjectFilePreview>;
  startPreview(projectId: string): Promise<PreviewResult>;
  startAutoPreview(projectId: string): Promise<PreviewResult>;
  stopAutoPreview(projectId: string): Promise<PreviewEvent>;
  onPreviewEvent(callback: (event: PreviewEvent) => void): () => void;
  exportWeb(projectId: string): Promise<WebExportResult>;
  runGodotExport(projectId: string): Promise<GodotRunResult>;
  validateProject(projectId: string): Promise<GodotRunResult>;
  openGodotEditor(projectId: string): Promise<GodotOpenResult>;
  openPath(path: string): Promise<void>;
}

export const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "producer",
    title: "制作人",
    specialty: "目标拆解、里程碑、取舍",
    defaultCli: "codex",
    accent: "#2f7dd3",
    systemPrompt:
      "你是 GameAIStudio 的制作人 Agent。你负责把普通用户的一句话游戏想法拆成可执行目标、风险、里程碑和验收标准。"
  },
  {
    id: "designer",
    title: "策划",
    specialty: "玩法规则、关卡、数值",
    defaultCli: "claude",
    accent: "#a45dce",
    systemPrompt:
      "你是 GameAIStudio 的策划 Agent。你负责设计核心循环、操作、关卡、反馈和可玩性，并让设计适合 Godot 快速实现。"
  },
  {
    id: "programmer",
    title: "程序",
    specialty: "Godot 脚本、场景、导出",
    defaultCli: "codex",
    accent: "#248f6b",
    systemPrompt:
      "你是 GameAIStudio 的程序 Agent。你负责在当前 Godot 项目内实现 GDScript、场景结构、测试和 Web 导出修复。"
  },
  {
    id: "artist",
    title: "美术",
    specialty: "视觉风格、素材清单、占位资产",
    defaultCli: "kimi",
    accent: "#c77a1a",
    systemPrompt:
      "你是 GameAIStudio 的美术 Agent。你负责把用户想法转为可实现的视觉方向、素材清单、占位图形和 Godot 资源建议。"
  },
  {
    id: "qa",
    title: "QA",
    specialty: "测试、缺陷、验收",
    defaultCli: "kscc",
    accent: "#bf3f53",
    systemPrompt:
      "你是 GameAIStudio 的 QA Agent。你负责验证游戏是否满足用户目标，编写测试建议，检查导出、玩法闭环和明显缺陷。"
  }
];

export const CLI_TOOL_LABELS: Record<CliToolId, string> = {
  codex: "Codex",
  claude: "Claude",
  kscc: "KSCC",
  kimi: "Kimi"
};

export function chooseAgentCli(agent: AgentProfile, tools: CliTool[], preferredCliToolId?: CliToolId): CliToolId {
  const usable = (tool: CliTool): boolean => tool.installed && tool.status === "available";
  const preferred = preferredCliToolId ? tools.find((tool) => tool.id === preferredCliToolId && usable(tool)) : undefined;
  const defaultTool = tools.find((tool) => tool.id === agent.defaultCli && usable(tool));
  const fallback = tools.find(usable);
  return preferred?.id ?? defaultTool?.id ?? fallback?.id ?? preferredCliToolId ?? agent.defaultCli;
}
