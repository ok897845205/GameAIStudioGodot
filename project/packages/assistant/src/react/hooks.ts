"use client";
import { useMemo } from "react";
import { useAssistantRuntime, useMessageRuntime } from "./context";
import { useSubscribable } from "./useSubscribable";
import type { ThreadRuntime, ThreadState } from "../runtime/api/thread-runtime";
import type {
  ThreadComposerRuntime,
  ThreadComposerState,
} from "../runtime/api/composer-runtime";
import type {
  MessageRuntime,
  MessageState,
} from "../runtime/api/message-runtime";

/** The main thread's runtime API (append/startRun/cancel/getMessageByIndex…). */
export const useThreadRuntime = (): ThreadRuntime =>
  useAssistantRuntime().thread;

/** Reactive snapshot of the main thread (messages, isRunning, capabilities…). */
export const useThread = (): ThreadState => {
  const runtime = useThreadRuntime();
  return useSubscribable(
    useMemo(
      () => ({ getState: runtime.getState, subscribe: runtime.subscribe }),
      [runtime],
    ),
  );
};

/** The thread composer's runtime API (setText/send/addAttachment…). */
export const useThreadComposerRuntime = (): ThreadComposerRuntime =>
  useThreadRuntime().composer;

/** Reactive snapshot of the thread composer (text, canSend, attachments…). */
export const useThreadComposer = (): ThreadComposerState => {
  const composer = useThreadComposerRuntime();
  return useSubscribable(
    useMemo(
      () => ({ getState: composer.getState, subscribe: composer.subscribe }),
      [composer],
    ),
  );
};

/** A stable `MessageRuntime` for the message at `index` in the current thread. */
export const useMessageRuntimeByIndex = (index: number): MessageRuntime => {
  const runtime = useThreadRuntime();
  return useMemo(() => runtime.getMessageByIndex(index), [runtime, index]);
};

/** Reactive snapshot of the message in the surrounding message context. */
export const useMessage = (): MessageState => {
  const runtime = useMessageRuntime();
  return useSubscribable(
    useMemo(
      () => ({ getState: runtime.getState, subscribe: runtime.subscribe }),
      [runtime],
    ),
  );
};
