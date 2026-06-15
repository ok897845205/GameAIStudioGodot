import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export function Dialog({
  open,
  onClose,
  closable = true,
  dismissable = true,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  closable?: boolean;
  /**
   * Whether clicking the backdrop or pressing Esc dismisses the dialog.
   * Set false for forms with user input (e.g. New Game) so an accidental
   * outside-click can't discard what was typed; the × button still closes.
   */
  dismissable?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable && dismissable) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable, dismissable, open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={closable && dismissable ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold">{title}</h2>}
              {description && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              disabled={!closable}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              title={closable ? "关闭" : "正在下载或安装更新，暂不能关闭"}
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
