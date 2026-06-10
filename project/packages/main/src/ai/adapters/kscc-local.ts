import type { LocalCliConfig } from "./local-cli-adapter";

export const ksccLocalConfig: LocalCliConfig = {
  id: "kscc",
  label: "KSCC",
  command: "kscc",
  versionArgs: ["--version"],
  promptArgs: ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
  outputFormat: "claude-stream-json",
  installCommand: ["npm", "install", "-g", "kscc"],
  installHint: "安装 KSCC CLI，或在系统 PATH 中提供 kscc 命令。",
  credentialEnvVars: ["KSCC_API_KEY"],
  credentialHint:
    "KSCC CLI 可能需要登录或配置 KSCC_API_KEY，具体以本机 kscc 命令要求为准。",
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
