export interface CreateProjectButtonStateInput {
  isBusy: boolean;
  prompt: string;
  templateBlocked: boolean;
  autoRunWorkflow: boolean;
  hasInstalledCli: boolean;
}

export interface CreateProjectButtonState {
  disabled: boolean;
  label: string;
  title?: string;
}

export function getCreateProjectButtonState(input: CreateProjectButtonStateInput): CreateProjectButtonState {
  if (input.templateBlocked) {
    return {
      disabled: true,
      label: input.autoRunWorkflow ? "创建并生成游戏" : "创建 Godot 项目",
      title: "当前维度的 Godot 模板缺失，无法创建项目。"
    };
  }

  if (!input.prompt.trim()) {
    return {
      disabled: true,
      label: input.autoRunWorkflow ? "创建并生成游戏" : "创建 Godot 项目",
      title: "先用一句话描述想创建的游戏。"
    };
  }

  if (input.autoRunWorkflow && !input.hasInstalledCli) {
    return {
      disabled: input.isBusy,
      label: "创建项目，稍后生成",
      title: "会先创建 Godot 项目；安装本地 AI CLI 后再运行团队工作流。"
    };
  }

  return {
    disabled: input.isBusy,
    label: input.autoRunWorkflow ? "创建并生成游戏" : "创建 Godot 项目"
  };
}
