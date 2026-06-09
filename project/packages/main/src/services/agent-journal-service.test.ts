import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentMessage, ProjectFileChange, ProjectSnapshot, StudioProject } from "@gameaistudio/shared";
import { appendAgentJournal, buildAgentJournalEntry, getAgentJournalPath, readAgentJournalTail } from "./agent-journal-service";

function createProject(rootPath: string): StudioProject {
  return {
    id: "project_1",
    name: "Gold Miner",
    dimension: "2d",
    prompt: "Create a gold miner game",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    activeAgentId: "programmer"
  };
}

function createMessage(project: StudioProject): AgentMessage {
  return {
    id: "msg_1",
    projectId: project.id,
    agentId: "programmer",
    role: "agent",
    content: "Implemented hook movement and score feedback.",
    createdAt: "2026-06-08T00:30:00.000Z",
    cliToolId: "codex",
    exitCode: 0,
    durationMs: 1234
  };
}

function createSnapshot(id: string, project: StudioProject): ProjectSnapshot {
  return {
    id,
    projectId: project.id,
    label: id,
    reason: id,
    createdAt: "2026-06-08T00:30:00.000Z",
    fileCount: 2,
    totalBytes: 64,
    storagePath: path.join(project.rootPath, ".gameaistudio", "snapshots", id)
  };
}

describe("Agent journal", () => {
  it("formats Agent turn handoff entries with file changes and snapshot references", () => {
    const project = createProject("E:/projects/gold-miner");
    const changes: ProjectFileChange[] = [
      {
        path: "scripts/player.gd",
        kind: "modified",
        beforeSize: 10,
        afterSize: 24,
        beforeHash: "a",
        afterHash: "b",
        isText: true
      }
    ];

    const entry = buildAgentJournalEntry({
      project,
      agentId: "programmer",
      cliToolId: "codex",
      userMessage: "Add hook scoring.",
      agentMessage: createMessage(project),
      status: "completed",
      fileChanges: changes,
      contextPath: path.join(project.rootPath, ".gameaistudio", "agent-context.md"),
      beforeSnapshot: createSnapshot("snap_before", project),
      afterSnapshot: createSnapshot("snap_after", project)
    });

    expect(entry).toContain("Gold Miner");
    expect(entry).toContain("Status: completed");
    expect(entry).toContain("User request: Add hook scoring.");
    expect(entry).toContain("Before snapshot: snap_before");
    expect(entry).toContain("After snapshot: snap_after");
    expect(entry).toContain("modified: scripts/player.gd");
    expect(entry).toContain("Implemented hook movement");
  });

  it("appends and reads a bounded tail from the in-project journal file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-agent-journal-"));

    try {
      await appendAgentJournal(dir, "## entry 1\n\nold");
      await appendAgentJournal(dir, "## entry 2\n\nnew");

      expect(await readFile(getAgentJournalPath(dir), "utf8")).toContain("## entry 1");
      expect(await readAgentJournalTail(dir, 18)).toContain("entry 2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
