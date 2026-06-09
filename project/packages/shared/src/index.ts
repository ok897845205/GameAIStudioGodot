export type GameDimension = "2d" | "3d";

export type CliToolId = "codex" | "claude" | "kscc" | "kimi";

export type CliToolStatus = "available" | "missing" | "error";

export type CliCredentialStatus = "configured" | "missing" | "unknown";

export type CliDiagnosticSeverity = "ok" | "info" | "warning" | "error";

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
  cliToolId?: CliToolId;
  exitCode?: number;
  durationMs?: number;
  fileChanges?: ProjectFileChange[];
  attachments?: AgentAttachment[];
}

export type StudioRunKind = "agent-turn" | "studio-workflow" | "godot-export" | "preview";

export type StudioRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

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
}

export interface RunAgentTurnInput {
  projectId: string;
  agentId: string;
  cliToolId: CliToolId;
  message: string;
  autoStartPreview: boolean;
  attachments?: AgentAttachmentInput[];
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
  preferredCliToolId?: CliToolId;
  autoExportWeb: boolean;
  autoPackageWebZip: boolean;
  autoStartPreview: boolean;
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
  changedFiles: string[];
  message: string;
  error?: string;
  lastCheckedAt: string;
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

export interface StudioBootstrap {
  dataRoot: string;
  templatesRoot: string;
  godotExecutablePath?: string;
  godotRuntime: GodotRuntime;
  environment: SystemEnvironment;
  projects: StudioProject[];
  agents: AgentProfile[];
  cliTools: CliTool[];
}

export interface StudioApi {
  bootstrap(): Promise<StudioBootstrap>;
  refreshEnvironment(): Promise<SystemEnvironment>;
  refreshCliTools(): Promise<CliTool[]>;
  installCliTool(toolId: CliToolId): Promise<GodotRunResult>;
  createProject(input: CreateProjectInput): Promise<ProjectDetails>;
  deleteProject(projectId: string): Promise<DeleteProjectResult>;
  listProjects(): Promise<StudioProject[]>;
  getProject(projectId: string): Promise<ProjectDetails>;
  runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult>;
  runStudioWorkflow(input: RunStudioWorkflowInput): Promise<RunStudioWorkflowResult>;
  listRuns(projectId: string): Promise<StudioRun[]>;
  cancelRun(runId: string): Promise<StudioRun>;
  onRunEvent(callback: (event: StudioRunEvent) => void): () => void;
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
  const preferred = preferredCliToolId ? tools.find((tool) => tool.id === preferredCliToolId && tool.installed) : undefined;
  const defaultTool = tools.find((tool) => tool.id === agent.defaultCli && tool.installed);
  const fallback = tools.find((tool) => tool.installed);
  return preferred?.id ?? defaultTool?.id ?? fallback?.id ?? preferredCliToolId ?? agent.defaultCli;
}
