export type GameDimension = "2d" | "3d";

export type CliToolId =
  | "codex"
  | "claude"
  | "kscc"
  | "kimi"
  | "gemini"
  | "qwen"
  | "cursor"
  | "copilot";

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

/**
 * Status of a CLI's optional ACP (Agent Client Protocol) run-mode upgrade.
 * When `available`, turns run over ACP (native streaming, live tool calls,
 * audited per-action permissions, session resume) instead of one-shot
 * headless invocation.
 */
export interface CliToolAcpStatus {
  /** The CLI has a known ACP agent adapter. */
  supported: boolean;
  /** The ACP agent executable was found on this machine. */
  available: boolean;
  agentCommand: string;
  executablePath?: string;
  installCommand: string[];
  installHint: string;
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
  /** ACP run-mode upgrade status (absent for CLIs without an ACP adapter). */
  acp?: CliToolAcpStatus;
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

export type AgentAttachmentKind = "image" | "audio";

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
  /**
   * Renderer-only: inline data URL for optimistic messages shown before the
   * backend has persisted the attachment (projectRelativePath is "" then).
   * Never written by the main process and never persisted to chat history.
   */
  dataUrl?: string;
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
  /** Resolved maintenance log file for this project. */
  projectLogPath?: string;
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
  /**
   * 一站式素材闭环: the artist Agent outputs a structured asset plan, the
   * system generates the images via the configured providers, saves them into
   * the project with slots, and hands the res:// paths to the programmer/QA
   * rounds. Requires the artist agent in the run; degrades to placeholder
   * guidance when generation is unavailable or fails.
   */
  withAssetPipeline?: boolean;
  /**
   * 音频闭环: the artist Agent also outputs an audio plan; the system
   * generates a BGM + core SFX, saves them into assets/audio with slots and
   * hands the res:// paths to the programmer/QA rounds. No-op when audio
   * generation isn't configured or its auto-generate switch is off.
   */
  withAudioPipeline?: boolean;
}

/** One asset the artist Agent asks the system to generate (素材规划 item). */
export interface AssetPlanItem {
  /** Stable role key, becomes the asset slot, e.g. "player_ship". */
  key: string;
  /** Generation prompt for this asset. */
  description: string;
  purpose: GeneratedAssetPurpose;
  style?: string;
  aspectRatio?: GeneratedAssetAspect;
  transparentBackground?: boolean;
  /** Images to generate for this item (1–2). */
  count?: number;
}

// ── 自动模式派单（intent routing）────────────────────────────────────────────

export type DispatchRoute = "agent" | "team";

/** Task size — decides between a single turn and the trimmed/full pipeline. */
export type DispatchScope = "small" | "large";

export interface DispatchDecision {
  route: DispatchRoute;
  /** Target agent for route="agent" (also the lead voice for team runs). */
  agentId: string;
  scope: DispatchScope;
  /** Short user-visible reason for the routing choice. */
  reason: string;
  /** How the decision was made — heuristic rules, the classifier turn, or the safe fallback. */
  source: "heuristic" | "classifier" | "fallback";
}

export interface DispatchChatInput {
  projectId: string;
  message: string;
  attachments?: AgentAttachmentInput[];
  autoStartPreview: boolean;
}

