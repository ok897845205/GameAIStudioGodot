import { describe, it, expect } from "vitest";
import {
  createAssistantStream,
  AssistantMessageStream,
  type AssistantMessage,
} from "../index";

async function collect(
  stream: ReturnType<typeof createAssistantStream>,
): Promise<AssistantMessage[]> {
  const msgStream = AssistantMessageStream.fromAssistantStream(stream);
  const snapshots: AssistantMessage[] = [];
  for await (const m of msgStream) snapshots.push(m);
  return snapshots;
}

describe("assistant-stream: text accumulation", () => {
  it("accumulates streamed text deltas into a single growing text part", async () => {
    const stream = createAssistantStream((c) => {
      c.appendText("Hello");
      c.appendText(" ");
      c.appendText("world");
    });

    const snapshots = await collect(stream);
    const final = snapshots.at(-1)!;

    expect(final.parts).toHaveLength(1);
    expect(final.parts[0]).toMatchObject({ type: "text", text: "Hello world" });
    expect(final.status.type).toBe("complete");
    // timing is computed once the message leaves the running state
    expect(final.metadata.timing).toBeDefined();

    // streaming property: an earlier snapshot showed partial text
    const texts = snapshots
      .map((m) => (m.parts[0]?.type === "text" ? m.parts[0].text : undefined))
      .filter((t): t is string => t !== undefined);
    expect(texts).toContain("Hello");
    // monotonic growth — each text snapshot is a prefix-extension of the prior
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i]!.startsWith(texts[i - 1]!)).toBe(true);
    }
  });

  it("opens separate parts for text then an explicit second text part", async () => {
    const stream = createAssistantStream((c) => {
      c.appendText("first");
      const p = c.addTextPart();
      p.append("second");
      p.close();
    });

    const final = (await collect(stream)).at(-1)!;
    expect(final.parts).toHaveLength(2);
    expect(final.parts[0]).toMatchObject({ type: "text", text: "first" });
    expect(final.parts[1]).toMatchObject({ type: "text", text: "second" });
  });
});

describe("assistant-stream: tool calls", () => {
  it("streams tool-call args as partial JSON and parses them incrementally", async () => {
    const stream = createAssistantStream(async (c) => {
      const tool = c.addToolCallPart({ toolName: "search", toolCallId: "tc1" });
      tool.argsText.append('{"q":"go');
      tool.argsText.append('dot"}');
      await tool.close();
    });

    const snapshots = await collect(stream);
    const final = snapshots.at(-1)!;

    expect(final.parts).toHaveLength(1);
    const part = final.parts[0]!;
    expect(part.type).toBe("tool-call");
    if (part.type !== "tool-call") throw new Error("expected tool-call");
    expect(part.toolName).toBe("search");
    expect(part.toolCallId).toBe("tc1");
    expect(part.argsText).toBe('{"q":"godot"}');
    expect(part.args).toMatchObject({ q: "godot" });

    // a mid-stream snapshot parsed the *partial* JSON object
    const partialArgs = snapshots.flatMap((m) =>
      m.parts[0]?.type === "tool-call" ? [m.parts[0].args] : [],
    );
    expect(partialArgs.some((a) => a["q"] === "go")).toBe(true);
  });
});

describe("assistant-stream: error handling", () => {
  it("surfaces an error chunk as an incomplete/error status", async () => {
    // Drive the accumulator with an explicit error chunk (the same chunk the
    // run-task emits when a callback throws), keeping the test deterministic and
    // free of run-task promise rejections.
    let captured: string | undefined;
    const stream = createAssistantStream((c) => {
      c.appendText("partial");
      c.enqueue({ type: "error", path: [], error: "boom" });
    });

    const msgStream = AssistantMessageStream.fromAssistantStream(stream);
    const snapshots: AssistantMessage[] = [];
    for await (const m of msgStream) snapshots.push(m);

    const final = snapshots.at(-1)!;
    expect(final.status.type).toBe("incomplete");
    if (final.status.type === "incomplete") {
      expect(final.status.reason).toBe("error");
      captured = final.status.error as string;
    }
    expect(captured).toBe("boom");
  });
});
