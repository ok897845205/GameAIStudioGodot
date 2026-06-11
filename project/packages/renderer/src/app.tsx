import { useEffect, useMemo, useState } from "react";
import CodeEditor from "@uiw/react-textarea-code-editor";
// Legacy stylesheet is scoped to this (lazy-loaded) legacy view only. It uses
// unlayered element rules (button/input/*) that would otherwise override the
// new UI's Tailwind utilities, so it must NOT load on the default StudioApp.
import "./styles.css";
import {
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Hammer,
  Image as ImageIcon,
  Loader2,
  Package,
  Paperclip,
  Play,
  RefreshCw,
  Save,
  Send,
  StopCircle,
  Terminal,
  Trash2,
  WandSparkles,
  X,
  XCircle
} from "lucide-react";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  chooseAgentCli,
  type AgentAttachment,
  type AgentAttachmentInput,
  type AgentMessage,
  type AgentProfile,
  type CliTool,
  type CliToolId,
  type EnvironmentTool,
  type GameDimension,
  type GitProjectStatus,
  type ProjectFileChange,
  type ProjectFilePreview,
  type PreviewEvent,
  type PreviewStatus,
  type ProjectDetails,
  type StudioBootstrap,
  type StudioProject,
  type StudioRun
} from "@gameaistudio/shared";
import { getSendTurnButtonState } from "./agent-action-state";
import { getCreateProjectButtonState } from "./create-project-state";
import { agentTurnPreviewNotice } from "./preview-notice";
import { pickBootstrapProjectId } from "./project-selection";

type BusyAction =
  | "boot"
  | "create"
  | "send"
  | "workflow"
  | "preview"
  | "export"
  | "godot"
  | "editor"
  | "validate"
  | "cli"
  | "environment"
  | "git"
  | "delete"
  | "file"
  | undefined;
type TeamCliRouteStatus = "default" | "fallback" | "missing" | "error";
type PreflightStatus = "ready" | "warning" | "blocked";

interface CreateForm {
  name: string;
  prompt: string;
  dimension: GameDimension;
  autoRunWorkflow: boolean;
}

interface PendingAttachment extends AgentAttachmentInput {
  id: string;
}

const initialForm: CreateForm = {
  name: "黄金矿工",
  prompt: "我要创建一个黄金矿工，玩家用钩子抓金块，限时得分。",
  dimension: "2d",
  autoRunWorkflow: true
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function dirnameFromPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? value.slice(0, index) : value;
}

function projectFilePath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/\//g, separator)}`;
}

function projectAgentContextPath(rootPath: string): string {
  return projectFilePath(rootPath, "docs/agent-context.md");
}

function projectAgentJournalPath(rootPath: string): string {
  return projectFilePath(rootPath, ".gameaistudio/agent-journal.md");
}

function projectGuidePath(rootPath: string): string {
  return projectFilePath(rootPath, "GAMEAISTUDIO.md");
}

function codeLanguageForPath(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".md")) {
    return "markdown";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return "ts";
  }
  if (lower.endsWith(".gd")) {
    return "gdscript";
  }
  return "text";
}

