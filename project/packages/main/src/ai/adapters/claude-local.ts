import type { LocalCliConfig } from "./local-cli-adapter";

export const claudeLocalConfig: LocalCliConfig = {
  id: "claude",
  label: "Claude",
  command: "claude",
  versionArgs: ["--version"],
  promptArgs: ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
  outputFormat: "claude-stream-json",
  resumeArgs: (sessionId) => ["--resume", sessionId],
  installCommand: ["npm", "install", "-g", "@anthropic-ai/claude-code"],
  installHint: "通过 npm 全局安装 Claude Code，或把已安装的 claude 加入 PATH。",
  credentialEnvVars: ["ANTHROPIC_API_KEY"],
  credentialHint:
    "Claude CLI 通常需要登录或提供 ANTHROPIC_API_KEY。若已完成 claude 登录，可忽略环境变量提示。",
  capabilities: {
    runModel: "local",
    supportsImages: false,
    imageInputMode: "unsupported",
    supportsStream: true,
    supportsResume: true,
    headless: true,
  },
  // `claude --version` can pass while `claude --print` returns 401 — this probe
  // is what catches that.
  headlessProbe: { prompt: "ping", timeoutMs: 20000 },
};
