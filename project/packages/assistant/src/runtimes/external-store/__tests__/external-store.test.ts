import { describe, it, expect } from "vitest";
import { ExternalStoreRuntimeCore } from "../external-store-runtime-core";
import type { ExternalStoreAdapter } from "../external-store-adapter";
import type { ThreadMessageLike } from "../../../runtime/utils/thread-message-like";
import type { AppendMessage } from "../../../types/message";

const baseAppend = (text: string, parentId: string | null): AppendMessage =>
  ({
    role: "user",
    content: [{ type: "text", text }],
    parentId,
    sourceId: null,
    runConfig: {},
    metadata: { custom: {} },
    attachments: [],
  }) as unknown as AppendMessage;

describe("ExternalStoreRuntimeCore", () => {
  it("reflects adapter messages through convertMessage", () => {
    const adapter: ExternalStoreAdapter<ThreadMessageLike> = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
      convertMessage: (m) => m,
      onNew: async () => {},
    };

    const core = new ExternalStoreRuntimeCore(adapter as ExternalStoreAdapter);
    const thread = core.threads.getMainThreadRuntimeCore();

    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0]!.role).toBe("user");
    expect(thread.messages[0]!.content).toEqual([
      { type: "text", text: "hello" },
    ]);
    expect(thread.messages[1]!.role).toBe("assistant");
  });

  it("derives capabilities from the provided adapter callbacks", () => {
    const core = new ExternalStoreRuntimeCore({
      messages: [{ role: "user", content: "x" }],
      convertMessage: (m: ThreadMessageLike) => m,
      onNew: async () => {},
      onCancel: async () => {},
      setMessages: () => {},
    } as ExternalStoreAdapter);
    const caps = core.threads.getMainThreadRuntimeCore().capabilities;

    expect(caps.cancel).toBe(true); // onCancel provided
    expect(caps.switchToBranch).toBe(true); // setMessages provided
    expect(caps.edit).toBe(false); // no onEdit
    expect(caps.reload).toBe(false); // no onReload
  });

  it("routes a new (non-edit) append to adapter.onNew", async () => {
    let received: AppendMessage | undefined;
    const adapter: ExternalStoreAdapter<ThreadMessageLike> = {
      messages: [{ role: "user", content: "first" }],
      convertMessage: (m) => m,
      onNew: async (m) => {
        received = m;
      },
    };

    const core = new ExternalStoreRuntimeCore(adapter as ExternalStoreAdapter);
    const thread = core.threads.getMainThreadRuntimeCore();
    const lastId = thread.messages.at(-1)!.id;

    await thread.append(baseAppend("second", lastId));

    expect(received).toBeDefined();
    expect(received!.content).toEqual([{ type: "text", text: "second" }]);
  });

  it("passes isRunning through and appends an optimistic placeholder", () => {
    const core = new ExternalStoreRuntimeCore({
      messages: [{ role: "user", content: "go" }],
      convertMessage: (m: ThreadMessageLike) => m,
      onNew: async () => {},
      isRunning: true,
    } as ExternalStoreAdapter);
    const thread = core.threads.getMainThreadRuntimeCore();

    expect(thread.isRunning).toBe(true);
    // while running with a trailing user message, an optimistic assistant
    // placeholder is appended to the head branch
    expect(thread.messages.at(-1)!.role).toBe("assistant");
    expect(thread.messages.at(-1)!.metadata.isOptimistic).toBe(true);
  });

  it("throws when neither messages nor messageRepository is provided", () => {
    expect(
      () =>
        new ExternalStoreRuntimeCore({
          onNew: async () => {},
        } as ExternalStoreAdapter),
    ).toThrow(/must provide either 'messages' or 'messageRepository'/);
  });
});
