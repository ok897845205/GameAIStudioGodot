import { describe, expect, it } from "vitest";
import { agentTurnPreviewNotice } from "./preview-notice";

describe("agentTurnPreviewNotice", () => {
  it("formats a successful preview refresh", () => {
    expect(
      agentTurnPreviewNotice({
        previewResult: {
          projectId: "project_1",
          url: "http://127.0.0.1:3123?v=1",
          webBuildPath: "C:/GameAIStudio/GoldMiner/build/web",
          watching: true
        }
      })
    ).toBe("Web 预览已刷新：http://127.0.0.1:3123?v=1");
  });

  it("formats a preview failure without treating the Agent turn as failed", () => {
    expect(agentTurnPreviewNotice({ previewError: "Godot Web export failed" })).toBe("Web 预览刷新失败：Godot Web export failed");
  });
});
