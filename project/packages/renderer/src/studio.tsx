import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Hammer,
  Info,
  Loader2,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  StopCircle,
  Sun,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  chooseAgentCli,
  type AgentMessage,
  type CliTool,
  type CliToolId,
  type EnvironmentToolId,
  type GameDimension,
  type GitFileChange,
  type GitProjectStatus,
  type PreviewEvent,
  type ProjectDetails,
  type ProjectFilePreview,
  type StudioBootstrap,
  type StudioProject,
  type UpdateEvent,
  type UpdateInfo,
  type UpdateStudioDirectorySettingsInput,
} from "@gameaistudio/shared";
import appPackage from "../../../package.json";
import { AgentChat, type AgentSendInput } from "./chat";
import { RunActivityPanel } from "./components/run-activity";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Dialog } from "./components/ui/dialog";
import { Tabs } from "./components/ui/tabs";
import { useTheme } from "./lib/theme";
import { cn } from "./lib/utils";

type BusyAction =
  | "boot"
  | "create"
  | "send"
  | "workflow"
  | "preview"
  | "build"
  | "git"
  | "delete"
  | "cli"
  | "update"
  | "settings"
  | undefined;

type RightTab = "build" | "activity" | "git" | "status";
type AgentCliToolIds = Partial<Record<string, CliToolId>>;

const DEFAULT_WORKFLOW_AGENT_IDS = ["producer", "designer", "programmer", "artist", "qa"];
const APP_VERSION = appPackage.version;

