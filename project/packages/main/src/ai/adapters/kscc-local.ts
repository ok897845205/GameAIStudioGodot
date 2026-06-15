import type { LocalCliConfig } from "./local-cli-adapter";

export const ksccLocalConfig: LocalCliConfig = {
  id: "kscc",
  label: "KSCC",
  command: "kscc",
  versionArgs: ["--version"],
  promptArgs: ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
  outputFormat: "claude-stream-json",
  // KSCC supports Claude Code-compatible resume semantics: `--resume <id>`
  // continues the same session, with the id parsed from the previous turn.
  resumeArgs: (sessionId) => ["--resume", sessionId],
  installCommand: ["npm", "i", "-g", "bun@1.3.14", "@seasun/kscc", "--registry=http://npmhub.ksyun.com"],
  installHint:
    "通过 npm 安装 KSCC（需先安装 Node.js，可在「系统环境」一键安装）：npm i -g bun@1.3.14 @seasun/kscc --registry=http://npmhub.ksyun.com",
  credentialEnvVars: ["KSCC_API_KEY"],
  credentialHint:
    "KSCC CLI 可能需要登录或配置 KSCC_API_KEY，具体以本机 kscc 命令要求为准。",
  capabilities: {
    runModel: "local",
    supportsImages: false,
    imageInputMode: "unsupported",
    supportsStream: true,
    supportsResume: true,
    headless: true,
  },
  headlessProbe: { prompt: "ping", timeoutMs: 20000 },
};
