import type { LocalCliConfig } from "./local-cli-adapter";

export const codexLocalConfig: LocalCliConfig = {
  id: "codex",
  label: "Codex",
  command: "codex",
  versionArgs: ["--version"],
  // Codex's Windows workspace-write sandbox can fail before the model runs when
  // it tries to apply deny-read ACLs from an Electron child process. GameAIStudio
  // already launches Codex from the selected project root and logs every turn, so
  // use Codex's documented no-sandbox automation mode for reliable local access.
  promptArgs: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-"],
  outputFormat: "codex-jsonl",
  imageArgs: (images) => images.flatMap((image) => (image.path ? ["--image", image.path] : [])),
  installCommand: ["npm", "install", "-g", "@openai/codex"],
  installHint: "通过 npm 全局安装 OpenAI Codex CLI，或把已安装的 codex 加入 PATH。",
  credentialEnvVars: ["OPENAI_API_KEY"],
  credentialHint:
    "Codex CLI 通常需要登录或提供 OPENAI_API_KEY。若已在 CLI 内登录，可忽略环境变量提示。",
  capabilities: {
    runModel: "local",
    supportsImages: true,
    imageInputMode: "file-flag",
    supportsStream: true,
    supportsResume: false,
    headless: true,
  },
  headlessProbe: { prompt: "ping", timeoutMs: 20000 },
};
