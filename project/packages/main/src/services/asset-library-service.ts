import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DeleteGeneratedAssetInput,
  GeneratedAssetAspect,
  GeneratedAssetPurpose,
  GeneratedAssetRecord,
  ProjectAssetLibrary,
  SetGeneratedAssetSlotInput,
  StudioProject
} from "@gameaistudio/shared";
import { GENERATED_ASSET_PURPOSE_LABELS } from "@gameaistudio/shared";
import { getProjectLogger } from "./logger";
import type { ProjectService } from "./project-service";

const MANIFEST_RELATIVE_PATH = path.join(".gameaistudio", "asset-manifest.json");

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

interface StoredAssetManifest {
  assets: GeneratedAssetRecord[];
}

export interface SaveGeneratedImagesInput {
  project: StudioProject;
  images: Array<{ mimeType: string; bytes: Buffer }>;
  meta: {
    prompt: string;
    finalPrompt?: string;
    purpose: GeneratedAssetPurpose;
    style?: string;
    aspectRatio?: GeneratedAssetAspect;
    transparentBackground?: boolean;
    modelId: string;
    providerId?: string;
    providerName?: string;
    upstreamModelId?: string;
  };
}

/** Generated images land in the asset folder matching their game role. */
export function purposeDirectory(purpose: GeneratedAssetPurpose): string {
  switch (purpose) {
    case "character":
    case "enemy":
      return "assets/characters";
    case "background":
      return "assets/backgrounds";
    case "ui-icon":
    case "ui-button":
    case "logo":
      return "assets/ui";
    default:
      return "assets/images";
  }
}

/** ASCII-safe filename stem so res:// paths stay portable across platforms. */
function filenameStem(prompt: string, purpose: GeneratedAssetPurpose): string {
  const ascii = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return ascii || purpose;
}

