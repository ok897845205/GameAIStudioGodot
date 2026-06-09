import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import {
  MessageRuntimeProvider,
  useMessageRuntimeByIndex,
  useThread,
} from "@gameaistudio/assistant/react";
import { Message } from "./message";
import { Composer } from "./composer";

function MessageByIndex({ index }: { index: number }) {
  const runtime = useMessageRuntimeByIndex(index);
  return (
    <MessageRuntimeProvider runtime={runtime}>
      <Message />
    </MessageRuntimeProvider>
  );
}

function ThreadWelcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Sparkles className="size-7" />
      </div>
      <h3 className="text-base font-medium text-foreground">开始对话</h3>
      <p className="max-w-sm text-sm">
        描述你想做的事，AI 会帮你推进。
      </p>
    </div>
  );
}

/**
 * Keeps the viewport pinned to the bottom while content grows (streaming),
 * unless the user has scrolled up.
 */
function useStickToBottom() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const onScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const target = (el.firstElementChild as HTMLElement | null) ?? el;
    const scrollToEnd = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    const ro = new ResizeObserver(scrollToEnd);
    ro.observe(target);
    scrollToEnd();
    return () => ro.disconnect();
  }, []);

  return { viewportRef, onScroll };
}

export function Thread() {
  const { messages } = useThread();
  const { viewportRef, onScroll } = useStickToBottom();

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        ref={viewportRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full max-w-3xl flex-col py-4">
          {messages.length === 0 ? (
            <div className="flex-1">
              <ThreadWelcome />
            </div>
          ) : (
            messages.map((m, i) => <MessageByIndex key={m.id} index={i} />)
          )}
        </div>
      </div>
      <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <Composer />
        </div>
      </div>
    </div>
  );
}
