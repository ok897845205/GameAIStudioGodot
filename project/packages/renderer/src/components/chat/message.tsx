import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Copy,
  Download,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Info,
  Music,
  Play,
  RefreshCw,
  Trash2,
  User,
  Users,
  Wrench,
} from "lucide-react";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type AgentMessageKind,
} from "@gameaistudio/shared";
import { useMessage, useThread, type MessageState } from "@gameaistudio/assistant/react";
import { cn } from "../../lib/utils";
import { extractFileMentions } from "../../lib/file-mentions";
import { useAgentChatContext } from "../../chat/agent-chat-context";
import { MarkdownText } from "./markdown";

/** Joins the text/reasoning parts of a message into a single string. */
export function messageText(content: MessageState["content"]): string {
  return content
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => (part as { text: string }).text)
    .join("\n\n");
}

const COLLAPSE_THRESHOLD = 2600;

const KIND_META: Partial<
  Record<AgentMessageKind, { label: string; icon: typeof Info }>
> = {
  workflow: { label: "团队工作流", icon: Users },
  git: { label: "Git 版本", icon: GitBranch },
  preview: { label: "预览", icon: Play },
  export: { label: "导出", icon: Download },
  error: { label: "错误", icon: AlertTriangle },
  tool: { label: "工具", icon: Wrench },
  "file-change": { label: "文件变更", icon: FileText },
  log: { label: "日志", icon: FileText },
};

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="正在输入">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function formatTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms?: number): string | undefined {
  if (!ms || ms <= 0) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Module-level thumbnail cache: one IPC read per (project, attachment) for
// the app session, shared across remounts of the chat.
const thumbnailCache = new Map<string, Promise<string | undefined>>();

function loadThumbnail(projectId: string, relativePath: string): Promise<string | undefined> {
  const key = `${projectId}:${relativePath}`;
  let cached = thumbnailCache.get(key);
  if (!cached) {
    cached = window.studio
      .readProjectFile({ projectId, relativePath })
      .then((preview) => preview.dataUrl)
      .catch(() => undefined);
    thumbnailCache.set(key, cached);
  }
  return cached;
}

/** Inline image thumbnails / audio players for chat attachments. */
function AttachmentThumbs({
  projectId,
  attachments,
  onOpen,
}: {
  projectId: string;
  attachments: Array<{
    id: string;
    name: string;
    projectRelativePath: string;
    kind?: "image" | "audio";
    dataUrl?: string;
  }>;
  onOpen?: (path: string) => void;
}) {
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let alive = true;
    for (const attachment of attachments) {
      // Optimistic messages carry the data URL inline (not yet on disk).
      if (attachment.dataUrl) {
        setThumbs((cur) => ({ ...cur, [attachment.id]: attachment.dataUrl ?? null }));
        continue;
      }
      if (!attachment.projectRelativePath) {
        setThumbs((cur) => ({ ...cur, [attachment.id]: null }));
        continue;
      }
      void loadThumbnail(projectId, attachment.projectRelativePath).then((dataUrl) => {
        if (!alive) return;
        setThumbs((cur) => ({ ...cur, [attachment.id]: dataUrl ?? null }));
      });
    }
    return () => {
      alive = false;
    };
  }, [projectId, attachments]);

  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const thumb = thumbs[attachment.id];
        const isAudio = attachment.kind === "audio";
        const FallbackIcon = isAudio ? Music : ImageIcon;
        const canOpen = Boolean(onOpen && attachment.projectRelativePath);
        if (thumb === null) {
          // File unreadable (moved/deleted) — fall back to a named chip.
          return (
            <button
              key={attachment.id}
              type="button"
              disabled={!canOpen}
              onClick={() => onOpen?.(attachment.projectRelativePath)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              title={`${isAudio ? "音频" : "图片"}不可用：${attachment.projectRelativePath || attachment.name}`}
            >
              <FallbackIcon className="size-3" />
              <span className="max-w-[10rem] truncate">{attachment.name}</span>
            </button>
          );
        }
        if (isAudio) {
          return (
            <div
              key={attachment.id}
              className="flex w-64 max-w-full flex-col gap-1 rounded-lg border border-border bg-background/60 p-2"
            >
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => onOpen?.(attachment.projectRelativePath)}
                className="inline-flex items-center gap-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                title={`点击查看 ${attachment.name}`}
              >
                <Music className="size-3 shrink-0" />
                <span className="truncate">{attachment.name}</span>
              </button>
              {thumb ? (
                <audio controls preload="metadata" src={thumb} className="h-8 w-full" />
              ) : (
                <span className="flex h-8 items-center justify-center text-muted-foreground">
                  <Music className="size-4 animate-pulse" />
                </span>
              )}
            </div>
          );
        }
        return (
          <button
            key={attachment.id}
            type="button"
            disabled={!canOpen}
            onClick={() => onOpen?.(attachment.projectRelativePath)}
            className="group/thumb relative overflow-hidden rounded-lg border border-border bg-background/60"
            title={`点击查看 ${attachment.name}`}
          >
            {thumb ? (
              <img
                src={thumb}
                alt={attachment.name}
                className="max-h-36 max-w-[14rem] object-contain transition-transform group-hover/thumb:scale-[1.02]"
              />
            ) : (
              <span className="flex h-20 w-28 items-center justify-center text-muted-foreground">
                <ImageIcon className="size-5 animate-pulse" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FileChips({
  title,
  paths,
  icon: Icon,
  onOpen,
}: {
  title: string;
  paths: string[];
  icon: typeof FileText;
  onOpen?: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{title}</span>
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          disabled={!onOpen}
          onClick={() => onOpen?.(path)}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11px] text-primary hover:bg-accent disabled:cursor-default disabled:text-muted-foreground"
          title={`预览 ${path}`}
        >
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{path}</span>
        </button>
      ))}
    </div>
  );
}

