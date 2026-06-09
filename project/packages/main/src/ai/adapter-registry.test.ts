import { describe, expect, it } from "vitest";
import { createAdapterRegistry } from "./adapter-registry";

describe("adapter registry", () => {
  it("registers local, cloud, and gateway adapters while keeping local CLI listing separate", () => {
    const registry = createAdapterRegistry();

    expect(registry.list().map((adapter) => adapter.id)).toEqual([
      "codex",
      "claude",
      "kscc",
      "kimi",
      "cursor-cloud",
      "openclaw-gateway",
    ]);
    expect(registry.listLocalCli().map((adapter) => adapter.id)).toEqual(["codex", "claude", "kscc", "kimi"]);
    expect(registry.require("cursor-cloud").capabilities.runModel).toBe("cloud");
    expect(registry.require("openclaw-gateway").capabilities.runModel).toBe("gateway");
  });
});
