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

/** How long a runtime ACP failure disables the ACP path for this adapter. */
const ACP_BROKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Wraps a headless CLI adapter so turns prefer the richer ACP path when the
 * ACP agent executable is present on this machine, and fall back to the
 * proven one-shot headless invocation otherwise.
 *
 * Resilience over purity: user environments vary wildly (forks, adapter
 * version drift, exotic models). If an ACP turn fails before producing ANY
 * text, the same turn is automatically retried over the headless path, and
 * the ACP path is benched for a while so later turns don't keep paying for a
 * broken adapter.
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
  let acpBrokenUntil = 0;

  async function* runTurn(
    req: AgentTurnRequest,
    env: RuntimeEnvironment,
  ): AsyncIterable<TurnChunk> {
    const plog = getProjectLogger(req.workingDir);
    let useAcp = false;
    try {
      useAcp = await acp.isAvailable(env);
    } catch {
      useAcp = false;
    }
    if (useAcp && Date.now() < acpBrokenUntil) {
      plog.warn("acp", "ACP 模式近期异常，本回合直接使用 headless", {
        adapterId: fallback.id,
        brokenUntil: new Date(acpBrokenUntil).toISOString(),
      });
      useAcp = false;
    }
    if (!useAcp) {
      yield* fallback.runTurn(req, env);
      return;
    }
    plog.info("acp", "检测到 ACP agent，本回合走 ACP 模式", {
      adapterId: fallback.id,
      acpAgent: acp.acpConfig.agentCommand,
    });

    // Stream the ACP turn live, but hold back the terminal chunks until we
    // know whether it failed before producing anything — that case retries
    // the same turn over headless instead of surfacing a broken-adapter error.
    let sawText = false;
    const terminal: TurnChunk[] = [];
    for await (const chunk of acp.runTurn(req, env)) {
      if (chunk.type === "text-delta") sawText = true;
      if (chunk.type === "final" || chunk.type === "error") {
        terminal.push(chunk);
        continue;
      }
      yield chunk;
    }
    const final = terminal.find(
      (chunk): chunk is Extract<TurnChunk, { type: "final" }> => chunk.type === "final",
    );
    const barrenFailure =
      Boolean(final) && final!.exitCode !== 0 && !final!.cancelled && !final!.timedOut && !sawText;
    if (!barrenFailure) {
      for (const chunk of terminal) yield chunk;
      return;
    }

    acpBrokenUntil = Date.now() + ACP_BROKEN_TTL_MS;
    plog.warn("acp", "ACP 回合在产出内容前失败，自动切换 headless 重试本回合", {
      adapterId: fallback.id,
      acpAgent: acp.acpConfig.agentCommand,
      acpStderrTail: final?.stderr?.slice(-600),
      benchedMinutes: ACP_BROKEN_TTL_MS / 60000,
    });
    yield {
      type: "step",
      title: "ACP 模式异常，已自动切换 headless 模式重试本回合",
    };
    if (req.signal.aborted) {
      for (const chunk of terminal) yield chunk;
      return;
    }
    yield* fallback.runTurn(req, env);
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
