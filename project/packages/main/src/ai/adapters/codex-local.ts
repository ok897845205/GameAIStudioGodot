import type { LocalCliConfig } from "./local-cli-adapter";

export const codexLocalConfig: LocalCliConfig = {
  id: "codex",
  label: "Codex",
  command: "codex",
  versionArgs: ["--version"],
  promptArgs: ["exec", "--skip-git-repo-check", "-"],
  installCommand: ["npm", "install", "-g", "@openai/codex"],
  installHint: "通过 npm 全局安装 OpenAI Codex CLI，或把已安装的 codex 加入 PATH。",
  credentialEnvVars: ["OPENAI_API_KEY"],
  credentialHint:
    "Codex CLI 通常需要登录或提供 OPENAI_API_KEY。若已在 CLI 内登录，可忽略环境变量提示。",
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
