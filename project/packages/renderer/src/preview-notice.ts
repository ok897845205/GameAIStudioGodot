import type { RunAgentTurnResult } from "@gameaistudio/shared";

export function agentTurnPreviewNotice(result: Pick<RunAgentTurnResult, "previewResult" | "previewError">): string | undefined {
  if (result.previewResult) {
    return `Web 预览已刷新：${result.previewResult.url}`;
  }
  if (result.previewError) {
    return `Web 预览刷新失败：${result.previewError}`;
  }
  return undefined;
}
