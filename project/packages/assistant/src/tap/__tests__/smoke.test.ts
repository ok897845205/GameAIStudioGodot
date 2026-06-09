import { describe, it, expect } from "vitest";
import { resource } from "../core/resource";
import { createResourceRoot } from "../core/createResourceRoot";
import { useState } from "../hooks/useState";
import { useEffect } from "../hooks/useEffect";
import { useMemo } from "../hooks/useMemo";

// The scheduler flushes updates on a MessageChannel macrotask, which a single
// setTimeout(0) doesn't reliably await under concurrent test load. Poll instead
// so the test resolves as soon as the state settles (and never flakes).
const flushUntil = async (predicate: () => boolean, tries = 100) => {
  for (let i = 0; i < tries && !predicate(); i++) {
    await new Promise<void>((r) => setTimeout(r, 1));
  }
};

describe("tap fiber runtime smoke", () => {
  it("renders initial state and exposes output", () => {
    const Counter = resource((props: { start: number }) => {
      const [count, setCount] = useState(props.start);
      const doubled = useMemo(() => count * 2, [count]);
      return { count, doubled, inc: () => setCount((c) => c + 1) };
    });

    const root = createResourceRoot();
    const sub = root.render(Counter({ start: 5 }));

    expect(sub.getValue().count).toBe(5);
    expect(sub.getValue().doubled).toBe(10);
    root.unmount();
  });

  it("re-renders after dispatch and notifies subscribers", async () => {
    const Counter = resource((props: { start: number }) => {
      const [count, setCount] = useState(props.start);
      const doubled = useMemo(() => count * 2, [count]);
      return { count, doubled, inc: () => setCount((c) => c + 1) };
    });

    const root = createResourceRoot();
    const sub = root.render(Counter({ start: 0 }));

    let notifications = 0;
    sub.subscribe(() => {
      notifications++;
    });

    sub.getValue().inc();
    await flushUntil(() => sub.getValue().count === 1);

    expect(sub.getValue().count).toBe(1);
    expect(sub.getValue().doubled).toBe(2);
    expect(notifications).toBeGreaterThan(0);
    root.unmount();
  });

  it("runs effects on commit and cleanups on unmount", async () => {
    // NOTE: under vitest NODE_ENV==="test", createResourceRoot runs in dev
    // StrictMode and intentionally double-invokes effects (mount→cleanup→mount),
    // exactly like React StrictMode. So assert the effect-balance invariant
    // rather than an exact call sequence.
    const log: string[] = [];
    const count = (s: string) => log.filter((x) => x === s).length;
    const active = (n: number) => count(`mount:${n}`) - count(`cleanup:${n}`);

    const WithEffect = resource(() => {
      const [n, setN] = useState(0);
      useEffect(() => {
        log.push(`mount:${n}`);
        return () => log.push(`cleanup:${n}`);
      }, [n]);
      return { n, bump: () => setN((x) => x + 1) };
    });

    const root = createResourceRoot();
    const sub = root.render(WithEffect());
    // n=0 effect is active (exactly one un-cleaned mount)
    expect(active(0)).toBe(1);

    sub.getValue().bump();
    await flushUntil(() => sub.getValue().n === 1);
    expect(sub.getValue().n).toBe(1);
    expect(active(0)).toBe(0); // previous effect cleaned up on dep change
    expect(active(1)).toBe(1); // new effect active

    root.unmount();
    // everything cleaned up: total mounts === total cleanups
    const mounts = log.filter((x) => x.startsWith("mount:")).length;
    const cleanups = log.filter((x) => x.startsWith("cleanup:")).length;
    expect(mounts).toBe(cleanups);
  });
});
