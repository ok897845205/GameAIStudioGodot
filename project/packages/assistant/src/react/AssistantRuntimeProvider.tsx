"use client";
import type { ReactNode } from "react";
import type { AssistantRuntime } from "../runtime/api/assistant-runtime";
import { AssistantRuntimeContext } from "./context";

export function AssistantRuntimeProvider({
  runtime,
  children,
}: {
  runtime: AssistantRuntime;
  children: ReactNode;
}) {
  return (
    <AssistantRuntimeContext.Provider value={runtime}>
      {children}
    </AssistantRuntimeContext.Provider>
  );
}
