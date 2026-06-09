import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";
import {
  AGENT_PROFILES,
  CLI_TOOL_LABELS,
  type CliToolId,
  type StudioRun,
  type StudioRunStatus,
  type StudioRunStep,
} from "@gameaistudio/shared";
import { cn } from "../lib/utils";

function agentTitle(agentId?: string): string | undefined {
  if (!agentId) return undefined;
  return AGENT_PROFILES.find((a) => a.id === agentId)?.title;
}

function statusLabel(status: StudioRunStatus): string {
  const map: Record<StudioRunStatus, string> = {
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return map[status];
}

function statusToneClass(status: StudioRunStatus): string {
  switch (status) {
    case "running":
      return "text-primary";
    case "completed":
      return "text-success";
    case "failed":
      return "text-danger";
    case "cancelled":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function StatusIcon({ status }: { status: StudioRunStatus }) {
  const cls = cn("size-4 shrink-0", statusToneClass(status));
  switch (status) {
    case "running":
      return <Loader2 className={cn(cls, "animate-spin")} />;
    case "completed":
      return <CheckCircle2 className={cls} />;
    case "failed":
      return <XCircle className={cls} />;
    case "cancelled":
      return <MinusCircle className={cls} />;
    default:
      return <CircleDashed className={cls} />;
  }
}

function formatDuration(ms?: number): string | undefined {
  if (!ms || ms <= 0) return undefined;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
}

function StepRow({
  step,
  defaultOpen,
}: {
  step: StudioRunStep;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Keep the running step expanded as new output streams in.
  useEffect(() => {
    if (step.status === "running") setOpen(true);
  }, [step.status]);

  const preRef = useRef<HTMLPreElement>(null);
  // Auto-scroll live output to the bottom while the step is running.
  useLayoutEffect(() => {
    if (step.status === "running" && open && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [step.output, step.status, open]);

  const meta = [
    agentTitle(step.agentId),
    step.cliToolId ? CLI_TOOL_LABELS[step.cliToolId as CliToolId] : undefined,
    typeof step.exitCode === "number" ? `exit ${step.exitCode}` : undefined,
    formatDuration(step.durationMs),
  ].filter(Boolean) as string[];

  const hasBody = Boolean(step.output?.trim() || step.message?.trim());

  return (
    <div className="rounded-lg border border-border bg-card/40">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
        onClick={() => hasBody && setOpen((v) => !v)}
      >
        <StatusIcon status={step.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{step.title}</span>
          {meta.length > 0 && (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {meta.join(" · ")}
            </span>
          )}
        </span>
        {hasBody &&
          (open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          ))}
      </button>

      {open && hasBody && (
        <div className="border-t border-border px-2.5 py-2">
          {step.message?.trim() && (
            <p
              className={cn(
                "mb-1.5 whitespace-pre-wrap break-words text-xs",
                step.status === "failed" ? "text-danger" : "text-muted-foreground",
              )}
            >
              {step.message.trim()}
            </p>
          )}
          {step.output?.trim() && (
            <pre
              ref={preRef}
              className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/90"
            >
              {step.output.trim()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function RunActivityPanel({ runs }: { runs: StudioRun[] }) {
  const ordered = useMemo(
    () =>
      [...runs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runs],
  );
  const activeRun = ordered.find(
    (r) => r.status === "running" || r.status === "queued",
  );
  const defaultId = activeRun?.id ?? ordered[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultId);

  // Follow the active run automatically when one starts.
  useEffect(() => {
    if (activeRun) setSelectedId(activeRun.id);
  }, [activeRun?.id]);

  const run = ordered.find((r) => r.id === selectedId) ?? ordered[0];

  if (!run) {
    return (
      <p className="px-1 py-6 text-center text-xs text-muted-foreground">
        还没有运行记录。点击「团队工作流」或给 Agent 发消息后，这里会实时显示每个
        Agent 的状态和输出日志。
      </p>
    );
  }

  const done = run.steps.filter(
    (s) => s.status === "completed" || s.status === "failed" || s.status === "cancelled",
  ).length;

  return (
    <div className="space-y-2">
      {ordered.length > 1 && (
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          value={run.id}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {ordered.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.createdAt).toLocaleString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {" · "}
              {r.title}
              {r.status === "running" ? " · 运行中" : ""}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2">
        <StatusIcon status={run.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{run.title}</span>
          <span className="text-[11px] text-muted-foreground">
            {statusLabel(run.status)} · {done}/{run.steps.length} 步
          </span>
        </span>
      </div>

      {run.steps.map((step) => (
        <StepRow key={step.id} step={step} defaultOpen={step.status === "running"} />
      ))}

      {run.summary && (
        <p className="rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
          {run.summary}
        </p>
      )}
    </div>
  );
}
