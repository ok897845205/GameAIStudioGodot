import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Palette, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

/** The subset of Electron.WebviewTag this component calls. */
interface WebviewElement extends HTMLElement {
  reload(): void;
}

/** 马良画卷 — embedded AI image-generation canvas. */
export const IMAGE_LAB_URL = "http://ailab.seasungame.com/maliang/";

/**
 * Full-area overlay hosting the image lab in an Electron <webview>.
 *
 * - `partition="persist:maliang"` keeps the login session across app restarts.
 * - The component stays mounted once opened and is only visibility-toggled,
 *   so switching back to chat never reloads the canvas (in-progress
 *   generations survive).
 */
export function ImageLabView({
  active,
  onClose,
  onOpenExternal,
}: {
  active: boolean;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return;
    const onFailLoad = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      // -3 = aborted (normal during in-page navigation); subframe errors are noise.
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setLoadError(detail.errorDescription || `加载失败（${detail.errorCode ?? "unknown"}）`);
    };
    const onDidNavigate = () => setLoadError(undefined);
    view.addEventListener("did-fail-load", onFailLoad);
    view.addEventListener("did-navigate", onDidNavigate);
    return () => {
      view.removeEventListener("did-fail-load", onFailLoad);
      view.removeEventListener("did-navigate", onDidNavigate);
    };
  }, []);

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 flex flex-col bg-background",
        active ? "visible" : "invisible pointer-events-none",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onClose} title="返回工作台">
          <ArrowLeft /> 返回
        </Button>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Palette className="size-4" /> AI 生图 · 马良画卷
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          生成的图片可下载后拖入聊天发给 Agent 使用
        </span>
        <Button
          variant="ghost"
          size="icon"
          title="刷新页面"
          onClick={() => {
            setLoadError(undefined);
            webviewRef.current?.reload();
          }}
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="在系统浏览器中打开"
          onClick={() => onOpenExternal(IMAGE_LAB_URL)}
        >
          <ExternalLink />
        </Button>
      </div>

      {loadError && (
        <div className="flex items-center gap-3 border-b border-danger/40 bg-danger/5 px-4 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1 truncate" title={loadError}>
            页面加载失败：{loadError}（请确认内网可达）
          </span>
          <button
            className="shrink-0 font-medium hover:underline"
            onClick={() => {
              setLoadError(undefined);
              webviewRef.current?.reload();
            }}
          >
            重试
          </button>
        </div>
      )}

      <webview
        ref={(element) => {
          webviewRef.current = element as WebviewElement | null;
        }}
        src={IMAGE_LAB_URL}
        partition="persist:maliang"
        allowpopups
        className="min-h-0 w-full flex-1"
      />
    </div>
  );
}
