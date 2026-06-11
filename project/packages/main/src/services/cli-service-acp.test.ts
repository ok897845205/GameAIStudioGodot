import { describe, expect, it } from "vitest";
import type { AdapterRegistry } from "../ai/adapter-registry";
import type { RuntimeEnvironment } from "../ai/runtime-environment";
import { CliService } from "./cli-service";

/**
 * Verifies the dynamic ACP reporting in `CliService.discover()`: when the ACP
 * agent executable is present, the tool exposes `acp.available` and upgrades
 * its advertised capabilities (image support, session resume) to the ACP
 * adapter's — that is what unlocks the image upload UI for Claude/Codex.
 */

function fakeEnv(): RuntimeEnvironment {
  return {
    platform: "linux",
    env: {},
    which: async () => undefined,
    npmGlobalBin: async () => undefined,
  } as unknown as RuntimeEnvironment;
}

function fakeRegistry(acpFound: boolean): AdapterRegistry {
  const adapter = {
    id: "claude",
    label: "Claude",
    capabilities: {
      runModel: "local",
      supportsImages: false,
      imageInputMode: "unsupported",
      supportsStream: true,
      supportsResume: false,
      headless: true,
    },
    config: {
      id: "claude",
      label: "Claude",
      command: "claude",
      versionArgs: ["--version"],
      promptArgs: ["--print"],
      installCommand: ["npm", "install", "-g", "@anthropic-ai/claude-code"],
      installHint: "install claude",
      credentialEnvVars: [],
      credentialHint: "login",
      capabilities: {} as never,
    },
    discover: async () => ({ found: true, executablePath: "/usr/bin/claude", source: "path" }),
    health: async () => ({ installed: true, authed: true, headlessOk: "unknown" }),
    runTurn: async function* () {
      yield { type: "final", content: "", exitCode: 0, durationMs: 1 };
    },
    acp: {
      id: "claude-acp",
      label: "Claude (ACP)",
      capabilities: {
        runModel: "local",
        supportsImages: true,
        imageInputMode: "base64",
        supportsStream: true,
        supportsResume: true,
        headless: true,
      },
      acpConfig: {
        id: "claude",
        label: "Claude",
        agentCommand: "claude-code-acp",
        installCommand: ["npm", "install", "-g", "@zed-industries/claude-code-acp"],
        installHint: "install acp adapter",
      },
      discover: async () =>
        acpFound
          ? { found: true, executablePath: "/usr/bin/claude-code-acp", source: "path" }
          : { found: false },
      isAvailable: async () => acpFound,
      probeCapabilities: async () => ({ ok: true, imageSupport: true, loadSession: true }),
      health: async () => ({ installed: acpFound, authed: "unknown", headlessOk: "unknown" }),
      runTurn: async function* () {
        yield { type: "final", content: "", exitCode: 0, durationMs: 1 };
      },
      install: async () => ({ ok: false, exitCode: null, stdout: "", stderr: "", durationMs: 0 }),
    },
  };
  return {
    list: () => [adapter as never],
    listLocalCli: () => [adapter as never],
    get: () => adapter as never,
    require: () => adapter as never,
    requireLocalCli: () => adapter as never,
  };
}

describe("CliService ACP status reporting", () => {
  it("upgrades capabilities and reports acp.available when the ACP agent exists", async () => {
    const service = new CliService(fakeEnv(), fakeRegistry(true));
    const [tool] = await service.discover();

    expect(tool?.acp).toMatchObject({
      supported: true,
      available: true,
      agentCommand: "claude-code-acp",
      executablePath: "/usr/bin/claude-code-acp",
    });
    expect(tool?.capabilities.supportsImages).toBe(true);
    expect(tool?.capabilities.imageInputMode).toBe("base64");
    expect(tool?.capabilities.supportsResume).toBe(true);
    expect(tool?.diagnostics.some((d) => d.id === "acp-mode" && d.severity === "ok")).toBe(true);
  });

  it("keeps headless capabilities and shows the install hint when ACP is absent", async () => {
    const service = new CliService(fakeEnv(), fakeRegistry(false));
    const [tool] = await service.discover();

    expect(tool?.acp).toMatchObject({ supported: true, available: false });
    expect(tool?.capabilities.supportsImages).toBe(false);
    expect(tool?.capabilities.supportsResume).toBe(false);
    const diagnostic = tool?.diagnostics.find((d) => d.id === "acp-mode");
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.action).toContain("@zed-industries/claude-code-acp");
  });
});
