import { useMemo } from "react";
import type { AgentAttachmentInput, AgentMessage } from "@gameaistudio/shared";
import {
  SimpleImageAttachmentAdapter,
  useExternalStoreRuntime,
  type AssistantRuntime,
} from "@gameaistudio/assistant/react";
import type { ThreadMessageLike, AppendMessage } from "@gameaistudio/assistant";

/**
 * Converts a GameAIStudio `AgentMessage` into the runtime's `ThreadMessageLike`.
 *
 * - `agent` role maps to `assistant` (assistant-ui's vocabulary).
 * - Content is the raw agent text; the runtime wraps it into a single text part.
 *   (File-change / image-attachment rendering is layered on later via custom
 *   parts — kept out of the core conversion so it stays a pure, testable map.)
 */
export function agentMessageToThreadMessageLike(
  message: AgentMessage,
): ThreadMessageLike {
  const role: ThreadMessageLike["role"] =
    message.role === "agent" ? "assistant" : message.role;
  return {
    id: message.id,
    role,
    content: message.content,
  };
}

/** Extracts the plain text a user typed from an outgoing AppendMessage. */
export function appendMessageText(message: AppendMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("\n");
}

/**
 * Extracts image attachments from an outgoing AppendMessage as the
 * `AgentAttachmentInput`s `runAgentTurn` expects (name/mimeType/size/dataUrl).
 * The composer's `SimpleImageAttachmentAdapter` stores each image as a single
 * `image` content part whose `image` field is a data URL.
 */
export function appendMessageAttachments(
  message: AppendMessage,
): AgentAttachmentInput[] {
  return (message.attachments ?? []).flatMap((att) => {
    const imagePart = att.content.find((p) => p.type === "image");
    if (!imagePart || imagePart.type !== "image") return [];
    const dataUrl = imagePart.image;
    return [
      {
        name: att.name,
        mimeType: att.contentType ?? "image/png",
        size: Math.round((dataUrl.length * 3) / 4),
        dataUrl,
      },
    ];
  });
}

export type AgentSendInput = {
  text: string;
  attachments: AgentAttachmentInput[];
};

/**
 * Wires an array of `AgentMessage`s (already filtered for one project×agent
 * thread) and a send callback into a runtime the chat components consume.
 *
 * The host owns the messages/isRunning state and the `onSend` implementation
 * (which calls `window.studio.runAgentTurn` and folds the returned messages
 * back into state). This keeps the existing IPC contract untouched — the
 * adapter is a thin translation layer.
 */
export function useAgentChatRuntime(opts: {
  messages: readonly AgentMessage[];
  isRunning: boolean;
  isSendDisabled?: boolean;
  onSend: (input: AgentSendInput) => Promise<void>;
}): AssistantRuntime {
  const attachments = useMemo(() => new SimpleImageAttachmentAdapter(), []);
  return useExternalStoreRuntime<AgentMessage>({
    messages: opts.messages,
    isRunning: opts.isRunning,
    isSendDisabled: opts.isSendDisabled,
    convertMessage: agentMessageToThreadMessageLike,
    adapters: { attachments },
    onNew: async (message) => {
      await opts.onSend({
        text: appendMessageText(message),
        attachments: appendMessageAttachments(message),
      });
    },
  });
}
