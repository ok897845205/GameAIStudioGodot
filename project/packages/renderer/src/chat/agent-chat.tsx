import { AssistantRuntimeProvider } from "@gameaistudio/assistant/react";
import type { AgentMessage } from "@gameaistudio/shared";
import { Thread } from "../components/chat";
import { useAgentChatRuntime, type AgentSendInput } from "./agent-adapter";

/**
 * A complete GameAIStudio agent chat: translates `AgentMessage`s into the
 * runtime, renders the ChatGPT-style thread, and routes the composer's send to
 * `onSend` (which the host implements with `window.studio.runAgentTurn`).
 *
 * State (messages / running / sending) stays with the host so the existing
 * project-state flow and IPC contract are untouched. One `AgentChat` is
 * mounted per (project × agent) thread (see #14).
 */
export function AgentChat({
  messages,
  isRunning,
  isSendDisabled,
  onSend,
}: {
  messages: readonly AgentMessage[];
  isRunning: boolean;
  isSendDisabled?: boolean;
  onSend: (input: AgentSendInput) => Promise<void>;
}) {
  const runtime = useAgentChatRuntime({
    messages,
    isRunning,
    isSendDisabled,
    onSend,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
