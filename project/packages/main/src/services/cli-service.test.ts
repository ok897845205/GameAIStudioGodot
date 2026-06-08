import { describe, expect, it } from "vitest";
import { buildCliDiagnostics, evaluateCredentialStatus } from "./cli-service";

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
});
