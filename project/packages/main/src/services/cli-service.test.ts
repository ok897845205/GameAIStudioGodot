import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CliService,
  buildInstallCommand,
  buildInstallManagerUnavailableResult,
  buildCliDiagnostics,
  cliExecutableCandidates,
  evaluateCredentialStatus,
  findExecutableInDirectory,
  npmGlobalBinPath,
  selectExecutableFromLocatorOutput
} from "./cli-service";

describe("evaluateCredentialStatus", () => {
  it("reports configured credentials when any expected environment variable is present", () => {
    const result = evaluateCredentialStatus(["OPENAI_API_KEY", "ALT_KEY"], {
      OPENAI_API_KEY: "sk-test",
      ALT_KEY: ""
    });

    expect(result.status).toBe("configured");
    expect(result.detectedCredentialEnvVars).toEqual(["OPENAI_API_KEY"]);
  });

  it("reports missing credentials when expected variables are empty", () => {
    const result = evaluateCredentialStatus(["ANTHROPIC_API_KEY"], {
      ANTHROPIC_API_KEY: "   "
    });

    expect(result.status).toBe("missing");
    expect(result.detectedCredentialEnvVars).toEqual([]);
  });

  it("reports unknown when a CLI has no known credential variables", () => {
    const result = evaluateCredentialStatus([], {});

    expect(result.status).toBe("unknown");
    expect(result.detectedCredentialEnvVars).toEqual([]);
  });
});

describe("npmGlobalBinPath", () => {
  it("uses the npm prefix itself as the Windows global bin path", () => {
    expect(npmGlobalBinPath("C:\\Users\\KSG\\AppData\\Roaming\\npm", "win32")).toBe("C:\\Users\\KSG\\AppData\\Roaming\\npm");
  });

  it("uses prefix/bin as the Unix global bin path", () => {
    expect(npmGlobalBinPath("/usr/local/", "linux")).toBe("/usr/local/bin");
  });
});

describe("npm global executable fallback", () => {
  it("checks Windows command shim candidates in npm global bin", () => {
    expect(cliExecutableCandidates("codex", "C:\\Users\\KSG\\AppData\\Roaming\\npm", "win32")).toEqual([
      "C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex.cmd",
      "C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex.exe",
      "C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex.bat",
      "C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex"
    ]);
  });

  it("prefers Windows executable shims from locator output over extensionless npm scripts", () => {
    expect(
      selectExecutableFromLocatorOutput(
        [
          "C:\\Users\\KSG\\AppData\\Roaming\\npm\\kscc",
          "C:\\Users\\KSG\\AppData\\Roaming\\npm\\kscc.cmd",
          "C:\\Users\\KSG\\AppData\\Roaming\\npm\\kscc.exe"
        ].join("\n"),
        "win32"
      )
    ).toBe("C:\\Users\\KSG\\AppData\\Roaming\\npm\\kscc.cmd");
  });

  it("finds a CLI command shim inside a global bin directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-cli-bin-"));

    try {
      const shim = path.join(dir, process.platform === "win32" ? "codex.cmd" : "codex");
      await writeFile(shim, "", "utf8");

      expect(findExecutableInDirectory("codex", dir)).toBe(shim);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds Agent commands with the discovered executable path", () => {
    const service = new CliService();
    const command = service.buildAgentCommand("codex", "hello", "C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex.cmd");

    expect(command.command).toBe("C:\\Users\\KSG\\AppData\\Roaming\\npm\\codex.cmd");
    expect(command.args).toEqual(["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-"]);
    expect(command.stdin).toBe("hello");
  });

  it("builds Kimi Agent commands with prompt on stdin instead of a positional command", () => {
    const service = new CliService();
    const command = service.buildAgentCommand("kimi", "hello", "C:\\Users\\KSG\\.local\\bin\\kimi.exe");

    expect(command.command).toBe("C:\\Users\\KSG\\.local\\bin\\kimi.exe");
    expect(command.args).toEqual(["--print", "--final-message"]);
    expect(command.stdin).toBe("hello");
  });

  it("delegates Agent turns to the selected adapter", async () => {
    const service = new CliService({} as never, {
      requireLocalCli: () => ({
        runTurn: async function* () {
          yield { type: "text-delta", text: "hello" };
          yield { type: "final", content: "hello", exitCode: 0, durationMs: 2 };
        }
      })
    } as never);

    const chunks: unknown[] = [];
    for await (const chunk of service.runTurn("codex", {
      prompt: "hi",
      workingDir: "E:/project",
      images: [],
      signal: new AbortController().signal
    })) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)).toMatchObject({ type: "final", content: "hello" });
  });

  it("builds install commands with the discovered install manager executable path", () => {
    const command = buildInstallCommand(
      ["npm", "install", "-g", "@openai/codex"],
      "C:\\Program Files\\nodejs\\npm.cmd"
    );

    expect(command.command).toBe("C:\\Program Files\\nodejs\\npm.cmd");
    expect(command.args).toEqual(["install", "-g", "@openai/codex"]);
  });

  it("builds a clear install failure when the install manager is unavailable", () => {
    const result = buildInstallManagerUnavailableResult("npm", Date.now());

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("未检测到 npm");
    expect(result.stderr).toContain("手动安装对应 AI CLI");
  });
});

