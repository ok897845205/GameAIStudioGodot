import { describe, it, expect } from "vitest";
import { MessageRepository } from "../message-repository";
import { fromThreadMessageLike, type ThreadMessageLike } from "../thread-message-like";
import { getAutoStatus } from "../auto-status";
import type { ThreadMessage } from "../../../types/message";

const mk = (
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
): ThreadMessage =>
  fromThreadMessageLike(
    { id, role, content: text } as ThreadMessageLike,
    id,
    getAutoStatus(false, false, false, false, undefined),
  );

const ids = (messages: readonly ThreadMessage[]) => messages.map((m) => m.id);

describe("MessageRepository: linear", () => {
  it("appends messages along the head branch", () => {
    const repo = new MessageRepository();
    repo.addOrUpdateMessage(null, mk("u1", "user", "hi"));
    repo.addOrUpdateMessage("u1", mk("a1", "assistant", "hello"));

    expect(ids(repo.getMessages())).toEqual(["u1", "a1"]);
    expect(repo.headId).toBe("a1");
  });
});

describe("MessageRepository: branching (regenerate)", () => {
  it("keeps sibling branches and switches between them", () => {
    const repo = new MessageRepository();
    repo.addOrUpdateMessage(null, mk("u1", "user", "hi"));
    repo.addOrUpdateMessage("u1", mk("a1", "assistant", "hello"));
    // regenerate: a second assistant reply under the same user message
    repo.addOrUpdateMessage("u1", mk("a2", "assistant", "hello again"));

    // both replies are branches of the same parent
    expect(repo.getBranches("a1").sort()).toEqual(["a1", "a2"]);
    // head stays on the original branch until we switch
    expect(ids(repo.getMessages())).toEqual(["u1", "a1"]);

    repo.switchToBranch("a2");
    expect(ids(repo.getMessages())).toEqual(["u1", "a2"]);
    expect(repo.headId).toBe("a2");

    repo.switchToBranch("a1");
    expect(ids(repo.getMessages())).toEqual(["u1", "a1"]);
  });

  it("survives an export/import round-trip preserving branches and head", () => {
    const repo = new MessageRepository();
    repo.addOrUpdateMessage(null, mk("u1", "user", "hi"));
    repo.addOrUpdateMessage("u1", mk("a1", "assistant", "hello"));
    repo.addOrUpdateMessage("u1", mk("a2", "assistant", "again"));
    repo.switchToBranch("a2");

    const exported = repo.export();
    expect(exported.headId).toBe("a2");
    expect(exported.messages).toHaveLength(3);

    const repo2 = new MessageRepository();
    repo2.import(exported);
    expect(repo2.headId).toBe("a2");
    expect(repo2.getBranches("a1").sort()).toEqual(["a1", "a2"]);
    expect(ids(repo2.getMessages())).toEqual(["u1", "a2"]);
  });
});

describe("MessageRepository: delete relinks children", () => {
  it("relinks a deleted message's children to its parent", () => {
    const repo = new MessageRepository();
    repo.addOrUpdateMessage(null, mk("u1", "user", "q"));
    repo.addOrUpdateMessage("u1", mk("a1", "assistant", "ans"));
    repo.addOrUpdateMessage("a1", mk("u2", "user", "follow"));

    // deleting the middle message defaults its replacement to its parent (u1)
    repo.deleteMessage("a1");

    expect(ids(repo.getMessages())).toEqual(["u1", "u2"]);
    expect(repo.headId).toBe("u2");
  });
});

describe("thread-message-like conversion", () => {
  it("expands string content into a single text part", () => {
    const m = fromThreadMessageLike(
      { role: "assistant", content: "hi" },
      "x",
      getAutoStatus(true, false, false, false, undefined),
    );
    expect(m.role).toBe("assistant");
    expect(m.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("drops empty text parts and rejects status on non-assistant roles", () => {
    const m = fromThreadMessageLike(
      { role: "assistant", content: [{ type: "text", text: "   " }] },
      "x",
      getAutoStatus(false, false, false, false, undefined),
    );
    expect(m.content).toHaveLength(0);

    expect(() =>
      fromThreadMessageLike(
        {
          role: "user",
          content: "hi",
          status: { type: "running" },
        } as ThreadMessageLike,
        "y",
        getAutoStatus(false, false, false, false, undefined),
      ),
    ).toThrow(/status is only supported for assistant messages/);
  });
});
