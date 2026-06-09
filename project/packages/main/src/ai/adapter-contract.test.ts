import { describe, it, expect } from "vitest";
import { collectTurn, type TurnChunk } from "./adapter-contract";

async function* stream(...chunks: TurnChunk[]): AsyncIterable<TurnChunk> {
  for (const c of chunks) yield c;
}

describe("collectTurn", () => {
  it("accumulates text deltas and finalizes from the final chunk", async () => {
    const result = await collectTurn(
      stream(
        { type: "step", title: "thinking" },
        { type: "text-delta", text: "Hello " },
        { type: "stderr-delta", text: "debug\n" },
        { type: "text-delta", text: "world" },
        { type: "final", content: "Hello world", stderr: "debug\n", exitCode: 0, durationMs: 12 },
      ),
    );
    expect(result.content).toBe("Hello world");
    expect(result.stderr).toBe("debug\n");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBe(12);
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("falls back to accumulated deltas when final omits content", async () => {
    const result = await collectTurn(
      stream(
        { type: "text-delta", text: "partial" },
        { type: "final", content: "", exitCode: 0, durationMs: 5 },
      ),
    );
    expect(result.content).toBe("partial");
  });

  it("surfaces an error chunk", async () => {
    const result = await collectTurn(
      stream(
        { type: "text-delta", text: "x" },
        { type: "error", error: "401 unauthorized" },
        { type: "final", content: "", exitCode: 1, durationMs: 3, timedOut: true },
      ),
    );
    expect(result.error).toBe("401 unauthorized");
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(true);
  });
});
