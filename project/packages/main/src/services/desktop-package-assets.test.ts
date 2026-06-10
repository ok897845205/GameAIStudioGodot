import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop package assets", () => {
  it("configures a bundled Windows application icon", async () => {
    const root = process.cwd();
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      build?: {
        icon?: string;
        win?: { icon?: string; artifactName?: string; target?: Array<{ target?: string; arch?: string[] }> };
      };
    };
    const iconPath = path.join(root, "build", "icon.ico");
    const icon = await readFile(iconPath);

    expect(packageJson.scripts?.build).toContain("assets:icon");
    expect(packageJson.scripts?.test).toContain("assets:icon");
    expect(packageJson.build?.icon).toBe("build/icon.ico");
    expect(packageJson.build?.win?.icon).toBe("build/icon.ico");
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
    expect(icon.length).toBeGreaterThan(1024);
  });

  it("exposes bundled Godot smoke commands", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:templates"]).toBe("node scripts/smoke-godot-templates.mjs");
    expect(packageJson.scripts?.["smoke:webzip"]).toBe("node scripts/smoke-webzip.mjs");
  });

  it("exposes a release verification command that covers code, Web zip, and installer gates", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:release"]).toBe("pnpm typecheck && pnpm test && pnpm smoke:webzip && pnpm dist:win");
  });

  it("configures an explicit Windows installer target for ordinary users", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      build?: {
        files?: string[];
        win?: { artifactName?: string; target?: Array<{ target?: string; arch?: string[] }> };
        nsis?: {
          oneClick?: boolean;
          allowToChangeInstallationDirectory?: boolean;
          createDesktopShortcut?: boolean;
          createStartMenuShortcut?: boolean;
          shortcutName?: string;
          deleteAppDataOnUninstall?: boolean;
        };
      };
    };

    expect(packageJson.build?.win?.artifactName).toBe("${productName}-Setup-${version}.${ext}");
    expect(packageJson.build?.files).toContain(".env");
    expect(packageJson.build?.win?.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    expect(packageJson.build?.nsis).toMatchObject({
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "GameAIStudio",
      deleteAppDataOnUninstall: false
    });
  });

  it("documents the release gate and installer handoff", async () => {
    const root = process.cwd();
    const projectReadme = await readFile(path.join(root, "README.md"), "utf8");
    const workspaceReadme = await readFile(path.join(root, "..", "README.md"), "utf8");

    for (const readme of [projectReadme, workspaceReadme]) {
      expect(readme).toContain("pnpm verify:release");
      expect(readme).toContain("GameAIStudio-Setup-<version>.exe");
    }

    expect(projectReadme).toContain("pnpm smoke:webzip");
    expect(projectReadme).toContain("当前应用能力");
    expect(workspaceReadme).toContain("参考项目");
  });
});
