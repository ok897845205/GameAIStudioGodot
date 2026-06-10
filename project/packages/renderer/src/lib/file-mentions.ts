/**
 * Detects project-file mentions inside chat text so the UI can render them as
 * clickable chips (→ file preview dialog).
 *
 * Recognized forms:
 *  - Godot resource paths: `res://scenes/main.tscn`
 *  - Relative/absolute paths ending in a known project extension:
 *    `scripts/player.gd`, `.gameaistudio/logs/project.log`, `E:\proj\a.md`
 */

const FILE_EXTENSIONS = [
  "gd",
  "gdshader",
  "tscn",
  "tres",
  "godot",
  "cfg",
  "md",
  "txt",
  "json",
  "xml",
  "yml",
  "yaml",
  "shader",
  "log",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "wav",
  "ogg",
  "glb",
  "gltf",
];

const MENTION_PATTERN = new RegExp(
  // res:// paths, or path-like tokens ending in a known extension.
  String.raw`res://[\w\-./]+|(?:[A-Za-z]:[\\/])?[\w\-.~]+(?:[\\/][\w\-.~]+)*\.(?:${FILE_EXTENSIONS.join("|")})\b`,
  "g",
);

/** Strips wrapping punctuation that markdown/prose attaches to a path token. */
function cleanToken(token: string): string {
  return token.replace(/^[`"'(（【[]+/, "").replace(/[`"')）】\],。：:;，]+$/, "");
}

export function normalizeMentionPath(token: string, projectRoot?: string): string {
  let value = cleanToken(token);
  if (value.startsWith("res://")) {
    value = value.slice("res://".length);
  }
  // Absolute path inside the project → relative; keep other absolutes as-is
  // (the host decides how to open them).
  if (projectRoot) {
    const rootForward = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const valueForward = value.replace(/\\/g, "/");
    if (valueForward.toLowerCase().startsWith(`${rootForward.toLowerCase()}/`)) {
      value = valueForward.slice(rootForward.length + 1);
    }
  }
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Returns the unique, normalized project-file mentions found in `text`,
 * in first-appearance order. Capped to keep the chip row sane.
 */
export function extractFileMentions(
  text: string,
  options: { projectRoot?: string; max?: number } = {},
): string[] {
  const max = options.max ?? 8;
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const normalized = normalizeMentionPath(match[0], options.projectRoot);
    // A bare filename without any directory is too ambiguous to be clickable
    // (and "v1.2.json" style version strings sneak in); require a separator
    // or a leading dot-directory.
    if (!normalized.includes("/")) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(normalized);
    if (mentions.length >= max) break;
  }
  return mentions;
}
