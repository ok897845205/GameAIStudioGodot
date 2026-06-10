import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@gameaistudio/assistant/react";
import type { AgentMessage } from "@gameaistudio/shared";
import { Thread } from "../components/chat";
import { useAgentChatRuntime, type AgentSendInput } from "./agent-adapter";
import { AgentChatContext, type AgentChatContextValue } from "./agent-chat-context";

export { useAgentChatContext, type AgentChatContextValue } from "./agent-chat-context";

/**
 * A complete GameAIStudio agent chat: translates `AgentMessage`s into the
 * runtime, renders the ChatGPT-style thread, and routes the composer's send to
 * `onSend` (which the host implements with `window.studio.runAgentTurn`).
 *
 * State (messages / running / sending) stays with the host so the existing
 * project-state flow and IPC contract are untouched. One `AgentChat` is
 * mounted per (project × agent) thread.
 */
export function AgentChat({
  messages,
  isRunning,
  isSendDisabled,
  supportsImages,
  projectRoot,
  onSend,
  onDeleteMessage,
  onRegenerate,
  onOpenFile,
}: {
  messages: readonly AgentMessage[];
  isRunning: boolean;
  isSendDisabled?: boolean;
  supportsImages?: boolean;
  projectRoot?: string;
  onSend: (input: AgentSendInput) => Promise<void>;
  onDeleteMessage?: (messageId: string) => void;
  onRegenerate?: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const runtime = useAgentChatRuntime({
    messages,
    isRunning,
    isSendDisabled,
    supportsImages,
    onSend,
  });

  const context = useMemo<AgentChatContextValue>(() => {
    const byId = new Map(messages.map((m) => [m.id, m]));
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "agent");
    return {
      byId,
      lastAssistantMessageId: lastAssistant?.id,
      projectRoot,
      onDeleteMessage,
      onRegenerate,
      onOpenFile,
    };
  }, [messages, projectRoot, onDeleteMessage, onRegenerate, onOpenFile]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentChatContext.Provider value={context}>
        <Thread />
      </AgentChatContext.Provider>
    </AssistantRuntimeProvider>
  );
}
