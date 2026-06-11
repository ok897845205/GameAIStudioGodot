import { describe, expect, it } from "vitest";
import { createAdapterRegistry } from "./adapter-registry";
import { hasAcpUpgrade } from "./acp/prefer-acp-adapter";

describe("adapter registry", () => {
  it("registers local, cloud, and gateway adapters while keeping local CLI listing separate", () => {
    const registry = createAdapterRegistry();

    // KSCC leads: it is the flagship CLI.
    expect(registry.list().map((adapter) => adapter.id)).toEqual([
      "kscc",
      "codex",
      "claude",
      "kimi",
      "gemini",
      "qwen",
      "cursor",
      "copilot",
      "cursor-cloud",
      "openclaw-gateway",
    ]);
    expect(registry.listLocalCli().map((adapter) => adapter.id)).toEqual([
      "kscc",
      "codex",
      "claude",
      "kimi",
      "gemini",
      "qwen",
      "cursor",
      "copilot",
    ]);
    expect(registry.require("cursor-cloud").capabilities.runModel).toBe("cloud");
    expect(registry.require("openclaw-gateway").capabilities.runModel).toBe("gateway");
  });

  it("attaches ACP run-mode upgrades to every CLI in the ACP registry", () => {
    const registry = createAdapterRegistry();
    const byId = new Map(registry.listLocalCli().map((adapter) => [adapter.id, adapter]));

    const expectations: Record<string, { command: string; args: string[] }> = {
      kscc: { command: "claude-code-acp", args: [] },
      claude: { command: "claude-code-acp", args: [] },
      codex: { command: "codex-acp", args: ["-c", 'sandbox_mode="danger-full-access"'] },
      kimi: { command: "kimi", args: ["acp"] },
      gemini: { command: "gemini", args: ["--experimental-acp"] },
      qwen: { command: "qwen", args: ["--experimental-acp"] },
      cursor: { command: "cursor-agent", args: ["acp"] },
      copilot: { command: "copilot", args: ["--acp"] },
    };
    for (const [id, expected] of Object.entries(expectations)) {
      const adapter = byId.get(id)!;
      expect(hasAcpUpgrade(adapter), `${id} should have an ACP upgrade`).toBe(true);
      if (hasAcpUpgrade(adapter)) {
        expect(adapter.acp.acpConfig.agentCommand).toBe(expected.command);
        expect(adapter.acp.acpConfig.agentArgs ?? []).toEqual(expected.args);
      }
    }
  });

  it("drives KSCC's ACP mode through claude-code-acp via CLAUDE_CODE_EXECUTABLE", () => {
    const registry = createAdapterRegistry();
    const kscc = registry.listLocalCli().find((adapter) => adapter.id === "kscc")!;
    expect(hasAcpUpgrade(kscc)).toBe(true);
    if (hasAcpUpgrade(kscc)) {
      expect(kscc.acp.acpConfig.hostCli).toEqual({
        command: "kscc",
        envVar: "CLAUDE_CODE_EXECUTABLE",
      });
    }
  });

  it("keeps the alternate executable for Cursor (cursor-agent → agent)", () => {
    const registry = createAdapterRegistry();
    const cursor = registry.listLocalCli().find((adapter) => adapter.id === "cursor")!;
    expect(hasAcpUpgrade(cursor)).toBe(true);
    if (hasAcpUpgrade(cursor)) {
      expect(cursor.acp.acpConfig.alternateCommands).toEqual(["agent"]);
    }
  });
});
