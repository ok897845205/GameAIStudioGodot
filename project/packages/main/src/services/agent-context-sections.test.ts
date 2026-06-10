import { describe, expect, it } from "vitest";
import type { AgentMessage, ProjectDetails } from "@gameaistudio/shared";
import {
  buildAgentContextMarkdown,
  latestAgentError,
  latestQaFindings,
  summarizeAgentOwnMessages
} from "./agent-context-service";

function message(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    projectId: "project_1",
    agentId: "programmer",
    role: "agent",
    content: "默认内容",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function project(messages: AgentMessage[]): ProjectDetails {
  return {
    id: "project_1",
    name: "Demo",
    dimension: "2d",
    prompt: "做一个跑酷",
    rootPath: "E:/projects/demo",
    webBuildPath: "E:/projects/demo/build/web",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentId: "programmer",
    messages,
    runs: []
  };
}

describe("agent-specific context sections", () => {
  it("summarizeAgentOwnMessages keeps only this agent's thread tail", () => {
    const messages = [
      message({ agentId: "qa", content: "QA 内容" }),
      message({ agentId: "programmer", role: "user", content: "修跳跃" }),
      message({ agentId: "programmer", content: "已修复跳跃" })
    ];
    const own = summarizeAgentOwnMessages(messages, "programmer");
    expect(own).toHaveLength(2);
    expect(own.join("\n")).toContain("修跳跃");
    expect(own.join("\n")).not.toContain("QA 内容");
  });

  it("latestQaFindings returns the newest QA reply and skips QA errors", () => {
    const messages = [
      message({ agentId: "qa", content: "旧的 QA 报告" }),
      message({ agentId: "qa", content: "QA结论：发现问题\n- 金币不计分" }),
      message({ agentId: "qa", kind: "error", content: "QA CLI 执行失败" })
    ];
    expect(latestQaFindings(messages)).toContain("金币不计分");
  });

  it("latestAgentError returns this agent's most recent failure only", () => {
    const messages = [
      message({ agentId: "programmer", kind: "error", content: "Codex CLI 执行失败（exitCode=1）" }),
      message({ agentId: "artist", kind: "error", content: "美术失败" })
    ];
    expect(latestAgentError(messages, "programmer")).toContain("exitCode=1");
    expect(latestAgentError(messages, "qa")).toBeUndefined();
  });

  it("buildAgentContextMarkdown renders the private sections and git line", () => {
    const markdown = buildAgentContextMarkdown({
      project: project([]),
      agentId: "programmer",
      userMessage: "修复跳跃",
      files: [],
      recentMessages: [],
      agentJournal: "",
      now: new Date().toISOString(),
      gitSummary: "main@abc1234, 2 uncommitted change(s)",
      ownMessages: ["- 程序 / Codex: 已修复跳跃"],
      knownIssues: "QA结论：发现问题\n- 金币不计分",
      lastError: "Codex CLI 执行失败（exitCode=1）"
    });

    expect(markdown).toContain("- Git: main@abc1234, 2 uncommitted change(s)");
    expect(markdown).toContain("## Your Recent Turns (this agent)");
    expect(markdown).toContain("## Known Issues (latest QA findings)");
    expect(markdown).toContain("金币不计分");
    expect(markdown).toContain("## Your Last Error");
    expect(markdown).toContain("exitCode=1");
  });
});
