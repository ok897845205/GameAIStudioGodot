import { describe, it, expect } from "vitest";
import { BaseThreadRuntimeCore } from "../base/base-thread-runtime-core";
import { fromThreadMessageLike } from "../utils/thread-message-like";
import { getAutoStatus } from "../utils/auto-status";
import { generateId } from "../../utils/id";
import type { AppendMessage, ThreadMessage } from "../../types/message";
import type {
  RuntimeCapabilities,
  StartRunConfig,
} from "../interfaces/thread-runtime-core";

const CAPABILITIES: RuntimeCapabilities = {
  switchToBranch: true,
  switchBranchDuringRun: false,
  edit: true,
  reload: true,
  cancel: true,
  unstable_copy: true,
  speech: false,
  dictation: false,
  voice: false,
  attachments: false,
  feedback: false,
  queue: false,
};

// Minimal concrete runtime core: turns appended messages into repository entries.
class TestThreadCore extends BaseThreadRuntimeCore {
  public get adapters() {
    return undefined;
  }
  public get isDisabled() {
    return false;
  }
  public get isSendDisabled() {
    return false;
  }
  public get isLoading() {
    return false;
  }
  public get suggestions() {
    return [];
  }
  public get extras() {
    return undefined;
  }
  public get capabilities() {
    return CAPABILITIES;
  }

  public append(message: AppendMessage): void {
    this.ensureInitialized();
    const tm = fromThreadMessageLike(
      {
        role: message.role,
        content: message.content,
        ...(message.role === "user"
          ? { attachments: message.attachments }
          : {}),
      },
      generateId(),
      getAutoStatus(true, false, false, false, undefined),
    );
    this.repository.addOrUpdateMessage(message.parentId, tm);
    this._notifySubscribers();
  }

  public startRun(_config: StartRunConfig): void {}
  public resumeRun(): void {}
  public addToolResult(): void {}
  public resumeToolCall(): void {}
  public respondToToolApproval(): void {}
  public cancelRun(): void {}
  public exportExternalState() {
    return null;
  }
  public importExternalState(): void {}
}

const contextProvider = { getModelContext: () => ({}) };

const userMessage = (text: string): AppendMessage =>
  ({
    role: "user",
    content: [{ type: "text", text }],
    parentId: null,
    sourceId: null,
    runConfig: {},
    metadata: { custom: {} },
    attachments: [],
  }) as unknown as AppendMessage;

const ids = (messages: readonly ThreadMessage[]) => messages.map((m) => m.id);

describe("BaseThreadRuntimeCore integration", () => {
  it("appends messages and exposes them via the head branch", () => {
    const core = new TestThreadCore(contextProvider);
    core.append(userMessage("hello"));

    expect(core.messages).toHaveLength(1);
    expect(core.messages[0]!.role).toBe("user");
    expect(core.messages[0]!.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("sends from the default thread composer (text -> append)", async () => {
    const core = new TestThreadCore(contextProvider);

    expect(core.composer.canSend).toBe(false); // empty
    core.composer.setText("from composer");
    expect(core.composer.canSend).toBe(true);

    core.composer.send();
    // send() is async (it awaits attachment processing) before calling append
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(core.messages).toHaveLength(1);
    expect(core.messages[0]!.content).toEqual([
      { type: "text", text: "from composer" },
    ]);
    // composer resets after send
    expect(core.composer.text).toBe("");
    expect(core.composer.isEmpty).toBe(true);
  });

  it("supports branching and branch switching through the core", () => {
    const core = new TestThreadCore(contextProvider);
    core.append(userMessage("question"));
    const userId = core.messages[0]!.id;

    // two assistant replies branching off the same user message
    const reply = (text: string): AppendMessage =>
      ({
        role: "assistant",
        content: [{ type: "text", text }],
        parentId: userId,
        sourceId: null,
        runConfig: {},
        metadata: { custom: {} },
      }) as unknown as AppendMessage;

    core.append(reply("answer A"));
    const branchAId = core.messages.at(-1)!.id;
    core.append({ ...reply("answer B"), parentId: userId });
    const branches = core.getBranches(branchAId);
    expect(branches).toHaveLength(2);

    // head currently on the first reply
    expect(core.messages.at(-1)!.content).toEqual([
      { type: "text", text: "answer A" },
    ]);

    core.switchToBranch(branches[1]!);
    expect(core.messages.at(-1)!.content).toEqual([
      { type: "text", text: "answer B" },
    ]);
    expect(ids(core.messages)[0]).toBe(userId);
  });

  it("notifies subscribers on append", () => {
    const core = new TestThreadCore(contextProvider);
    let notifications = 0;
    const unsub = core.subscribe(() => {
      notifications++;
    });
    core.append(userMessage("x"));
    expect(notifications).toBeGreaterThan(0);
    unsub();
  });
});
