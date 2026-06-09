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
});
