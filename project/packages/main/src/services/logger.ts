import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogMeta = Record<string, unknown>;

export interface FileLoggerOptions {
  /** Absolute path of the primary log file. When omitted the logger only mirrors to console. */
  filePath?: string;
  /** Rotate the file once it grows beyond this many bytes. */
  maxBytes?: number;
  /** How many rotated files to keep (app.1.log ... app.N.log). */
  maxFiles?: number;
  /** Lines below this level are dropped. */
  minLevel?: LogLevel;
  /** Also echo lines to the console (handy in dev). */
  mirrorConsole?: boolean;
  /** Forward every formatted line to another logger too (e.g. project log -> app log). */
  tee?: FileLogger;
}

const MAX_META_STRING = 2000;

// ── Sensitive-data redaction ──────────────────────────────────────────────────
// Local-CLI logging routinely captures argv, env hints, prompts and stderr.
// Tokens/keys and the local username must never land in a log file that users
// may share for support. Applied centrally to every formatted line.

const REDACTION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI / Anthropic style secret keys: sk-..., sk-ant-..., rk-...
  { pattern: /\b(sk|rk)-[A-Za-z0-9_-]{8,}/g, replacement: "$1-***" },
  // Authorization headers / bearer tokens.
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, replacement: "Bearer ***" },
  // KEY/TOKEN/SECRET/PASSWORD assignments (env style, JSON, CLI flags).
  // Uppercase-only on purpose: lowercase JSON fields like "input_tokens"
  // are usage metrics, not secrets.
  {
    pattern:
      /\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)(\\?["']?\s*[=:]\s*\\?["']?)(?!\*\*\*)[^\s\\"',;}]+/g,
    replacement: "$1$2***",
  },
  // Local usernames inside home-directory paths (Windows + POSIX).
  { pattern: /([A-Za-z]:\\+Users\\+)([^\\/\s"',;]+)/g, replacement: "$1<user>" },
  { pattern: /(\/(?:home|Users)\/)([^/\s"',;]+)/g, replacement: "$1<user>" },
];

/** Masks tokens, keys and the local username in a log line. */
export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const rule of REDACTION_RULES) {
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }
  return redacted;
}

function safeMeta(meta: LogMeta): string {
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(meta, (_key, value) => {
      if (typeof value === "string" && value.length > MAX_META_STRING) {
        return `${value.slice(0, MAX_META_STRING)}…(+${value.length - MAX_META_STRING})`;
      }
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[circular]";
        seen.add(value);
      }
      return value;
    });
    return json && json !== "{}" ? ` ${json}` : "";
  } catch {
    return " {\"meta\":\"<unserializable>\"}";
  }
}

export class FileLogger {
  private readonly filePath?: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly minLevel: number;
  private readonly mirrorConsole: boolean;
  private readonly tee?: FileLogger;
  private queue: Promise<void> = Promise.resolve();
  private dirReady = false;

  constructor(options: FileLoggerOptions = {}) {
    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 5;
    this.minLevel = LEVEL_ORDER[options.minLevel ?? "info"];
    this.mirrorConsole = options.mirrorConsole ?? false;
    this.tee = options.tee;
  }

  debug(scope: string, message: string, meta?: LogMeta): void {
    this.log("debug", scope, message, meta);
  }
  info(scope: string, message: string, meta?: LogMeta): void {
    this.log("info", scope, message, meta);
  }
  warn(scope: string, message: string, meta?: LogMeta): void {
    this.log("warn", scope, message, meta);
  }
  error(scope: string, message: string, meta?: LogMeta): void {
    this.log("error", scope, message, meta);
  }

  log(level: LogLevel, scope: string, message: string, meta?: LogMeta): void {
    if (LEVEL_ORDER[level] < this.minLevel) {
      return;
    }
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${redactSensitiveText(
      `${message}${meta ? safeMeta(meta) : ""}`,
    )}\n`;

    if (this.mirrorConsole) {
      const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      sink(line.trimEnd());
    }
    if (this.filePath) {
      this.enqueue(this.filePath, line);
    }
    this.tee?.ingest(level, line);
  }

  /** Accept a pre-formatted line from a tee source (already includes timestamp/level). */
  private ingest(level: LogLevel, line: string): void {
    if (LEVEL_ORDER[level] < this.minLevel) {
      return;
    }
    if (this.mirrorConsole) {
      const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      sink(line.trimEnd());
    }
    if (this.filePath) {
      this.enqueue(this.filePath, line);
    }
  }

  private enqueue(filePath: string, line: string): void {
    this.queue = this.queue
      .then(async () => {
        if (!this.dirReady) {
          await mkdir(path.dirname(filePath), { recursive: true });
          this.dirReady = true;
        }
        await this.rotateIfNeeded(filePath, line.length);
        await appendFile(filePath, line, "utf8");
      })
      .catch(() => {
        // Logging must never throw into the app; swallow IO errors.
      });
  }

  private async rotateIfNeeded(filePath: string, incomingBytes: number): Promise<void> {
    let size = 0;
    try {
      size = (await stat(filePath)).size;
    } catch {
      return; // file does not exist yet
    }
    if (size + incomingBytes <= this.maxBytes) {
      return;
    }
    // Drop the oldest, then shift each rotated file up by one.
    try {
      await unlink(`${filePath}.${this.maxFiles}`).catch(() => undefined);
      for (let i = this.maxFiles - 1; i >= 1; i -= 1) {
        await rename(`${filePath}.${i}`, `${filePath}.${i + 1}`).catch(() => undefined);
      }
      await rename(filePath, `${filePath}.1`).catch(() => undefined);
    } catch {
      // best-effort rotation
    }
  }

  /** Flush all pending writes (call before quit). */
  async flush(): Promise<void> {
    await this.queue;
    if (this.tee) {
      await this.tee.flush();
    }
  }
}

// --- App-wide singleton + per-project logger cache ---------------------------

const consoleFallback = new FileLogger({ mirrorConsole: true, minLevel: "debug" });
let appLogger: FileLogger | null = null;
const projectLoggers = new Map<string, FileLogger>();

export interface InitAppLoggerOptions {
  dataRoot: string;
  mirrorConsole?: boolean;
  minLevel?: LogLevel;
}

/** Initialise the global app.log. Safe to call once at startup. */
export function initAppLogger(options: InitAppLoggerOptions): FileLogger {
  appLogger = new FileLogger({
    filePath: path.join(options.dataRoot, "logs", "app.log"),
    maxBytes: 5 * 1024 * 1024,
    maxFiles: 5,
    minLevel: options.minLevel ?? "info",
    mirrorConsole: options.mirrorConsole ?? false,
  });
  return appLogger;
}

/** The global app logger. Before init() it is a console-only fallback (used by unit tests). */
export function getAppLogger(): FileLogger {
  return appLogger ?? consoleFallback;
}

/**
 * Per-project maintenance log under `<projectRoot>/.gameaistudio/logs/project.log`.
 * Lines are also teed into app.log so a single timeline exists for support.
 */
export function getProjectLogger(projectRoot: string): FileLogger {
  const filePath = path.join(projectRoot, ".gameaistudio", "logs", "project.log");
  let logger = projectLoggers.get(filePath);
  if (!logger) {
    logger = new FileLogger({
      filePath,
      maxBytes: 2 * 1024 * 1024,
      maxFiles: 3,
      minLevel: "debug",
      tee: getAppLogger(),
    });
    projectLoggers.set(filePath, logger);
  }
  return logger;
}

/** Install handlers so uncaught crashes land in app.log. */
export function installProcessErrorLogging(): void {
  process.on("uncaughtException", (error) => {
    getAppLogger().error("process", "uncaughtException", { error });
  });
  process.on("unhandledRejection", (reason) => {
    getAppLogger().error("process", "unhandledRejection", {
      error: reason instanceof Error ? reason : String(reason),
    });
  });
}

/** Flush app + project logs (call on quit). */
export async function flushAllLogs(): Promise<void> {
  await getAppLogger().flush();
  await Promise.all([...projectLoggers.values()].map((logger) => logger.flush()));
}
