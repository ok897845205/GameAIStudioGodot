import type { LocalCliConfig } from "./local-cli-adapter";

export const kimiLocalConfig: LocalCliConfig = {
  id: "kimi",
  label: "Kimi",
  command: "kimi",
  versionArgs: ["--version"],
  promptArgs: ["--print"],
  installCommand: ["npm", "install", "-g", "@moonshot-ai/kimi-cli"],
  installHint: "安装 Kimi CLI，或在系统 PATH 中提供 kimi 命令。",
  credentialEnvVars: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  credentialHint:
    "Kimi CLI 通常需要 Moonshot/Kimi API Key，可尝试配置 MOONSHOT_API_KEY 或 KIMI_API_KEY。",
  capabilities: {
    runModel: "local",
    supportsImages: true,
    imageInputMode: "prompt-path-reference",
    supportsStream: true,
    supportsResume: false,
    headless: true,
  },
  headlessProbe: { prompt: "ping", timeoutMs: 20000 },
};
