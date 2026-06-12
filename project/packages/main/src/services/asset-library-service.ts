import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AudioKind,
  DeleteGeneratedAssetInput,
  DeleteGeneratedAudioInput,
  GeneratedAssetAspect,
  GeneratedAssetPurpose,
  GeneratedAssetRecord,
  GeneratedAudioRecord,
  ProjectAssetLibrary,
  ProjectAudioLibrary,
  SetGeneratedAssetSlotInput,
  SetGeneratedAudioSlotInput,
  StudioProject
} from "@gameaistudio/shared";
import { AUDIO_KIND_LABELS, GENERATED_ASSET_PURPOSE_LABELS } from "@gameaistudio/shared";
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
  audio: GeneratedAudioRecord[];
}

/** Generated audio lands in the subfolder matching its kind. */
export function audioKindDirectory(kind: AudioKind): string {
  return `assets/audio/${kind}`;
}

export interface SaveGeneratedAudioInput {
  project: StudioProject;
  audios: Array<{ mimeType: string; bytes: Buffer; format: string; durationSeconds?: number; note?: string }>;
  meta: {
    kind: AudioKind;
    prompt: string;
    finalPrompt?: string;
    loopable?: boolean;
    providerId?: string;
    providerName?: string;
    upstreamModelId?: string;
    modelId: string;
    license?: string;
  };
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
    return {
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      audio: Array.isArray(parsed.audio) ? parsed.audio : []
    };
  } catch {
    return { assets: [], audio: [] };
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

/** Audio manifest records for a project root — used by the agent context builder. */
export async function readGeneratedAudioRecords(rootPath: string): Promise<GeneratedAudioRecord[]> {
  return (await readManifest(rootPath)).audio;
}

/** ASCII-safe filename stem for audio files. */
function audioFilenameStem(prompt: string, kind: AudioKind): string {
  const ascii = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32)
    .replace(/_+$/g, "");
  return ascii || kind;
}

/**
 * Context lines describing each generated audio clip (kind, slot, duration,
 * loop, prompt), so agents wire `AudioStreamPlayer`s to the right res:// path.
 */
export function buildAudioContextLines(records: GeneratedAudioRecord[], maxLines = MAX_ASSET_CONTEXT_LINES): string[] {
  const format = (record: GeneratedAudioRecord): string => {
    const slot = record.slot ? ` [slot: ${record.slot}]` : "";
    const duration = record.durationSeconds ? `，约 ${record.durationSeconds}s` : "";
    const loop = record.loopable ? "，可循环" : "";
    return `- ${record.resPath} — ${AUDIO_KIND_LABELS[record.kind]}${slot}（AI 生成${duration}${loop}）prompt: ${record.prompt.replace(/\s+/g, " ").slice(0, 100)}`;
  };
  if (records.length <= maxLines) {
    return records.map(format);
  }
  const slotted = records.filter((record) => record.slot);
  const unslotted = records.filter((record) => !record.slot);
  const remaining = Math.max(maxLines - slotted.length, 0);
  const keptUnslotted = unslotted.slice(-remaining);
  const omitted = records.length - slotted.length - keptUnslotted.length;
  const lines = [...slotted, ...keptUnslotted].map(format);
  if (omitted > 0) {
    lines.push(`- （另有 ${omitted} 个较早的未绑定槽位音频未在此列出）`);
  }
  return lines;
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

  // ── 音频 ──────────────────────────────────────────────────────────────

  async saveGeneratedAudio(input: SaveGeneratedAudioInput): Promise<GeneratedAudioRecord[]> {
    const { project, audios, meta } = input;
    const directory = audioKindDirectory(meta.kind);
    await mkdir(path.join(project.rootPath, directory), { recursive: true });
    const stem = audioFilenameStem(meta.prompt, meta.kind);

    const records: GeneratedAudioRecord[] = [];
    for (const audio of audios) {
      const id = randomUUID();
      const fileName = `${stem}-${id.slice(0, 8)}.${audio.format}`;
      const relativePath = `${directory}/${fileName}`;
      await writeFile(path.join(project.rootPath, directory, fileName), audio.bytes);
      records.push({
        id,
        projectId: project.id,
        kind: meta.kind,
        fileName,
        projectRelativePath: relativePath,
        resPath: `res://${relativePath}`,
        prompt: meta.prompt,
        finalPrompt: meta.finalPrompt,
        durationSeconds: audio.durationSeconds,
        loopable: meta.loopable,
        providerId: meta.providerId,
        providerName: meta.providerName,
        upstreamModelId: meta.upstreamModelId,
        modelId: meta.modelId,
        format: audio.format,
        mimeType: audio.mimeType,
        sizeBytes: audio.bytes.length,
        license: meta.license ?? audio.note,
        createdAt: new Date().toISOString()
      });
    }

    await this.runExclusive(project.rootPath, async () => {
      const manifest = await readManifest(project.rootPath);
      manifest.audio.push(...records);
      await writeManifest(project.rootPath, manifest);
    });
    getProjectLogger(project.rootPath).info("audio", "生成音频已入库", {
      count: records.length,
      directory,
      kind: meta.kind,
      modelId: meta.modelId
    });
    return records;
  }

  async listAudio(projectId: string): Promise<ProjectAudioLibrary> {
    const project = await this.projectService.requireProject(projectId);
    const manifest = await readManifest(project.rootPath);
    return { projectId, audios: [...manifest.audio].reverse() };
  }

  async deleteAudio(input: DeleteGeneratedAudioInput): Promise<ProjectAudioLibrary> {
    const project = await this.projectService.requireProject(input.projectId);
    return this.runExclusive(project.rootPath, async () => {
      const manifest = await readManifest(project.rootPath);
      const record = manifest.audio.find((audio) => audio.id === input.audioId);
      if (record) {
        manifest.audio = manifest.audio.filter((audio) => audio.id !== input.audioId);
        const absolutePath = path.join(project.rootPath, record.projectRelativePath);
        await rm(absolutePath, { force: true });
        await rm(`${absolutePath}.import`, { force: true });
        await writeManifest(project.rootPath, manifest);
        getProjectLogger(project.rootPath).info("audio", "删除生成音频", { audioId: input.audioId, path: record.projectRelativePath });
      }
      return { projectId: input.projectId, audios: [...manifest.audio].reverse() };
    });
  }

  async setAudioSlot(input: SetGeneratedAudioSlotInput): Promise<ProjectAudioLibrary> {
    const project = await this.projectService.requireProject(input.projectId);
    return this.runExclusive(project.rootPath, async () => {
      const manifest = await readManifest(project.rootPath);
      const record = manifest.audio.find((audio) => audio.id === input.audioId);
      if (!record) {
        throw new Error(`音频不存在：${input.audioId}`);
      }
      const slot = input.slot.trim();
      if (slot) {
        for (const audio of manifest.audio) {
          if (audio.id !== record.id && audio.slot === slot) {
            audio.slot = undefined;
          }
        }
      }
      record.slot = slot || undefined;
      await writeManifest(project.rootPath, manifest);
      getProjectLogger(project.rootPath).info("audio", "更新音频槽位", { audioId: record.id, slot: record.slot ?? "(cleared)" });
      return { projectId: input.projectId, audios: [...manifest.audio].reverse() };
    });
  }
}
