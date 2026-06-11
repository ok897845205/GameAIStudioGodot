import type { LocalCliConfig } from "./local-cli-adapter";

export const cursorLocalConfig: LocalCliConfig = {
  id: "cursor",
  label: "Cursor",
  command: "cursor-agent",
  versionArgs: ["--version"],
  // Print mode reads the piped prompt from stdin. The primary integration is
  // the ACP run-mode (`cursor-agent acp`); this is the fallback.
  promptArgs: ["-p", "--output-format", "text"],
  // Cursor CLI installs via its own script, not npm ("manual" disables the
  // in-app install button and surfaces the hint instead).
  installCommand: ["manual"],
  installHint:
    "Cursor CLI 需手动安装：在终端运行 `curl https://cursor.com/install -fsS | bash`（默认装到 ~/.local/bin），安装后刷新。",
  credentialEnvVars: ["CURSOR_API_KEY"],
  credentialHint:
    "Cursor CLI 通常通过 `cursor-agent login` 登录，也支持 CURSOR_API_KEY。",
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
