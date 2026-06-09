import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage, ProjectDetails } from "@gameaistudio/shared";
import { describe, expect, it } from "vitest";
import { AgentContextService, shouldIncludeAgentContextPath, summarizeRecentMessages } from "./agent-context-service";

function createMessage(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id ?? `msg_${Math.random().toString(16).slice(2)}`,
    projectId: "project_1",
    agentId: partial.agentId ?? "producer",
    role: partial.role ?? "agent",
    content: partial.content ?? "",
    createdAt: partial.createdAt ?? new Date().toISOString(),
    cliToolId: partial.cliToolId
  };
}

function createProject(rootPath: string, messages: AgentMessage[]): ProjectDetails {
  return {
    id: "project_1",
    name: "黄金矿工",
    dimension: "2d",
    prompt: "我要创建一个黄金矿工，玩家用钩子抓金块，限时得分。",
    rootPath,
    webBuildPath: path.join(rootPath, "build", "web"),
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    activeAgentId: "programmer",
    previewUrl: "http://127.0.0.1:3000/index.html?v=42",
    previewWatching: true,
    previewStatus: "ready",
    previewUpdatedAt: "2026-06-08T00:30:00.000Z",
    exportZipPath: path.join(rootPath, "dist", "gold-miner-web.zip"),
    latestExportManifestPath: path.join(rootPath, "build", "web", "gameaistudio-export.json"),
    latestWebBuildInspection: {
      projectId: "project_1",
      webBuildPath: path.join(rootPath, "build", "web"),
      ok: false,
      files: ["index.html"],
      totalBytes: 128,
      requiredFiles: ["index.html", "*.wasm", "*.pck"],
      missingRequiredFiles: ["*.wasm", "*.pck"],
      message: "Web build is missing required files: *.wasm, *.pck."
    },
    messages,
    runs: []
  };
}

describe("AgentContextService", () => {
  it("writes a compact Agent context with project files and recent conversation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gameaistudio-agent-context-"));
    const service = new AgentContextService({ maxFiles: 20, maxMessages: 2 });

    try {
      await mkdir(path.join(dir, "scripts"), { recursive: true });
      await mkdir(path.join(dir, "assets"), { recursive: true });
      await mkdir(path.join(dir, "build", "web"), { recursive: true });
      await mkdir(path.join(dir, ".gameaistudio"), { recursive: true });
      await writeFile(path.join(dir, "project.godot"), "config/name=\"黄金矿工\"\n", "utf8");
      await writeFile(path.join(dir, "scripts", "player.gd"), "extends Node2D\n", "utf8");
      await writeFile(path.join(dir, "assets", "gold.png"), "not really a png", "utf8");
      await writeFile(path.join(dir, "build", "web", "index.html"), "generated", "utf8");
      await writeFile(path.join(dir, ".gameaistudio", "project.json"), "internal", "utf8");
      await writeFile(path.join(dir, ".gameaistudio", "agent-journal.md"), "## previous run\n\n- changed scripts/player.gd\n", "utf8");
      await writeFile(path.join(dir, "scripts", "player.gd.uid"), "uid", "utf8");

      const project = createProject(dir, [
        createMessage({ role: "user", content: "第一条旧消息" }),
        createMessage({ agentId: "producer", role: "agent", content: "先做核心循环。", cliToolId: "codex" }),
        createMessage({ agentId: "designer", role: "agent", content: "加入金块、石头和时间限制。" })
      ]);
      const bundle = await service.prepare({
        project,
        agentId: "programmer",
        userMessage: "请实现第一版钩子和得分。"
      });

      const markdown = await readFile(bundle.contextPath, "utf8");
      expect(bundle.contextPath).toBe(path.join(dir, ".gameaistudio", "agent-context.md"));
      expect(markdown).toContain("Active agent: 程序");
      expect(markdown).toContain("## Delivery Status");
      expect(markdown).toContain("Preview: ready (http://127.0.0.1:3000/index.html?v=42)");
      expect(markdown).toContain("Web zip:");
      expect(markdown).toContain("gold-miner-web.zip");
      expect(markdown).toContain("Export manifest:");
      expect(markdown).toContain("gameaistudio-export.json");
      expect(markdown).toContain("Web artifact inspection: FAILED, missing *.wasm, *.pck");
      expect(markdown).toContain("Required Web artifacts: index.html, *.wasm, *.pck");
      expect(markdown).toContain("请实现第一版钩子和得分。");
      expect(markdown).toContain("scripts/player.gd");
      expect(markdown).toContain("assets/gold.png");
      expect(markdown).toContain("project.godot");
      expect(markdown).not.toContain("build/web/index.html");
      expect(markdown).not.toContain(".gameaistudio/project.json");
      expect(markdown).not.toContain("player.gd.uid");
      expect(markdown).toContain("先做核心循环。");
      expect(markdown).toContain("加入金块、石头和时间限制。");
      expect(markdown).not.toContain("第一条旧消息");
      expect(markdown).toContain("## Recent Agent Journal");
      expect(markdown).toContain("changed scripts/player.gd");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters generated project paths from Agent context maps", () => {
    expect(shouldIncludeAgentContextPath("scripts/player.gd")).toBe(true);
    expect(shouldIncludeAgentContextPath("assets/gold.png")).toBe(true);
    expect(shouldIncludeAgentContextPath("build/web/index.html")).toBe(false);
    expect(shouldIncludeAgentContextPath(".godot/imported/cache.md5")).toBe(false);
    expect(shouldIncludeAgentContextPath(".gameaistudio/project.json")).toBe(false);
    expect(shouldIncludeAgentContextPath("scripts/player.gd.uid")).toBe(false);
  });

  it("summarizes only the latest conversation entries", () => {
    const summary = summarizeRecentMessages(
      [
        createMessage({ role: "user", content: "旧消息" }),
        createMessage({ role: "agent", agentId: "producer", content: "制作人输出", cliToolId: "codex" }),
        createMessage({ role: "agent", agentId: "qa", content: "QA 输出" })
      ],
      2
    );

    expect(summary).toEqual(["- 制作人 / Codex: 制作人输出", "- QA: QA 输出"]);
  });
});
