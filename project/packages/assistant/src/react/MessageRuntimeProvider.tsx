"use client";
import type { ReactNode } from "react";
import type { MessageRuntime } from "../runtime/api/message-runtime";
import { MessageRuntimeContext } from "./context";

/**
 * Provides a `MessageRuntime` to the subtree so `useMessage()` /
 * `useMessageRuntime()` resolve to this message. Typically rendered once per
 * message by the thread message list.
 */
export function MessageRuntimeProvider({
  runtime,
  children,
}: {
  runtime: MessageRuntime;
  children: ReactNode;
}) {
  return (
    <MessageRuntimeContext.Provider value={runtime}>
      {children}
    </MessageRuntimeContext.Provider>
  );
}
