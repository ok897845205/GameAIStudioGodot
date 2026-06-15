import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioProject } from "@gameaistudio/shared";
import { AssetLibraryService } from "./asset-library-service";
import { ImageGenerationService } from "./image-generation-service";
import { MediaSettingsService } from "./media-settings-service";
import type { ProjectService } from "./project-service";

// LIVE end-to-end image generation against the BUILT-IN providers (KSYun /
// OpenRouter). Makes a real upstream call and saves a real image into a temp
// project. Opt-in:
//   RUN_LIVE_IMAGE=1 ./node_modules/.bin/vitest run \
//     packages/main/src/services/image-generation.live.test.ts
const LIVE = process.env.RUN_LIVE_IMAGE === "1";

function fakeProject(rootPath: string): StudioProject {
  return {
    id: "live_project",
    name: "Live Test",
    dimension: "2d",
    prompt: "live test",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "producer"
  };
}

describe.runIf(LIVE)("LIVE image generation (built-in providers)", () => {
  it(
    "generates a real image and saves it into the project assets",
    async () => {
      const dataRoot = await mkdtemp(path.join(os.tmpdir(), "gas-live-data-"));
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gas-live-project-"));
      const settings = new MediaSettingsService(dataRoot, { seedBuiltins: true });
      const project = fakeProject(projectRoot);
      const projectService = { requireProject: async () => project } as unknown as ProjectService;
      const assetLibrary = new AssetLibraryService(projectService);
      const service = new ImageGenerationService(settings, projectService, assetLibrary);

      const modelId = process.env.LIVE_MODEL || undefined; // default: first enabled (nano-banana)
      const result = await service.generateImage({
        projectId: project.id,
        prompt: "a cute pixel-art orange cat game character, side view, transparent background",
        purpose: "character",
        modelId,
        count: 1
      });

      // eslint-disable-next-line no-console
      console.log(
        "\n=== LIVE 生图结果 ===\n" +
          `ok=${result.ok} model=${result.modelId}\n` +
          `attempts:\n${result.attempts
            .map((a) => `  ${a.ok ? "✓" : "✗"} ${a.providerName} / ${a.upstreamModelId} (${Math.round(a.durationMs / 100) / 10}s)${a.error ? " — " + a.error : ""}`)
            .join("\n")}\n` +
          (result.ok ? `saved: ${result.assets.map((x) => x.resPath).join(", ")}\n` : `error: ${result.error}\n`)
      );

      expect(result.ok).toBe(true);
      expect(result.assets.length).toBeGreaterThan(0);
      const saved = result.assets[0]!;
      const fileStat = await stat(path.join(projectRoot, saved.projectRelativePath));
      expect(fileStat.size).toBeGreaterThan(0);

      await rm(dataRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    },
    240_000
  );
});
