import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Music, Paperclip, Send, Square, X } from "lucide-react";
import {
  useThread,
  useThreadComposer,
  useThreadComposerRuntime,
  useThreadRuntime,
} from "@gameaistudio/assistant/react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

/** Hard cap on images per message — keeps prompts and CLI argv sane. */
const MAX_IMAGES_PER_MESSAGE = 4;

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
  const canAttachImages = Boolean(capabilities.attachments);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [attachNotice, setAttachNotice] = useState("");

  // Transient "当前 CLI 不支持图片输入" style hint for paste / drop attempts.
  useEffect(() => {
    if (!attachNotice) return;
    const timer = setTimeout(() => setAttachNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [attachNotice]);

  // Grow with the content up to the CSS max-height, then scroll inside.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [composer.text]);

  // Create one object URL per pending image attachment (not per render) and
  // revoke them when the attachment set changes or the composer unmounts.
  // Audio attachments get an icon chip instead of a thumbnail.
  const thumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const att of composer.attachments) {
      if (att.file && (att.contentType ?? att.file.type).startsWith("image/")) {
        map.set(att.id, URL.createObjectURL(att.file));
      }
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

  const addFiles = (files: FileList | File[] | null): number => {
    if (!files) return 0;
    const images = Array.from(files).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("audio/"),
    );
    if (images.length === 0) return 0;
    if (!canAttachImages) {
      setAttachNotice("当前 CLI 不支持图片附件，请切换到支持图片的 CLI（音频不受限制）。");
      return 0;
    }
    const room = MAX_IMAGES_PER_MESSAGE - composer.attachments.length;
    if (room <= 0) {
      setAttachNotice(`每条消息最多 ${MAX_IMAGES_PER_MESSAGE} 个图片/音频附件。`);
      return 0;
    }
    const accepted = images.slice(0, room);
    if (accepted.length < images.length) {
      setAttachNotice(`每条消息最多 ${MAX_IMAGES_PER_MESSAGE} 个附件，已保留前 ${accepted.length} 个。`);
    }
    for (const file of accepted) {
      void composerRuntime.addAttachment(file);
    }
    return accepted.length;
  };

  // Clipboard images (screenshots) paste straight into the composer.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.some((file) => file.type.startsWith("image/") || file.type.startsWith("audio/"))) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onDragOver = (e: DragEvent<HTMLFormElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    setDragActive(true);
  };

  const onDrop = (e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDragActive(false);
    addFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  return (
    <form
      onSubmit={onSubmit}
      onDragOver={onDragOver}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40",
        dragActive &&
          (canAttachImages
            ? "ring-2 ring-primary/50"
            : "ring-2 ring-destructive/40"),
      )}
    >
      {attachNotice && (
        <p className="px-1 pt-1 text-xs text-destructive">{attachNotice}</p>
      )}
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
                ) : (att.contentType ?? "").startsWith("audio/") ? (
                  <Music className="size-4 text-muted-foreground" />
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
          className={cn(
            "flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors",
            canAttachImages
              ? "cursor-pointer hover:bg-accent hover:text-foreground"
              : "cursor-not-allowed opacity-45",
          )}
          title={canAttachImages ? "添加图片或音频" : "当前 CLI 不支持图片附件"}
        >
          <Paperclip className="size-4" />
          <input
            type="file"
            accept="image/*,audio/*"
            multiple
            className="hidden"
            disabled={!canAttachImages}
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
          onPaste={onPaste}
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