function attachmentSummary(attachments?: AgentAttachment[]): string | undefined {
  if (!attachments?.length) {
    return undefined;
  }
  return `${attachments.length} 张图片`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function agentById(agentId: string): AgentProfile {
  return AGENT_PROFILES.find((agent) => agent.id === agentId) ?? AGENT_PROFILES[0];
}

function pickDefaultCli(agentId: string, tools: CliTool[]): CliToolId {
  const agent = agentById(agentId);
  if (tools.some((tool) => tool.id === agent.defaultCli && tool.installed && tool.status === "available")) {
    return agent.defaultCli;
  }
  return tools.find((tool) => tool.installed && tool.status === "available")?.id ?? agent.defaultCli;
}

function upsertRun(runs: StudioRun[], run: StudioRun): StudioRun[] {
  const next = runs.filter((candidate) => candidate.id !== run.id);
  next.unshift(run);
  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function runStatusLabel(status: StudioRun["status"]): string {
  const labels: Record<StudioRun["status"], string> = {
    queued: "排队",
    running: "运行中",
    completed: "完成",
    failed: "失败",
    cancelled: "已取消",
    skipped: "已跳过"
  };
  return labels[status];
}

function previewStatusLabel(status?: PreviewStatus): string {
  if (!status) {
    return "未启动";
  }
  const labels: Record<PreviewStatus, string> = {
    watching: "监听中",
    exporting: "导出中",
    ready: "已刷新",
    failed: "失败",
    stopped: "已停止"
  };
  return labels[status];
}

function fileChangeKindLabel(kind: ProjectFileChange["kind"]): string {
  const labels: Record<ProjectFileChange["kind"], string> = {
    added: "新增",
    modified: "修改",
    deleted: "删除"
  };
  return labels[kind];
}

function cliStatusLabel(status: CliTool["status"]): string {
  const labels: Record<CliTool["status"], string> = {
    available: "可用",
    missing: "未安装",
    error: "需检查"
  };
  return labels[status];
}

function credentialStatusLabel(status: CliTool["credentialStatus"]): string {
  const labels: Record<CliTool["credentialStatus"], string> = {
    configured: "凭据已检测",
    missing: "凭据未检测",
    unknown: "凭据未知"
  };
  return labels[status];
}

function diagnosticSeverityLabel(severity: CliTool["diagnostics"][number]["severity"]): string {
  const labels: Record<CliTool["diagnostics"][number]["severity"], string> = {
    ok: "正常",
    info: "提示",
    warning: "注意",
    error: "错误"
  };
  return labels[severity];
}

function cliHealthValueLabel(value: CliTool["health"]["headlessOk"]): string {
  if (value === true) {
    return "可用";
  }
  if (value === false) {
    return "失败";
  }
  return "未知";
}

function imageInputModeLabel(mode: CliTool["capabilities"]["imageInputMode"]): string {
  const labels: Record<CliTool["capabilities"]["imageInputMode"], string> = {
    "file-flag": "图片参数",
    "prompt-path-reference": "图片路径",
    base64: "Base64",
    unsupported: "不支持"
  };
  return labels[mode];
}

function runModelLabel(model: CliTool["capabilities"]["runModel"]): string {
  const labels: Record<CliTool["capabilities"]["runModel"], string> = {
    local: "本机",
    cloud: "云端",
    gateway: "网关"
  };
  return labels[model];
}

function runtimeStatusLabel(status: StudioBootstrap["godotRuntime"]["status"]): string {
  const labels: Record<StudioBootstrap["godotRuntime"]["status"], string> = {
    ready: "就绪",
    partial: "部分可用",
    missing: "缺失",
    error: "异常"
  };
  return labels[status];
}

function environmentStatusLabel(status?: StudioBootstrap["environment"]["status"]): string {
  if (!status) {
    return "未检查";
  }
  const labels: Record<StudioBootstrap["environment"]["status"], string> = {
    ready: "就绪",
    partial: "部分可用",
    missing: "缺失"
  };
  return labels[status];
}

function environmentToolStatusLabel(status: EnvironmentTool["status"]): string {
  const labels: Record<EnvironmentTool["status"], string> = {
    available: "可用",
    missing: "缺失",
    error: "异常"
  };
  return labels[status];
}

function runtimeSeverityLabel(severity: StudioBootstrap["godotRuntime"]["diagnostics"][number]["severity"]): string {
  const labels: Record<StudioBootstrap["godotRuntime"]["diagnostics"][number]["severity"], string> = {
    ok: "正常",
    info: "提示",
    warning: "注意",
    error: "错误"
  };
  return labels[severity];
}

function gitStatusLabel(status?: GitProjectStatus): string {
  if (!status) {
    return "未检查";
  }
  if (!status.available) {
    return "Git 缺失";
  }
  if (!status.initialized) {
    return "未启用";
  }
  return status.clean ? "干净" : `${status.changedFiles.length} 变更`;
}

function gitStatusClass(status?: GitProjectStatus): string {
  if (!status) {
    return "missing";
  }
  if (!status.available || status.error) {
    return "error";
  }
  if (!status.initialized || !status.clean) {
    return "partial";
  }
  return "ready";
}

function teamRouteStatusLabel(status: TeamCliRouteStatus, defaultCli: CliToolId): string {
  if (status === "default") {
    return "默认";
  }
  if (status === "fallback") {
    return `回退自 ${CLI_TOOL_LABELS[defaultCli]}`;
  }
  if (status === "error") {
    return "不可用";
  }
  return "缺失";
}

function preflightStatusLabel(status: PreflightStatus): string {
  const labels: Record<PreflightStatus, string> = {
    ready: "就绪",
    warning: "注意",
    blocked: "阻塞"
  };
  return labels[status];
}

function Button(props: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "quiet" | "danger";
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`button ${props.variant ?? "quiet"}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      type={props.type ?? "button"}
    >
      {props.icon}
      <span>{props.children}</span>
    </button>
  );
}

export function App() {
  const [bootstrap, setBootstrap] = useState<StudioBootstrap | undefined>();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetails | undefined>();
  const [activeAgentId, setActiveAgentId] = useState("producer");
  const [selectedCli, setSelectedCli] = useState<CliToolId>("codex");
  const [form, setForm] = useState<CreateForm>(initialForm);
  const [draft, setDraft] = useState("先帮我规划第一版可玩的核心循环。");
  const [autoPreviewAfterSend, setAutoPreviewAfterSend] = useState(true);
  const [busy, setBusy] = useState<BusyAction>("boot");
  const [notice, setNotice] = useState<string>("");
  const [previewNotice, setPreviewNotice] = useState<string>("");
  const [gitCommitMessage, setGitCommitMessage] = useState<string>("保存当前游戏版本");
  const [gitRestoreHash, setGitRestoreHash] = useState<string>("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [filePreview, setFilePreview] = useState<ProjectFilePreview | undefined>();

  const tools = bootstrap?.cliTools ?? [];
  const agents = bootstrap?.agents ?? AGENT_PROFILES;
  const activeAgent = agentById(activeAgentId);
  const hasAvailableCli = tools.some((tool) => tool.installed && tool.status === "available");
  const activeMessages = useMemo(
    () => (selectedProject?.messages ?? []).filter((message) => message.agentId === activeAgentId || message.role === "system"),
    [selectedProject, activeAgentId]
  );
  const activeTool = tools.find((tool) => tool.id === selectedCli);
  const activeCliInstalled = Boolean(activeTool?.installed);
  const activeCliAvailable = Boolean(activeTool?.installed && activeTool.status === "available");
  const activeCliSupportsImages = Boolean(activeTool?.capabilities.supportsImages);
  const activeCliUnavailableReason = activeTool?.status === "error" ? activeTool.health.detail ?? `${activeTool.label} 当前不可用。` : undefined;
  const environment = bootstrap?.environment;
  const gitEnvironmentTool = environment?.tools.find((tool) => tool.id === "git");
  const selectedTemplate = bootstrap?.godotRuntime.templates.find((template) => template.dimension === form.dimension);
  const createPreflight = useMemo(
    () => [
      {
        id: "cli",
        status: hasAvailableCli ? ("ready" as const) : ("warning" as const),
        title: "本地 AI CLI",
        detail: hasAvailableCli ? "已检测到可用于 Agent 的本地 CLI。" : "未检测到可用的本地 AI CLI；会先创建 Godot 项目，修复 CLI 后再运行团队工作流。"
      },
      {
        id: "template",
        status: selectedTemplate?.available ? ("ready" as const) : ("blocked" as const),
        title: `${form.dimension.toUpperCase()} Godot 模板`,
        detail: selectedTemplate?.available ? selectedTemplate.path : "当前维度的内置 Godot 模板缺失，无法创建项目。"
      },
      {
        id: "preview",
        status: bootstrap?.godotRuntime.consolePath ? ("ready" as const) : ("warning" as const),
        title: "Web 预览 / 导出 / zip",
        detail: bootstrap?.godotRuntime.consolePath ? "Godot Console 可用于导出、打包和刷新预览。" : "未检测到 Godot Console，Agent 可工作但 Web 预览/导出/zip 会失败。"
      }
    ],
    [bootstrap?.godotRuntime.consolePath, form.dimension, hasAvailableCli, selectedTemplate?.available, selectedTemplate?.path]
  );
  const templateBlocked = Boolean(bootstrap && !selectedTemplate?.available);
  const teamCliRoutes = useMemo(
    () =>
      agents.map((agent) => {
        const cliToolId = chooseAgentCli(agent, tools);
        const tool = tools.find((candidate) => candidate.id === cliToolId);
        const status: TeamCliRouteStatus = !tool?.installed
          ? "missing"
          : tool.status !== "available"
            ? "error"
            : cliToolId === agent.defaultCli
              ? "default"
              : "fallback";
        return {
          agent,
          cliToolId,
          tool,
          status
        };
      }),
    [agents, tools]
  );
  const activeRun = useMemo(
    () => (selectedProject?.runs ?? []).find((run) => run.status === "running" || run.status === "queued"),
    [selectedProject?.runs]
  );
  const previewFrameKey = selectedProject?.previewUrl
    ? `${selectedProject.id}:${selectedProject.previewUrl}:${selectedProject.previewUpdatedAt ?? "initial"}`
    : "no-preview";

  async function openPath(targetPath?: string) {
    if (!targetPath) {
      return;
    }
    try {
      await window.studio.openPath(targetPath);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function previewProjectFile(relativePath?: string) {
    if (!selectedProject || !relativePath) {
      return;
    }
    setBusy("file");
    try {
      const preview = await window.studio.readProjectFile({
        projectId: selectedProject.id,
        relativePath
      });
      setFilePreview(preview);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function attachImages(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    if (!activeCliSupportsImages) {
      setNotice(`${activeTool?.label ?? CLI_TOOL_LABELS[selectedCli]} Adapter 不支持图片输入，请切换支持图片的 CLI。`);
      return;
    }
    try {
      const nextAttachments = await Promise.all(
        [...files]
          .filter((file) => file.type.startsWith("image/"))
          .slice(0, 6)
          .map(async (file) => ({
            id: `${file.name}:${file.lastModified}:${file.size}`,
            name: file.name,
            mimeType: file.type || "image/png",
            size: file.size,
            dataUrl: await readFileAsDataUrl(file)
          }))
      );
      setPendingAttachments((current) => [...current, ...nextAttachments].slice(0, 6));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function deleteSelectedProject() {
    if (!selectedProject) {
      return;
    }
    const ok = window.confirm(
      `删除项目“${selectedProject.name}”？\n\n这会同时删除本地游戏目录：\n${selectedProject.rootPath}\n\n此操作不可撤销。`
    );
    if (!ok) {
      return;
    }
    setBusy("delete");
    try {
      const result = await window.studio.deleteProject(selectedProject.id);
      setProjects(result.projects);
      setSelectedProject(result.selectedProject);
      if (result.selectedProject) {
        setActiveAgentId(result.selectedProject.activeAgentId);
      }
      setNotice(`已删除项目：${result.deletedRootPath}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function loadBootstrap(selectProjectId?: string) {
    setBusy("boot");
    try {
      const data = await window.studio.bootstrap();
      setBootstrap(data);
      setProjects(data.projects);
      const target = pickBootstrapProjectId(data.projects, selectProjectId, selectedProject?.id);
      if (target) {
        const detail = await window.studio.getProject(target);
        setSelectedProject(detail);
        setActiveAgentId(detail.activeAgentId);
        setSelectedCli(pickDefaultCli(detail.activeAgentId, data.cliTools));
      } else {
        setSelectedProject(undefined);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    return window.studio.onRunEvent((event) => {
      setSelectedProject((current) => {
        if (!current || current.id !== event.run.projectId) {
          return current;
        }
        return {
          ...current,
          runs: upsertRun(current.runs ?? [], event.run)
        };
      });
    });
  }, []);

  useEffect(() => {
    return window.studio.onPreviewEvent((event: PreviewEvent) => {
      setSelectedProject((current) => {
        if (!current || current.id !== event.projectId) {
          return current;
        }
        return {
          ...current,
          previewUrl: event.url ?? current.previewUrl,
          previewWatching: event.status !== "stopped",
          previewStatus: event.status,
          previewUpdatedAt: event.updatedAt
        };
      });
      setPreviewNotice(event.message ?? previewStatusLabel(event.status));
    });
  }, []);

  useEffect(() => {
    setSelectedCli(pickDefaultCli(activeAgentId, tools));
  }, [activeAgentId, tools]);

  useEffect(() => {
    if (selectedProject) {
      setGitCommitMessage(`保存 ${selectedProject.name} 当前版本`);
    }
  }, [selectedProject?.id, selectedProject?.name]);

  async function createProject() {
    setBusy("create");
    setNotice("");
    try {
      const { autoRunWorkflow, ...projectInput } = form;
      const project = await window.studio.createProject(projectInput);
      setSelectedProject(project);
      setProjects(await window.studio.listProjects());
      setActiveAgentId(project.activeAgentId);
      const refreshedTools = await window.studio.refreshCliTools();
      setBootstrap((current) => (current ? { ...current, cliTools: refreshedTools } : current));
      const defaultCli = pickDefaultCli(project.activeAgentId, refreshedTools);
      setSelectedCli(defaultCli);

      if (!autoRunWorkflow) {
        setNotice(`已创建项目：${project.name}`);
        return;
      }

      if (!refreshedTools.some((tool) => tool.installed && tool.status === "available")) {
        setNotice(`已创建项目：${project.name}。请先安装或修复至少一个可用的本地 AI CLI，再运行团队工作流。`);
        return;
      }

      setBusy("workflow");
      setNotice(`已创建项目：${project.name}，正在启动团队工作流。`);
      await startStudioWorkflow(project, project.prompt);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function selectProject(projectId: string) {
    setBusy("boot");
    try {
      const project = await window.studio.getProject(projectId);
      setSelectedProject(project);
      setActiveAgentId(project.activeAgentId);
      setDraft("继续推进下一步。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshCliTools() {
    setBusy("cli");
    try {
      const cliTools = await window.studio.refreshCliTools();
      setBootstrap((current) => (current ? { ...current, cliTools } : current));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshEnvironment() {
    setBusy("environment");
    try {
      const nextEnvironment = await window.studio.refreshEnvironment();
      setBootstrap((current) => (current ? { ...current, environment: nextEnvironment } : current));
      if (selectedProject) {
        await refreshGitStatus(selectedProject.id);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshGitStatus(projectId = selectedProject?.id) {
    if (!projectId) {
      return;
    }
    try {
      const gitStatus = await window.studio.getProjectGitStatus(projectId);
      setSelectedProject((current) => (current && current.id === projectId ? { ...current, gitStatus } : current));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function installCli(toolId: CliToolId) {
    setBusy("cli");
    setNotice(`正在安装 ${CLI_TOOL_LABELS[toolId]}...`);
    try {
      const result = await window.studio.installCliTool(toolId);
      setNotice(result.ok ? `${CLI_TOOL_LABELS[toolId]} 安装完成。` : result.stderr || result.stdout || "安装失败。");
      await refreshCliTools();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function commitGitVersion() {
    if (!selectedProject) {
      return;
    }
    setBusy("git");
    try {
      const result = await window.studio.commitProjectGit({
        projectId: selectedProject.id,
        message: gitCommitMessage.trim() || `保存 ${selectedProject.name} 当前版本`
      });
      setSelectedProject(result.project);
      setProjects(await window.studio.listProjects());
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function restoreGitCommit(commitHash: string, label: string) {
    if (!selectedProject) {
      return;
    }
    const targetHash = commitHash.trim();
    if (!targetHash) {
      setNotice("请输入要还原的 Git 提交 hash。");
      return;
    }
    const ok = window.confirm(`还原到 Git 版本 ${label}？\n\n当前未提交的本地变更会被覆盖。`);
    if (!ok) {
      return;
    }
    setBusy("git");
    try {
      const result = await window.studio.restoreProjectGit({
        projectId: selectedProject.id,
        commitHash: targetHash
      });
      setSelectedProject(result.project);
      setProjects(await window.studio.listProjects());
      setNotice(result.message);
      setGitRestoreHash("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function sendTurn() {
    if (!selectedProject || (!draft.trim() && pendingAttachments.length === 0)) {
      return;
    }
    if (pendingAttachments.length > 0 && !activeCliSupportsImages) {
      setNotice(`${activeTool?.label ?? CLI_TOOL_LABELS[selectedCli]} Adapter 不支持图片输入，请移除图片或切换 CLI。`);
      return;
    }
    setBusy("send");
    setNotice("");
    try {
      const result = await window.studio.runAgentTurn({
        projectId: selectedProject.id,
        agentId: activeAgentId,
        cliToolId: selectedCli,
        message: draft.trim(),
        autoStartPreview: autoPreviewAfterSend,
        attachments: pendingAttachments.map(({ id: _id, ...attachment }) => attachment)
      });
      setSelectedProject({ ...result.project, messages: result.messages, runs: result.runs });
      setProjects(await window.studio.listProjects());
      const nextPreviewNotice = agentTurnPreviewNotice(result);
      if (nextPreviewNotice) {
        setPreviewNotice(nextPreviewNotice);
      }
      setDraft("");
      setPendingAttachments([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function startStudioWorkflow(project: ProjectDetails, message: string, preferredCliToolId?: CliToolId): Promise<void> {
    const result = await window.studio.runStudioWorkflow({
      projectId: project.id,
      message,
      preferredCliToolId,
      autoExportWeb: true,
      autoPackageWebZip: true,
      autoStartPreview: true
    });
    setSelectedProject(result.project);
    setProjects(await window.studio.listProjects());
    setNotice(
      result.run.status === "completed"
        ? result.zipResult
          ? `团队工作流完成，Web zip 已导出：${result.zipResult.zipPath}`
          : "团队工作流完成，预览已刷新。"
        : result.run.summary ?? "团队工作流结束。"
    );
  }

  async function runWorkflow() {
    if (!selectedProject) {
      return;
    }
    setBusy("workflow");
    setNotice("");
    try {
      await startStudioWorkflow(selectedProject, draft.trim() || selectedProject.prompt);
      if (draft.trim()) {
        setDraft("");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function cancelActiveRun() {
    if (!activeRun) {
      return;
    }
    try {
      const cancelled = await window.studio.cancelRun(activeRun.id);
      setSelectedProject((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          runs: upsertRun(current.runs ?? [], cancelled)
        };
      });
      setNotice(cancelled.summary ?? "任务已取消。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function startPreview() {
    if (!selectedProject) {
      return;
    }
    setBusy("preview");
    try {
      const preview = await window.studio.startAutoPreview(selectedProject.id);
      setSelectedProject({
        ...selectedProject,
        previewUrl: preview.url,
        previewWatching: true,
        previewStatus: "watching",
        previewUpdatedAt: new Date().toISOString()
      });
      setPreviewNotice(`实时预览已启动：${preview.url}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function stopPreview() {
    if (!selectedProject) {
      return;
    }
    setBusy("preview");
    try {
      const event = await window.studio.stopAutoPreview(selectedProject.id);
      setSelectedProject({
        ...selectedProject,
        previewWatching: false,
        previewStatus: event.status,
        previewUpdatedAt: event.updatedAt
      });
      setPreviewNotice(event.message ?? "实时预览已停止。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function runGodotExport() {
    if (!selectedProject) {
      return;
    }
    setBusy("godot");
    try {
      const result = await window.studio.runGodotExport(selectedProject.id);
      setNotice(result.ok ? "Godot Web 导出完成。" : result.stderr || result.stdout || "Godot 导出失败。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function openGodotEditor() {
    if (!selectedProject) {
      return;
    }
    setBusy("editor");
    try {
      const result = await window.studio.openGodotEditor(selectedProject.id);
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function validateProject() {
    if (!selectedProject) {
      return;
    }
    setBusy("validate");
    try {
      const result = await window.studio.validateProject(selectedProject.id);
      setNotice(result.ok ? "Godot 校验通过。" : result.stderr || result.stdout || "Godot 校验失败。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function exportWeb() {
    if (!selectedProject) {
      return;
    }
    setBusy("export");
    try {
      const result = await window.studio.exportWeb(selectedProject.id);
      setSelectedProject(result.project);
      setProjects(await window.studio.listProjects());
      setNotice(result.ok && result.zipPath ? `Web zip 已导出：${result.zipPath}` : result.error ?? "Web zip 导出失败。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  const isBusy = Boolean(busy);
  const createProjectButton = getCreateProjectButtonState({
    isBusy,
    prompt: form.prompt,
    templateBlocked,
    autoRunWorkflow: form.autoRunWorkflow,
    hasInstalledCli: hasAvailableCli
  });
  const sendTurnButton = getSendTurnButtonState({
    hasSelectedProject: Boolean(selectedProject),
    draft,
    attachmentCount: pendingAttachments.length,
    isBusy,
    selectedCliInstalled: activeCliInstalled,
    selectedCliAvailable: activeCliAvailable,
    selectedCliUnavailableReason: activeCliUnavailableReason,
    selectedCliSupportsImages: activeCliSupportsImages,
    selectedCliLabel: CLI_TOOL_LABELS[selectedCli]
  });
  const gitStatus = selectedProject?.gitStatus;
  const gitCommitDisabled =
    !selectedProject ||
    isBusy ||
    !gitStatus?.available ||
    (gitStatus.initialized && gitStatus.clean) ||
    !gitCommitMessage.trim();
  const gitCommitTitle = !selectedProject
    ? "先创建或选择项目。"
    : !gitStatus?.available
      ? gitStatus?.message ?? "未检测到 Git。"
      : gitStatus.initialized && gitStatus.clean
        ? "当前 Git 工作区没有未提交变更。"
        : gitStatus.initialized
          ? "提交当前 Git 变更。"
          : "为此项目启用 Git 版本管理并提交当前状态。";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Gamepad2 size={22} />
          </div>
          <div>
            <h1>GameAIStudio</h1>
            <p>Godot AI 创作台</p>
          </div>
        </div>

        <section className="panel create-panel">
          <div className="section-title">
            <WandSparkles size={17} />
            <span>新建游戏</span>
          </div>
          <label>
            <span>项目名</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            <span>一句话需求</span>
            <textarea value={form.prompt} rows={4} onChange={(event) => setForm({ ...form, prompt: event.target.value })} />
          </label>
          <div className="segmented">
            <button className={form.dimension === "2d" ? "active" : ""} onClick={() => setForm({ ...form, dimension: "2d" })}>
              2D
            </button>
            <button className={form.dimension === "3d" ? "active" : ""} onClick={() => setForm({ ...form, dimension: "3d" })}>
              3D
            </button>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={form.autoRunWorkflow}
              onChange={(event) => setForm({ ...form, autoRunWorkflow: event.target.checked })}
            />
            <span>创建后自动启动团队工作流</span>
          </label>
          {form.autoRunWorkflow && bootstrap ? (
            <div className="team-cli-routes compact">
              {teamCliRoutes.map((route) => (
                <div className={`team-cli-route ${route.status}`} key={`create:${route.agent.id}`}>
                  <span>{route.agent.title}</span>
                  <strong>{CLI_TOOL_LABELS[route.cliToolId]}</strong>
                  <small>{teamRouteStatusLabel(route.status, route.agent.defaultCli)}</small>
                </div>
              ))}
            </div>
          ) : null}
          {form.autoRunWorkflow && bootstrap ? (
            <div className="create-preflight">
              {createPreflight.map((item) => (
                <div className={`create-preflight-item ${item.status}`} key={item.id}>
                  <span>{preflightStatusLabel(item.status)}</span>
                  <p title={item.detail}>
                    <strong>{item.title}</strong>
                    {` · ${item.detail}`}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <Button
            variant="primary"
            icon={busy === "create" || (busy === "workflow" && form.autoRunWorkflow) ? <Loader2 className="spin" size={16} /> : <Package size={16} />}
            onClick={createProject}
            disabled={createProjectButton.disabled}
            title={createProjectButton.title}
          >
            {createProjectButton.label}
          </Button>
        </section>

        <section className="panel">
          <div className="section-title split">
            <span>
              <Terminal size={17} />
              本地 CLI
            </span>
            <button className="icon-button" title="刷新 CLI" onClick={refreshCliTools} disabled={isBusy}>
              <RefreshCw size={15} className={busy === "cli" ? "spin" : ""} />
            </button>
          </div>
          <div className="cli-list">
            {tools.map((tool) => (
              <div className={`cli-row ${tool.status}`} key={tool.id}>
                <div className="cli-main">
                  <div className="cli-title">
                    <strong>{tool.label}</strong>
                    <span className={`status-pill cli-status ${tool.status}`}>{cliStatusLabel(tool.status)}</span>
                  </div>
                  <span title={tool.executablePath ?? tool.installCommand.join(" ")}>
                    {tool.installed ? tool.version || tool.executablePath : `命令：${tool.command}`}
                  </span>
                </div>
                <div className="cli-actions">
                  {tool.installed ? (
                    <CheckCircle2 className="ok" size={18} />
                  ) : (
                    <button
                      onClick={() => installCli(tool.id)}
                      disabled={isBusy || !tool.installManagerAvailable}
                      title={tool.installManagerAvailable ? tool.installCommand.join(" ") : `${tool.installManager} 不可用`}
                    >
                      安装
                    </button>
                  )}
                </div>
                <div className="cli-meta">
                  <span title={tool.installManagerVersion}>
                    安装器：{tool.installManagerAvailable ? `${tool.installManager}${tool.installManagerVersion ? ` ${tool.installManagerVersion}` : ""}` : `${tool.installManager} 不可用`}
                  </span>
                  <span title={tool.credentialEnvVars.join(" / ")}>
                    {credentialStatusLabel(tool.credentialStatus)}
                    {tool.detectedCredentialEnvVars.length > 0 ? `：${tool.detectedCredentialEnvVars.join(", ")}` : ""}
                  </span>
                  <span title={tool.health.detail ?? "Adapter 分层健康状态"}>
                    Headless：{cliHealthValueLabel(tool.health.headlessOk)}
                  </span>
                  <span title={`认证：${cliHealthValueLabel(tool.health.authed)}`}>
                    Auth：{cliHealthValueLabel(tool.health.authed)}
                  </span>
                </div>
                <div className="cli-capabilities">
                  <span>{runModelLabel(tool.capabilities.runModel)}</span>
                  <span>{tool.capabilities.headless ? "Headless" : "交互"}</span>
                  <span>{tool.capabilities.supportsStream ? "流式" : "一次性"}</span>
                  <span className={tool.capabilities.supportsImages ? "" : "muted"}>
                    图片：{tool.capabilities.supportsImages ? imageInputModeLabel(tool.capabilities.imageInputMode) : "不支持"}
                  </span>
                  {tool.capabilities.supportsResume ? <span>续聊</span> : null}
                </div>
                <div className="cli-diagnostics">
                  {tool.diagnostics.map((diagnostic) => (
                    <div className={`cli-diagnostic ${diagnostic.severity}`} key={diagnostic.id}>
                      <span>{diagnosticSeverityLabel(diagnostic.severity)}</span>
                      <p title={diagnostic.action ?? diagnostic.detail}>
                        <strong>{diagnostic.title}</strong>
                        {diagnostic.action ? ` · ${diagnostic.action}` : ` · ${diagnostic.detail}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel project-list">
          <div className="section-title">
            <FolderOpen size={17} />
            <span>项目</span>
          </div>
          {projects.length === 0 ? <p className="empty-text">还没有项目</p> : null}
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-item ${selectedProject?.id === project.id ? "active" : ""}`}
              onClick={() => selectProject(project.id)}
            >
              <span>{project.name}</span>
              <small>
                {project.dimension.toUpperCase()} · {formatTime(project.updatedAt)}
              </small>
            </button>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">当前项目</p>
            <h2>{selectedProject?.name ?? "等待创建"}</h2>
          </div>
          {selectedProject ? (
            <div className="header-actions">
              <Button icon={<FolderOpen size={16} />} onClick={() => openPath(selectedProject.rootPath)}>
                打开目录
              </Button>
              <Button
                icon={busy === "editor" ? <Loader2 className="spin" size={16} /> : <Gamepad2 size={16} />}
                onClick={openGodotEditor}
                disabled={isBusy}
                title={bootstrap?.godotRuntime.guiPath ?? "需要内置 Godot GUI 可执行文件"}
              >
                Godot
              </Button>
              <Button icon={<ExternalLink size={16} />} onClick={() => selectedProject.previewUrl && window.open(selectedProject.previewUrl)}>
                浏览器
              </Button>
              <Button
                variant="danger"
                icon={busy === "delete" ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                onClick={deleteSelectedProject}
                disabled={isBusy}
                title="删除项目，并同时删除本地 Godot 游戏目录。"
              >
                删除
              </Button>
            </div>
          ) : null}
        </header>

        <div className="agent-tabs">
          {agents.map((agent) => (
            <button
              key={agent.id}
              style={{ "--agent": agent.accent } as React.CSSProperties}
              className={activeAgentId === agent.id ? "active" : ""}
              onClick={() => setActiveAgentId(agent.id)}
            >
              <Bot size={16} />
              <span>{agent.title}</span>
            </button>
          ))}
        </div>

        <div className="conversation">
          {!selectedProject ? (
            <div className="empty-state">
              <Gamepad2 size={42} />
              <h3>创建第一个 Godot 游戏</h3>
            </div>
          ) : (
            activeMessages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-meta">
                  <strong>{message.role === "user" ? "用户" : message.role === "system" ? "系统" : activeAgent.title}</strong>
                  <span>{formatTime(message.createdAt)}</span>
                  {message.cliToolId ? <span>{CLI_TOOL_LABELS[message.cliToolId]}</span> : null}
                  {attachmentSummary(message.attachments) ? <span>{attachmentSummary(message.attachments)}</span> : null}
                  {message.fileChanges && message.fileChanges.length > 0 ? <span>{message.fileChanges.length} 个文件变更</span> : null}
                </div>
                <pre>{message.content}</pre>
                {message.attachments && message.attachments.length > 0 ? (
                  <div className="message-attachments">
                    {message.attachments.map((attachment) => (
                      <button
                        key={attachment.id}
                        className="message-attachment"
                        onClick={() => previewProjectFile(attachment.projectRelativePath)}
                        title={attachment.projectRelativePath}
                      >
                        <ImageIcon size={15} />
                        <span>{attachment.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.fileChanges && message.fileChanges.length > 0 ? (
                  <div className="message-file-changes">
                    {message.fileChanges.slice(0, 10).map((change) => (
                      <button
                        className={`message-file-change ${change.kind}`}
                        key={`${message.id}:${change.kind}:${change.path}`}
                        onClick={() => previewProjectFile(change.path)}
                        title={projectFilePath(selectedProject.rootPath, change.path)}
                      >
                        <span>{fileChangeKindLabel(change.kind)}</span>
                        <p>{change.path}</p>
                      </button>
                    ))}
                    {message.fileChanges.length > 10 ? <small>还有 {message.fileChanges.length - 10} 个文件变更</small> : null}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>

        <footer className="composer">
          <div className="composer-top">
            <div>
              <strong style={{ color: activeAgent.accent }}>{activeAgent.title}</strong>
              <span>{activeAgent.specialty}</span>
            </div>
            <select value={selectedCli} onChange={(event) => setSelectedCli(event.target.value as CliToolId)}>
              {Object.entries(CLI_TOOL_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="composer-row">
            <textarea value={draft} rows={3} onChange={(event) => setDraft(event.target.value)} disabled={!selectedProject || isBusy} />
            <Button
              variant="primary"
              icon={busy === "send" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              onClick={sendTurn}
              disabled={sendTurnButton.disabled}
              title={sendTurnButton.title}
            >
              发送
            </Button>
          </div>
          {pendingAttachments.length > 0 ? (
            <div className="pending-attachments">
              {pendingAttachments.map((attachment) => (
                <div className="pending-attachment" key={attachment.id}>
                  <img src={attachment.dataUrl} alt={attachment.name} />
                  <span title={attachment.name}>{attachment.name}</span>
                  <button onClick={() => removePendingAttachment(attachment.id)} title="移除图片" disabled={isBusy}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="composer-actions">
            <label
              className={`attach-button ${activeCliSupportsImages ? "" : "disabled"}`}
              title={
                activeCliSupportsImages
                  ? `添加图片；当前 Adapter 会以${imageInputModeLabel(activeTool?.capabilities.imageInputMode ?? "unsupported")}方式交给 AI。`
                  : `${activeTool?.label ?? CLI_TOOL_LABELS[selectedCli]} Adapter 不支持图片输入`
              }
            >
              <Paperclip size={15} />
              <span>图片</span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={!selectedProject || isBusy || !activeCliSupportsImages}
                onChange={(event) => {
                  void attachImages(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <label className="composer-option">
            <input type="checkbox" checked={autoPreviewAfterSend} onChange={(event) => setAutoPreviewAfterSend(event.target.checked)} />
            <span>Agent 修改 Godot 文件后自动刷新 Web 预览</span>
          </label>
          {selectedProject && !activeCliInstalled ? <p className="warning">{activeTool?.installHint ?? sendTurnButton.title}</p> : null}
          {selectedProject && activeCliInstalled && !activeCliAvailable ? <p className="warning">{activeCliUnavailableReason ?? sendTurnButton.title}</p> : null}
          {selectedProject && pendingAttachments.length > 0 && !activeCliSupportsImages ? <p className="warning">当前 Adapter 不支持图片输入，请移除图片或切换 CLI。</p> : null}
        </footer>
      </section>

      <aside className="rightbar">
        <section className="preview-panel">
          <div className="section-title split">
            <span>
              <Play size={17} />
              Web 实时预览
            </span>
            {selectedProject?.previewWatching ? (
              <Button icon={busy === "preview" ? <Loader2 className="spin" size={16} /> : <StopCircle size={16} />} onClick={stopPreview} disabled={!selectedProject || isBusy}>
                停止
              </Button>
            ) : (
              <Button icon={busy === "preview" ? <Loader2 className="spin" size={16} /> : <Play size={16} />} onClick={startPreview} disabled={!selectedProject || isBusy}>
                启动
              </Button>
            )}
          </div>
          <div className="preview-status-row">
            <span className={`status-pill ${selectedProject?.previewStatus ?? "stopped"}`}>
              {previewStatusLabel(selectedProject?.previewStatus)}
            </span>
            <p>{previewNotice || (selectedProject?.previewWatching ? "正在监听 Godot 项目文件变化。" : "启动后会自动导出并刷新预览。")}</p>
          </div>
          <div className="preview-frame">
            {selectedProject?.previewUrl ? <iframe key={previewFrameKey} src={selectedProject.previewUrl} title="Godot Web Preview" /> : <Play size={40} />}
          </div>
        </section>

        <section className="panel actions-panel">
          <div className="section-title">
            <Hammer size={17} />
            <span>构建</span>
          </div>
          <Button
            icon={busy === "workflow" ? <Loader2 className="spin" size={16} /> : <Bot size={16} />}
            onClick={runWorkflow}
            disabled={!selectedProject || isBusy || !hasAvailableCli}
            title="团队工作流会按角色自动选择默认 CLI，当前 CLI 下拉框只影响单个 Agent 对话。"
          >
            团队工作流
          </Button>
          <div className="team-cli-routes">
            {teamCliRoutes.map((route) => (
              <div className={`team-cli-route ${route.status}`} key={route.agent.id}>
                <span>{route.agent.title}</span>
                <strong>{CLI_TOOL_LABELS[route.cliToolId]}</strong>
                <small>{teamRouteStatusLabel(route.status, route.agent.defaultCli)}</small>
              </div>
            ))}
            {!hasAvailableCli ? <p>安装或修复至少一个可用的本地 AI CLI 后才能运行团队工作流。</p> : null}
          </div>
          {activeRun ? (
            <Button variant="danger" icon={<StopCircle size={16} />} onClick={cancelActiveRun}>
              取消当前任务
            </Button>
          ) : null}
          <Button icon={busy === "godot" ? <Loader2 className="spin" size={16} /> : <Package size={16} />} onClick={runGodotExport} disabled={!selectedProject || isBusy}>
            Web 导出
          </Button>
          <Button icon={busy === "validate" ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />} onClick={validateProject} disabled={!selectedProject || isBusy}>
            Godot 校验
          </Button>
          <Button icon={busy === "export" ? <Loader2 className="spin" size={16} /> : <Download size={16} />} onClick={exportWeb} disabled={!selectedProject || isBusy}>
            导出 zip
          </Button>
          {selectedProject?.exportZipPath ? (
            <div className="zip-delivery">
              <div>
                <strong>最新 Web zip</strong>
                <span title={selectedProject.exportZipPath}>{selectedProject.exportZipPath}</span>
              </div>
              <button title="打开 zip" onClick={() => openPath(selectedProject.exportZipPath)} disabled={isBusy}>
                <ExternalLink size={15} />
              </button>
              <button title="导出目录" onClick={() => openPath(dirnameFromPath(selectedProject.exportZipPath!))} disabled={isBusy}>
                <FolderOpen size={15} />
              </button>
              {selectedProject.latestExportManifestPath ? (
                <button title="打开导出清单" onClick={() => openPath(selectedProject.latestExportManifestPath)} disabled={isBusy}>
                  <FileJson size={15} />
                </button>
              ) : null}
            </div>
          ) : null}
          {selectedProject?.latestWebBuildInspection ? (
            <div className={`web-build-health ${selectedProject.latestWebBuildInspection.ok ? "ok" : "failed"}`}>
              <span>{selectedProject.latestWebBuildInspection.ok ? "完整" : "缺失"}</span>
              <p title={selectedProject.latestWebBuildInspection.message}>
                <strong>Web 构建检查</strong>
                {selectedProject.latestWebBuildInspection.ok
                  ? ` · ${selectedProject.latestWebBuildInspection.files.length} 文件 · ${formatBytes(selectedProject.latestWebBuildInspection.totalBytes)}`
                  : ` · 缺少 ${selectedProject.latestWebBuildInspection.missingRequiredFiles.join(", ")}`}
              </p>
            </div>
          ) : null}
        </section>

        <section className="panel git-panel">
          <div className="section-title split">
            <span>
              <GitBranch size={17} />
              Git 版本
            </span>
            <span className={`status-pill git-status ${gitStatusClass(gitStatus)}`}>{gitStatusLabel(gitStatus)}</span>
          </div>
          {selectedProject ? (
            <>
              <dl>
                <dt>分支</dt>
                <dd>{gitStatus?.branch ?? "未初始化"}</dd>
                <dt>提交</dt>
                <dd>{gitStatus?.head ?? "无"}</dd>
                <dt>状态</dt>
                <dd title={gitStatus?.error ?? gitStatus?.message}>{gitStatus?.message ?? "未检查"}</dd>
              </dl>
              {gitStatus?.changedFiles.length ? (
                <div className="git-change-list">
                  {gitStatus.changedFiles.slice(0, 8).map((file) => (
                    <button key={file} onClick={() => previewProjectFile(file)} title={projectFilePath(selectedProject.rootPath, file)}>
                      {file}
                    </button>
                  ))}
                  {gitStatus.changedFiles.length > 8 ? <small>还有 {gitStatus.changedFiles.length - 8} 个变更</small> : null}
                </div>
              ) : null}
              {gitStatus?.recentCommits.length ? (
                <div className="git-commit-list">
                  {gitStatus.recentCommits.slice(0, 5).map((commit) => (
                    <article className="git-commit-item" key={commit.hash}>
                      <div>
                        <strong title={commit.message}>{commit.message}</strong>
                        <span>
                          {commit.shortHash} · {formatTime(commit.date)}
                        </span>
                      </div>
                      <button
                        title="还原到此版本"
                        onClick={() => restoreGitCommit(commit.hash, `${commit.shortHash} ${commit.message}`)}
                        disabled={isBusy}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
              <div className="git-restore-row">
                <input
                  value={gitRestoreHash}
                  onChange={(event) => setGitRestoreHash(event.target.value)}
                  placeholder="输入任意提交 hash"
                  disabled={isBusy || !gitStatus?.initialized}
                />
                <Button
                  icon={<RefreshCw size={16} />}
                  onClick={() => restoreGitCommit(gitRestoreHash, gitRestoreHash.trim() || "指定提交")}
                  disabled={isBusy || !gitStatus?.initialized || !gitRestoreHash.trim()}
                  title="还原到指定 Git 提交"
                >
                  还原版本
                </Button>
              </div>
              <div className="git-commit-row">
                <input value={gitCommitMessage} onChange={(event) => setGitCommitMessage(event.target.value)} disabled={isBusy} />
                <Button
                  icon={busy === "git" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  onClick={commitGitVersion}
                  disabled={gitCommitDisabled}
                  title={gitCommitTitle}
                >
                  {gitStatus?.initialized ? "提交版本" : "启用 Git"}
                </Button>
              </div>
              <button className="text-button" onClick={() => refreshGitStatus()} disabled={isBusy}>
                刷新 Git 状态
              </button>
            </>
          ) : (
            <p className="empty-text">暂无项目</p>
          )}
        </section>

        <section className="panel runs-panel">
          <div className="section-title">
            <Terminal size={17} />
            <span>Agent 任务</span>
          </div>
          {selectedProject && selectedProject.runs.length > 0 ? (
            <div className="run-list">
              {selectedProject.runs.slice(0, 5).map((run) => (
                <article className="run-item" key={run.id}>
                  <div className="run-head">
                    <strong>{run.title}</strong>
                    <span className={`status-pill ${run.status}`}>{runStatusLabel(run.status)}</span>
                  </div>
                  <div className="run-steps">
                    {run.steps.map((step) => (
                      <div className={`run-step ${step.status}`} key={step.id}>
                        <span>
                          {step.status === "running"
                            ? "●"
                            : step.status === "completed"
                              ? "✓"
                              : step.status === "failed"
                                ? "!"
                                : step.status === "cancelled"
                                  ? "×"
                                  : "○"}
                        </span>
                        <p title={step.message}>{step.title}</p>
                        {step.fileChanges && step.fileChanges.length > 0 ? (
                          <div className="file-change-list">
                            {step.fileChanges.slice(0, 8).map((change) => (
                              <div className={`file-change ${change.kind}`} key={`${change.kind}:${change.path}`}>
                                <span>{fileChangeKindLabel(change.kind)}</span>
                                <p title={change.path}>{change.path}</p>
                              </div>
                            ))}
                            {step.fileChanges.length > 8 ? <small>还有 {step.fileChanges.length - 8} 个文件变更</small> : null}
                          </div>
                        ) : null}
                        {step.output ? <pre className="run-output">{step.output}</pre> : null}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-text">还没有 Agent 任务</p>
          )}
        </section>

        <section className="panel details-panel">
          <div className="section-title">
            <Gamepad2 size={17} />
            <span>状态</span>
          </div>
          {selectedProject ? (
            <>
              <dl>
                <dt>类型</dt>
                <dd>{selectedProject.dimension.toUpperCase()}</dd>
                <dt>目录</dt>
                <dd title={selectedProject.rootPath}>{selectedProject.rootPath}</dd>
                <dt>Web</dt>
                <dd title={selectedProject.webBuildPath}>{selectedProject.webBuildPath}</dd>
                <dt>Zip</dt>
                <dd>{selectedProject.exportZipPath ?? "未导出"}</dd>
              </dl>
              <div className="details-actions">
                <Button icon={<FileJson size={16} />} onClick={() => previewProjectFile("GAMEAISTUDIO.md")}>
                  项目说明
                </Button>
                <Button icon={<FileJson size={16} />} onClick={() => previewProjectFile("docs/agent-context.md")}>
                  Agent 上下文
                </Button>
                <Button icon={<Terminal size={16} />} onClick={() => previewProjectFile(".gameaistudio/agent-journal.md")}>
                  Agent 日志
                </Button>
              </div>
              {selectedProject.exportZipPath ? (
                <div className="details-actions">
                  <Button icon={<ExternalLink size={16} />} onClick={() => openPath(selectedProject.exportZipPath)}>
                    打开 zip
                  </Button>
                  <Button icon={<FolderOpen size={16} />} onClick={() => openPath(dirnameFromPath(selectedProject.exportZipPath!))}>
                    导出目录
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="empty-text">暂无项目</p>
          )}
        </section>

        {notice ? (
          <section className="notice">
            {notice.includes("失败") || notice.includes("未找到") ? <XCircle size={17} /> : <CheckCircle2 size={17} />}
            <p>{notice}</p>
          </section>
        ) : null}

        {environment ? (
          <section className="panel environment-panel">
            <div className="section-title split">
              <span>
                <Terminal size={17} />
                系统环境
              </span>
              <button className="icon-button" title="刷新环境" onClick={refreshEnvironment} disabled={isBusy}>
                <RefreshCw size={15} className={busy === "environment" ? "spin" : ""} />
              </button>
            </div>
            <div className="environment-summary">
              <span className={`status-pill environment-status ${environment.status}`}>{environmentStatusLabel(environment.status)}</span>
              <p>Git：{gitEnvironmentTool ? environmentToolStatusLabel(gitEnvironmentTool.status) : "未检查"}</p>
            </div>
            <div className="environment-tool-list">
              {environment.tools.map((tool) => (
                <div className={`environment-tool ${tool.status}`} key={tool.id}>
                  <div>
                    <strong>{tool.label}</strong>
                    <span title={tool.executablePath ?? tool.command}>{tool.version ?? tool.command}</span>
                  </div>
                  <span className={`status-pill environment-tool-status ${tool.status}`}>{environmentToolStatusLabel(tool.status)}</span>
                  {tool.diagnostics.map((diagnostic) => (
                    <p key={diagnostic.id} title={diagnostic.detail}>
                      {diagnostic.action ?? diagnostic.detail}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {bootstrap ? (
          <section className="panel runtime-panel">
            <div className="section-title split">
              <span>
                <Gamepad2 size={17} />
                Godot 运行时
              </span>
              <span className={`status-pill runtime-status ${bootstrap.godotRuntime.status}`}>
                {runtimeStatusLabel(bootstrap.godotRuntime.status)}
              </span>
            </div>
            <dl>
              <dt>版本</dt>
              <dd>{bootstrap.godotRuntime.version ?? "未探测"}</dd>
              <dt>Console</dt>
              <dd title={bootstrap.godotRuntime.consolePath}>{bootstrap.godotRuntime.consolePath ?? "未找到"}</dd>
              <dt>GUI</dt>
              <dd title={bootstrap.godotRuntime.guiPath}>{bootstrap.godotRuntime.guiPath ?? "未找到"}</dd>
              <dt>模板</dt>
              <dd>{bootstrap.godotRuntime.templates.filter((template) => template.available).length}/{bootstrap.godotRuntime.templates.length} 可用</dd>
            </dl>
            <div className="runtime-diagnostics">
              {bootstrap.godotRuntime.diagnostics.map((diagnostic) => (
                <div className={`runtime-diagnostic ${diagnostic.severity}`} key={diagnostic.id}>
                  <span>{runtimeSeverityLabel(diagnostic.severity)}</span>
                  <p title={diagnostic.action ?? diagnostic.detail}>
                    <strong>{diagnostic.title}</strong>
                    {diagnostic.action ? ` · ${diagnostic.action}` : ` · ${diagnostic.detail}`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {bootstrap ? (
          <section className="runtime-paths">
            <span>数据：{bootstrap.dataRoot}</span>
            <span>模板：{bootstrap.templatesRoot}</span>
            <span>引擎：{bootstrap.godotRuntime.engineRoot}</span>
          </section>
        ) : null}
      </aside>

      {filePreview ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="file-preview-modal">
            <header>
              <div>
                <strong>{filePreview.name}</strong>
                <span title={filePreview.absolutePath}>
                  {filePreview.relativePath} · {formatBytes(filePreview.size)}
                </span>
              </div>
              <button title="关闭预览" onClick={() => setFilePreview(undefined)}>
                <X size={18} />
              </button>
            </header>
            <div className="file-preview-body">
              {filePreview.kind === "image" && filePreview.dataUrl ? (
                <img src={filePreview.dataUrl} alt={filePreview.name} />
              ) : filePreview.kind === "text" ? (
                <CodeEditor
                  value={`${filePreview.content ?? ""}${filePreview.truncated ? "\n\n... 文件过大，已截断预览。" : ""}`}
                  language={codeLanguageForPath(filePreview.relativePath)}
                  readOnly
                  padding={14}
                  minHeight={420}
                  style={{
                    background: "#0f172a",
                    color: "#dbeafe",
                    fontSize: 13,
                    fontFamily: "Consolas, 'SFMono-Regular', monospace"
                  }}
                />
              ) : (
                <div className="binary-preview">
                  <FileJson size={34} />
                  <p>此文件不是文本或图片，无法在应用内预览。</p>
                  {filePreview.truncated ? <span>文件较大，已跳过内容加载。</span> : null}
                  <Button icon={<ExternalLink size={16} />} onClick={() => openPath(filePreview.absolutePath)}>
                    用系统打开
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
