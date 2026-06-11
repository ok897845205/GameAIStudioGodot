import type { LocalCliConfig } from "./local-cli-adapter";

export const kimiLocalConfig: LocalCliConfig = {
  id: "kimi",
  label: "Kimi",
  command: "kimi",
  versionArgs: ["--version"],
  promptArgs: ["--print", "--final-message"],
  installCommand: ["uv", "tool", "install", "--python", "3.13", "kimi-cli"],
  installHint:
    "通过 uv 安装 Kimi CLI：uv tool install --python 3.13 kimi-cli（若未安装 uv，先运行 winget install astral-sh.uv）。",
  credentialEnvVars: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  credentialHint:
    "Kimi CLI 通常需要 Moonshot/Kimi API Key，可尝试配置 MOONSHOT_API_KEY 或 KIMI_API_KEY。",
  capabilities: {
    runModel: "local",
    supportsImages: false,
    imageInputMode: "unsupported",
    supportsStream: true,
    supportsResume: false,
    headless: true,
  },
  headlessProbe: { prompt: "ping", timeoutMs: 20000 },
};
