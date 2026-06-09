"use client";
import { createContext, useContext } from "react";
import type { AssistantRuntime } from "../runtime/api/assistant-runtime";
import type { MessageRuntime } from "../runtime/api/message-runtime";

export const AssistantRuntimeContext = createContext<AssistantRuntime | null>(
  null,
);

export const MessageRuntimeContext = createContext<MessageRuntime | null>(null);

export const useAssistantRuntime = (): AssistantRuntime => {
  const ctx = useContext(AssistantRuntimeContext);
  if (!ctx)
    throw new Error(
      "useAssistantRuntime must be used within an <AssistantRuntimeProvider>.",
    );
  return ctx;
};

export const useMessageRuntime = (): MessageRuntime => {
  const ctx = useContext(MessageRuntimeContext);
  if (!ctx)
    throw new Error(
      "useMessageRuntime must be used within a message (see <ThreadMessages>).",
    );
  return ctx;
};
