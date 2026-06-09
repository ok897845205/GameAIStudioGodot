export interface SendTurnButtonStateInput {
  hasSelectedProject: boolean;
  draft: string;
  attachmentCount?: number;
  isBusy: boolean;
  selectedCliInstalled: boolean;
  selectedCliLabel: string;
}

export interface SendTurnButtonState {
  disabled: boolean;
  title?: string;
}

export function getSendTurnButtonState(input: SendTurnButtonStateInput): SendTurnButtonState {
  if (!input.hasSelectedProject) {
    return {
      disabled: true,
      title: "先创建或选择一个 Godot 项目。"
    };
  }

  if (!input.draft.trim() && !input.attachmentCount) {
    return {
      disabled: true,
      title: "先输入要交给 Agent 的需求。"
    };
  }

  if (!input.selectedCliInstalled) {
    return {
      disabled: true,
      title: `先安装 ${input.selectedCliLabel}，或在下拉框选择已安装 CLI。`
    };
  }

  return {
    disabled: input.isBusy,
    title: input.isBusy ? "等待当前任务结束。" : undefined
  };
}
