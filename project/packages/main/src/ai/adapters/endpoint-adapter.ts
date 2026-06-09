import type {
  AdapterCapabilities,
  AdapterHealth,
  AgentTurnRequest,
  AiAdapter,
  DiscoverResult,
  RunModel,
  TurnChunk,
} from "../adapter-contract";
import type { RuntimeEnvironment } from "../runtime-environment";

export type EndpointAdapterConfig = {
  id: string;
  label: string;
  runModel: Extract<RunModel, "cloud" | "gateway">;
  endpointEnvVars: string[];
  credentialEnvVars: string[];
  capabilities: AdapterCapabilities;
};

function firstConfigured(env: RuntimeEnvironment, names: string[]): string | undefined {
  return names.map((name) => env.env[name]?.trim()).find(Boolean);
}

export function createEndpointAdapter(config: EndpointAdapterConfig): AiAdapter {
  const discover = async (env: RuntimeEnvironment): Promise<DiscoverResult> => {
    const endpoint = firstConfigured(env, config.endpointEnvVars);
    return endpoint ? { found: true, executablePath: endpoint } : { found: false };
  };

  const health = async (env: RuntimeEnvironment): Promise<AdapterHealth> => {
    const endpoint = firstConfigured(env, config.endpointEnvVars);
    const hasCredential = Boolean(firstConfigured(env, config.credentialEnvVars));
    if (!endpoint) {
      return {
        installed: false,
        authed: "unknown",
        headlessOk: "unknown",
        detail: `未配置 ${config.endpointEnvVars.join(" / ")}。`,
      };
    }
    return {
      installed: true,
      authed: hasCredential ? true : "unknown",
      headlessOk: "unknown",
      imagesOk: config.capabilities.supportsImages ? "unknown" : false,
      detail: hasCredential ? undefined : `未检测到 ${config.credentialEnvVars.join(" / ")}。`,
    };
  };

  async function* runTurn(_req: AgentTurnRequest, env: RuntimeEnvironment): AsyncIterable<TurnChunk> {
    const endpoint = firstConfigured(env, config.endpointEnvVars);
    if (!endpoint) {
      yield {
        type: "error",
        error: `未配置 ${config.label} endpoint：${config.endpointEnvVars.join(" / ")}`,
      };
      yield {
        type: "final",
        content: "",
        exitCode: 1,
        durationMs: 0,
      };
      return;
    }

    yield {
      type: "error",
      error: `${config.label} Adapter 已注册，但 endpoint 协议尚未接入。`,
    };
    yield {
      type: "final",
      content: "",
      exitCode: 1,
      durationMs: 0,
    };
  }

  return {
    id: config.id,
    label: config.label,
    capabilities: config.capabilities,
    discover,
    health,
    runTurn,
  };
}
