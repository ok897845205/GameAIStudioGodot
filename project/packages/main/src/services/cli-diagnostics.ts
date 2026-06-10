import type { ProcessRunResult } from "./process-runner";

const PERMISSION_FAILURE_PATTERN =
  /apply deny-read ACLs|sandbox:\s*read-only|permission denied|access is denied|operation not permitted|read-only file system|\b(?:EACCES|EPERM)\b/i;

export function processOutput(result: Pick<ProcessRunResult, "stdout" | "stderr">): string {
  return [
    result.stdout.trim(),
    result.stderr.trim() ? `\n--- stderr ---\n${result.stderr.trim()}` : ""
  ]
    .join("")
    .trim();
}

export function hasCliPermissionFailure(output: string): boolean {
  return PERMISSION_FAILURE_PATTERN.test(output);
}

export function tailText(value: string | undefined, maxLength = 1600): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(-maxLength)}...(tail ${maxLength}/${text.length})` : text;
}

export function applyCliPermissionFailureDiagnostic(
  result: ProcessRunResult,
  toolLabel: string
): { result: ProcessRunResult; detected: boolean; rawExitCode: number | null } {
  const detected = hasCliPermissionFailure(processOutput(result));
  if (!detected) {
    return { result, detected: false, rawExitCode: result.exitCode };
  }

  const diagnostic =
    `${toolLabel} CLI 权限诊断：检测到本地 CLI 被沙盒或 Windows ACL 拒绝访问项目目录。` +
    "请确认该 adapter 已禁用本地 CLI 自带沙盒或使用 full-access/bypass 模式，且工作目录是当前游戏项目根目录。";
  const stderr = result.stderr.includes(diagnostic)
    ? result.stderr
    : [result.stderr.trim(), diagnostic].filter(Boolean).join("\n");

  return {
    result: {
      ...result,
      exitCode: result.exitCode === 0 ? 1 : result.exitCode,
      stderr
    },
    detected: true,
    rawExitCode: result.exitCode
  };
}
