const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

export function sanitizeProjectName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  if (!cleaned) {
    return "game-project";
  }

  if (RESERVED_WINDOWS_NAMES.has(cleaned.toLowerCase())) {
    return `${cleaned}-project`;
  }

  return cleaned;
}

export function createProjectId(): string {
  return `proj_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createRunStepId(): string {
  return `step_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createSnapshotId(): string {
  return `snap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
