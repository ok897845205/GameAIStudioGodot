import type { CliFailureKind } from "@gameaistudio/shared";
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

// ── Structured failure classification ───────────────────────────────────────
// "执行失败" alone is useless for support. Every failed turn / probe is mapped
// to one of these kinds so the UI can show a short reason and the logs can
// carry the full diagnosis. Patterns are matched against the combined,
// already-sanitized stdout+stderr of the CLI.

const AUTH_PATTERN =
  /\b401\b|unauthor|forbidden|not\s+logged\s*in|please\s+(?:log|sign)\s*in|login\s+required|invalid\s+(?:api\s*key|bearer)|invalid_authentication|failed\s+to\s+authenticate|api\s*key\s+appears\s+to\s+be\s+invalid|credentials?\s+(?:missing|invalid|expired)/i;

const QUOTA_PATTERN =
  /\b429\b|rate.?limit|too\s+many\s+requests|insufficient[_\s]quota|exceeded\s+your\s+current\s+quota|usage\s+limit|quota\s+(?:exceeded|exhausted|reached)|credit\s+balance|billing\s+(?:hard\s+)?limit/i;

const NETWORK_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|getaddrinfo|fetch\s+failed|network\s+(?:error|failure|issue)|socket\s+hang\s?up|connection\s+(?:refused|reset|closed|failed|timed\s+out)|无法连接|网络(?:错误|异常)/i;

const MODEL_UNAVAILABLE_PATTERN =
  /model\s+(?:is\s+)?(?:not\s+(?:found|available|supported)|at\s+capacity|unavailable|overloaded)|unknown\s+model|model_not_found|invalid\s+model|no\s+such\s+model|overloaded_error/i;

const NOT_INSTALLED_PATTERN =
  /spawn\s+\S+\s+ENOENT|is\s+not\s+recognized\s+as|command\s+not\s+found|不是内部或外部命令|无法将.+识别为/i;

const NON_INTERACTIVE_PATTERN =
  /raw\s+mode\s+is\s+not\s+supported|stdin\s+is\s+not\s+a\s+(?:tty|terminal)|not\s+a\s+terminal|terminal\s+(?:is\s+)?required|requires\s+an?\s+interactive/i;

const PROJECT_DIR_PATTERN =
  /(?:working\s+director(?:y|ies)|cwd|chdir).{0,80}(?:not\s+exist|missing|no\s+such)|cannot\s+find\s+the\s+path|系统找不到指定的路径|项目目录不存在/i;

const FILE_WRITE_PATTERN =
  /\b(?:EROFS|ENOSPC|EBUSY)\b|failed\s+to\s+write|cannot\s+write|write\s+error|disk\s+(?:is\s+)?full|no\s+space\s+left/i;

export const CLI_FAILURE_SUMMARIES: Record<CliFailureKind, string> = {
  cancelled: "用户已取消本轮运行。",
  timeout: "CLI 运行超时。",
  "not-installed": "CLI 未安装或不在 PATH。",
  auth: "CLI 未登录或凭据无效。",
  quota: "额度或调用频率受限。",
  network: "网络连接失败。",
  permission: "CLI 被拒绝读写项目目录（权限不足）。",
  "non-interactive": "该 CLI 的非交互模式不可用。",
  "model-unavailable": "当前模型不可用或已满载。",
  "project-dir-missing": "项目目录不存在或无法进入。",
  "file-write": "文件写入失败（磁盘或权限问题）。",
  parse: "CLI 输出解析失败。",
  unknown: "CLI 执行失败，原因未识别。",
};

const CLI_FAILURE_HINTS: Partial<Record<CliFailureKind, string>> = {
  auth: "请在终端用该 CLI 完成登录（或配置对应 API Key 环境变量），然后回到设置页点击「测试」。",
  quota: "请稍后重试，或检查该 CLI 账号的额度/订阅状态；也可以给这个 Agent 换一个 CLI。",
  network: "请检查网络/代理设置后重试。",
  permission: "请确认该 CLI 已使用 bypass/full-access 模式运行，且工作目录是当前游戏项目根目录。",
  "non-interactive": "请确认该 CLI 版本支持 headless/print 模式，必要时升级 CLI。",
  "model-unavailable": "请稍后重试，或在该 CLI 内切换到可用模型。",
  "not-installed": "请在设置页安装该 CLI，或把它加入 PATH 后刷新。",
  "project-dir-missing": "项目目录可能已被移动或删除，请检查后重新打开项目。",
  "file-write": "请检查磁盘空间与目录权限。",
  timeout: "可以重试一次；如果反复超时，请检查网络或换一个 CLI。",
};

export interface CliFailureDiagnosis {
  kind: CliFailureKind;
  /** Short user-facing reason (Chinese, one line). */
  summary: string;
  /** Optional remediation hint for the UI. */
  hint?: string;
  /** The first output line that triggered the classification, for logs. */
  evidence?: string;
}

function firstMatchingLine(output: string, pattern: RegExp): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && pattern.test(line));
}

/**
 * Classifies a failed CLI invocation. Returns `undefined` for successful runs
 * so callers can `if (diagnosis)` directly.
 */
export function classifyCliFailure(input: {
  exitCode: number | null;
  output: string;
  cancelled?: boolean;
  timedOut?: boolean;
}): CliFailureDiagnosis | undefined {
  if (!input.cancelled && !input.timedOut && input.exitCode === 0) {
    return undefined;
  }
  const build = (kind: CliFailureKind, pattern?: RegExp): CliFailureDiagnosis => ({
    kind,
    summary: CLI_FAILURE_SUMMARIES[kind],
    ...(CLI_FAILURE_HINTS[kind] ? { hint: CLI_FAILURE_HINTS[kind] } : {}),
    ...(pattern
      ? (() => {
          const evidence = firstMatchingLine(input.output, pattern);
          return evidence ? { evidence } : {};
        })()
      : {}),
  });

  if (input.cancelled) return build("cancelled");
  if (input.timedOut) return build("timeout");
  // Order matters: the most specific signals first. Auth before quota because
  // 401 bodies sometimes mention limits; permission before file-write because
  // EACCES matches both.
  if (NOT_INSTALLED_PATTERN.test(input.output)) return build("not-installed", NOT_INSTALLED_PATTERN);
  if (AUTH_PATTERN.test(input.output)) return build("auth", AUTH_PATTERN);
  if (QUOTA_PATTERN.test(input.output)) return build("quota", QUOTA_PATTERN);
  if (MODEL_UNAVAILABLE_PATTERN.test(input.output)) return build("model-unavailable", MODEL_UNAVAILABLE_PATTERN);
  if (PERMISSION_FAILURE_PATTERN.test(input.output)) return build("permission", PERMISSION_FAILURE_PATTERN);
  if (PROJECT_DIR_PATTERN.test(input.output)) return build("project-dir-missing", PROJECT_DIR_PATTERN);
  if (FILE_WRITE_PATTERN.test(input.output)) return build("file-write", FILE_WRITE_PATTERN);
  if (NON_INTERACTIVE_PATTERN.test(input.output)) return build("non-interactive", NON_INTERACTIVE_PATTERN);
  if (NETWORK_PATTERN.test(input.output)) return build("network", NETWORK_PATTERN);
  return build("unknown");
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