const initialForm = {
  name: "黄金矿工",
  prompt: "我要创建一个黄金矿工，玩家用钩子抓金块，限时得分。",
  dimension: "2d" as GameDimension,
  agentCliToolIds: {} as AgentCliToolIds,
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value?: string): string {
  if (!value) return "未获取";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function updateReleaseNotesText(info?: UpdateInfo): string | undefined {
  if (!info?.configured || !info.latestVersion) return undefined;
  if (info.policy !== "optional" && info.policy !== "required") return undefined;
  return info.releaseNotes?.trim() || "本次更新暂无说明。";
}

function gitChangeLabel(kind: GitFileChange["kind"]): string {
  const labels: Record<GitFileChange["kind"], string> = {
    added: "新增",
    modified: "修改",
    deleted: "删除",
    renamed: "重命名",
    copied: "复制",
    untracked: "未跟踪",
    conflicted: "冲突",
    unknown: "变更",
  };
  return labels[kind];
}

function gitChangeTone(kind: GitFileChange["kind"]): "danger" | "info" | "muted" | "success" | "warning" {
  if (kind === "deleted" || kind === "conflicted") return "danger";
  if (kind === "added" || kind === "untracked") return "success";
  if (kind === "renamed" || kind === "copied") return "info";
  if (kind === "unknown") return "muted";
  return "warning";
}

function gitStatusText(status?: GitProjectStatus): string {
  if (!status) return "未检查";
  if (!status.available) return "Git 缺失";
  if (!status.initialized) return "未启用";
  return status.clean ? "干净" : `${status.changedFiles.length} 变更`;
}

function gitStatusTone(status?: GitProjectStatus): "danger" | "muted" | "success" | "warning" {
  if (!status) return "muted";
  if (!status.available) return "danger";
  if (!status.initialized || !status.clean) return "warning";
  return "success";
}

function healthText(value: boolean | "unknown" | undefined): string {
  if (value === true) return "可用";
  if (value === false) return "异常";
  return "未知";
}

function healthTone(value: boolean | "unknown" | undefined): "danger" | "muted" | "success" {
  if (value === true) return "success";
  if (value === false) return "danger";
  return "muted";
}

function cliToolStatusLabel(tool?: CliTool): string {
  if (!tool?.installed) return "未安装";
  if (tool.status === "available") return "可用";
  return "不可用";
}

function cliToolStatusTone(tool?: CliTool): "danger" | "success" | "warning" {
  if (!tool?.installed) return "danger";
  return tool.status === "available" ? "success" : "warning";
}

function updatePolicyLabel(info?: UpdateInfo): string {
  if (!info) return "未检查";
  if (!info.configured) return "未配置";
  if (info.status === "error") return "检查失败";
  if (info.policy === "required") return "必须更新";
  if (info.policy === "optional") return "可更新";
  return "已是最新";
}

function updatePolicyTone(info?: UpdateInfo): "danger" | "muted" | "success" | "warning" {
  if (!info || !info.configured) return "muted";
  if (info.status === "error") return "danger";
  if (info.policy === "required") return "danger";
  if (info.policy === "optional") return "warning";
  return "success";
}

function footerUpdateBadge(info?: UpdateInfo): { label: string; tone: "danger" | "warning" } | undefined {
  if (info?.policy === "required") return { label: "必须更新", tone: "danger" };
  if (info?.policy === "optional") return { label: "可更新", tone: "warning" };
  return undefined;
}

function isUpdateInstallStatus(status?: UpdateInfo["status"]): boolean {
  return status === "downloading" || status === "installing";
}

function updateReasonText(info?: UpdateInfo): string {
  if (!info) return "尚未检查更新。";
  if (!info.configured) return "暂未配置更新服务。";
  if (info.status === "checking") return "正在从服务器获取更新信息。";
  if (info.status === "downloading") return "正在下载更新安装包。";
  if (info.status === "installing") return "安装器已启动，软件即将退出。";
  if (info.status === "error") return "更新检查失败，请稍后重试；详细原因已记录到应用日志。";
  if (info.policy === "required") {
    if (info.reason === "major") return "发现大版本更新，需要更新后继续使用。";
    if (info.reason === "minor") return "发现小版本更新，需要更新后继续使用。";
    if (info.reason === "unsupported") return "当前版本已不再受支持，需要强制更新。";
    if (info.reason === "force") return "服务器要求当前版本必须更新。";
  }
  if (info.policy === "optional") return "发现迭代版本更新，可手动下载并安装。";
  return "当前已是最新版本。";
}

function updateOperationErrorText(): string {
  return "更新操作失败，请稍后重试；详细原因已记录到应用日志。";
}

function formatBytes(value?: number): string {
  if (!value) return "未知";
  const mb = value / 1024 / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function joinFsPath(rootPath: string | undefined, relativePath: string): string | undefined {
  if (!rootPath) return undefined;
  const sep = rootPath.includes("\\") ? "\\" : "/";
  const root = rootPath.replace(/[\\/]+$/, "");
  const relative = relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, sep);
  return `${root}${sep}${relative}`;
}

export function StudioApp() {
  const { theme, toggleTheme } = useTheme();
  const [bootstrap, setBootstrap] = useState<StudioBootstrap>();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetails>();
  const [activeAgentId, setActiveAgentId] = useState("producer");
  const [selectedCli, setSelectedCli] = useState<CliToolId>("kscc");
  const [busy, setBusy] = useState<BusyAction>("boot");
  const [notice, setNotice] = useState("");
  const [previewNotice, setPreviewNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [rightTab, setRightTab] = useState<RightTab>("build");
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [gitMessage, setGitMessage] = useState("保存当前游戏版本");
  const [gitRestoreHash, setGitRestoreHash] = useState("");
  const [filePreview, setFilePreview] = useState<ProjectFilePreview>();
  const [chatSearch, setChatSearch] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>();
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateInstallLocked, setUpdateInstallLocked] = useState(false);
  const [directorySettingsDraft, setDirectorySettingsDraft] = useState({
    dataRoot: "",
    projectsRoot: "",
  });

  const tools = bootstrap?.cliTools ?? [];
  const agents = bootstrap?.agents ?? AGENT_PROFILES;
  const activeAgent =
    agents.find((a) => a.id === activeAgentId) ?? agents[0]!;
  const hasInstalledCli = tools.some((t) => t.installed);
  const activeTool = tools.find((t) => t.id === selectedCli);
  const activeCliAvailable = Boolean(activeTool?.installed && activeTool.status === "available");
  const activeCliSupportsImages = Boolean(activeTool?.capabilities.supportsImages);
  const activeCliUnavailableReason =
    activeTool?.installed && activeTool.status !== "available"
      ? activeTool.health.detail ?? `${activeTool.label} 当前不可用。`
      : undefined;
  const isBusy = Boolean(busy);
  const currentUpdateInfo = updateInfo ?? bootstrap?.update;
  const currentDirectorySettings = bootstrap?.directorySettings;
  const directorySetupRequired = Boolean(currentDirectorySettings?.setupRequired);
  const visibleUpdateNotes = updateReleaseNotesText(currentUpdateInfo);
  const footerUpdate = footerUpdateBadge(currentUpdateInfo);
  const updateDialogLocked = updateInstallLocked || isUpdateInstallStatus(currentUpdateInfo?.status);
  const updateRequired = currentUpdateInfo?.policy === "required";
  const workflowAgents = useMemo(
    () =>
      DEFAULT_WORKFLOW_AGENT_IDS.map((id) => agents.find((agent) => agent.id === id)).filter(
        (agent): agent is (typeof agents)[number] => Boolean(agent),
      ),
    [agents],
  );
  const createAgentCliToolIds = useMemo(
    () =>
      Object.fromEntries(
        workflowAgents.map((agent) => [
          agent.id,
          form.agentCliToolIds[agent.id] ?? chooseAgentCli(agent, tools),
        ]),
      ) as AgentCliToolIds,
    [form.agentCliToolIds, tools, workflowAgents],
  );
  const createCliIssues = workflowAgents.filter((agent) => {
    const toolId = createAgentCliToolIds[agent.id];
    const tool = tools.find((candidate) => candidate.id === toolId);
    return !tool?.installed || tool.status !== "available";
  });
  const createProjectDisabled = isBusy || updateRequired || !form.prompt.trim() || createCliIssues.length > 0;
  const createProjectTitle = updateRequired
    ? "发现必须更新版本，请先在关于弹窗中完成更新。"
    : !form.prompt.trim()
    ? "请输入一句话需求。"
    : createCliIssues.length > 0
      ? `请先修复这些 Agent 的 CLI：${createCliIssues.map((agent) => agent.title).join("、")}`
      : "创建项目后立即启动团队工作流。";

  const threadMessages = useMemo(
    () =>
      (selectedProject?.messages ?? []).filter(
        (m) => m.agentId === activeAgentId || m.role === "system",
      ),
    [selectedProject, activeAgentId],
  );
  // History search filters the visible thread; an empty query shows it all.
  const activeMessages = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) return threadMessages;
    return threadMessages.filter((m) => m.content.toLowerCase().includes(query));
  }, [threadMessages, chatSearch]);

  const activeRun = useMemo(
    () =>
      (selectedProject?.runs ?? []).find(
        (r) => r.status === "running" || r.status === "queued",
      ),
    [selectedProject?.runs],
  );
  const activeStep = activeRun
    ? (activeRun.steps.find((s) => s.id === activeRun.currentStepId) ??
      activeRun.steps.find((s) => s.status === "running"))
    : undefined;
  const activeStepIndex = activeRun && activeStep
    ? activeRun.steps.findIndex((s) => s.id === activeStep.id)
    : -1;

  // Surface live activity automatically: when a run starts, reveal the right
  // panel and focus the 运行 tab so the user can watch every Agent's status
  // and streamed output without hunting for it.
  useEffect(() => {
    if (!activeRun) return;
    setRightCollapsed(false);
    setRightTab("activity");
  }, [activeRun?.id]);

  const previewFrameKey = selectedProject?.previewUrl
    ? `${selectedProject.id}:${selectedProject.previewUrl}:${selectedProject.previewUpdatedAt ?? "x"}`
    : "none";

  async function loadBootstrap(selectId?: string) {
    setBusy("boot");
    try {
      const data = await window.studio.bootstrap();
      setBootstrap(data);
      setUpdateInfo(data.update);
      setDirectorySettingsDraft({
        dataRoot: data.directorySettings.dataRoot ?? "",
        projectsRoot: data.directorySettings.projectsRoot ?? "",
      });
      setProjects(data.projects);
      if (data.directorySettings.setupRequired) {
        setSettingsOpen(true);
        setNotice("首次使用请确认软件数据目录和游戏项目目录，或使用默认设置。");
      }
      if (data.update.configured) {
        void window.studio
          .checkForUpdates()
          .then((info) => {
            setUpdateInfo(info);
            setBootstrap((cur) => (cur ? { ...cur, update: info } : cur));
            setUpdateMessage(updateReasonText(info));
            if (info.policy === "required") {
              setAboutOpen(true);
              setNotice("发现必须更新版本，请先完成软件更新。");
            }
          })
          .catch(() => setUpdateMessage(updateOperationErrorText()));
      }
      const target =
        selectId ?? selectedProject?.id ?? data.projects[0]?.id;
      if (target) {
        const detail = await window.studio.getProject(target);
        const nextAgents = data.agents ?? AGENT_PROFILES;
        const nextAgent =
          nextAgents.find((a) => a.id === detail.activeAgentId) ?? nextAgents[0]!;
        setSelectedProject(detail);
        setActiveAgentId(detail.activeAgentId);
        setSelectedCli(chooseAgentCli(nextAgent, data.cliTools, detail.agentCliToolIds?.[nextAgent.id]));
      }
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  useEffect(() => {
    void loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return window.studio.onRunEvent((event) => {
      setSelectedProject((cur) => {
        if (!cur || cur.id !== event.run.projectId) return cur;
        const runs = [
          event.run,
          ...(cur.runs ?? []).filter((r) => r.id !== event.run.id),
        ];
        return { ...cur, runs };
      });
    });
  }, []);

  useEffect(() => {
    return window.studio.onPreviewEvent((event: PreviewEvent) => {
      setSelectedProject((cur) => {
        if (!cur || cur.id !== event.projectId) return cur;
        return {
          ...cur,
          previewUrl: event.url ?? cur.previewUrl,
          previewWatching: event.status !== "stopped",
          previewStatus: event.status,
          previewUpdatedAt: event.updatedAt,
        };
      });
      setPreviewNotice(event.message ?? "");
    });
  }, []);

  useEffect(() => {
    return window.studio.onUpdateEvent((event: UpdateEvent) => {
      if (event.info) {
        setUpdateInfo(event.info);
        setBootstrap((cur) => (cur ? { ...cur, update: event.info! } : cur));
      }
      if (isUpdateInstallStatus(event.status)) {
        setUpdateInstallLocked(true);
      } else if (event.status === "error" || event.status === "available" || event.status === "idle" || event.status === "not-configured") {
        setUpdateInstallLocked(false);
      }
      const progress =
        event.percent !== undefined
          ? ` · ${event.percent}%`
          : event.receivedBytes
            ? ` · ${formatBytes(event.receivedBytes)}`
            : "";
      setUpdateMessage(`${event.message}${progress}`);
    });
  }, []);

  // Live token stream: accumulate deltas into an in-flight assistant message so
  // the chat bubble types. `runAgentTurn`'s canonical messages replace it on
  // settle (same id → no flicker). `done` is a no-op; the resolve handles it.
  useEffect(() => {
    return window.studio.onAgentStream((event) => {
      if (event.done) return;
      setSelectedProject((cur) => {
        if (!cur || cur.id !== event.projectId) return cur;
        const messages = cur.messages.slice();
        const idx = messages.findIndex((m) => m.id === event.messageId);
        if (idx === -1) {
          messages.push({
            id: event.messageId,
            projectId: event.projectId,
            agentId: event.agentId,
            role: "agent",
            content: event.delta,
            createdAt: new Date().toISOString(),
            cliToolId: event.cliToolId,
          });
        } else {
          messages[idx] = {
            ...messages[idx]!,
            content: messages[idx]!.content + event.delta,
          };
        }
        return { ...cur, messages };
      });
    });
  }, []);

  async function selectProject(id: string) {
    setBusy("boot");
    try {
      const detail = await window.studio.getProject(id);
      const nextAgent =
        agents.find((a) => a.id === detail.activeAgentId) ?? agents[0]!;
      setSelectedProject(detail);
      setActiveAgentId(detail.activeAgentId);
      setSelectedCli(chooseAgentCli(nextAgent, tools, detail.agentCliToolIds?.[nextAgent.id]));
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  function switchActiveAgent(agentId: string) {
    const nextAgent = agents.find((agent) => agent.id === agentId) ?? agents[0]!;
    setActiveAgentId(agentId);
    setSelectedCli(chooseAgentCli(nextAgent, tools, selectedProject?.agentCliToolIds?.[nextAgent.id]));
  }

  function ensureUpdateAllowsWork(): boolean {
    if (!updateRequired) return true;
    setAboutOpen(true);
    setNotice("发现必须更新版本，请先完成软件更新。");
    return false;
  }

  async function startStudioWorkflow(project: ProjectDetails, message: string, agentCliToolIds?: AgentCliToolIds) {
    if (!ensureUpdateAllowsWork()) return;
    const result = await window.studio.runStudioWorkflow({
      projectId: project.id,
      message,
      agentIds: workflowAgents.map((agent) => agent.id),
      agentCliToolIds: agentCliToolIds ?? project.agentCliToolIds,
      autoExportWeb: true,
      autoPackageWebZip: true,
      autoStartPreview: true,
      withQualityLoop: true,
    });
    setSelectedProject(result.project);
    setProjects(await window.studio.listProjects());
    setNotice(result.run.summary ?? "团队工作流结束。");
  }

  async function createProject() {
    if (!ensureUpdateAllowsWork()) return;
    if (createProjectDisabled) {
      setNotice(createProjectTitle);
      return;
    }
    setBusy("create");
    setNotice("");
    const agentCliToolIds = createAgentCliToolIds;
    try {
      const project = await window.studio.createProject({
        ...form,
        agentCliToolIds,
      });
      setSelectedProject(project);
      setProjects(await window.studio.listProjects());
      setActiveAgentId(project.activeAgentId);
      const producer = agents.find((agent) => agent.id === project.activeAgentId) ?? agents[0]!;
      setSelectedCli(chooseAgentCli(producer, tools, agentCliToolIds[producer.id]));
      setCreateOpen(false);
      setRightCollapsed(false);
      setRightTab("activity");
      setNotice(`已创建项目：${project.name}，正在启动团队工作流。`);
      setBusy("workflow");
      await startStudioWorkflow(project, project.prompt, agentCliToolIds);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  // Core chat→turn runner. handleAgentSend / quick actions / regenerate all
  // funnel through here so optimistic UI and result folding stay identical.
  async function runTurnFromChat(input: {
    agentId: string;
    cliToolId: CliToolId;
    text: string;
    attachments: AgentSendInput["attachments"];
    regenerate?: boolean;
  }) {
    if (!selectedProject) return;
    if (!ensureUpdateAllowsWork()) return;
    const projectId = selectedProject.id;
    setBusy("send");
    setNotice("");

    // Optimistically show the user's message immediately (the canonical
    // messages from runAgentTurn replace it on completion). Regenerate re-runs
    // an existing user message, so it adds no new bubble.
    if (!input.regenerate) {
      const optimistic: AgentMessage = {
        id: `optimistic-${Date.now()}`,
        projectId,
        agentId: input.agentId,
        role: "user",
        content: input.text.trim(),
        createdAt: new Date().toISOString(),
      };
      setSelectedProject((cur) =>
        cur && cur.id === projectId
          ? { ...cur, messages: [...cur.messages, optimistic] }
          : cur,
      );
    }

    try {
      const result = await window.studio.runAgentTurn({
        projectId,
        agentId: input.agentId,
        cliToolId: input.cliToolId,
        message: input.text.trim(),
        autoStartPreview: true,
        attachments: input.attachments,
        regenerate: input.regenerate,
      });
      setSelectedProject({
        ...result.project,
        messages: result.messages,
        runs: result.runs,
      });
      setProjects(await window.studio.listProjects());
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  const handleAgentSend = async ({ text, attachments }: AgentSendInput) => {
    if (!selectedProject || (!text.trim() && attachments.length === 0)) return;
    if (!activeCliAvailable) {
      setNotice(activeCliUnavailableReason ?? "当前 CLI 不可用，请在设置中修复后刷新。");
      return;
    }
    if (attachments.length > 0 && !activeCliSupportsImages) {
      setNotice("当前 CLI 不支持图片输入，请移除图片或切换到支持图片的 CLI。");
      return;
    }
    await runTurnFromChat({
      agentId: activeAgentId,
      cliToolId: selectedCli,
      text,
      attachments,
    });
  };

  /** Quick-action helper: route a preset request to a specific Agent. */
  async function sendToAgent(agentId: string, text: string) {
    if (!selectedProject || isBusy) return;
    const agent = agents.find((a) => a.id === agentId) ?? agents[0]!;
    const cli = chooseAgentCli(agent, tools, selectedProject.agentCliToolIds?.[agentId]);
    setActiveAgentId(agentId);
    setSelectedCli(cli);
    await runTurnFromChat({ agentId, cliToolId: cli, text, attachments: [] });
  }

  /** 重新生成: re-run the latest user message of the active thread. */
  async function regenerateLastReply() {
    if (!selectedProject || isBusy) return;
    const lastUser = [...(selectedProject.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user" && m.agentId === activeAgentId);
    if (!lastUser) {
      setNotice("当前会话还没有可重新生成的用户消息。");
      return;
    }
    if (!activeCliAvailable) {
      setNotice(activeCliUnavailableReason ?? "当前 CLI 不可用，请在设置中修复后刷新。");
      return;
    }
    await runTurnFromChat({
      agentId: activeAgentId,
      cliToolId: selectedCli,
      text: lastUser.content,
      attachments: [],
      regenerate: true,
    });
  }

  async function deleteChatMessage(messageId: string) {
    if (!selectedProject) return;
    try {
      const messages = await window.studio.deleteProjectMessage({
        projectId: selectedProject.id,
        messageId,
      });
      setSelectedProject((cur) =>
        cur && cur.id === selectedProject.id ? { ...cur, messages } : cur,
      );
    } catch (e) {
      setNotice(errText(e));
    }
  }

  async function clearActiveThread() {
    if (!selectedProject) return;
    const count = (selectedProject.messages ?? []).filter(
      (m) => m.agentId === activeAgentId,
    ).length;
    if (count === 0) {
      setNotice("当前会话没有可清空的消息。");
      return;
    }
    if (
      !window.confirm(
        `清空「${activeAgent.title}」的当前会话？\n\n共 ${count} 条消息将被删除，此操作不可撤销。`,
      )
    ) {
      return;
    }
    try {
      const messages = await window.studio.clearProjectMessages({
        projectId: selectedProject.id,
        agentId: activeAgentId,
      });
      setSelectedProject((cur) =>
        cur && cur.id === selectedProject.id ? { ...cur, messages } : cur,
      );
      setNotice(`已清空 ${activeAgent.title} 的会话。`);
    } catch (e) {
      setNotice(errText(e));
    }
  }

  async function exportChatHistory() {
    if (!selectedProject) return;
    setBusy("git");
    try {
      const result = await window.studio.exportProjectChat(selectedProject.id);
      setNotice(`聊天记录已导出（${result.messageCount} 条）：${result.path}`);
      await openPath(result.path);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  /** File chips in chat bubbles: project-relative → preview; outside → OS open. */
  function openMentionedFile(path: string) {
    if (!selectedProject) return;
    const forward = path.replace(/\\/g, "/");
    const root = selectedProject.rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (forward.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      void previewProjectFile(forward.slice(root.length + 1));
      return;
    }
    if (/^[A-Za-z]:\//.test(forward) || forward.startsWith("/")) {
      void openPath(path);
      return;
    }
    void previewProjectFile(forward);
  }

  async function cancelActiveRun() {
    const run = (selectedProject?.runs ?? []).find(
      (r) => r.status === "running" || r.status === "queued",
    );
    if (!run) return;
    try {
      const cancelled = await window.studio.cancelRun(run.id);
      setSelectedProject((cur) =>
        cur
          ? {
              ...cur,
              runs: [
                cancelled,
                ...(cur.runs ?? []).filter((r) => r.id !== cancelled.id),
              ],
            }
          : cur,
      );
    } catch (e) {
      setNotice(errText(e));
    }
  }

  async function runWorkflow() {
    if (!selectedProject) return;
    setBusy("workflow");
    try {
      await startStudioWorkflow(selectedProject, selectedProject.prompt);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function togglePreview() {
    if (!selectedProject) return;
    setBusy("preview");
    try {
      if (selectedProject.previewWatching) {
        const event = await window.studio.stopAutoPreview(selectedProject.id);
        setPreviewNotice(event.message ?? "已停止预览。");
      } else {
        const preview = await window.studio.startAutoPreview(
          selectedProject.id,
        );
        setSelectedProject({
          ...selectedProject,
          previewUrl: preview.url,
          previewWatching: true,
          previewStatus: "watching",
        });
        setPreviewNotice(`实时预览已启动：${preview.url}`);
      }
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function buildAction(kind: "validate" | "export" | "zip") {
    if (!selectedProject) return;
    if (
      kind === "zip" &&
      !window.confirm(
        `导出 Web 发布包（zip）？\n\n会重新执行 Godot Web 导出并打包 build/web。\n项目：${selectedProject.name}`,
      )
    ) {
      return;
    }
    setBusy("build");
    try {
      if (kind === "validate") {
        const r = await window.studio.validateProject(selectedProject.id);
        setNotice(r.ok ? "Godot 校验通过。" : r.stderr || "校验失败。");
      } else if (kind === "export") {
        const r = await window.studio.runGodotExport(selectedProject.id);
        setNotice(r.ok ? "Web 导出完成。" : r.stderr || "导出失败。");
      } else {
        const r = await window.studio.exportWeb(selectedProject.id);
        setSelectedProject(r.project);
        setNotice(
          r.ok && r.zipPath ? `Web zip 已导出：${r.zipPath}` : r.error ?? "失败。",
        );
      }
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function commitGit() {
    if (!selectedProject) return;
    setBusy("git");
    try {
      const r = await window.studio.commitProjectGit({
        projectId: selectedProject.id,
        message: gitMessage.trim() || "保存当前版本",
      });
      setSelectedProject(r.project);
      setNotice(r.message);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshGitStatus() {
    if (!selectedProject) return;
    setBusy("git");
    try {
      const gitStatus = await window.studio.getProjectGitStatus(selectedProject.id);
      setSelectedProject((cur) =>
        cur && cur.id === selectedProject.id ? { ...cur, gitStatus } : cur,
      );
      setNotice(gitStatus.message);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function restoreGitCommit(commitHash: string, label: string) {
    if (!selectedProject) return;
    const target = commitHash.trim();
    if (!target) {
      setNotice("请输入要还原的 Git 提交 hash。");
      return;
    }
    const dirtyHint =
      selectedProject.gitStatus && !selectedProject.gitStatus.clean
        ? `\n\n当前有 ${selectedProject.gitStatus.changedFiles.length} 个未提交变更，还原会覆盖这些本地改动。`
        : "";
    if (
      !window.confirm(
        `还原到 Git 版本 ${label}？${dirtyHint}\n\n项目目录：${selectedProject.rootPath}`,
      )
    ) {
      return;
    }
    setBusy("git");
    try {
      const result = await window.studio.restoreProjectGit({
        projectId: selectedProject.id,
        commitHash: target,
      });
      setSelectedProject(result.project);
      setGitRestoreHash("");
      setNotice(result.message);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function deleteProject() {
    if (!selectedProject) return;
    if (
      !window.confirm(
        `删除项目「${selectedProject.name}」？\n\n此操作会将本地游戏目录一起删除：\n${selectedProject.rootPath}\n\n此操作不可撤销。`,
      )
    )
      return;
    setBusy("delete");
    try {
      const r = await window.studio.deleteProject(selectedProject.id);
      setProjects(r.projects);
      setSelectedProject(r.selectedProject);
      setNotice(`已删除：${r.deletedRootPath}`);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function openPath(p?: string) {
    if (p) await window.studio.openPath(p).catch((e) => setNotice(errText(e)));
  }

  async function previewProjectFile(relativePath: string) {
    if (!selectedProject) return;
    setBusy("git");
    try {
      const preview = await window.studio.readProjectFile({
        projectId: selectedProject.id,
        relativePath,
      });
      setFilePreview(preview);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function previewCurrentProjectLog() {
    if (!selectedProject) return;
    setBusy("git");
    try {
      const preview = await window.studio.readProjectLog(selectedProject.id);
      setFilePreview(preview);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function chooseStudioDirectory(kind: "data" | "projects") {
    const current =
      kind === "data"
        ? directorySettingsDraft.dataRoot || currentDirectorySettings?.defaultDataRoot
        : directorySettingsDraft.projectsRoot || currentDirectorySettings?.defaultProjectsRoot;
    try {
      const directory = await window.studio.selectDirectory({
        title: kind === "data" ? "选择软件数据目录" : "选择游戏项目目录",
        defaultPath: current,
      });
      if (!directory) return;
      setDirectorySettingsDraft((draft) =>
        kind === "data" ? { ...draft, dataRoot: directory } : { ...draft, projectsRoot: directory },
      );
    } catch (e) {
      setNotice(errText(e));
    }
  }

  async function saveDirectorySettings(input?: UpdateStudioDirectorySettingsInput) {
    setBusy("settings");
    try {
      const payload =
        input ??
        ({
          dataRoot: directorySettingsDraft.dataRoot.trim() || undefined,
          projectsRoot: directorySettingsDraft.projectsRoot.trim() || undefined,
          setupCompleted: true,
        } satisfies UpdateStudioDirectorySettingsInput);
      const directorySettings = await window.studio.updateDirectorySettings(payload);
      setBootstrap((cur) =>
        cur
          ? {
              ...cur,
              directorySettings,
            }
          : cur,
      );
      setDirectorySettingsDraft({
        dataRoot: directorySettings.dataRoot ?? "",
        projectsRoot: directorySettings.projectsRoot ?? "",
      });
      if (directorySettings.requiresRestart) {
        const runningHint = activeRun ? "\n\n注意：当前有任务正在运行，重启会中断它。" : "";
        if (window.confirm(`目录设置已保存。需要重启软件才能应用新目录，现在重启吗？${runningHint}`)) {
          setNotice("正在重启软件以应用新目录。");
          await window.studio.restartApp();
          return;
        }
        setNotice("目录设置已保存，下次启动软件时生效。");
        return;
      }
      setSettingsOpen(false);
      setNotice("目录设置已保存。");
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function installCli(id: CliToolId) {
    setBusy("cli");
    setNotice(`正在安装 ${CLI_TOOL_LABELS[id]}…`);
    try {
      const r = await window.studio.installCliTool(id);
      const cliTools = await window.studio.refreshCliTools();
      setBootstrap((cur) => (cur ? { ...cur, cliTools } : cur));
      setNotice(r.ok ? `${CLI_TOOL_LABELS[id]} 安装完成。` : r.stderr || "安装失败。");
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  // One-click base dependency install (git / Node.js via winget). After it
  // succeeds the main process refreshes its PATH, so a re-scan finds the tool
  // without restarting the app.
  async function installEnvironmentTool(id: EnvironmentToolId) {
    setBusy("cli");
    setNotice(`正在安装 ${id === "git" ? "Git" : "Node.js"}…（winget，可能需要几分钟）`);
    try {
      const r = await window.studio.installEnvironmentTool(id);
      if (r.ok) {
        const [environment, cliTools] = await Promise.all([
          window.studio.refreshEnvironment(),
          window.studio.refreshCliTools(),
        ]);
        setBootstrap((cur) => (cur ? { ...cur, environment, cliTools } : cur));
        setNotice(`${id === "git" ? "Git" : "Node.js"} 安装完成，已自动刷新检测。`);
      } else {
        setNotice(r.stderr || "安装失败。");
      }
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function installAcp(id: CliToolId) {
    setBusy("cli");
    setNotice(`正在为 ${CLI_TOOL_LABELS[id]} 安装 ACP 适配器…`);
    try {
      const r = await window.studio.installCliAcp(id);
      const cliTools = await window.studio.refreshCliTools();
      setBootstrap((cur) => (cur ? { ...cur, cliTools } : cur));
      setNotice(
        r.ok
          ? `${CLI_TOOL_LABELS[id]} 的 ACP 模式已启用，下个回合自动生效。`
          : r.stderr || "ACP 适配器安装失败。",
      );
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  // Explicit headless probe (a real model call) — surfaces login/401 issues
  // that the fast discovery check cannot.
  async function testCli(id: CliToolId) {
    setBusy("cli");
    setNotice(`正在测试 ${CLI_TOOL_LABELS[id]} 非交互连接…`);
    try {
      const tool = await window.studio.testCliTool(id);
      setBootstrap((cur) =>
        cur
          ? {
              ...cur,
              cliTools: cur.cliTools.map((t) => (t.id === id ? tool : t)),
            }
          : cur,
      );
      setNotice(
        tool.health.headlessOk === true
          ? `${CLI_TOOL_LABELS[id]} 非交互可用。`
          : (tool.health.detail ?? `${CLI_TOOL_LABELS[id]} 非交互检查未通过。`),
      );
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function checkForUpdates() {
    setBusy("update");
    setUpdateMessage("正在检查更新…");
    try {
      const info = await window.studio.checkForUpdates();
      setUpdateInfo(info);
      setBootstrap((cur) => (cur ? { ...cur, update: info } : cur));
      setUpdateMessage(updateReasonText(info));
      setNotice(
        info.policy === "none"
          ? "当前已是最新版本。"
          : `发现 ${info.latestVersion ? `v${info.latestVersion}` : "新版本"}：${updatePolicyLabel(info)}。`,
      );
    } catch {
      const message = updateOperationErrorText();
      setUpdateMessage(message);
      setNotice(message);
    } finally {
      setBusy(undefined);
    }
  }

  async function downloadAndInstallUpdate() {
    const info = currentUpdateInfo;
    if (!info || info.policy === "none") return;
    if (
      info.policy === "optional" &&
      !window.confirm(`确认下载并安装 GameAI Studio v${info.latestVersion ?? ""}？安装过程中软件会重启。`)
    ) {
      return;
    }
    setBusy("update");
    setUpdateInstallLocked(true);
    setUpdateMessage("准备下载更新…");
    try {
      const result = await window.studio.downloadAndInstallUpdate();
      setUpdateInfo(result.info);
      setBootstrap((cur) => (cur ? { ...cur, update: result.info } : cur));
      setNotice(result.message);
      setUpdateMessage(result.message);
    } catch {
      const message = updateOperationErrorText();
      setUpdateInstallLocked(false);
      setUpdateMessage(message);
      setNotice(message);
    } finally {
      setBusy(undefined);
    }
  }

  // Persist a per-Agent CLI choice on the project (used by the team workflow
  // and as the default when switching to that Agent's tab).
  async function updateAgentCli(agentId: string, cliToolId: CliToolId) {
    if (!selectedProject) return;
    setBusy("cli");
    try {
      const detail = await window.studio.updateProjectAgentClis({
        projectId: selectedProject.id,
        agentCliToolIds: { [agentId]: cliToolId },
      });
      setSelectedProject(detail);
      if (agentId === activeAgentId) setSelectedCli(cliToolId);
      const agent = agents.find((a) => a.id === agentId);
      setNotice(`${agent?.title ?? agentId} 现在使用 ${CLI_TOOL_LABELS[cliToolId]}。`);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  const git = selectedProject?.gitStatus;
  const gitChanges: GitFileChange[] =
    git?.changes ??
    git?.changedFiles.map((file) => ({
      path: file,
      kind: "unknown" as const,
      rawStatus: "",
    })) ??
    [];
  const gitCommitDisabled =
    isBusy ||
    !selectedProject ||
    !git?.available ||
    (git.initialized && git.clean);
  const gitCommitTitle = !git?.available
    ? git?.message ?? "未检测到 Git。"
    : git.initialized && git.clean
      ? "当前 Git 工作区没有未提交变更。"
      : git.initialized
        ? "提交当前 Git 变更。"
        : "为此项目启用 Git 版本管理并提交当前状态。";
  const appMaintenanceLogPath = currentDirectorySettings?.appLogPath ?? joinFsPath(bootstrap?.dataRoot, "logs/app.log");
  const projectMaintenanceLogPath = selectedProject?.projectLogPath;
  const projectPreviewButtons = [
    {
      label: "项目说明",
      title: "预览 GAMEAISTUDIO.md",
      run: () => previewProjectFile("GAMEAISTUDIO.md"),
      icon: <FileText />,
    },
    {
      label: "Agent 上下文",
      title: "预览 .gameaistudio/agent-context.md",
      run: () => previewProjectFile(".gameaistudio/agent-context.md"),
      icon: <FileText />,
    },
    {
      label: "Agent 日志",
      title: "预览 .gameaistudio/agent-journal.md",
      run: () => previewProjectFile(".gameaistudio/agent-journal.md"),
      icon: <Terminal />,
    },
    {
      label: "项目日志",
      title: "预览项目维护日志",
      run: () => previewCurrentProjectLog(),
      icon: <Terminal />,
    },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* ── LEFT: projects ─────────────────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Gamepad2 className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">GameAIStudio</div>
            <div className="truncate text-xs text-muted-foreground">
              Godot AI 创作台
            </div>
          </div>
        </div>

        <div className="px-3">
          <Button
            className="w-full"
            onClick={() => setCreateOpen(true)}
            disabled={isBusy}
          >
            <Plus /> 新建游戏
          </Button>
        </div>

        <div className="mt-3 flex-1 space-y-1 overflow-y-auto px-2">
          {projects.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">还没有项目</p>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProject(p.id)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                selectedProject?.id === p.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
              )}
            >
              <span className="truncate text-sm">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.dimension.toUpperCase()} · {formatTime(p.updatedAt)}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-1 border-t border-border p-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings /> 设置
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              title="切换主题"
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => setAboutOpen(true)}
            >
              <Info /> 关于
            </Button>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              onClick={() => setAboutOpen(true)}
              title={footerUpdate ? `${footerUpdate.label}，点击查看软件更新` : `当前版本 v${APP_VERSION}`}
            >
              <span>v{APP_VERSION}</span>
              {footerUpdate && (
                <Badge tone={footerUpdate.tone} className="px-1.5 py-0 text-[10px] leading-4">
                  {footerUpdate.label}
                </Badge>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* ── CENTER: role tabs + chat ───────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-sm font-semibold">
              {selectedProject?.name ?? "等待创建"}
            </h1>
            {selectedProject && (
              <Badge tone="outline">
                {selectedProject.dimension.toUpperCase()}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <select
              value={selectedCli}
              onChange={(e) => setSelectedCli(e.target.value as CliToolId)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              title="当前对话使用的本地 CLI"
            >
              {Object.entries(CLI_TOOL_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {activeTool?.acp?.available && (
              <Badge
                tone="success"
                title="本回合将以 ACP 模式运行：原生流式、工具调用可见、按操作权限审计、会话复用。"
              >
                ACP
              </Badge>
            )}
            {selectedProject && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  title="打开目录"
                  onClick={() => openPath(selectedProject.rootPath)}
                >
                  <FolderOpen />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="浏览器打开预览"
                  onClick={() =>
                    selectedProject.previewUrl &&
                    window.open(selectedProject.previewUrl)
                  }
                >
                  <ExternalLink />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={rightCollapsed ? "展开预览栏" : "收起预览栏"}
                  onClick={() => setRightCollapsed((v) => !v)}
                >
                  {rightCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
                </Button>
              </>
            )}
          </div>
        </header>

        {selectedProject && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <Tabs
              size="sm"
              value={activeAgentId}
              onValueChange={switchActiveAgent}
              tabs={agents.map((a) => ({
                value: a.id,
                accent: a.accent,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Bot className="size-3.5" />
                    {a.title}
                  </span>
                ),
              }))}
            />
            <div className="ml-auto flex items-center gap-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  placeholder="搜索历史消息"
                  className="h-7 w-40 rounded-md border border-border bg-background pl-7 pr-6 text-xs"
                />
                {chatSearch && (
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setChatSearch("")}
                    title="清除搜索"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="清空当前会话（需确认）"
                onClick={clearActiveThread}
                disabled={isBusy}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {selectedProject && chatSearch.trim() && (
          <div className="border-b border-border bg-muted/30 px-4 py-1 text-[11px] text-muted-foreground">
            搜索「{chatSearch.trim()}」：{activeMessages.length} 条匹配（共 {threadMessages.length} 条）
          </div>
        )}

        {selectedProject && !activeRun && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-1.5">
            {[
              { label: "继续制作", title: "再跑一轮团队工作流", run: () => void runWorkflow() },
              { label: "修复错误", title: "让程序 Agent 修复报错与导出问题", run: () => void sendToAgent("programmer", "请检查当前项目的报错、Web 导出失败和明显缺陷，并直接修复。") },
              { label: "QA 测试", title: "让 QA Agent 验证当前版本", run: () => void sendToAgent("qa", "请对当前版本做一轮 QA：验证核心玩法是否可玩、Web 导出是否正常，列出缺陷和修复建议。") },
              { label: "美术优化", title: "让美术 Agent 优化画面", run: () => void sendToAgent("artist", "请优化当前游戏的视觉表现：配色、UI 可读性和角色/场景素材，给出可直接落地的改动。") },
              { label: "运行预览", title: "启动 / 打开 Web 实时预览", run: () => (selectedProject.previewWatching && selectedProject.previewUrl ? window.open(selectedProject.previewUrl) : void togglePreview()) },
              { label: "导出 Web", title: "导出 Web zip", run: () => void buildAction("zip") },
              { label: "保存版本", title: "提交当前 Git 变更", run: () => void commitGit() },
              { label: "查看日志", title: "预览项目日志", run: () => void previewProjectFile(".gameaistudio/logs/project.log") },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                title={action.title}
                onClick={action.run}
                disabled={isBusy}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {activeRun && (
          <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            <button
              className="min-w-0 flex-1 truncate text-left hover:underline"
              title="查看实时运行日志"
              onClick={() => {
                setRightCollapsed(false);
                setRightTab("activity");
              }}
            >
              {activeStepIndex >= 0 && (
                <span className="mr-1 rounded bg-primary/15 px-1 font-medium text-primary">
                  {activeStepIndex + 1}/{activeRun.steps.length}
                </span>
              )}
              <span className="text-foreground">{activeRun.title}</span>
              {activeStep ? ` · ${activeStep.title}` : ""}
            </button>
            <button
              className="shrink-0 text-destructive hover:underline"
              onClick={cancelActiveRun}
            >
              取消
            </button>
          </div>
        )}

        {selectedProject && !activeRun && !activeCliAvailable && (
          <div className="flex items-center gap-2 border-b border-border bg-danger/10 px-4 py-1.5 text-xs text-danger">
            <span className="min-w-0 flex-1 truncate">
              {!hasInstalledCli
                ? "未检测到任何本地 AI CLI，发送已禁用。请在设置中安装。"
                : `当前 CLI「${activeTool?.label ?? selectedCli}」不可用：${activeCliUnavailableReason ?? "请在设置中测试连接。"}`}
            </span>
            <button
              className="shrink-0 font-medium hover:underline"
              onClick={() => setSettingsOpen(true)}
            >
              打开设置
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {selectedProject ? (
            <AgentChat
              key={`${selectedProject.id}:${activeAgentId}`}
              messages={activeMessages}
              isRunning={busy === "send" || busy === "workflow"}
              isSendDisabled={!hasInstalledCli || !activeCliAvailable}
              supportsImages={activeCliSupportsImages}
              projectRoot={selectedProject.rootPath}
              onSend={handleAgentSend}
              onDeleteMessage={(messageId) => void deleteChatMessage(messageId)}
              onRegenerate={() => void regenerateLastReply()}
              onOpenFile={openMentionedFile}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Gamepad2 className="size-12" />
              <h3 className="text-base font-medium text-foreground">
                创建第一个 Godot 游戏
              </h3>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> 新建游戏
              </Button>
            </div>
          )}
        </div>

        {notice && (
          <div className="flex items-start gap-2 border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 break-words">{notice}</span>
            <button
              className="shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground"
              onClick={() => setNotice("")}
              title="关闭"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </main>

      {/* ── RIGHT: preview + build/git/status ──────────────────────── */}
      {selectedProject && !rightCollapsed && (
        <aside className="flex w-[26rem] shrink-0 flex-col border-l border-border bg-card/30">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <Play className="size-4" /> Web 实时预览
            </span>
            <Button
              size="sm"
              variant={selectedProject.previewWatching ? "secondary" : "default"}
              onClick={togglePreview}
              disabled={isBusy}
            >
              {busy === "preview" ? (
                <Loader2 className="animate-spin" />
              ) : selectedProject.previewWatching ? (
                <StopCircle />
              ) : (
                <Play />
              )}
              {selectedProject.previewWatching ? "停止" : "启动"}
            </Button>
          </div>

          <div className="aspect-video w-full shrink-0 border-b border-border bg-black/80">
            {selectedProject.previewUrl ? (
              <iframe
                key={previewFrameKey}
                src={selectedProject.previewUrl}
                title="Godot Web Preview"
                className="size-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Play className="size-10" />
              </div>
            )}
          </div>
          {previewNotice && (
            <p className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
              {previewNotice}
            </p>
          )}

          <div className="px-4 py-2">
            <Tabs
              size="sm"
              value={rightTab}
              onValueChange={(v) => setRightTab(v as RightTab)}
              tabs={[
                { value: "build", label: "构建" },
                { value: "activity", label: "运行" },
                { value: "git", label: "Git" },
                { value: "status", label: "状态" },
              ]}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {rightTab === "build" && (
              <>
                <Button
                  className="w-full"
                  onClick={runWorkflow}
                  disabled={isBusy || !hasInstalledCli}
                >
                  {busy === "workflow" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Bot />
                  )}
                  团队工作流
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => buildAction("validate")}
                  disabled={isBusy}
                >
                  <CheckCircle2 /> Godot 校验
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => buildAction("export")}
                  disabled={isBusy}
                >
                  <Hammer /> Web 导出
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => buildAction("zip")}
                  disabled={isBusy}
                >
                  <Download /> 导出 zip
                </Button>
                {selectedProject.exportZipPath && (
                  <div className="rounded-lg border border-border p-2 text-xs">
                    <div className="font-medium">最新 Web zip</div>
                    <div
                      className="mt-0.5 truncate text-muted-foreground"
                      title={selectedProject.exportZipPath}
                    >
                      {selectedProject.exportZipPath}
                    </div>
                    <button
                      className="mt-1 text-primary hover:underline"
                      onClick={() => openPath(selectedProject.exportZipPath)}
                    >
                      打开 zip
                    </button>
                  </div>
                )}
              </>
            )}

            {rightTab === "activity" && (
              <RunActivityPanel
                runs={selectedProject.runs ?? []}
                onOpenLog={() =>
                  previewProjectFile(".gameaistudio/logs/project.log")
                }
                onRetryStep={(step) => {
                  if (step.agentId && step.message) {
                    void sendToAgent(step.agentId, step.message);
                    setRightTab("activity");
                  }
                }}
              />
            )}

            {rightTab === "git" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <GitBranch className="size-4" /> Git 版本
                  </span>
                  <Badge tone={gitStatusTone(git)}>{gitStatusText(git)}</Badge>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">分支</dt>
                  <dd className="truncate">{git?.branch ?? "未初始化"}</dd>
                  <dt className="text-muted-foreground">提交</dt>
                  <dd className="truncate">{git?.head ?? "无"}</dd>
                  <dt className="text-muted-foreground">状态</dt>
                  <dd className="truncate" title={git?.error ?? git?.message}>
                    {git?.message ?? "未检查"}
                  </dd>
                </dl>

                {gitChanges.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      未提交变更
                    </div>
                    {gitChanges.slice(0, 8).map((change) => (
                      <button
                        key={`${change.rawStatus}:${change.path}:${change.originalPath ?? ""}`}
                        className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent"
                        onClick={() => change.kind !== "deleted" && previewProjectFile(change.path)}
                        disabled={isBusy || change.kind === "deleted"}
                        title={
                          change.originalPath
                            ? `${change.originalPath} -> ${change.path}`
                            : change.path
                        }
                      >
                        <Badge tone={gitChangeTone(change.kind)} className="shrink-0">
                          {gitChangeLabel(change.kind)}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate">{change.path}</span>
                      </button>
                    ))}
                    {gitChanges.length > 8 && (
                      <div className="text-xs text-muted-foreground">
                        还有 {gitChanges.length - 8} 个变更
                      </div>
                    )}
                  </div>
                )}

                {git?.recentCommits?.slice(0, 5).map((c) => (
                  <div
                    key={c.hash}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate" title={c.message}>
                        {c.message}
                      </div>
                      <div className="text-muted-foreground">
                        {c.shortHash} · {formatTime(c.date)}
                      </div>
                    </div>
                    <button
                      title="还原到此版本"
                      className="text-primary hover:underline"
                      onClick={() => restoreGitCommit(c.hash, `${c.shortHash} ${c.message}`)}
                      disabled={isBusy || !git?.initialized}
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    value={gitRestoreHash}
                    onChange={(e) => setGitRestoreHash(e.target.value)}
                    className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                    placeholder="输入任意提交 hash"
                    disabled={isBusy || !git?.initialized}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      restoreGitCommit(
                        gitRestoreHash,
                        gitRestoreHash.trim() || "指定提交",
                      )
                    }
                    disabled={isBusy || !git?.initialized || !gitRestoreHash.trim()}
                    title="还原到指定 Git 提交"
                  >
                    <RefreshCw /> 还原
                  </Button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={gitMessage}
                    onChange={(e) => setGitMessage(e.target.value)}
                    className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                    placeholder="提交信息"
                  />
                  <Button
                    size="sm"
                    onClick={commitGit}
                    disabled={gitCommitDisabled}
                    title={gitCommitTitle}
                  >
                    {busy === "git" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Save />
                    )}
                    {git?.initialized ? "提交" : "启用"}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={refreshGitStatus}
                  disabled={isBusy || !selectedProject}
                >
                  <RefreshCw /> 刷新 Git 状态
                </Button>
              </>
            )}

            {rightTab === "status" && (
              <>
                <section className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    Agent CLI 配置（团队工作流使用）
                  </div>
                  {workflowAgents.map((agent) => {
                    const toolId =
                      selectedProject.agentCliToolIds?.[agent.id] ??
                      chooseAgentCli(agent, tools);
                    const tool = tools.find((t) => t.id === toolId);
                    return (
                      <div
                        key={agent.id}
                        className="grid grid-cols-[minmax(0,1fr)_8.5rem_auto] items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                      >
                        <span className="truncate font-medium">{agent.title}</span>
                        <select
                          value={toolId}
                          onChange={(e) =>
                            updateAgentCli(agent.id, e.target.value as CliToolId)
                          }
                          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                          disabled={isBusy}
                          title={`${agent.title} 使用的本地 AI CLI`}
                        >
                          {Object.entries(CLI_TOOL_LABELS).map(([id, label]) => {
                            const optionTool = tools.find((t) => t.id === id);
                            return (
                              <option key={id} value={id}>
                                {label} · {cliToolStatusLabel(optionTool)}
                              </option>
                            );
                          })}
                        </select>
                        <Badge tone={cliToolStatusTone(tool)} className="shrink-0">
                          {cliToolStatusLabel(tool)}
                        </Badge>
                      </div>
                    );
                  })}
                </section>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">类型</dt>
                  <dd>{selectedProject.dimension.toUpperCase()}</dd>
                  <dt className="text-muted-foreground">目录</dt>
                  <dd className="truncate" title={selectedProject.rootPath}>
                    {selectedProject.rootPath}
                  </dd>
                  <dt className="text-muted-foreground">Web</dt>
                  <dd className="truncate" title={selectedProject.webBuildPath}>
                    {selectedProject.webBuildPath}
                  </dd>
                  <dt className="text-muted-foreground">Zip</dt>
                  <dd className="truncate">
                    {selectedProject.exportZipPath ?? "未导出"}
                  </dd>
                  <dt className="text-muted-foreground">日志</dt>
                  <dd className="truncate" title={projectMaintenanceLogPath}>
                    {projectMaintenanceLogPath ?? "未创建"}
                  </dd>
                </dl>
                <div className="grid grid-cols-2 gap-2">
                  {projectPreviewButtons.map((item) => (
                    <Button
                      key={item.label}
                      size="sm"
                      variant="outline"
                      className="justify-start"
                      onClick={item.run}
                      disabled={isBusy}
                      title={item.title}
                    >
                      {item.icon}
                      {item.label}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="justify-start"
                    onClick={() => openPath(appMaintenanceLogPath)}
                    disabled={!appMaintenanceLogPath}
                    title={appMaintenanceLogPath}
                  >
                    <FolderOpen /> 打开 app.log
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="justify-start"
                    onClick={exportChatHistory}
                    disabled={isBusy}
                    title="把项目聊天记录导出为 Markdown，便于排查问题"
                  >
                    <Download /> 导出聊天记录
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={deleteProject}
              disabled={isBusy}
            >
              {busy === "delete" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              删除项目
            </Button>
          </div>
        </aside>
      )}

      {/* ── New project dialog ─────────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建游戏"
        description="用一句话描述你的游戏想法，AI 团队会立即开始工作。"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm text-muted-foreground">游戏名称（仅用于显示，可用中文）</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              项目目录会自动按「2D_game_年月日时分秒」生成（纯英文，避免 AI CLI 路径兼容问题）。
            </span>
          </label>
          <label className="block">
            <span className="text-sm text-muted-foreground">一句话需求</span>
            <textarea
              value={form.prompt}
              rows={4}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            {(["2d", "3d"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setForm({ ...form, dimension: d })}
                className={cn(
                  "flex-1 rounded-md border py-2 text-sm transition-colors",
                  form.dimension === d
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent",
                )}
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Agent CLI</span>
              {createCliIssues.length > 0 ? (
                <Badge tone="danger">需要修复 {createCliIssues.length} 个</Badge>
              ) : (
                <Badge tone="success">可启动</Badge>
              )}
            </div>
            <div className="space-y-1.5">
              {workflowAgents.map((agent) => {
                const toolId = createAgentCliToolIds[agent.id] ?? agent.defaultCli;
                const tool = tools.find((candidate) => candidate.id === toolId);
                return (
                  <div
                    key={agent.id}
                    className="grid grid-cols-[minmax(0,1fr)_10rem_auto] items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{agent.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {agent.specialty}
                      </div>
                    </div>
                    <select
                      value={toolId}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          agentCliToolIds: {
                            ...form.agentCliToolIds,
                            [agent.id]: e.target.value as CliToolId,
                          },
                        })
                      }
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                      disabled={isBusy}
                      title={`${agent.title} 使用的本地 AI CLI`}
                    >
                      {Object.entries(CLI_TOOL_LABELS).map(([id, label]) => {
                        const optionTool = tools.find((candidate) => candidate.id === id);
                        return (
                          <option key={id} value={id}>
                            {label} · {cliToolStatusLabel(optionTool)}
                          </option>
                        );
                      })}
                    </select>
                    <Badge tone={cliToolStatusTone(tool)} className="shrink-0">
                      {cliToolStatusLabel(tool)}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </section>
          <Button
            className="w-full"
            onClick={createProject}
            disabled={createProjectDisabled}
            title={createProjectTitle}
          >
            {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
            创建并启动团队工作流
          </Button>
        </div>
      </Dialog>

      {/* ── About dialog ───────────────────────────────────────────── */}
      <Dialog
        open={aboutOpen}
        onClose={() => {
          if (updateDialogLocked) {
            setUpdateMessage("更新正在下载或安装，请等待完成。");
            return;
          }
          setAboutOpen(false);
        }}
        closable={!updateDialogLocked}
        title={
          <span className="inline-flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Gamepad2 className="size-4" />
            </span>
            GameAI Studio
          </span>
        }
        description={`版本 v${APP_VERSION}`}
        className="max-w-md"
      >
        <div className="space-y-4 text-sm">
          <p className="leading-6 text-muted-foreground">
            AI 驱动的游戏创作平台。通过自然语言描述快速创建 2D/3D
            游戏，支持本地 AI CLI、多 Agent 协作、实时预览与 Web 导出。
          </p>

          <section className="rounded-lg border border-border bg-accent/50 px-4 py-3">
            <div className="flex items-center gap-2 font-medium">
              <Info className="size-4 text-primary" />
              联系与协作
            </div>
            <p className="mt-2 text-muted-foreground">有问题请协作联系：</p>
            <p className="mt-1 font-semibold">李宗尚</p>
          </section>

          <section className="rounded-lg border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">软件更新</div>
              <Badge tone={updatePolicyTone(currentUpdateInfo)}>
                {updatePolicyLabel(currentUpdateInfo)}
              </Badge>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">当前</dt>
              <dd>v{APP_VERSION}</dd>
              <dt className="text-muted-foreground">最新</dt>
              <dd>{currentUpdateInfo?.latestVersion ? `v${currentUpdateInfo.latestVersion}` : "未获取"}</dd>
              <dt className="text-muted-foreground">安装包</dt>
              <dd>{formatBytes(currentUpdateInfo?.package?.size)}</dd>
              <dt className="text-muted-foreground">发布</dt>
              <dd>{formatDateTime(currentUpdateInfo?.releaseDate)}</dd>
            </dl>
            <p className="mt-3 break-words text-xs leading-5 text-muted-foreground">
              {updateMessage || updateReasonText(currentUpdateInfo)}
            </p>
            {visibleUpdateNotes && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Info className="size-3.5 text-primary" />
                    更新日志
                  </span>
                  <span className="text-muted-foreground">v{currentUpdateInfo?.latestVersion}</span>
                </div>
                <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                  {visibleUpdateNotes}
                </div>
              </div>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={checkForUpdates}
                disabled={busy === "update"}
              >
                {busy === "update" && currentUpdateInfo?.status !== "downloading" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                检查更新
              </Button>
              <Button
                onClick={downloadAndInstallUpdate}
                disabled={
                  busy === "update" ||
                  currentUpdateInfo?.policy === "none" ||
                  !currentUpdateInfo?.package
                }
                title={updateReasonText(currentUpdateInfo)}
              >
                {busy === "update" && currentUpdateInfo?.status === "downloading" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {currentUpdateInfo?.policy === "required" ? "立即强制更新" : "下载并安装"}
              </Button>
            </div>
          </section>

          <p className="pt-1 text-center text-xs text-muted-foreground">
            © 2026-2027 AI Entertainment · 内部工具，仅限授权使用
          </p>
        </div>
      </Dialog>

      {/* ── Settings dialog (diagnostics) ──────────────────────────── */}
      <Dialog
        open={settingsOpen}
        onClose={() => {
          if (updateDialogLocked) {
            setUpdateMessage("更新正在下载或安装，请等待完成。");
            return;
          }
          setSettingsOpen(false);
        }}
        closable={!updateDialogLocked}
        title={directorySetupRequired ? "首次配置 · 设置" : "设置 · 环境诊断"}
        description={directorySetupRequired ? "请确认软件数据目录和游戏项目目录。热更新后会继续沿用这里的配置。" : undefined}
      >
        <div className="space-y-5 text-sm">
          {bootstrap && currentDirectorySettings && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-medium">
                  <FolderOpen className="size-4" /> 软件目录
                </div>
                {directorySetupRequired && <Badge tone="warning">待确认</Badge>}
              </div>
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                软件数据目录保存状态文件、App 日志等维护数据；游戏项目目录用于新建游戏落地。留空使用默认位置，修改后会重启软件生效，已有项目不会自动搬迁。
              </p>
              {currentDirectorySettings.startupFallbackActive && (
                <div className="mb-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
                  配置的目录在启动时不可用（例如移动硬盘未连接），本次以默认目录运行。已保存的配置未被修改——恢复目录可用后重启软件即可继续使用。
                </div>
              )}
              <div className="space-y-2">
                <label className="block">
                  <span className="text-xs text-muted-foreground">软件数据目录</span>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={directorySettingsDraft.dataRoot}
                      onChange={(event) =>
                        setDirectorySettingsDraft((draft) => ({ ...draft, dataRoot: event.target.value }))
                      }
                      placeholder={currentDirectorySettings.defaultDataRoot}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => chooseStudioDirectory("data")}
                      disabled={isBusy}
                    >
                      <FolderOpen /> 选择
                    </Button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">游戏项目目录</span>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={directorySettingsDraft.projectsRoot}
                      onChange={(event) =>
                        setDirectorySettingsDraft((draft) => ({ ...draft, projectsRoot: event.target.value }))
                      }
                      placeholder={currentDirectorySettings.defaultProjectsRoot}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => chooseStudioDirectory("projects")}
                      disabled={isBusy}
                    >
                      <FolderOpen /> 选择
                    </Button>
                  </div>
                </label>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">数据</dt>
                <dd className="truncate" title={currentDirectorySettings.resolvedDataRoot}>
                  {currentDirectorySettings.resolvedDataRoot}
                </dd>
                <dt className="text-muted-foreground">项目</dt>
                <dd className="truncate" title={currentDirectorySettings.resolvedProjectsRoot}>
                  {currentDirectorySettings.resolvedProjectsRoot}
                </dd>
                <dt className="text-muted-foreground">App 日志</dt>
                <dd className="truncate" title={appMaintenanceLogPath}>
                  {appMaintenanceLogPath}
                </dd>
                <dt className="text-muted-foreground">项目日志</dt>
                <dd className="truncate" title={projectMaintenanceLogPath ?? "未选择项目"}>
                  {projectMaintenanceLogPath ?? "未选择项目"}
                </dd>
              </dl>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Button
                  onClick={() => saveDirectorySettings()}
                  disabled={isBusy}
                >
                  {busy === "settings" ? <Loader2 className="animate-spin" /> : <Save />}
                  保存设置
                </Button>
                <Button
                  variant="outline"
                  onClick={() => saveDirectorySettings({ setupCompleted: true })}
                  disabled={isBusy}
                >
                  使用默认
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openPath(appMaintenanceLogPath)}
                  disabled={!appMaintenanceLogPath || isBusy}
                  title={appMaintenanceLogPath}
                >
                  <FolderOpen /> 打开 app.log
                </Button>
                <Button
                  variant="outline"
                  onClick={previewCurrentProjectLog}
                  disabled={!projectMaintenanceLogPath || isBusy}
                  title={projectMaintenanceLogPath}
                >
                  <Terminal /> 预览项目日志
                </Button>
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-medium">
                <Download className="size-4" /> 软件更新
              </div>
              <Badge tone={updatePolicyTone(currentUpdateInfo)}>
                {updatePolicyLabel(currentUpdateInfo)}
              </Badge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">当前</dt>
              <dd>v{APP_VERSION}</dd>
              <dt className="text-muted-foreground">最新</dt>
              <dd>{currentUpdateInfo?.latestVersion ? `v${currentUpdateInfo.latestVersion}` : "未获取"}</dd>
              <dt className="text-muted-foreground">安装包</dt>
              <dd>{formatBytes(currentUpdateInfo?.package?.size)}</dd>
              <dt className="text-muted-foreground">发布</dt>
              <dd>{formatDateTime(currentUpdateInfo?.releaseDate)}</dd>
            </dl>
            <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
              {updateMessage || updateReasonText(currentUpdateInfo)}
            </p>
            {visibleUpdateNotes && (
              <div className="mt-3 rounded-md border border-border px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Info className="size-3.5 text-primary" />
                    更新日志
                  </span>
                  <span className="text-muted-foreground">v{currentUpdateInfo?.latestVersion}</span>
                </div>
                <div className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                  {visibleUpdateNotes}
                </div>
              </div>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={checkForUpdates}
                disabled={busy === "update"}
              >
                {busy === "update" && currentUpdateInfo?.status !== "downloading" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                检查更新
              </Button>
              <Button
                onClick={downloadAndInstallUpdate}
                disabled={
                  busy === "update" ||
                  currentUpdateInfo?.policy === "none" ||
                  !currentUpdateInfo?.package
                }
                title={updateReasonText(currentUpdateInfo)}
              >
                {busy === "update" && currentUpdateInfo?.status === "downloading" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {currentUpdateInfo?.policy === "required" ? "立即强制更新" : "下载并安装"}
              </Button>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Terminal className="size-4" /> 本地 AI CLI
            </div>
            <div className="space-y-1.5">
              {tools.map((t) => (
                <div
                  key={t.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{t.label}</div>
                    <div
                      className="truncate text-xs text-muted-foreground"
                      title={t.executablePath ?? t.command}
                    >
                      {t.installed
                        ? [
                            t.version || t.executablePath,
                            t.source === "npm-global"
                              ? "来源：npm 全局"
                              : t.source === "well-known"
                                ? "来源：本机安装目录"
                                : t.source === "path"
                                  ? "来源：PATH"
                                  : undefined,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : `命令：${t.command}`}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={t.installed ? "success" : "danger"}>
                        {t.installed ? "已安装" : "未安装"}
                      </Badge>
                      <Badge tone={healthTone(t.health.authed)}>
                        Auth {healthText(t.health.authed)}
                      </Badge>
                      <Badge tone={healthTone(t.health.headlessOk)}>
                        Headless {healthText(t.health.headlessOk)}
                      </Badge>
                      {t.health.quota === false && (
                        <Badge tone="danger">额度受限</Badge>
                      )}
                      <Badge tone={t.capabilities.supportsImages ? "success" : "muted"}>
                        图片 {t.capabilities.supportsImages ? "可用" : "不支持"}
                      </Badge>
                      {t.acp?.supported && (
                        <Badge
                          tone={t.acp.available ? "success" : "muted"}
                          title={
                            t.acp.available
                              ? `ACP 模式已启用：原生流式、工具调用可见、权限审计、会话复用。\n${t.acp.executablePath ?? t.acp.agentCommand}`
                              : `${t.acp.installHint}`
                          }
                        >
                          ACP {t.acp.available ? "已启用" : "未启用"}
                        </Badge>
                      )}
                    </div>
                    {t.installed && t.status !== "available" && t.health.detail && (
                      <p className="mt-1 break-words text-xs text-danger" title={t.health.detail}>
                        最近错误：{t.health.detail}
                      </p>
                    )}
                  </div>
                  {t.installed ? (
                    <div className="flex shrink-0 items-center gap-2">
                      {t.status === "available" ? (
                        <Badge tone="success">可用</Badge>
                      ) : (
                        <Badge tone="danger" title={t.health.detail}>
                          不可用
                        </Badge>
                      )}
                      {t.acp?.supported && !t.acp.available && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy || !t.installManagerAvailable}
                          onClick={() => installAcp(t.id)}
                          title={t.acp.installHint}
                        >
                          启用 ACP
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => testCli(t.id)}
                        title="运行一次非交互探测（真实调用），检测登录/401"
                      >
                        {busy === "cli" ? (
                          <Loader2 className="animate-spin" />
                        ) : null}
                        测试
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy || !t.installManagerAvailable}
                      onClick={() => installCli(t.id)}
                    >
                      安装
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {bootstrap?.environment && (
            <section>
              <div className="mb-2 font-medium">系统环境</div>
              <div className="space-y-1.5">
                {bootstrap.environment.tools.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span>{t.label}</span>
                      {!t.installed && t.installHint && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={t.installHint}>
                          {t.installHint}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={t.installed ? "success" : "danger"}>
                        {t.installed ? t.version ?? "可用" : "缺失"}
                      </Badge>
                      {!t.installed && t.installAvailable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => installEnvironmentTool(t.id)}
                          title={`通过 winget 一键安装 ${t.label}`}
                        >
                          {busy === "cli" ? <Loader2 className="animate-spin" /> : null}
                          安装
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {bootstrap && (
            <section>
              <div className="mb-2 font-medium">Godot 运行时</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">状态</dt>
                <dd>{bootstrap.godotRuntime.status}</dd>
                <dt className="text-muted-foreground">版本</dt>
                <dd>{bootstrap.godotRuntime.version ?? "未探测"}</dd>
                <dt className="text-muted-foreground">模板</dt>
                <dd>
                  {
                    bootstrap.godotRuntime.templates.filter((t) => t.available)
                      .length
                  }
                  /{bootstrap.godotRuntime.templates.length} 可用
                </dd>
              </dl>
            </section>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => loadBootstrap()}
            disabled={isBusy}
          >
            <RefreshCw /> 重新检测环境
          </Button>
        </div>
      </Dialog>

      {/* ── File preview dialog ────────────────────────────────────── */}
      <Dialog
        open={Boolean(filePreview)}
        onClose={() => setFilePreview(undefined)}
        title={filePreview?.name}
        description={filePreview?.relativePath}
        className="max-w-3xl"
      >
        {filePreview?.kind === "image" && filePreview.dataUrl ? (
          <img src={filePreview.dataUrl} alt={filePreview.name} />
        ) : (
          <pre className="overflow-auto rounded-lg bg-muted p-3 text-xs">
            {filePreview?.content ?? "（无法预览）"}
          </pre>
        )}
      </Dialog>
    </div>
  );
}
