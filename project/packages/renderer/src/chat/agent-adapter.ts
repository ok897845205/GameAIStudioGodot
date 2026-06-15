import { useMemo } from "react";
import type { AgentAttachmentInput, AgentMessage } from "@gameaistudio/shared";
import {
  useExternalStoreRuntime,
  type AssistantRuntime,
  type CompleteAttachment,
  type PendingAttachment,
} from "@gameaistudio/assistant/react";
import type { ThreadMessageLike, AppendMessage } from "@gameaistudio/assistant";

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });

/**
 * Chat attachment adapter for game-asset workflows: images become `image`
 * parts (the CLI's vision channel), audio files become `file` parts (the
 * agent receives them as on-disk paths and wires them into the game).
 */
class ChatAttachmentAdapter {
  public accept = "image/*,audio/*";

  public async add(state: { file: File }): Promise<PendingAttachment> {
    const isAudio = state.file.type.startsWith("audio/");
    return {
      id: state.file.name,
      type: isAudio ? "audio" : "image",
      name: state.file.name,
      contentType: state.file.type,
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    if (!attachment.file) {
      throw new Error(`附件 ${attachment.name} 缺少文件内容。`);
    }
    const dataUrl = await readFileAsDataUrl(attachment.file);
    const mimeType = attachment.contentType ?? attachment.file.type;
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        mimeType.startsWith("audio/")
          ? {
              type: "file",
              filename: attachment.name,
              data: dataUrl,
              mimeType,
            }
          : { type: "image", image: dataUrl },
      ],
    };
  }

  public async remove() {
    // noop
  }
}

/**
 * Converts a GameAIStudio `AgentMessage` into the runtime's `ThreadMessageLike`.
 *
 * - `agent` role maps to `assistant` for the internal chat runtime.
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
    for (const part of att.content) {
      if (part.type === "image") {
        return [
          {
            name: att.name,
            mimeType: att.contentType ?? "image/png",
            size: Math.round((part.image.length * 3) / 4),
            dataUrl: part.image,
          },
        ];
      }
      if (part.type === "file") {
        return [
          {
            name: part.filename ?? att.name,
            mimeType: part.mimeType,
            size: Math.round((part.data.length * 3) / 4),
            dataUrl: part.data,
          },
        ];
      }
    }
    return [];
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
  supportsImages?: boolean;
  onSend: (input: AgentSendInput) => Promise<void>;
}): AssistantRuntime {
  const attachments = useMemo(() => new ChatAttachmentAdapter(), []);
  return useExternalStoreRuntime<AgentMessage>({
    messages: opts.messages,
    isRunning: opts.isRunning,
    isSendDisabled: opts.isSendDisabled,
    convertMessage: agentMessageToThreadMessageLike,
    adapters: opts.supportsImages ? { attachments } : undefined,
    onNew: async (message) => {
      await opts.onSend({
        text: appendMessageText(message),
        attachments: appendMessageAttachments(message),
      });
    },
  });
}
