import type { CliToolId } from "@gameaistudio/shared";
import type { runProcess } from "../services/process-runner";
import type { AiAdapter } from "./adapter-contract";
import {
  createLocalCliAdapter,
  type LocalCliAdapter,
} from "./adapters/local-cli-adapter";
import { createEndpointAdapter } from "./adapters/endpoint-adapter";
import { createAcpAgentAdapter } from "./acp/acp-agent-adapter";
import { createPreferAcpAdapter } from "./acp/prefer-acp-adapter";
import { codexLocalConfig } from "./adapters/codex-local";
import { claudeLocalConfig } from "./adapters/claude-local";
import { ksccLocalConfig } from "./adapters/kscc-local";
import { kimiLocalConfig } from "./adapters/kimi-local";
import { geminiLocalConfig } from "./adapters/gemini-local";
import { qwenLocalConfig } from "./adapters/qwen-local";
import { cursorLocalConfig } from "./adapters/cursor-local";
import { copilotLocalConfig } from "./adapters/copilot-local";
import { cursorCloudConfig } from "./adapters/cursor-cloud";
import { openclawGatewayConfig } from "./adapters/openclaw-gateway";

// KSCC first: it is the flagship CLI — listed first in settings and preferred
// by the generic "first usable tool" fallback in chooseAgentCli.
const LOCAL_CLI_CONFIGS = [
  ksccLocalConfig,
  codexLocalConfig,
  claudeLocalConfig,
  kimiLocalConfig,
  geminiLocalConfig,
  qwenLocalConfig,
  cursorLocalConfig,
  copilotLocalConfig,
];

export interface AdapterRegistry {
  list(): AiAdapter[];
  listLocalCli(): LocalCliAdapter[];
  get(id: string): AiAdapter | undefined;
  require(id: string): AiAdapter;
  requireLocalCli(id: CliToolId): LocalCliAdapter;
}

// ACP run-mode upgrades: when the matching ACP agent executable exists on the
// user's machine, the CLI's turns run over the Agent Client Protocol (native
// streaming, tool-call visibility, audited per-action permissions) and fall
// back to the headless one-shot invocation otherwise.
const ACP_UPGRADES: Partial<Record<CliToolId, Parameters<typeof createAcpAgentAdapter>[0]>> = {
  // Claude / Codex use Zed's dedicated ACP adapter packages.
  claude: {
    id: "claude",
    label: "Claude",
    agentCommand: "claude-code-acp",
    installCommand: ["npm", "install", "-g", "@zed-industries/claude-code-acp"],
    installHint:
      "安装 ACP 适配器以启用 Claude 的 ACP 模式：npm install -g @zed-industries/claude-code-acp（复用已有 claude 登录）。",
  },
  codex: {
    id: "codex",
    label: "Codex",
    agentCommand: "codex-acp",
    // Same rationale as the headless `--dangerously-bypass-approvals-and-sandbox`:
    // Codex's Windows sandbox helpers fail to spawn from an Electron child
    // ("windows sandbox: spawn setup refresh"). Permission requests still flow
    // through ACP and are audited per action.
    agentArgs: ["-c", 'sandbox_mode="danger-full-access"'],
    installCommand: ["npm", "install", "-g", "@zed-industries/codex-acp"],
    installHint:
      "安装 ACP 适配器以启用 Codex 的 ACP 模式：npm install -g @zed-industries/codex-acp（复用已有 codex 登录）。",
  },
  // KSCC is a Claude Code fork — the same claude-code-acp adapter drives it
  // via the CLAUDE_CODE_EXECUTABLE override (resolved to the kscc binary).
  kscc: {
    id: "kscc",
    label: "KSCC",
    agentCommand: "claude-code-acp",
    hostCli: { command: "kscc", envVar: "CLAUDE_CODE_EXECUTABLE" },
    installCommand: ["npm", "install", "-g", "@zed-industries/claude-code-acp"],
    installHint:
      "安装 ACP 适配器以启用 KSCC 的 ACP 模式：npm install -g @zed-industries/claude-code-acp（驱动本机 kscc，复用其登录状态）。",
  },
  // The rest speak ACP natively — the agent is the CLI itself with a flag, so
  // installing the CLI is all it takes for the ACP run-mode to light up.
  kimi: {
    id: "kimi",
    label: "Kimi",
    agentCommand: "kimi",
    agentArgs: ["acp"],
    installCommand: ["uv", "tool", "install", "--python", "3.13", "kimi-cli"],
    installHint: "Kimi CLI 原生支持 ACP（kimi acp）。安装 kimi-cli 并完成 /login 后即自动启用。",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    agentCommand: "gemini",
    agentArgs: ["--experimental-acp"],
    installCommand: ["npm", "install", "-g", "@google/gemini-cli"],
    installHint: "Gemini CLI 原生支持 ACP（gemini --experimental-acp）。安装并登录后即自动启用。",
  },
  qwen: {
    id: "qwen",
    label: "Qwen Code",
    agentCommand: "qwen",
    agentArgs: ["--experimental-acp"],
    installCommand: ["npm", "install", "-g", "@qwen-code/qwen-code"],
    installHint: "Qwen Code 原生支持 ACP（qwen --experimental-acp）。安装并登录后即自动启用。",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    agentCommand: "cursor-agent",
    alternateCommands: ["agent"],
    agentArgs: ["acp"],
    installCommand: ["manual"],
    installHint:
      "Cursor CLI 原生支持 ACP（cursor-agent acp）。在终端运行 `curl https://cursor.com/install -fsS | bash` 安装后即自动启用。",
  },
  copilot: {
    id: "copilot",
    label: "Copilot",
    agentCommand: "copilot",
    agentArgs: ["--acp"],
    installCommand: ["npm", "install", "-g", "@github/copilot"],
    installHint: "Copilot CLI 原生支持 ACP（copilot --acp，公测中）。安装并登录后即自动启用。",
  },
};

export function createAdapterRegistry(
  deps: { runner?: typeof runProcess } = {},
): AdapterRegistry {
  const adapters = new Map<string, AiAdapter>();
  const localAdapters = new Map<CliToolId, LocalCliAdapter>();
  for (const config of LOCAL_CLI_CONFIGS) {
    const headless = createLocalCliAdapter(config, deps);
    const acpConfig = ACP_UPGRADES[config.id as CliToolId];
    const adapter = acpConfig
      ? createPreferAcpAdapter(createAcpAgentAdapter(acpConfig), headless)
      : headless;
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