async function readManifest(rootPath: string): Promise<StoredAssetManifest> {
  try {
    const raw = await readFile(path.join(rootPath, MANIFEST_RELATIVE_PATH), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredAssetManifest>;
    return { assets: Array.isArray(parsed.assets) ? parsed.assets : [] };
  } catch {
    return { assets: [] };
  }
}

async function writeManifest(rootPath: string, manifest: StoredAssetManifest): Promise<void> {
  const manifestPath = path.join(rootPath, MANIFEST_RELATIVE_PATH);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

/** Manifest records for a project root — used by the agent context builder. */
export async function readGeneratedAssetRecords(rootPath: string): Promise<GeneratedAssetRecord[]> {
  return (await readManifest(rootPath)).assets;
}

/** Cap on asset lines injected per turn so a large library can't crowd out the rest of the context. */
export const MAX_ASSET_CONTEXT_LINES = 80;

/**
 * Context lines describing each generated asset semantically (role, slot,
 * prompt), so agents know which image is the player and which is a coin
 * instead of guessing from filenames. Slotted assets are always kept (they
 * name a game role); when the library is large only the most recent unslotted
 * ones are listed, with a trailing note about the omitted count.
 */
export function buildAssetContextLines(records: GeneratedAssetRecord[], maxLines = MAX_ASSET_CONTEXT_LINES): string[] {
  const format = (record: GeneratedAssetRecord): string => {
    const slot = record.slot ? ` [slot: ${record.slot}]` : "";
    const style = record.style ? `，风格：${record.style}` : "";
    return `- ${record.resPath} — ${GENERATED_ASSET_PURPOSE_LABELS[record.purpose]}${slot}（AI 生成${style}）prompt: ${record.prompt.replace(/\s+/g, " ").slice(0, 120)}`;
  };

  if (records.length <= maxLines) {
    return records.map(format);
  }

  // Slotted assets carry a game role — never drop them. Fill the rest of the
  // budget with the most recent unslotted assets.
  const slotted = records.filter((record) => record.slot);
  const unslotted = records.filter((record) => !record.slot);
  const remaining = Math.max(maxLines - slotted.length, 0);
  const keptUnslotted = unslotted.slice(-remaining);
  const omitted = records.length - slotted.length - keptUnslotted.length;
  const lines = [...slotted, ...keptUnslotted].map(format);
  if (omitted > 0) {
    lines.push(`- （另有 ${omitted} 个较早的未绑定槽位素材未在此列出，可在 AI 素材工坊查看）`);
  }
  return lines;
}

export class AssetLibraryService {
  constructor(private readonly projectService: ProjectService) {}

  /**
   * Tail of the serialized manifest-mutation chain per project root. The
   * manifest is a read-modify-write JSON file shared by the manual generate
   * path (no project lock) and the workflow path — concurrent writers would
   * each read the same snapshot and clobber the other's records. Every
   * mutation runs inside this per-root critical section so additions, slot
   * changes and deletes never interleave.
   */
  private readonly manifestChains = new Map<string, Promise<unknown>>();

  private runExclusive<T>(rootPath: string, task: () => Promise<T>): Promise<T> {
    const prior = this.manifestChains.get(rootPath) ?? Promise.resolve();
    const result = prior.then(task, task);
    // Keep the chain alive but never let a rejection poison later callers.
    this.manifestChains.set(
      rootPath,
      result.then(
        () => undefined,
        () => undefined
      )
    );
    return result;
  }

  async saveGeneratedImages(input: SaveGeneratedImagesInput): Promise<GeneratedAssetRecord[]> {
    const { project, images, meta } = input;
    const directory = purposeDirectory(meta.purpose);
    await mkdir(path.join(project.rootPath, directory), { recursive: true });
    const stem = filenameStem(meta.prompt, meta.purpose);

    // Write image bytes outside the lock (independent files, unique names);
    // only the manifest read-modify-write needs serializing.
    const records: GeneratedAssetRecord[] = [];
    for (const image of images) {
      const id = randomUUID();
      const extension = MIME_EXTENSIONS[image.mimeType] ?? "png";
      const fileName = `${stem}-${id.slice(0, 8)}.${extension}`;
      const relativePath = `${directory}/${fileName}`;
      await writeFile(path.join(project.rootPath, directory, fileName), image.bytes);
      records.push({
        id,
        projectId: project.id,
        fileName,
        projectRelativePath: relativePath,
        resPath: `res://${relativePath}`,
        prompt: meta.prompt,
        finalPrompt: meta.finalPrompt,
        purpose: meta.purpose,
        style: meta.style,
        aspectRatio: meta.aspectRatio,
        transparentBackground: meta.transparentBackground,
        modelId: meta.modelId,
        providerId: meta.providerId,
        providerName: meta.providerName,
        upstreamModelId: meta.upstreamModelId,
        mimeType: image.mimeType,
        sizeBytes: image.bytes.length,
        createdAt: new Date().toISOString()
      });
    }

    await this.runExclusive(project.rootPath, async () => {
      const manifest = await readManifest(project.rootPath);
      manifest.assets.push(...records);
      await writeManifest(project.rootPath, manifest);
    });
    getProjectLogger(project.rootPath).info("media", "生成素材已入库", {
      count: records.length,
      directory,
      modelId: meta.modelId,
      purpose: meta.purpose
    });
    return records;
  }

  async listAssets(projectId: string): Promise<ProjectAssetLibrary> {
    const project = await this.projectService.requireProject(projectId);
    const manifest = await readManifest(project.rootPath);
    return { projectId, assets: [...manifest.assets].reverse() };
  }

  async deleteAsset(input: DeleteGeneratedAssetInput): Promise<ProjectAssetLibrary> {
    const project = await this.projectService.requireProject(input.projectId);
    return this.runExclusive(project.rootPath, async () => {
      const manifest = await readManifest(project.rootPath);
      const record = manifest.assets.find((asset) => asset.id === input.assetId);
      if (record) {
        manifest.assets = manifest.assets.filter((asset) => asset.id !== input.assetId);
        const absolutePath = path.join(project.rootPath, record.projectRelativePath);
        await rm(absolutePath, { force: true });
        // Godot writes a sidecar .import next to imported textures.
        await rm(`${absolutePath}.import`, { force: true });
        await writeManifest(project.rootPath, manifest);
        getProjectLogger(project.rootPath).info("media", "删除生成素材", {
          assetId: input.assetId,
          path: record.projectRelativePath
        });
      }
      return { projectId: input.projectId, assets: [...manifest.assets].reverse() };
    });
  }

  async setSlot(input: SetGeneratedAssetSlotInput): Promise<ProjectAssetLibrary> {
    const project = await this.projectService.requireProject(input.projectId);
    return this.runExclusive(project.rootPath, async () => {
      const manifest = await readManifest(project.rootPath);
      const record = manifest.assets.find((asset) => asset.id === input.assetId);
      if (!record) {
        throw new Error(`素材不存在：${input.assetId}`);
      }
      const slot = input.slot.trim();
      if (slot) {
        // A slot names one role in the game — only one asset may hold it.
        for (const asset of manifest.assets) {
          if (asset.id !== record.id && asset.slot === slot) {
            asset.slot = undefined;
          }
        }
      }
      record.slot = slot || undefined;
      await writeManifest(project.rootPath, manifest);
      getProjectLogger(project.rootPath).info("media", "更新素材槽位", { assetId: record.id, slot: record.slot ?? "(cleared)" });
      return { projectId: input.projectId, assets: [...manifest.assets].reverse() };
    });
  }
}
