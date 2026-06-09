// Root entry for `@gameaistudio/assistant` — the React-facing surface most
// consumers need. Subpaths (`/tap`, `/stream`, `/stream/utils`, `/react`)
// expose the lower layers directly.

export * from "./react";

// Message conversion type used when wiring an ExternalStoreAdapter.
export type { ThreadMessageLike } from "./runtime/utils/thread-message-like";
export { fromThreadMessageLike } from "./runtime/utils/thread-message-like";
export type {
  ThreadMessage,
  ThreadAssistantMessagePart,
  ThreadUserMessagePart,
  TextMessagePart,
  MessageStatus,
  AppendMessage,
} from "./types/message";
