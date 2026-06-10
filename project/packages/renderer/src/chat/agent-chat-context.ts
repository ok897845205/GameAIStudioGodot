import { createContext, useContext } from "react";
import type { AgentMessage } from "@gameaistudio/shared";

/**
 * Chat-level metadata and actions the message bubbles need but the runtime's
 * `ThreadMessageLike` cannot carry: the original `AgentMessage` (kind, CLI,
 * attachments, file changes, …) plus host callbacks (delete / regenerate /
 * open file preview).
 *
 * Lives in its own module so `message.tsx` does not import `agent-chat.tsx`
 * (which imports the chat component index back — a require cycle).
 */
export interface AgentChatContextValue {
  byId: ReadonlyMap<string, AgentMessage>;
  lastAssistantMessageId?: string;
  projectRoot?: string;
  onDeleteMessage?: (messageId: string) => void;
  onRegenerate?: () => void;
  onOpenFile?: (path: string) => void;
}

export const AgentChatContext = createContext<AgentChatContextValue>({
  byId: new Map(),
});

export function useAgentChatContext(): AgentChatContextValue {
  return useContext(AgentChatContext);
}
