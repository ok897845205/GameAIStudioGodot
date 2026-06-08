import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectFileChange } from "@gameaistudio/shared";

export interface ProjectFileFingerprint {
  path: string;
  size: number;
  hash: string;
  isText: boolean;
}

export type ProjectFileSnapshot = Map<string, ProjectFileFingerprint>;

const IGNORED_DIRECTORIES = new Set([".git", ".godot", ".gameaistudio", "build", "dist", "node_modules"]);
const IGNORED_SUFFIXES = [".uid", ".import", ".tmp"];
const TEXT_EXTENSIONS = new Set([
  ".cfg",
  ".gd",
  ".gdshader",
  ".godot",
  ".import",
  ".json",
  ".md",
  ".shader",
  ".tres",
  ".tscn",
  ".txt",
  ".xml",
  ".yml",
  ".yaml"
]);

function toRelativePath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replace(/\\/g, "/");
}

function shouldIgnoreFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return IGNORED_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

function isTextFile(filePath: string, buffer: Buffer): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  return !sample.includes(0);
}

async function walkProjectFiles(rootPath: string, directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      await walkProjectFiles(rootPath, fullPath, files);
      continue;
    }

    if (!entry.isFile() || shouldIgnoreFile(fullPath)) {
      continue;
    }
    files.push(fullPath);
  }
}

export class ProjectFileChangeService {
  async createSnapshot(rootPath: string): Promise<ProjectFileSnapshot> {
    const files: string[] = [];
    await walkProjectFiles(rootPath, rootPath, files);

    const snapshot: ProjectFileSnapshot = new Map();
    for (const filePath of files) {
      const [fileStat, buffer] = await Promise.all([stat(filePath), readFile(filePath)]);
      const relativePath = toRelativePath(rootPath, filePath);
      snapshot.set(relativePath, {
        path: relativePath,
        size: fileStat.size,
        hash: createHash("sha1").update(buffer).digest("hex"),
        isText: isTextFile(filePath, buffer)
      });
    }

    return snapshot;
  }

  compareSnapshots(before: ProjectFileSnapshot, after: ProjectFileSnapshot): ProjectFileChange[] {
    const changes: ProjectFileChange[] = [];
    const paths = new Set([...before.keys(), ...after.keys()]);

    for (const filePath of [...paths].sort()) {
      const beforeFile = before.get(filePath);
      const afterFile = after.get(filePath);

      if (!beforeFile && afterFile) {
        changes.push({
          path: filePath,
          kind: "added",
          afterSize: afterFile.size,
          afterHash: afterFile.hash,
          isText: afterFile.isText
        });
        continue;
      }

      if (beforeFile && !afterFile) {
        changes.push({
          path: filePath,
          kind: "deleted",
          beforeSize: beforeFile.size,
          beforeHash: beforeFile.hash,
          isText: beforeFile.isText
        });
        continue;
      }

      if (beforeFile && afterFile && beforeFile.hash !== afterFile.hash) {
        changes.push({
          path: filePath,
          kind: "modified",
          beforeSize: beforeFile.size,
          afterSize: afterFile.size,
          beforeHash: beforeFile.hash,
          afterHash: afterFile.hash,
          isText: beforeFile.isText || afterFile.isText
        });
      }
    }

    return changes;
  }
}
