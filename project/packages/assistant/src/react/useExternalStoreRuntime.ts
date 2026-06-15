"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalStoreRuntimeCore } from "../runtimes/external-store/external-store-runtime-core";
import type { ExternalStoreAdapter } from "../runtimes/external-store/external-store-adapter";
import type { AssistantRuntime } from "../runtime/api/assistant-runtime";
import { AssistantRuntimeImpl } from "../runtime/api/assistant-runtime";

/**
 * Lean external-store runtime hook. Owns an `ExternalStoreRuntimeCore`,
 * re-applies the adapter on every render so new messages / `isRunning` flow
 * in, and exposes the public `AssistantRuntime` API for the React hooks.
 *
 * Model-context providers are intentionally omitted: GameAIStudio agents
 * receive their context from the local CLI backend, not from a frontend
 * model-context registry.
 */
export const useExternalStoreRuntime = <T>(
  store: ExternalStoreAdapter<T>,
): AssistantRuntime => {
  const [core] = useState(
    () => new ExternalStoreRuntimeCore(store as ExternalStoreAdapter),
  );

  useEffect(() => {
    core.setAdapter(store as ExternalStoreAdapter);
  });

  return useMemo(() => new AssistantRuntimeImpl(core), [core]);
};
