"use client";
// Lean React runtime bindings for GameAIStudio, built directly on the ported
// runtime/api (AssistantRuntimeImpl / ThreadRuntime / MessageRuntime /
// ComposerRuntime) + a minimal `useSubscribable`. This replaces upstream
// assistant-ui's store framework + core/react + primitives (~24k lines) with a
// thin layer tailored to our chat UI.

export { AssistantRuntimeProvider } from "./AssistantRuntimeProvider";
export { MessageRuntimeProvider } from "./MessageRuntimeProvider";
export { useExternalStoreRuntime } from "./useExternalStoreRuntime";
export {
  AssistantRuntimeContext,
  MessageRuntimeContext,
  useAssistantRuntime,
  useMessageRuntime,
} from "./context";
export {
  useThreadRuntime,
  useThread,
  useThreadComposerRuntime,
  useThreadComposer,
  useMessageRuntimeByIndex,
  useMessage,
} from "./hooks";
export { useSubscribable, type Subscribable } from "./useSubscribable";

// Attachment adapter + types for composers that accept files (e.g. images).
export {
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  CompositeAttachmentAdapter,
} from "../adapters/attachment";
export type {
  Attachment,
  CompleteAttachment,
  PendingAttachment,
} from "../types/attachment";

// Re-export the runtime-api types most consumers need.
export type {
  AssistantRuntime,
} from "../runtime/api/assistant-runtime";
export type {
  ThreadRuntime,
  ThreadState,
} from "../runtime/api/thread-runtime";
export type {
  ThreadComposerRuntime,
  ThreadComposerState,
  ComposerState,
} from "../runtime/api/composer-runtime";
export type {
  MessageRuntime,
  MessageState,
} from "../runtime/api/message-runtime";
export type {
  ExternalStoreAdapter,
  ExternalStoreMessageConverter,
} from "../runtimes/external-store/external-store-adapter";
