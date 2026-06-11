import { getProjectLogger } from "../../services/logger";
import type { RuntimeEnvironment } from "../runtime-environment";
import type { AdapterHealth, AgentTurnRequest, HealthOptions, TurnChunk } from "../adapter-contract";
import type { LocalCliAdapter } from "../adapters/local-cli-adapter";
import type { AcpAgentAdapter } from "./acp-agent-adapter";

/** A headless CLI adapter carrying an optional ACP run-mode upgrade. */
export type AcpUpgradedAdapter = LocalCliAdapter & { acp: AcpAgentAdapter };

export function hasAcpUpgrade(adapter: LocalCliAdapter): adapter is AcpUpgradedAdapter {
  return "acp" in adapter && Boolean((adapter as AcpUpgradedAdapter).acp);
}

/**
 * Wraps a headless CLI adapter so turns prefer the richer ACP path when the
 * ACP agent executable is present on this machine, and fall back to the
 * proven one-shot headless invocation otherwise.
 *
 * Discovery / health / install / capabilities keep delegating to the headless
 * adapter: the user manages and sees "Claude" as one tool; ACP is a run-mode
 * upgrade, not a separate tool. The decision is made per turn so installing
 * `claude-code-acp` takes effect without a restart.
 */
export function createPreferAcpAdapter(
  acp: AcpAgentAdapter,
  fallback: LocalCliAdapter,
): AcpUpgradedAdapter {
  async function* runTurn(
    req: AgentTurnRequest,
    env: RuntimeEnvironment,
  ): AsyncIterable<TurnChunk> {
    let useAcp = false;
    try {
      useAcp = await acp.isAvailable(env);
    } catch {
      useAcp = false;
    }
    if (!useAcp) {
      yield* fallback.runTurn(req, env);
      return;
    }
    getProjectLogger(req.workingDir).info("acp", "检测到 ACP agent，本回合走 ACP 模式", {
      adapterId: fallback.id,
      acpAgent: acp.acpConfig.agentCommand,
    });
    yield* acp.runTurn(req, env);
  }

  // Layered health stays the headless adapter's (install/auth/headless probe
  // are about the CLI itself); when ACP is present, the explicit "测试" adds
  // the handshake-derived image capability on top.
  const health = async (
    env: RuntimeEnvironment,
    options?: HealthOptions,
  ): Promise<AdapterHealth> => {
    const base = await fallback.health(env, options);
    if (options?.probe === false) return base;
    try {
      if (!(await acp.isAvailable(env))) return base;
      const probe = await acp.probeCapabilities(env);
      return {
        ...base,
        ...(probe.ok ? { imagesOk: probe.imageSupport } : {}),
      };
    } catch {
      return base;
    }
  };

  return {
    ...fallback,
    health,
    runTurn,
    acp,
  };
}
