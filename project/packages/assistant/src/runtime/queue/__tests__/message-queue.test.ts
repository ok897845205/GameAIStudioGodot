import { describe, it, expect, vi } from "vitest";
import { createMessageQueue } from "../message-queue";
import type { AppendMessage } from "../../../types/message";

const msg = (text: string): AppendMessage =>
  ({
    role: "user",
    content: [{ type: "text", text }],
    parentId: null,
    sourceId: null,
    runConfig: {},
    metadata: { custom: {} },
    attachments: [],
  }) as unknown as AppendMessage;

describe("createMessageQueue", () => {
  it("runs immediately when idle and buffers while busy", () => {
    const run = vi.fn();
    const queue = createMessageQueue({ run });

    // idle: first enqueue runs immediately and drains the queue
    queue.adapter.enqueue(msg("first"), { steer: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toMatchObject({
      content: [{ type: "text", text: "first" }],
    });
    expect(queue.adapter.items).toHaveLength(0);

    // busy: second enqueue buffers (the prompt text is surfaced for the UI)
    queue.adapter.enqueue(msg("second"), { steer: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.adapter.items).toHaveLength(1);
    expect(queue.adapter.items[0]!.prompt).toBe("second");

    // run settles -> advance to the buffered message
    queue.notifyIdle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(queue.adapter.items).toHaveLength(0);
  });

  it("removes a buffered item without running it", () => {
    const run = vi.fn();
    const queue = createMessageQueue({ run });

    queue.adapter.enqueue(msg("a"), { steer: false }); // runs immediately
    queue.adapter.enqueue(msg("b"), { steer: false }); // buffered
    expect(queue.adapter.items).toHaveLength(1);

    queue.adapter.remove(queue.adapter.items[0]!.id);
    expect(queue.adapter.items).toHaveLength(0);

    queue.notifyIdle();
    // nothing left to advance to
    expect(run).toHaveBeenCalledTimes(1);
  });
});
