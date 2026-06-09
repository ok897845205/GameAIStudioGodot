import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Hammer,
  Loader2,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Save,
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
  type AgentMessage,
  type CliToolId,
  type GameDimension,
  type PreviewEvent,
  type ProjectDetails,
  type ProjectFilePreview,
  type StudioBootstrap,
  type StudioProject,
} from "@gameaistudio/shared";
import { AgentChat, type AgentSendInput } from "./chat";
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
  | undefined;

type RightTab = "build" | "git" | "status";

const initialForm = {
  name: "黄金矿工",
  prompt: "我要创建一个黄金矿工，玩家用钩子抓金块，限时得分。",
  dimension: "2d" as GameDimension,
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

export function StudioApp() {
  const { theme, toggleTheme } = useTheme();
  const [bootstrap, setBootstrap] = useState<StudioBootstrap>();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetails>();
  const [activeAgentId, setActiveAgentId] = useState("producer");
  const [selectedCli, setSelectedCli] = useState<CliToolId>("codex");
  const [busy, setBusy] = useState<BusyAction>("boot");
  const [notice, setNotice] = useState("");
  const [previewNotice, setPreviewNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [rightTab, setRightTab] = useState<RightTab>("build");
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [gitMessage, setGitMessage] = useState("保存当前游戏版本");
  const [filePreview, setFilePreview] = useState<ProjectFilePreview>();

  const tools = bootstrap?.cliTools ?? [];
  const agents = bootstrap?.agents ?? AGENT_PROFILES;
  const activeAgent =
    agents.find((a) => a.id === activeAgentId) ?? agents[0]!;
  const hasInstalledCli = tools.some((t) => t.installed);
  const isBusy = Boolean(busy);

  const activeMessages = useMemo(
    () =>
      (selectedProject?.messages ?? []).filter(
        (m) => m.agentId === activeAgentId || m.role === "system",
      ),
    [selectedProject, activeAgentId],
  );

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

  const previewFrameKey = selectedProject?.previewUrl
    ? `${selectedProject.id}:${selectedProject.previewUrl}:${selectedProject.previewUpdatedAt ?? "x"}`
    : "none";

  async function loadBootstrap(selectId?: string) {
    setBusy("boot");
    try {
      const data = await window.studio.bootstrap();
      setBootstrap(data);
      setProjects(data.projects);
      const target =
        selectId ?? selectedProject?.id ?? data.projects[0]?.id;
      if (target) {
        const detail = await window.studio.getProject(target);
        setSelectedProject(detail);
        setActiveAgentId(detail.activeAgentId);
        setSelectedCli(
          (agents.find((a) => a.id === detail.activeAgentId)?.defaultCli ??
            "codex") as CliToolId,
        );
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

  async function selectProject(id: string) {
    setBusy("boot");
    try {
      const detail = await window.studio.getProject(id);
      setSelectedProject(detail);
      setActiveAgentId(detail.activeAgentId);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function createProject() {
    setBusy("create");
    setNotice("");
    try {
      const project = await window.studio.createProject(form);
      setSelectedProject(project);
      setProjects(await window.studio.listProjects());
      setActiveAgentId(project.activeAgentId);
      setCreateOpen(false);
      setNotice(`已创建项目：${project.name}`);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(undefined);
    }
  }

  const handleAgentSend = async ({ text, attachments }: AgentSendInput) => {
    if (!selectedProject || (!text.trim() && attachments.length === 0)) return;
    const projectId = selectedProject.id;
    setBusy("send");
    setNotice("");

    // Optimistically show the user's message immediately (the canonical
    // messages from runAgentTurn replace it on completion).
    const optimistic: AgentMessage = {
      id: `optimistic-${Date.now()}`,
      projectId,
      agentId: activeAgentId,
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setSelectedProject((cur) =>
      cur && cur.id === projectId
        ? { ...cur, messages: [...cur.messages, optimistic] }
        : cur,
    );

    try {
      const result = await window.studio.runAgentTurn({
        projectId,
        agentId: activeAgentId,
        cliToolId: selectedCli,
        message: text.trim(),
        autoStartPreview: true,
        attachments,
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
  };

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
      const result = await window.studio.runStudioWorkflow({
        projectId: selectedProject.id,
        message: selectedProject.prompt,
        autoExportWeb: true,
        autoPackageWebZip: true,
        autoStartPreview: true,
      });
      setSelectedProject(result.project);
      setProjects(await window.studio.listProjects());
      setNotice(result.run.summary ?? "团队工作流结束。");
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

  async function deleteProject() {
    if (!selectedProject) return;
    if (!window.confirm(`删除项目「${selectedProject.name}」？此操作不可撤销。`))
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

  const git = selectedProject?.gitStatus;

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

        <div className="flex items-center gap-1 border-t border-border p-2">
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
          <div className="border-b border-border px-4 py-2">
            <Tabs
              size="sm"
              value={activeAgentId}
              onValueChange={setActiveAgentId}
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
          </div>
        )}

        {activeRun && (
          <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            <span className="truncate">
              <span className="text-foreground">{activeRun.title}</span>
              {activeStep ? ` · ${activeStep.title}` : ""}
            </span>
            <button
              className="ml-auto shrink-0 text-destructive hover:underline"
              onClick={cancelActiveRun}
            >
              取消
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {selectedProject ? (
            <AgentChat
              key={`${selectedProject.id}:${activeAgentId}`}
              messages={activeMessages}
              isRunning={busy === "send" || busy === "workflow"}
              isSendDisabled={!hasInstalledCli}
              onSend={handleAgentSend}
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

            {rightTab === "git" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <GitBranch className="size-4" /> Git 版本
                  </span>
                  <Badge tone={git?.clean ? "success" : "warning"}>
                    {!git?.available
                      ? "Git 缺失"
                      : !git.initialized
                        ? "未启用"
                        : git.clean
                          ? "干净"
                          : `${git.changedFiles.length} 变更`}
                  </Badge>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">分支</dt>
                  <dd className="truncate">{git?.branch ?? "未初始化"}</dd>
                  <dt className="text-muted-foreground">提交</dt>
                  <dd className="truncate">{git?.head ?? "无"}</dd>
                </dl>
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
                      onClick={() =>
                        window.confirm(`还原到 ${c.shortHash}？`) &&
                        window.studio
                          .restoreProjectGit({
                            projectId: selectedProject.id,
                            commitHash: c.hash,
                          })
                          .then((r) => {
                            setSelectedProject(r.project);
                            setNotice(r.message);
                          })
                          .catch((e) => setNotice(errText(e)))
                      }
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    value={gitMessage}
                    onChange={(e) => setGitMessage(e.target.value)}
                    className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                    placeholder="提交信息"
                  />
                  <Button size="sm" onClick={commitGit} disabled={isBusy}>
                    {busy === "git" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Save />
                    )}
                    {git?.initialized ? "提交" : "启用"}
                  </Button>
                </div>
              </>
            )}

            {rightTab === "status" && (
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
              </dl>
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
        description="用一句话描述你的游戏想法，AI 团队会帮你从零搭起。"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm text-muted-foreground">项目名</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
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
          <Button
            className="w-full"
            onClick={createProject}
            disabled={isBusy || !form.prompt.trim()}
          >
            {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
            创建项目
          </Button>
        </div>
      </Dialog>

      {/* ── Settings dialog (diagnostics) ──────────────────────────── */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="设置 · 环境诊断"
      >
        <div className="space-y-5 text-sm">
          <section>
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Terminal className="size-4" /> 本地 AI CLI
            </div>
            <div className="space-y-1.5">
              {tools.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{t.label}</div>
                    <div
                      className="truncate text-xs text-muted-foreground"
                      title={t.executablePath ?? t.command}
                    >
                      {t.installed
                        ? t.version || t.executablePath
                        : `命令：${t.command}`}
                    </div>
                  </div>
                  {t.installed ? (
                    <Badge tone="success">可用</Badge>
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
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span>{t.label}</span>
                    <Badge tone={t.installed ? "success" : "danger"}>
                      {t.installed ? t.version ?? "可用" : "缺失"}
                    </Badge>
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
