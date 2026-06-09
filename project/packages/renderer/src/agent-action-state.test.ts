import { describe, expect, it } from "vitest";

import { getSendTurnButtonState } from "./agent-action-state";

describe("send turn button state", () => {
  it("blocks sending to an unavailable local CLI", () => {
    const state = getSendTurnButtonState({
      hasSelectedProject: true,
      draft: "继续做黄金矿工",
      isBusy: false,
      selectedCliInstalled: false,
      selectedCliLabel: "Codex"
    });

    expect(state.disabled).toBe(true);
    expect(state.title).toContain("先安装 Codex");
  });

  it("allows sending when a project, prompt, and installed CLI are ready", () => {
    expect(
      getSendTurnButtonState({
        hasSelectedProject: true,
        draft: "继续做黄金矿工",
        isBusy: false,
        selectedCliInstalled: true,
        selectedCliLabel: "Codex"
      })
    ).toEqual({
      disabled: false,
      title: undefined
    });
  });

  it("allows sending an image-only turn when a CLI is installed", () => {
    const state = getSendTurnButtonState({
      hasSelectedProject: true,
      draft: "",
      attachmentCount: 1,
      isBusy: false,
      selectedCliInstalled: true,
      selectedCliLabel: "Codex"
    });

    expect(state.disabled).toBe(false);
  });

  it("blocks image attachments when the selected adapter does not support images", () => {
    const state = getSendTurnButtonState({
      hasSelectedProject: true,
      draft: "参考图片修改 UI",
      attachmentCount: 1,
      isBusy: false,
      selectedCliInstalled: true,
      selectedCliAvailable: true,
      selectedCliSupportsImages: false,
      selectedCliLabel: "Kimi"
    });

    expect(state.disabled).toBe(true);
    expect(state.title).toContain("不支持图片输入");
  });

  it("blocks sending to an installed but unhealthy CLI", () => {
    const state = getSendTurnButtonState({
      hasSelectedProject: true,
      draft: "继续做黄金矿工",
      isBusy: false,
      selectedCliInstalled: true,
      selectedCliAvailable: false,
      selectedCliUnavailableReason: "Claude 非交互模式认证失败。",
      selectedCliLabel: "Claude"
    });

    expect(state.disabled).toBe(true);
    expect(state.title).toContain("认证失败");
  });
});
