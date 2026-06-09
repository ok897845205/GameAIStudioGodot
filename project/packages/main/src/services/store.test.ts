import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StudioStore } from "./store";

describe("StudioStore", () => {
  it("persists Agent messages with file change metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-store-"));
    const store = new StudioStore(path.join(dir, "studio-state.json"));

    try {
      await store.appendMessages([
        {
          id: "msg_1",
          projectId: "project_1",
          agentId: "programmer",
          role: "agent",
          content: "已实现第一版钩子。",
          createdAt: "2026-06-08T00:00:00.000Z",
          cliToolId: "codex",
          fileChanges: [
            {
              path: "scripts/hook.gd",
              kind: "added",
              afterSize: 128,
              afterHash: "abc",
              isText: true
            }
          ]
        }
      ]);

      const reloaded = new StudioStore(path.join(dir, "studio-state.json"));
      const messages = await reloaded.listMessages("project_1");

      expect(messages).toHaveLength(1);
      expect(messages[0]?.fileChanges).toEqual([
        {
          path: "scripts/hook.gd",
          kind: "added",
          afterSize: 128,
          afterHash: "abc",
          isText: true
        }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
