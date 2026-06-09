import type { CliToolId } from "@gameaistudio/shared";
import type { runProcess } from "../services/process-runner";
import type { AiAdapter } from "./adapter-contract";
import {
  createLocalCliAdapter,
  type LocalCliAdapter,
} from "./adapters/local-cli-adapter";
import { createEndpointAdapter } from "./adapters/endpoint-adapter";
import { codexLocalConfig } from "./adapters/codex-local";
import { claudeLocalConfig } from "./adapters/claude-local";
import { ksccLocalConfig } from "./adapters/kscc-local";
import { kimiLocalConfig } from "./adapters/kimi-local";
import { cursorCloudConfig } from "./adapters/cursor-cloud";
import { openclawGatewayConfig } from "./adapters/openclaw-gateway";

// First batch — the CLIs that exist today, migrated from CliService. Cloud /
// gateway adapters (cursor-cloud, openclaw-gateway, …) plug in here later.
const LOCAL_CLI_CONFIGS = [
  codexLocalConfig,
  claudeLocalConfig,
  ksccLocalConfig,
  kimiLocalConfig,
];

export interface AdapterRegistry {
  list(): AiAdapter[];
  listLocalCli(): LocalCliAdapter[];
  get(id: string): AiAdapter | undefined;
  require(id: string): AiAdapter;
  requireLocalCli(id: CliToolId): LocalCliAdapter;
}

export function createAdapterRegistry(
  deps: { runner?: typeof runProcess } = {},
): AdapterRegistry {
  const adapters = new Map<string, AiAdapter>();
  const localAdapters = new Map<CliToolId, LocalCliAdapter>();
  for (const config of LOCAL_CLI_CONFIGS) {
    const adapter = createLocalCliAdapter(config, deps);
    adapters.set(config.id, adapter);
    localAdapters.set(config.id as CliToolId, adapter);
  }
  for (const config of [cursorCloudConfig, openclawGatewayConfig]) {
    adapters.set(config.id, createEndpointAdapter(config));
  }

  return {
    list: () => [...adapters.values()],
    listLocalCli: () => [...localAdapters.values()],
    get: (id) => adapters.get(id),
    require: (id) => {
      const adapter = adapters.get(id);
      if (!adapter) throw new Error(`Unknown AI adapter: ${id}`);
      return adapter;
    },
    requireLocalCli: (id) => {
      const adapter = localAdapters.get(id);
      if (!adapter) throw new Error(`Unknown local CLI adapter: ${id}`);
      return adapter;
    },
  };
}
