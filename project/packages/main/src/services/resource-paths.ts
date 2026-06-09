import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { GameDimension } from "@gameaistudio/shared";

export interface StudioPaths {
  resourceRoot: string;
  dataRoot: string;
  projectsRoot: string;
  templatesRoot: string;
  engineRoot: string;
  godotGuiPath?: string;
  godotConsolePath?: string;
}

function uniqueExisting(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean).map((candidate) => path.resolve(candidate)))];
}

export function findResourceRoot(candidates: string[]): string | undefined {
  return uniqueExisting(candidates).find((candidate) =>
    existsSync(path.join(candidate, "gameaistudio_template")) && existsSync(path.join(candidate, "engine"))
  );
}

export function resolveResourceRoot(): string {
  const appPath = app.getAppPath();
  const candidates = uniqueExisting([
    process.env.GAMEAISTUDIO_RESOURCE_ROOT ?? "",
    process.resourcesPath,
    appPath,
    path.resolve(appPath, ".."),
    path.resolve(appPath, "..", ".."),
    process.cwd(),
    path.resolve(process.cwd(), "project")
  ]);

  const resourceRoot = findResourceRoot(candidates);

  return resourceRoot ?? process.cwd();
}

export function resolveStudioPaths(): StudioPaths {
  const resourceRoot = resolveResourceRoot();
  const dataRoot =
    process.env.GAMEAISTUDIO_HOME?.trim() || path.join(app.getPath("documents"), "GameAIStudio");
  const engineRoot = path.join(resourceRoot, "engine");
  const godotGuiPath = path.join(engineRoot, "Godot_v4.6.2-stable_win64.exe");
  const godotConsolePath = path.join(engineRoot, "Godot_v4.6.2-stable_win64_console.exe");

  return {
    resourceRoot,
    dataRoot,
    projectsRoot: path.join(dataRoot, "projects"),
    templatesRoot: path.join(resourceRoot, "gameaistudio_template"),
    engineRoot,
    godotGuiPath: existsSync(godotGuiPath) ? godotGuiPath : undefined,
    godotConsolePath: existsSync(godotConsolePath) ? godotConsolePath : undefined
  };
}

export function getTemplatePath(paths: StudioPaths, dimension: GameDimension): string {
  return path.join(paths.templatesRoot, `gameaistudio_template_${dimension}`);
}
