import type { LocalCliConfig } from "./local-cli-adapter";

export const geminiLocalConfig: LocalCliConfig = {
  id: "gemini",
  label: "Gemini",
  command: "gemini",
  versionArgs: ["--version"],
  // Gemini CLI runs non-interactively when the prompt is piped via stdin;
  // --yolo auto-approves tool actions (we run in the project sandbox dir).
  promptArgs: ["--yolo"],
  installCommand: ["npm", "install", "-g", "@google/gemini-cli"],
  installHint: "通过 npm 全局安装 Gemini CLI，或把已安装的 gemini 加入 PATH。",
  credentialEnvVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  credentialHint:
    "Gemini CLI 支持 Google 账号登录或 GEMINI_API_KEY / GOOGLE_API_KEY。若已在 CLI 内登录，可忽略环境变量提示。",
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
