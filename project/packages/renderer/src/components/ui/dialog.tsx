import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
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
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="关闭"
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
