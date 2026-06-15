import type { ThreadMessage } from "../../types/message";
import type { ReadonlyJSONValue } from "../../stream/utils";
import type { Tool, ToolModelContentPart } from "../../stream";

/**
 * Minimal internal `ToolInvocationTracker` implementation.
 *
 * Full client-side tool execution would handle `streamCall` / `execute`,
 * human-input interrupts, and per-call status tracking. GameAIStudio runs
 * local CLI agents and never executes client-side
 * tools, so it never sets `unstable_enableToolInvocations` — meaning the
 * external-store runtime constructs this tracker only on an opt-in that we do
 * not use. This implementation preserves the exact public surface the runtime
 * references (constructor + setState/abort/resume/reset) while doing no work.
 * If client-side tools are ever needed, this is the extension point.
 */

export type ToolExecutionStatus =
  | { type: "executing" }
  | {
      type: "interrupt";
      payload: { type: "human"; payload: unknown };
    };

export type AddToolResultCommand = {
  readonly type: "add-tool-result";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result: ReadonlyJSONValue;
  readonly isError: boolean;
  readonly artifact?: ReadonlyJSONValue;
  readonly modelContent?: readonly ToolModelContentPart[];
};

export type ToolInvocationTrackerSnapshot = {
  readonly messages: readonly ThreadMessage[];
  readonly isRunning: boolean;
  readonly isLoading?: boolean;
};

export type ToolInvocationTrackerCallbacks = {
  onResult: (command: AddToolResultCommand) => void;
  onStatusesChange: (
    statuses: ReadonlyMap<string, ToolExecutionStatus>,
  ) => void;
};

export class ToolInvocationTracker {
  constructor(
    _getTools: () => Record<string, Tool<any, any>> | undefined,
    _callbacks: ToolInvocationTrackerCallbacks,
  ) {}

  public setState(_snapshot: ToolInvocationTrackerSnapshot): void {}

  public resume(_toolCallId: string, _payload: unknown): boolean {
    return false;
  }

  public async abort(): Promise<void> {}

  public reset(): void {}
}
