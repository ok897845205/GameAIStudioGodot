import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@gameaistudio/shared";
import { fromThreadMessageLike, type AppendMessage } from "@gameaistudio/assistant";
import {
  agentMessageToThreadMessageLike,
  appendMessageText,
} from "./agent-adapter";

const agentMsg = (
  role: AgentMessage["role"],
  content: string,
  id = "m1",
): AgentMessage => ({
  id,
  projectId: "p1",
  agentId: "producer",
  role,
  content,
  createdAt: new Date("2026-01-01").toISOString(),
});

const COMPLETE = { type: "complete", reason: "stop" } as const;

describe("agentMessageToThreadMessageLike", () => {
  it("maps agent → assistant and preserves id/content", () => {
    const like = agentMessageToThreadMessageLike(agentMsg("agent", "hello", "a1"));
    expect(like.role).toBe("assistant");
    expect(like.id).toBe("a1");
    expect(like.content).toBe("hello");
  });

  it("keeps user and system roles", () => {
    expect(agentMessageToThreadMessageLike(agentMsg("user", "hi")).role).toBe(
      "user",
    );
    expect(
      agentMessageToThreadMessageLike(agentMsg("system", "note")).role,
    ).toBe("system");
  });

  it("produces ThreadMessageLike the runtime converter accepts", () => {
    const assistant = fromThreadMessageLike(
      agentMessageToThreadMessageLike(agentMsg("agent", "答案")),
      "fallback",
      COMPLETE,
    );
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toEqual([{ type: "text", text: "答案" }]);

    // system messages must convert to exactly one text part (runtime invariant)
    const system = fromThreadMessageLike(
      agentMessageToThreadMessageLike(agentMsg("system", "团队工作流完成")),
      "fallback",
      COMPLETE,
    );
    expect(system.role).toBe("system");
    expect(system.content).toEqual([{ type: "text", text: "团队工作流完成" }]);

    const user = fromThreadMessageLike(
      agentMessageToThreadMessageLike(agentMsg("user", "做个黄金矿工")),
      "fallback",
      COMPLETE,
    );
    expect(user.role).toBe("user");
  });
});

describe("appendMessageText", () => {
  it("joins text parts of an outgoing message", () => {
    const message = {
      role: "user",
      content: [
        { type: "text", text: "第一行" },
        { type: "text", text: "第二行" },
      ],
      parentId: null,
      sourceId: null,
      runConfig: {},
      metadata: { custom: {} },
    } as unknown as AppendMessage;

    expect(appendMessageText(message)).toBe("第一行\n第二行");
  });
});
