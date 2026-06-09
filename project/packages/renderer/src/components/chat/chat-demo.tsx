import { useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from "@gameaistudio/assistant/react";
import type { ThreadMessageLike, AppendMessage } from "@gameaistudio/assistant";
import { Thread } from "./thread";

type DemoMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

const appendText = (message: AppendMessage): string =>
  message.content
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");

/**
 * Self-contained chat harness with an in-memory streaming "echo" backend.
 * Proves the runtime ↔ React bindings ↔ chat components wiring end to end
 * (streaming reveal, auto-scroll, composer). The real GameAIStudio wiring
 * (runAgentTurn / AgentMessage conversion) lands in #13.
 */
export function ChatDemo() {
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runtime = useExternalStoreRuntime<DemoMessage>({
    messages,
    isRunning,
    convertMessage: (m): ThreadMessageLike => ({
      id: m.id,
      role: m.role,
      content: m.text,
    }),
    onNew: async (message) => {
      const text = appendText(message);
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", text },
      ]);

      setIsRunning(true);
      const reply = [
        `收到：**${text}**`,
        "",
        "这是一个 markdown + 代码高亮的流式示例：",
        "",
        "```gdscript",
        "extends Node2D",
        "",
        "func _ready() -> void:",
        `    print("Hello, ${text}")`,
        "```",
        "",
        "- 支持 *斜体*、`行内代码`",
        "- 支持有序/无序列表",
        "- 代码块按主题高亮",
      ].join("\n");
      const replyId = uid();
      setMessages((prev) => [...prev, { id: replyId, role: "assistant", text: "" }]);
      for (let i = 1; i <= reply.length; i++) {
        await new Promise((r) => setTimeout(r, 24));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId ? { ...m, text: reply.slice(0, i) } : m,
          ),
        );
      }
      setIsRunning(false);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-screen">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
