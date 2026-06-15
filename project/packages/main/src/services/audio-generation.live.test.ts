import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioProject } from "@gameaistudio/shared";
import { AssetLibraryService } from "./asset-library-service";
import { AudioGenerationService } from "./audio-generation-service";
import { AudioSettingsService } from "./audio-settings-service";
import type { ProjectService } from "./project-service";

// LIVE end-to-end audio generation against the BUILT-IN ACE Music provider.
// Opt-in (real upstream call, ~30s):
//   RUN_LIVE_AUDIO=1 ./node_modules/.bin/vitest run \
//     packages/main/src/services/audio-generation.live.test.ts
const LIVE = process.env.RUN_LIVE_AUDIO === "1";

function fakeProject(rootPath: string): StudioProject {
  return {
    id: "live_audio",
    name: "Live Audio",
    dimension: "2d",
    prompt: "live",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
}

describe.runIf(LIVE)("LIVE audio generation (built-in ACE Music)", () => {
  it(
    "generates a real audio clip and saves it into assets/audio",
    async () => {
      const dataRoot = await mkdtemp(path.join(os.tmpdir(), "gas-live-adata-"));
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gas-live-aproject-"));
      const settings = new AudioSettingsService(dataRoot, { seedBuiltins: true });
      const project = fakeProject(projectRoot);
      const projectService = { requireProject: async () => project } as unknown as ProjectService;
      const assetLibrary = new AssetLibraryService(projectService);
      const service = new AudioGenerationService(settings, projectService, assetLibrary);

      const result = await service.generateAudio({
        projectId: project.id,
        kind: "sfx",
        prompt: "short retro 8-bit coin pickup blip",
        durationSeconds: 1
      });

      // eslint-disable-next-line no-console
      console.log(
        "\n=== LIVE 音频结果 ===\n" +
          `ok=${result.ok}\n` +
          `attempts:\n${result.attempts
            .map((a) => `  ${a.ok ? "✓" : "✗"} ${a.providerName} (${Math.round(a.durationMs / 100) / 10}s)${a.error ? " — " + a.error : ""}`)
            .join("\n")}\n` +
          (result.ok ? `saved: ${result.audios.map((x) => `${x.resPath} (${x.format})`).join(", ")}\n` : `error: ${result.error}\n`)
      );

      expect(result.ok).toBe(true);
      const saved = result.audios[0]!;
      const fileStat = await stat(path.join(projectRoot, saved.projectRelativePath));
      expect(fileStat.size).toBeGreaterThan(0);

      await rm(dataRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    },
    240_000
  );
});
