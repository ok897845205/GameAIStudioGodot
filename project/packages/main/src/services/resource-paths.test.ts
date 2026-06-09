import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findResourceRoot } from "./resource-paths";

async function createResourceRoot(parent: string, name: string): Promise<string> {
  const root = path.join(parent, name);
  await mkdir(path.join(root, "engine"), { recursive: true });
  await mkdir(path.join(root, "gameaistudio_template"), { recursive: true });
  return root;
}

describe("findResourceRoot", () => {
  it("selects the first candidate that contains bundled engine and templates", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-resources-"));

    try {
      const incomplete = path.join(dir, "app");
      await mkdir(path.join(incomplete, "engine"), { recursive: true });
      const resources = await createResourceRoot(dir, "resources");

      expect(findResourceRoot([incomplete, resources])).toBe(resources);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when no candidate has both resource folders", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-resources-"));

    try {
      const onlyTemplates = path.join(dir, "templates-only");
      await mkdir(path.join(onlyTemplates, "gameaistudio_template"), { recursive: true });

      expect(findResourceRoot([onlyTemplates, path.join(dir, "missing")])).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
