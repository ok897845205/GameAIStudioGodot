import { describe, expect, it } from "vitest";

import { getCreateProjectButtonState } from "./create-project-state";

describe("create project button state", () => {
  it("allows creating the Godot project before any local AI CLI is installed", () => {
    const state = getCreateProjectButtonState({
      isBusy: false,
      prompt: "我要创建一个黄金矿工",
      templateBlocked: false,
      autoRunWorkflow: true,
      hasInstalledCli: false
    });

    expect(state.disabled).toBe(false);
    expect(state.label).toBe("创建项目，稍后生成");
    expect(state.title).toContain("安装本地 AI CLI");
  });

  it("blocks creation when the selected Godot template is missing", () => {
    const state = getCreateProjectButtonState({
      isBusy: false,
      prompt: "我要创建一个黄金矿工",
      templateBlocked: true,
      autoRunWorkflow: true,
      hasInstalledCli: true
    });

    expect(state.disabled).toBe(true);
    expect(state.title).toContain("模板缺失");
  });

  it("uses the one-click generation label when the workflow can run immediately", () => {
    const state = getCreateProjectButtonState({
      isBusy: false,
      prompt: "我要创建一个黄金矿工",
      templateBlocked: false,
      autoRunWorkflow: true,
      hasInstalledCli: true
    });

    expect(state).toEqual({
      disabled: false,
      label: "创建并生成游戏"
    });
  });
});
