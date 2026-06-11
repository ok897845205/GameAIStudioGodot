import type { LocalCliConfig } from "./local-cli-adapter";

export const qwenLocalConfig: LocalCliConfig = {
  id: "qwen",
  label: "Qwen Code",
  command: "qwen",
  versionArgs: ["--version"],
  // Qwen Code is a Gemini CLI fork: piped stdin runs non-interactively and
  // --yolo auto-approves tool actions.
  promptArgs: ["--yolo"],
  installCommand: ["npm", "install", "-g", "@qwen-code/qwen-code"],
  installHint: "通过 npm 全局安装 Qwen Code，或把已安装的 qwen 加入 PATH。",
  credentialEnvVars: ["DASHSCOPE_API_KEY", "OPENAI_API_KEY"],
  credentialHint:
    "Qwen Code 支持 qwen.ai 账号登录或 DASHSCOPE_API_KEY / OpenAI 兼容凭据。若已在 CLI 内登录，可忽略环境变量提示。",
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
