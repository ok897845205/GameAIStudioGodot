import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Copy,
  Download,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Info,
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

          {attachments.length > 0 && (
            <FileChips
              title="图片"
              icon={ImageIcon}
              paths={attachments.map((a) => a.projectRelativePath)}
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
