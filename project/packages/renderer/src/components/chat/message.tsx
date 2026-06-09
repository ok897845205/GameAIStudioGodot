import { Bot, Info, User } from "lucide-react";
import { useMessage, type MessageState } from "@gameaistudio/assistant/react";
import { cn } from "../../lib/utils";
import { MarkdownText } from "./markdown";

/** Joins the text/reasoning parts of a message into a single string. */
export function messageText(content: MessageState["content"]): string {
  return content
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => (part as { text: string }).text)
    .join("\n\n");
}

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

export function Message() {
  const message = useMessage();
  const role = message.role;
  const text = messageText(message.content);
  const isUser = role === "user";
  const isSystem = role === "system";
  const isRunning = message.status?.type === "running";

  const Avatar = isUser ? User : isSystem ? Info : Bot;

  return (
    <div
      className={cn(
        "flex w-full gap-3 px-4 py-3",
        isUser && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : isSystem
              ? "bg-muted text-muted-foreground"
              : "bg-accent text-accent-foreground",
        )}
      >
        <Avatar className="size-4" />
      </div>
      <div
        className={cn(
          "max-w-[80%] break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "whitespace-pre-wrap bg-primary text-primary-foreground"
            : isSystem
              ? "whitespace-pre-wrap border border-border bg-muted/40 text-muted-foreground"
              : "border border-border bg-card text-card-foreground",
        )}
      >
        {isUser || isSystem ? text : <MarkdownText>{text}</MarkdownText>}
        {isRunning && !text && <TypingDots />}
        {isRunning && text && !isUser && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-current align-text-bottom" />
        )}
      </div>
    </div>
  );
}