function MessageBody({
  text,
  isUser,
  isSystem,
  isRunning,
}: {
  text: string;
  isUser: boolean;
  isSystem: boolean;
  isRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = !isRunning && text.length > COLLAPSE_THRESHOLD;
  const visibleText =
    collapsible && !expanded ? `${text.slice(0, COLLAPSE_THRESHOLD)}…` : text;

  return (
    <>
      {isUser || isSystem ? (
        <span className="whitespace-pre-wrap">{visibleText}</span>
      ) : (
        <MarkdownText>{visibleText}</MarkdownText>
      )}
      {collapsible && (
        <button
          type="button"
          className="mt-1 block text-xs text-primary hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : `展开全部（共 ${text.length} 字）`}
        </button>
      )}
      {isRunning && !text && <TypingDots />}
      {isRunning && text && !isUser && (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-current align-text-bottom" />
      )}
    </>
  );
}

export function Message() {
  const message = useMessage();
  const { isRunning: threadRunning } = useThread();
  const chat = useAgentChatContext();
  const meta = chat.byId.get(message.id);

  const role = message.role;
  const text = messageText(message.content);
  const isUser = role === "user";
  const isSystem = role === "system";
  const isRunning = message.status?.type === "running";
  const kind: AgentMessageKind = meta?.kind ?? "text";
  const kindMeta = kind !== "text" ? KIND_META[kind] : undefined;
  const isError = kind === "error";

  const agent = meta
    ? AGENT_PROFILES.find((profile) => profile.id === meta.agentId)
    : undefined;
  const cliLabel = meta?.cliToolId ? CLI_TOOL_LABELS[meta.cliToolId] : undefined;
  const time = formatTime(meta?.createdAt);
  const duration = formatDuration(meta?.durationMs);
  const [copied, setCopied] = useState(false);

  const mentions = useMemo(
    () =>
      isUser || !text
        ? []
        : extractFileMentions(text, { projectRoot: chat.projectRoot }),
    [isUser, text, chat.projectRoot],
  );
  const changedPaths = (meta?.fileChanges ?? []).slice(0, 6).map((c) => c.path);
  const attachments = meta?.attachments ?? [];

  const headerParts = [
    isUser ? "我" : isSystem ? (kindMeta?.label ?? "系统") : (agent?.title ?? "Agent"),
    !isUser && cliLabel ? cliLabel : undefined,
    duration,
    time,
  ].filter(Boolean) as string[];

  const canRegenerate =
    !isUser &&
    !isSystem &&
    chat.onRegenerate &&
    message.id === chat.lastAssistantMessageId &&
    !threadRunning;

  const Avatar = isUser ? User : isSystem ? (kindMeta?.icon ?? Info) : Bot;

  return (
    <div
      className={cn("group flex w-full gap-3 px-4 py-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : isError
              ? "bg-danger/15 text-danger"
              : isSystem
                ? "bg-muted text-muted-foreground"
                : "bg-accent text-accent-foreground",
        )}
        style={!isUser && !isSystem && agent ? { color: agent.accent } : undefined}
      >
        <Avatar className="size-4" />
      </div>

      <div className={cn("flex max-w-[80%] min-w-0 flex-col", isUser && "items-end")}>
        {headerParts.length > 0 && (
          <div className="mb-0.5 px-1 text-[11px] text-muted-foreground">
            {headerParts.join(" · ")}
          </div>
        )}

        <div
          className={cn(
            "break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground"
              : isError
                ? "border border-danger/40 bg-danger/5 text-foreground"
                : isSystem
                  ? "border border-border bg-muted/40 text-muted-foreground"
                  : "border border-border bg-card text-card-foreground",
          )}
        >
          <MessageBody
            text={text}
            isUser={isUser}
            isSystem={isSystem}
            isRunning={isRunning}
          />

          {attachments.length > 0 && meta && (
            <AttachmentThumbs
              projectId={meta.projectId}
              attachments={attachments}
              onOpen={chat.onOpenFile}
            />
          )}
          {changedPaths.length > 0 && (
            <FileChips
              title={`文件变更 ${meta?.fileChanges?.length ?? 0} 个`}
              icon={FileText}
              paths={changedPaths}
              onOpen={chat.onOpenFile}
            />
          )}
          {mentions.length > 0 && changedPaths.length === 0 && (
            <FileChips
              title="提到的文件"
              icon={FileText}
              paths={mentions}
              onOpen={chat.onOpenFile}
            />
          )}
        </div>

        {!isRunning && (
          <div
            className={cn(
              "mt-0.5 flex items-center gap-2 px-1 opacity-0 transition-opacity group-hover:opacity-100",
              isUser && "flex-row-reverse",
            )}
          >
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              title="复制消息内容"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Copy className="size-3" /> {copied ? "已复制" : "复制"}
            </button>
            {canRegenerate && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                title="重新生成这条回复"
                onClick={() => chat.onRegenerate?.()}
              >
                <RefreshCw className="size-3" /> 重新生成
              </button>
            )}
            {chat.onDeleteMessage && meta && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-danger"
                title="删除这条消息"
                onClick={() => chat.onDeleteMessage?.(meta.id)}
              >
                <Trash2 className="size-3" /> 删除
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
