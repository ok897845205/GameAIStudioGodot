import { describe, it, expect } from "vitest";
import { ExternalStoreRuntimeCore } from "../../runtimes/external-store/external-store-runtime-core";
import { AssistantRuntimeImpl } from "../../runtime/api/assistant-runtime";
import type { ExternalStoreAdapter } from "../../runtimes/external-store/external-store-adapter";
import type { ThreadMessageLike } from "../../runtime/utils/thread-message-like";

// Exercises the runtime-api layer (AssistantRuntimeImpl + ThreadRuntime /
// ComposerRuntime / MessageRuntime memoize bindings) over external-store —
// exactly the lifecycle `useExternalStoreRuntime` + the binding hooks wrap.

const makeAdapter = (
  messages: ThreadMessageLike[],
  onNew: (m: unknown) => Promise<void>,
  isRunning = false,
): ExternalStoreAdapter =>
  ({
    messages,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew,
    isRunning,
  }) as unknown as ExternalStoreAdapter;

describe("runtime-api over external-store", () => {
  it("exposes thread state through AssistantRuntimeImpl.thread", () => {
    const core = new ExternalStoreRuntimeCore(
      makeAdapter([{ role: "user", content: "hi" }], async () => {}),
    );
    const runtime = new AssistantRuntimeImpl(core);

    const state = runtime.thread.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.role).toBe("user");
    expect(state.isRunning).toBe(false);
  });

  it("re-reads state and notifies subscribers after setAdapter", () => {
    const core = new ExternalStoreRuntimeCore(
      makeAdapter([{ role: "user", content: "q" }], async () => {}),
    );
    const runtime = new AssistantRuntimeImpl(core);
    const thread = runtime.thread;

    let notified = 0;
    thread.subscribe(() => {
      notified++;
    });

    // a new adapter snapshot: the assistant reply arrived
    core.setAdapter(
      makeAdapter(
        [
          { role: "user", content: "q" },
          { role: "assistant", content: "a" },
        ],
        async () => {},
      ),
    );

    expect(thread.getState().messages).toHaveLength(2);
    expect(thread.getState().messages[1]!.role).toBe("assistant");
    expect(notified).toBeGreaterThan(0);
  });

  it("exposes per-message runtimes by index", () => {
    const core = new ExternalStoreRuntimeCore(
      makeAdapter(
        [
          { role: "user", content: "hello" },
          { role: "assistant", content: "world" },
        ],
        async () => {},
      ),
    );
    const thread = new AssistantRuntimeImpl(core).thread;

    const m0 = thread.getMessageByIndex(0).getState();
    const m1 = thread.getMessageByIndex(1).getState();
    expect(m0.role).toBe("user");
    expect(m0.isLast).toBe(false);
    expect(m1.role).toBe("assistant");
    expect(m1.isLast).toBe(true);
  });

  it("drives the thread composer and routes send to onNew", async () => {
    let received: any;
    const core = new ExternalStoreRuntimeCore(
      makeAdapter([{ role: "user", content: "seed" }], async (m) => {
        received = m;
      }),
    );
    const thread = new AssistantRuntimeImpl(core).thread;

    thread.composer.setText("typed message");
    expect(thread.composer.getState().text).toBe("typed message");
    expect(thread.composer.getState().canSend).toBe(true);

    thread.composer.send();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(received).toBeDefined();
    expect(received.content).toEqual([{ type: "text", text: "typed message" }]);
    // composer cleared after send
    expect(thread.composer.getState().text).toBe("");
  });
});
