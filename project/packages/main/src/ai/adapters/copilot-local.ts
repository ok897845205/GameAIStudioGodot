import type { LocalCliConfig } from "./local-cli-adapter";

export const copilotLocalConfig: LocalCliConfig = {
  id: "copilot",
  label: "Copilot",
  command: "copilot",
  versionArgs: ["--version"],
  // Piped stdin prompt; --allow-all-tools approves tool actions (project dir
  // sandbox). The primary integration is the ACP run-mode (`copilot --acp`).
  promptArgs: ["--allow-all-tools"],
  installCommand: ["npm", "install", "-g", "@github/copilot"],
  installHint: "通过 npm 全局安装 GitHub Copilot CLI，或把已安装的 copilot 加入 PATH。",
  credentialEnvVars: ["GH_TOKEN", "GITHUB_TOKEN"],
  credentialHint:
    "Copilot CLI 通常通过 GitHub 账号登录（copilot 内置 /login），也支持 GH_TOKEN / GITHUB_TOKEN。",
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
