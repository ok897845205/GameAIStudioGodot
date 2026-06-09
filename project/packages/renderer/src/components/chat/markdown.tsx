import { Streamdown } from "streamdown";
import { cn } from "../../lib/utils";

/**
 * Streaming-aware markdown renderer for assistant messages.
 *
 * `streamdown` gracefully renders incomplete markdown (open code fences, half
 * links) as it streams in, and highlights code blocks via shiki. We pin both a
 * light and dark shiki theme so code blocks follow the app theme.
 */
export function MarkdownText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <Streamdown
      shikiTheme={["github-light", "github-dark"]}
      className={cn(
        "text-sm leading-relaxed [&_pre]:my-2 [&_pre]:rounded-lg [&_pre]:text-xs [&_code]:text-[0.85em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:mb-1 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-[0.95rem] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_table]:my-2 [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        className,
      )}
    >
      {children}
    </Streamdown>
  );
}