export interface DispatchChatResult {
  decision: DispatchDecision;
  kind: "agent-turn" | "workflow";
  turn?: RunAgentTurnResult;
  workflow?: RunStudioWorkflowResult;
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
  /** One-click install is possible on this machine (e.g. winget on Windows). */
  installAvailable?: boolean;
  /** How to install when one-click is unavailable. */
  installHint?: string;
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

export type ProjectFilePreviewKind = "text" | "image" | "audio" | "binary";

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

export interface StudioDirectorySettings {
  dataRoot?: string;
  projectsRoot?: string;
  setupCompleted: boolean;
  setupRequired: boolean;
  settingsPath: string;
  defaultDataRoot: string;
  defaultProjectsRoot: string;
  resolvedDataRoot: string;
  resolvedProjectsRoot: string;
  appLogPath: string;
  selectedProjectLogPath?: string;
  requiresRestart?: boolean;
  /**
   * The configured directories were unavailable at startup (e.g. unplugged
   * drive); this session is running on the default directories instead. The
   * stored configuration is preserved — fix the location and restart.
   */
  startupFallbackActive?: boolean;
}

export interface UpdateStudioDirectorySettingsInput {
  dataRoot?: string;
  projectsRoot?: string;
  setupCompleted?: boolean;
}

export interface SelectDirectoryInput {
  title?: string;
  defaultPath?: string;
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
  directorySettings: StudioDirectorySettings;
}

// ── AI 素材工坊（文生图 / 素材库）────────────────────────────────────────────

/**
 * Wire protocol spoken to an upstream image-generation endpoint. Users pick
 * the protocol matching their vendor; the app builds requests accordingly:
 * - `openai-images-v1` — POST {base}/images/generations (OpenAI, 兼容网关)
 * - `openai-chat-image-v1` — POST {base}/chat/completions with image output
 *   (OpenRouter google/gemini-*-image and similar)
 * - `gemini-image-v1` — POST {base}/models/{model}:generateContent with
 *   IMAGE response modality (Google AI Studio / Gemini-compatible gateways)
 */
export type MediaProtocolId = "openai-images-v1" | "openai-chat-image-v1" | "gemini-image-v1";

export type MediaModelKind = "image" | "video";

/** One upstream endpoint: base URL + API key + protocol + optional headers. */
export interface MediaProviderConfig {
  id: string;
  name: string;
  protocol: MediaProtocolId;
  baseUrl: string;
  /** Extra HTTP headers sent verbatim with every request. */
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  /** Never leaves the main process — renderer only sees `hasApiKey`. */
  apiKey?: string;
}

/** Renderer-safe view of a provider (API key masked to a boolean). */
export interface MediaProviderView {
  id: string;
  name: string;
  protocol: MediaProtocolId;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  hasApiKey: boolean;
}

export interface SaveMediaProviderInput {
  /** Omitted when creating a new provider. */
  id?: string;
  name: string;
  protocol: MediaProtocolId;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  /** Omitted = keep the stored key; "" = clear it. */
  apiKey?: string;
}

/** Routes a studio model to one upstream; lower `order` is tried first. */
export interface MediaModelBinding {
  id: string;
  providerId: string;
  upstreamModelId: string;
  order: number;
  enabled: boolean;
}

export interface MediaModelConfig {
  /** Studio-facing model id, e.g. "nano-banana", "gpt-image-2". */
  id: string;
  kind: MediaModelKind;
  displayName: string;
  order: number;
  enabled: boolean;
  bindings: MediaModelBinding[];
}

export interface SaveMediaModelInput {
  id: string;
  kind: MediaModelKind;
  displayName: string;
  order: number;
  enabled: boolean;
  bindings: Array<{
    id?: string;
    providerId: string;
    upstreamModelId: string;
    order: number;
    enabled: boolean;
  }>;
}

export interface MediaGenerationSettings {
  providers: MediaProviderView[];
  models: MediaModelConfig[];
}

export type GeneratedAssetPurpose =
  | "character"
  | "enemy"
  | "prop"
  | "background"
  | "ui-icon"
  | "ui-button"
  | "logo"
  | "cover"
  | "promo"
  | "other";

export const GENERATED_ASSET_PURPOSE_LABELS: Record<GeneratedAssetPurpose, string> = {
  character: "角色",
  enemy: "敌人",
  prop: "道具",
  background: "背景",
  "ui-icon": "UI 图标",
  "ui-button": "UI 按钮",
  logo: "Logo",
  cover: "游戏封面",
  promo: "宣传图",
  other: "其他"
};

export type GeneratedAssetAspect = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface GeneratedAssetRecord {
  id: string;
  projectId: string;
  fileName: string;
  /** Project-relative POSIX path, e.g. "assets/characters/xxx.png". */
  projectRelativePath: string;
  /** Godot resource path, e.g. "res://assets/characters/xxx.png". */
  resPath: string;
  prompt: string;
  /** The full prompt actually sent upstream (with purpose/style template). */
  finalPrompt?: string;
  purpose: GeneratedAssetPurpose;
  style?: string;
  aspectRatio?: GeneratedAssetAspect;
  transparentBackground?: boolean;
  modelId: string;
  providerId?: string;
  providerName?: string;
  upstreamModelId?: string;
  mimeType: string;
  sizeBytes: number;
  /** Semantic slot, e.g. "player.main", "ui.button" — lets agents know the role. */
  slot?: string;
  createdAt: string;
}

export interface GenerateImageInput {
  projectId: string;
  prompt: string;
  purpose: GeneratedAssetPurpose;
  style?: string;
  aspectRatio?: GeneratedAssetAspect;
  transparentBackground?: boolean;
  /** Studio model id; omitted = first enabled image model. */
  modelId?: string;
  /** 1–4 images per request. */
  count?: number;
}

/** One upstream call that was tried while serving a generation request. */
export interface GenerationAttempt {
  providerId: string;
  providerName: string;
  upstreamModelId: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface GenerateImageResult {
  ok: boolean;
  modelId: string;
  assets: GeneratedAssetRecord[];
  attempts: GenerationAttempt[];
  error?: string;
}

export type MediaProviderTestStatus = "ok" | "auth" | "not-found" | "rate-limit" | "network" | "protocol" | "server" | "no-key" | "unknown";

/** Result of the read-only「测试连接」probe for one provider. */
export interface MediaProviderTestResult {
  providerId: string;
  ok: boolean;
  status: MediaProviderTestStatus;
  /** Human-readable, actionable message for the settings UI. */
  message: string;
  /** HTTP status of the probe, when a response was received. */
  httpStatus?: number;
  durationMs: number;
}

export interface ProjectAssetLibrary {
  projectId: string;
  assets: GeneratedAssetRecord[];
}

export interface DeleteGeneratedAssetInput {
  projectId: string;
  assetId: string;
}

/** Regenerate an image in place — same res:// path & slot, new bytes. */
export interface RegenerateAssetInput {
  projectId: string;
  assetId: string;
}

export interface SetGeneratedAssetSlotInput {
  projectId: string;
  assetId: string;
  /** Empty string clears the slot. */
  slot: string;
}

// ── AI 音频工坊（文生音频 / 音频素材库）──────────────────────────────────────

/**
 * Wire protocol spoken to an upstream audio-generation endpoint. Pluggable so
 * the app can later route to several vendors:
 * - `ace-music-v1` — ACE Music (acemusic.ai), OpenRouter-style synchronous
 *   POST {base}/chat/completions with the audio output modality.
 * Future: `elevenlabs-sfx-v1`, `mubert-music-v1`, `stable-audio-local`.
 */
export type AudioProtocolId = "ace-music-v1";

export const AUDIO_PROTOCOL_IDS: AudioProtocolId[] = ["ace-music-v1"];

/** The three generation modes; each maps to an asset subfolder and slot prefix. */
export type AudioKind = "bgm" | "sfx" | "ambience";

export const AUDIO_KIND_LABELS: Record<AudioKind, string> = {
  bgm: "背景音乐",
  sfx: "音效",
  ambience: "环境音"
};

/** One configured audio provider (ACE Music etc.). Key never leaves main. */
export interface AudioProviderConfig {
  id: string;
  name: string;
  protocol: AudioProtocolId;
  baseUrl: string;
  /** Upstream model id, e.g. "acemusic/acestep-v1.5-turbo". */
  modelId: string;
  /** Preferred container; ACE currently returns mp3 regardless. */
  outputFormat: string;
  order: number;
  enabled: boolean;
  apiKey?: string;
}

export interface AudioProviderView {
  id: string;
  name: string;
  protocol: AudioProtocolId;
  baseUrl: string;
  modelId: string;
  outputFormat: string;
  order: number;
  enabled: boolean;
  hasApiKey: boolean;
}

export interface SaveAudioProviderInput {
  id?: string;
  name: string;
  protocol: AudioProtocolId;
  baseUrl: string;
  modelId: string;
  outputFormat: string;
  order: number;
  enabled: boolean;
  /** Omitted = keep stored key; "" = clear. */
  apiKey?: string;
}

export interface AudioGenerationSettings {
  providers: AudioProviderView[];
  /** Generate a BGM + core SFX automatically during the team workflow. */
  autoGenerateInWorkflow: boolean;
}

export interface GeneratedAudioRecord {
  id: string;
  projectId: string;
  kind: AudioKind;
  fileName: string;
  /** Project-relative POSIX path, e.g. "assets/audio/bgm/main_theme.mp3". */
  projectRelativePath: string;
  /** Godot resource path, e.g. "res://assets/audio/bgm/main_theme.mp3". */
  resPath: string;
  prompt: string;
  finalPrompt?: string;
  /** Game role, e.g. "bgm.main", "sfx.jump", "ambience.forest". */
  slot?: string;
  durationSeconds?: number;
  loopable?: boolean;
  providerId?: string;
  providerName?: string;
  upstreamModelId?: string;
  modelId: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
  /** Usage/licence note captured for traceability. */
  license?: string;
  createdAt: string;
}

export interface GenerateAudioInput {
  projectId: string;
  kind: AudioKind;
  prompt: string;
  /** Common */
  durationSeconds?: number;
  loopable?: boolean;
  /** BGM */
  style?: string;
  mood?: string;
  bpm?: number;
  instrumental?: boolean;
  hasLyrics?: boolean;
  /** SFX */
  intensity?: "soft" | "medium" | "strong";
  dry?: boolean;
  /** Ambience */
  ambienceKeywords?: string;
  seamlessLoop?: boolean;
  /** Provider id; omitted = first enabled audio provider. */
  providerId?: string;
  /** Used as the slot when generated from the manual panel with intent. */
  slot?: string;
}

export interface GenerateAudioResult {
  ok: boolean;
  audios: GeneratedAudioRecord[];
  attempts: GenerationAttempt[];
  error?: string;
}

export interface ProjectAudioLibrary {
  projectId: string;
  audios: GeneratedAudioRecord[];
}

export interface DeleteGeneratedAudioInput {
  projectId: string;
  audioId: string;
}

/** Regenerate an audio clip in place — same res:// path & slot, new bytes. */
export interface RegenerateAudioInput {
  projectId: string;
  audioId: string;
}

export interface SetGeneratedAudioSlotInput {
  projectId: string;
  audioId: string;
  slot: string;
}

/** One audio asset the artist/AI asks the system to generate (AudioPlan item). */
export interface AudioPlanItem {
  key: string;
  kind: AudioKind;
  description: string;
  durationSeconds?: number;
  loopable?: boolean;
}

export interface StudioApi {
  bootstrap(): Promise<StudioBootstrap>;
  getUpdateStatus(): Promise<UpdateInfo>;
  checkForUpdates(): Promise<UpdateInfo>;
  downloadAndInstallUpdate(): Promise<UpdateInstallResult>;
  onUpdateEvent(callback: (event: UpdateEvent) => void): () => void;
  updateDirectorySettings(input: UpdateStudioDirectorySettingsInput): Promise<StudioDirectorySettings>;
  selectDirectory(input?: SelectDirectoryInput): Promise<string | undefined>;
  restartApp(): Promise<void>;
  refreshEnvironment(): Promise<SystemEnvironment>;
  installEnvironmentTool(toolId: EnvironmentToolId): Promise<GodotRunResult>;
  refreshCliTools(): Promise<CliTool[]>;
  testCliTool(toolId: CliToolId): Promise<CliTool>;
  installCliTool(toolId: CliToolId): Promise<GodotRunResult>;
  installCliAcp(toolId: CliToolId): Promise<GodotRunResult>;
  createProject(input: CreateProjectInput): Promise<ProjectDetails>;
  updateProjectAgentClis(input: UpdateProjectAgentClisInput): Promise<ProjectDetails>;
  deleteProject(projectId: string): Promise<DeleteProjectResult>;
  listProjects(): Promise<StudioProject[]>;
  getProject(projectId: string): Promise<ProjectDetails>;
  runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult>;
  dispatchChat(input: DispatchChatInput): Promise<DispatchChatResult>;
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
  readProjectLog(projectId: string): Promise<ProjectFilePreview>;
  startPreview(projectId: string): Promise<PreviewResult>;
  startAutoPreview(projectId: string): Promise<PreviewResult>;
  stopAutoPreview(projectId: string): Promise<PreviewEvent>;
  onPreviewEvent(callback: (event: PreviewEvent) => void): () => void;
  exportWeb(projectId: string): Promise<WebExportResult>;
  runGodotExport(projectId: string): Promise<GodotRunResult>;
  validateProject(projectId: string): Promise<GodotRunResult>;
  openGodotEditor(projectId: string): Promise<GodotOpenResult>;
  openPath(path: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  getMediaSettings(): Promise<MediaGenerationSettings>;
  saveMediaProvider(input: SaveMediaProviderInput): Promise<MediaGenerationSettings>;
  deleteMediaProvider(providerId: string): Promise<MediaGenerationSettings>;
  saveMediaModel(input: SaveMediaModelInput): Promise<MediaGenerationSettings>;
  deleteMediaModel(modelId: string): Promise<MediaGenerationSettings>;
  testMediaProvider(providerId: string): Promise<MediaProviderTestResult>;
  generateImage(input: GenerateImageInput): Promise<GenerateImageResult>;
  regenerateImage(input: RegenerateAssetInput): Promise<GenerateImageResult>;
  listGeneratedAssets(projectId: string): Promise<ProjectAssetLibrary>;
  deleteGeneratedAsset(input: DeleteGeneratedAssetInput): Promise<ProjectAssetLibrary>;
  setGeneratedAssetSlot(input: SetGeneratedAssetSlotInput): Promise<ProjectAssetLibrary>;
  getAudioSettings(): Promise<AudioGenerationSettings>;
  saveAudioProvider(input: SaveAudioProviderInput): Promise<AudioGenerationSettings>;
  deleteAudioProvider(providerId: string): Promise<AudioGenerationSettings>;
  setAudioAutoGenerate(enabled: boolean): Promise<AudioGenerationSettings>;
  testAudioProvider(providerId: string): Promise<MediaProviderTestResult>;
  generateAudio(input: GenerateAudioInput): Promise<GenerateAudioResult>;
  regenerateAudio(input: RegenerateAudioInput): Promise<GenerateAudioResult>;
  listGeneratedAudio(projectId: string): Promise<ProjectAudioLibrary>;
  deleteGeneratedAudio(input: DeleteGeneratedAudioInput): Promise<ProjectAudioLibrary>;
  setGeneratedAudioSlot(input: SetGeneratedAudioSlotInput): Promise<ProjectAudioLibrary>;
}

export const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "producer",
    title: "制作人",
    specialty: "目标拆解、里程碑、取舍",
    defaultCli: "kscc",
    accent: "#2f7dd3",
    systemPrompt:
      "你是 GameAIStudio 的制作人 Agent。你负责把普通用户的一句话游戏想法拆成可执行目标、风险、里程碑和验收标准。"
  },
  {
    id: "designer",
    title: "策划",
    specialty: "玩法规则、关卡、数值",
    defaultCli: "kscc",
    accent: "#a45dce",
    systemPrompt:
      "你是 GameAIStudio 的策划 Agent。你负责设计核心循环、操作、关卡、反馈和可玩性，并让设计适合 Godot 快速实现。"
  },
  {
    id: "programmer",
    title: "程序",
    specialty: "Godot 脚本、场景、导出",
    defaultCli: "kscc",
    accent: "#248f6b",
    systemPrompt:
      "你是 GameAIStudio 的程序 Agent。你负责在当前 Godot 项目内实现 GDScript、场景结构、测试和 Web 导出修复。"
  },
  {
    id: "artist",
    title: "美术",
    specialty: "视觉风格、素材清单、占位资产",
    defaultCli: "kscc",
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
  kimi: "Kimi",
  gemini: "Gemini",
  qwen: "Qwen Code",
  cursor: "Cursor",
  copilot: "Copilot"
};

export function chooseAgentCli(agent: AgentProfile, tools: CliTool[], preferredCliToolId?: CliToolId): CliToolId {
  const usable = (tool: CliTool): boolean => tool.installed && tool.status === "available";
  const preferred = preferredCliToolId ? tools.find((tool) => tool.id === preferredCliToolId && usable(tool)) : undefined;
  const defaultTool = tools.find((tool) => tool.id === agent.defaultCli && usable(tool));
  const fallback = tools.find(usable);
  return preferred?.id ?? defaultTool?.id ?? fallback?.id ?? preferredCliToolId ?? agent.defaultCli;
}
