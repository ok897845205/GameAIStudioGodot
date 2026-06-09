import {
  useEffect,
  useMemo,
  useRef,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import {
  useThread,
  useThreadComposer,
  useThreadComposerRuntime,
  useThreadRuntime,
} from "@gameaistudio/assistant/react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export function Composer({
  placeholder = "给 AI 发消息…",
}: {
  placeholder?: string;
}) {
  const composer = useThreadComposer();
  const composerRuntime = useThreadComposerRuntime();
  const threadRuntime = useThreadRuntime();
  const { isRunning, capabilities } = useThread();
  const canStop = isRunning && capabilities.cancel;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Create one object URL per pending attachment (not per render) and revoke
  // them when the attachment set changes or the composer unmounts.
  const thumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const att of composer.attachments) {
      if (att.file) map.set(att.id, URL.createObjectURL(att.file));
    }
    return map;
  }, [composer.attachments]);

  useEffect(
    () => () => {
      for (const url of thumbs.values()) URL.revokeObjectURL(url);
    },
    [thumbs],
  );

  const submit = () => {
    if (composer.canSend) composerRuntime.send();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        void composerRuntime.addAttachment(file);
      }
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40"
    >
      {composer.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pt-1">
          {composer.attachments.map((att, idx) => {
            const thumb = thumbs.get(att.id);
            return (
              <div
                key={att.id}
                className="group relative flex items-center gap-1.5 rounded-lg border border-border bg-background py-1 pl-1 pr-2 text-xs"
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt={att.name}
                    className="size-7 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="size-4 text-muted-foreground" />
                )}
                <span className="max-w-[8rem] truncate" title={att.name}>
                  {att.name}
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() =>
                    void composerRuntime.getAttachmentByIndex(idx).remove()
                  }
                  title="移除"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        <label
          className="flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="添加图片"
        >
          <Paperclip className="size-4" />
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>

        <textarea
          ref={textareaRef}
          value={composer.text}
          onChange={(e) => composerRuntime.setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          className={cn(
            "max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground",
          )}
        />

        {canStop ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={() => threadRuntime.cancelRun()}
            title="停止"
          >
            <Square />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!composer.canSend || isRunning}
            title="发送"
          >
            <Send />
          </Button>
        )}
      </div>
    </form>
  );
}
