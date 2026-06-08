import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CreateSnapshotInput, ProjectSnapshot, RestoreSnapshotResult } from "@gameaistudio/shared";
import { createSnapshotId } from "./naming";
import { ProjectService } from "./project-service";
import { StudioStore } from "./store";

interface ProjectFileEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
}

const IGNORED_DIRECTORIES = new Set([".git", ".godot", ".gameaistudio", "build", "dist", "node_modules"]);
const IGNORED_SUFFIXES = [".uid", ".import", ".tmp"];

function safeRelativePath(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).replace(/\\/g, "/");
}

function shouldIgnoreFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return IGNORED_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

async function walkSnapshotFiles(rootPath: string, directory: string, files: ProjectFileEntry[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      await walkSnapshotFiles(rootPath, absolutePath, files);
      continue;
    }

    if (!entry.isFile() || shouldIgnoreFile(absolutePath)) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    files.push({
      absolutePath,
      relativePath: safeRelativePath(rootPath, absolutePath),
      size: fileStat.size
    });
  }
}

async function listSnapshotFiles(rootPath: string): Promise<ProjectFileEntry[]> {
  const files: ProjectFileEntry[] = [];
  await walkSnapshotFiles(rootPath, rootPath, files);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export class ProjectSnapshotService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly store: StudioStore
  ) {}

  async list(projectId: string): Promise<ProjectSnapshot[]> {
    await this.projectService.requireProject(projectId);
    return this.store.listSnapshots(projectId);
  }

  async create(input: CreateSnapshotInput): Promise<ProjectSnapshot> {
    const project = await this.projectService.requireProject(input.projectId);
    const id = createSnapshotId();
    const createdAt = new Date().toISOString();
    const storagePath = path.join(project.rootPath, ".gameaistudio", "snapshots", id);
    const filesPath = path.join(storagePath, "files");
    const files = await listSnapshotFiles(project.rootPath);

    await mkdir(filesPath, { recursive: true });
    let totalBytes = 0;
    for (const file of files) {
      totalBytes += file.size;
      const targetPath = path.join(filesPath, file.relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(file.absolutePath, targetPath, { force: true });
    }

    const snapshot: ProjectSnapshot = {
      id,
      projectId: project.id,
      label: input.label.trim() || "未命名快照",
      reason: input.reason.trim() || "manual",
      createdAt,
      fileCount: files.length,
      totalBytes,
      storagePath
    };

    await writeFile(path.join(storagePath, "manifest.json"), JSON.stringify(snapshot, null, 2), "utf8");
    await this.store.upsertSnapshot(snapshot);
    return snapshot;
  }

  async restore(projectId: string, snapshotId: string): Promise<RestoreSnapshotResult> {
    const project = await this.projectService.requireProject(projectId);
    const snapshot = await this.store.getSnapshot(snapshotId);
    if (!snapshot || snapshot.projectId !== projectId) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    await readFile(path.join(snapshot.storagePath, "manifest.json"), "utf8");
    const safetySnapshot = await this.create({
      projectId,
      label: `恢复前自动快照 ${new Date().toLocaleString("zh-CN")}`,
      reason: `before-restore:${snapshot.id}`
    });

    const currentFiles = await listSnapshotFiles(project.rootPath);
    const snapshotFiles = await listSnapshotFiles(path.join(snapshot.storagePath, "files"));
    const snapshotPaths = new Set(snapshotFiles.map((file) => file.relativePath));

    for (const file of currentFiles) {
      if (!snapshotPaths.has(file.relativePath)) {
        await rm(file.absolutePath, { force: true });
      }
    }

    for (const file of snapshotFiles) {
      const targetPath = path.join(project.rootPath, file.relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(file.absolutePath, targetPath, { force: true });
    }

    await writeFile(
      path.join(project.rootPath, ".gameaistudio", "last-restore.json"),
      JSON.stringify(
        {
          snapshotId: snapshot.id,
          safetySnapshotId: safetySnapshot.id,
          restoredAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      project: await this.projectService.getProject(projectId),
      snapshot,
      safetySnapshot,
      restoredAt: new Date().toISOString()
    };
  }
}

