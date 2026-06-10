import { describe, expect, it } from "vitest";
import { AGENT_PROFILES } from "@gameaistudio/shared";
import { buildWorkflowStartMessage } from "./workflow-service";

describe("buildWorkflowStartMessage", () => {
  it("announces the kickoff with agent→CLI routing as a workflow system message", () => {
    const producer = AGENT_PROFILES.find((a) => a.id === "producer")!;
    const qa = AGENT_PROFILES.find((a) => a.id === "qa")!;

    const message = buildWorkflowStartMessage({
      projectId: "project_1",
      userMessage: "做一个赛博朋克跑酷",
      routes: [
        { agent: producer, cliToolId: "codex" },
        { agent: qa, cliToolId: "claude" }
      ]
    });

    expect(message.role).toBe("system");
    expect(message.kind).toBe("workflow");
    expect(message.projectId).toBe("project_1");
    expect(message.content).toContain("团队工作流已启动");
    expect(message.content).toContain("制作人（Codex）");
    expect(message.content).toContain("QA（Claude）");
    expect(message.content).toContain("做一个赛博朋克跑酷");
  });

  it("truncates an overly long goal", () => {
    const producer = AGENT_PROFILES[0]!;
    const message = buildWorkflowStartMessage({
      projectId: "p",
      userMessage: "长".repeat(400),
      routes: [{ agent: producer, cliToolId: "codex" }]
    });
    expect(message.content).toContain("…");
    expect(message.content.length).toBeLessThan(600);
  });
});
