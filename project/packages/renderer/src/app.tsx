import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Hammer,
  Loader2,
  Package,
  Play,
  RotateCcw,
  RefreshCw,
  Save,
  Send,
  StopCircle,
  Terminal,
  WandSparkles,
  XCircle
} from "lucide-react";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type AgentMessage,
  type AgentProfile,
  type CliTool,
  type CliToolId,
  type GameDimension,
  type ProjectFileChange,
  type ProjectSnapshot,
  type PreviewEvent,
  type PreviewStatus,
  type ProjectDetails,
  type StudioBootstrap,
  type StudioProject,
  type StudioRun
} from "@gameaistudio/shared";

type BusyAction = "boot" | "create" | "send" | "workflow" | "snapshot" | "preview" | "export" | "godot" | "validate" | "cli" | undefined;

interface CreateForm {
  name: string;
  prompt: string;
  dimension: GameDimension;
  autoRunWorkflow: boolean;
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

function agentById(agentId: string): AgentProfile {
  return AGENT_PROFILES.find((agent) => agent.id === agentId) ?? AGENT_PROFILES[0];
}

function pickDefaultCli(agentId: string, tools: CliTool[]): CliToolId {
  const agent = agentById(agentId);
  if (tools.some((tool) => tool.id === agent.defaultCli && tool.installed)) {
    return agent.defaultCli;
  }
  return tools.find((tool) => tool.installed)?.id ?? agent.defaultCli;
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
    cancelled: "已取消"
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

function runtimeStatusLabel(status: StudioBootstrap["godotRuntime"]["status"]): string {
  const labels: Record<StudioBootstrap["godotRuntime"]["status"], string> = {
    ready: "就绪",
    partial: "部分可用",
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

function snapshotReasonLabel(snapshot: ProjectSnapshot): string {
  if (snapshot.reason === "project-created") {
    return "初始模板";
  }
  if (snapshot.reason.startsWith("before-agent:")) {
    return "Agent 运行前";
  }
  if (snapshot.reason.startsWith("after-agent:")) {
    return "Agent 完成后";
  }
  if (snapshot.reason.startsWith("before-restore:")) {
    return "恢复前";
  }
  return snapshot.reason;
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
  const [busy, setBusy] = useState<BusyAction>("boot");
  const [notice, setNotice] = useState<string>("");
  const [previewNotice, setPreviewNotice] = useState<string>("");

  const tools = bootstrap?.cliTools ?? [];
  const agents = bootstrap?.agents ?? AGENT_PROFILES;
  const activeAgent = agentById(activeAgentId);
  const activeMessages = useMemo(
    () => (selectedProject?.messages ?? []).filter((message) => message.agentId === activeAgentId || message.role === "system"),
    [selectedProject, activeAgentId]
  );
  const activeTool = tools.find((tool) => tool.id === selectedCli);
  const activeRun = useMemo(
    () => (selectedProject?.runs ?? []).find((run) => run.status === "running" || run.status === "queued"),
    [selectedProject?.runs]
  );

  async function loadBootstrap(selectProjectId?: string) {
    setBusy("boot");
    try {
      const data = await window.studio.bootstrap();
      setBootstrap(data);
      setProjects(data.projects);
      const target = selectProjectId ?? selectedProject?.id ?? data.projects[0]?.id;
      if (target) {
        const detail = await window.studio.getProject(target);
        setSelectedProject(detail);
        setActiveAgentId(detail.activeAgentId);
        setSelectedCli(pickDefaultCli(detail.activeAgentId, data.cliTools));
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

      const preferredTool = refreshedTools.find((tool) => tool.id === defaultCli && tool.installed);
      if (!preferredTool) {
        setNotice(`已创建项目：${project.name}。请先安装至少一个本地 AI CLI，再运行团队工作流。`);
        return;
      }

      setBusy("workflow");
      setNotice(`已创建项目：${project.name}，正在启动团队工作流。`);
      await startStudioWorkflow(project, project.prompt, preferredTool.id);
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

  async function sendTurn() {
    if (!selectedProject || !draft.trim()) {
      return;
    }
    setBusy("send");
    setNotice("");
    try {
      const result = await window.studio.runAgentTurn({
        projectId: selectedProject.id,
        agentId: activeAgentId,
        cliToolId: selectedCli,
        message: draft.trim()
      });
      setSelectedProject({ ...result.project, messages: result.messages, runs: result.runs });
      setProjects(await window.studio.listProjects());
      setDraft("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function createManualSnapshot() {
    if (!selectedProject) {
      return;
    }
    setBusy("snapshot");
    try {
      const snapshot = await window.studio.createSnapshot({
        projectId: selectedProject.id,
        label: `手动快照 ${new Date().toLocaleString("zh-CN")}`,
        reason: "manual"
      });
      setSelectedProject({
        ...selectedProject,
        snapshots: [snapshot, ...selectedProject.snapshots]
      });
      setNotice(`已创建快照：${snapshot.label}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function restoreSnapshot(snapshot: ProjectSnapshot) {
    if (!selectedProject) {
      return;
    }
    const ok = window.confirm(`恢复到快照“${snapshot.label}”？当前状态会先自动保存为恢复前快照。`);
    if (!ok) {
      return;
    }
    setBusy("snapshot");
    try {
      const result = await window.studio.restoreSnapshot(selectedProject.id, snapshot.id);
      setSelectedProject(result.project);
      setProjects(await window.studio.listProjects());
      setNotice(`已恢复到快照：${result.snapshot.label}`);
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
      autoStartPreview: true
    });
    setSelectedProject(result.project);
    setProjects(await window.studio.listProjects());
    setNotice(result.run.status === "completed" ? "团队工作流完成，预览已刷新。" : result.run.summary ?? "团队工作流结束。");
  }

  async function runWorkflow() {
    if (!selectedProject) {
      return;
    }
    setBusy("workflow");
    setNotice("");
    try {
      await startStudioWorkflow(selectedProject, draft.trim() || selectedProject.prompt, activeTool?.installed ? selectedCli : undefined);
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
          <Button
            variant="primary"
            icon={busy === "create" || (busy === "workflow" && form.autoRunWorkflow) ? <Loader2 className="spin" size={16} /> : <Package size={16} />}
            onClick={createProject}
            disabled={isBusy || !form.prompt.trim()}
          >
            {form.autoRunWorkflow ? "创建并生成游戏" : "创建 Godot 项目"}
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
              <Button icon={<FolderOpen size={16} />} onClick={() => window.studio.openPath(selectedProject.rootPath)}>
                打开目录
              </Button>
              <Button icon={<ExternalLink size={16} />} onClick={() => selectedProject.previewUrl && window.open(selectedProject.previewUrl)}>
                浏览器
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
                </div>
                <pre>{message.content}</pre>
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
              disabled={!selectedProject || !draft.trim() || isBusy}
            >
              发送
            </Button>
          </div>
          {activeTool && !activeTool.installed ? <p className="warning">{activeTool.installHint}</p> : null}
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
            {selectedProject?.previewUrl ? <iframe src={selectedProject.previewUrl} title="Godot Web Preview" /> : <Play size={40} />}
          </div>
        </section>

        <section className="panel actions-panel">
          <div className="section-title">
            <Hammer size={17} />
            <span>构建</span>
          </div>
          <Button icon={busy === "workflow" ? <Loader2 className="spin" size={16} /> : <Bot size={16} />} onClick={runWorkflow} disabled={!selectedProject || isBusy}>
            团队工作流
          </Button>
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

        <section className="panel snapshots-panel">
          <div className="section-title split">
            <span>
              <Save size={17} />
              版本快照
            </span>
            <button className="icon-button" title="创建快照" onClick={createManualSnapshot} disabled={!selectedProject || isBusy}>
              {busy === "snapshot" ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            </button>
          </div>
          {selectedProject && selectedProject.snapshots.length > 0 ? (
            <div className="snapshot-list">
              {selectedProject.snapshots.slice(0, 6).map((snapshot) => (
                <article className="snapshot-item" key={snapshot.id}>
                  <div>
                    <strong>{snapshot.label}</strong>
                    <span>
                      {snapshotReasonLabel(snapshot)} · {snapshot.fileCount} 文件 · {formatBytes(snapshot.totalBytes)}
                    </span>
                    <small>{formatTime(snapshot.createdAt)}</small>
                  </div>
                  <button title="恢复快照" onClick={() => restoreSnapshot(snapshot)} disabled={isBusy}>
                    <RotateCcw size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-text">还没有快照</p>
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
              {selectedProject.exportZipPath ? (
                <div className="details-actions">
                  <Button icon={<ExternalLink size={16} />} onClick={() => window.studio.openPath(selectedProject.exportZipPath!)}>
                    打开 zip
                  </Button>
                  <Button icon={<FolderOpen size={16} />} onClick={() => window.studio.openPath(dirnameFromPath(selectedProject.exportZipPath!))}>
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
    </main>
  );
}