describe("buildCliDiagnostics", () => {
  it("explains missing CLI and unavailable install manager", () => {
    const diagnostics = buildCliDiagnostics({
      installed: false,
      status: "missing",
      installManager: "npm",
      installManagerAvailable: false,
      credentialStatus: "missing",
      credentialEnvVars: ["OPENAI_API_KEY"],
      detectedCredentialEnvVars: [],
      installHint: "通过 npm 安装 Codex。",
      credentialHint: "需要登录或配置 OPENAI_API_KEY。"
    });

    expect(diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      "cli-missing",
      "install-manager",
      "credential-missing"
    ]);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.action).toContain("npm");
    expect(diagnostics[1]?.severity).toBe("warning");
    expect(diagnostics[2]?.action).toContain("OPENAI_API_KEY");
  });

  it("warns when an installed CLI cannot report its version", () => {
    const diagnostics = buildCliDiagnostics({
      installed: true,
      status: "error",
      executablePath: "C:\\tools\\codex.cmd",
      installManager: "npm",
      installManagerAvailable: true,
      installManagerVersion: "10.0.0",
      credentialStatus: "configured",
      credentialEnvVars: ["OPENAI_API_KEY"],
      detectedCredentialEnvVars: ["OPENAI_API_KEY"],
      installHint: "通过 npm 安装 Codex。",
      credentialHint: "需要登录或配置 OPENAI_API_KEY。"
    });

    expect(diagnostics.map((diagnostic) => diagnostic.id)).toContain("cli-version-error");
    expect(diagnostics.find((diagnostic) => diagnostic.id === "install-manager")?.severity).toBe("ok");
    expect(diagnostics.find((diagnostic) => diagnostic.id === "credential-configured")?.detail).toContain("OPENAI_API_KEY");
  });

  it("shows the npm global bin path when a CLI is missing but npm is available", () => {
    const diagnostics = buildCliDiagnostics({
      installed: false,
      status: "missing",
      installManager: "npm",
      installManagerAvailable: true,
      installManagerVersion: "10.0.0",
      installGlobalBinPath: "C:\\Users\\KSG\\AppData\\Roaming\\npm",
      credentialStatus: "missing",
      credentialEnvVars: ["OPENAI_API_KEY"],
      detectedCredentialEnvVars: [],
      installHint: "通过 npm 安装 Codex。",
      credentialHint: "需要登录或配置 OPENAI_API_KEY。"
    });

    const installPath = diagnostics.find((diagnostic) => diagnostic.id === "install-global-bin");
    expect(installPath?.severity).toBe("info");
    expect(installPath?.detail).toBe("C:\\Users\\KSG\\AppData\\Roaming\\npm");
    expect(installPath?.action).toContain("PATH");
  });

  it("includes the discovered install manager path in diagnostics", () => {
    const diagnostics = buildCliDiagnostics({
      installed: false,
      status: "missing",
      installManager: "npm",
      installManagerPath: "C:\\Program Files\\nodejs\\npm.cmd",
      installManagerAvailable: true,
      installManagerVersion: "10.0.0",
      credentialStatus: "missing",
      credentialEnvVars: ["OPENAI_API_KEY"],
      detectedCredentialEnvVars: [],
      installHint: "Install Codex with npm.",
      credentialHint: "Set OPENAI_API_KEY or sign in from the CLI."
    });

    expect(diagnostics.find((diagnostic) => diagnostic.id === "install-manager")?.detail).toContain(
      "C:\\Program Files\\nodejs\\npm.cmd"
    );
  });
});
