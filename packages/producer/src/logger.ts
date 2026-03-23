/**
 * Pluggable Producer Logger
 *
 * Lightweight pluggable logger with zero dependencies.
 * Default implementation writes to console with level filtering.
 *
 * Users can provide their own logger (e.g. Winston, Pino) by
 * implementing the ProducerLogger interface.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface ProducerLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Create a console-based logger with level filtering.
 *
 * Messages at or below the configured level are printed;
 * everything else is silently dropped.
 */
export function createConsoleLogger(level: LogLevel = "info"): ProducerLogger {
  const threshold = LOG_LEVEL_PRIORITY[level];

  const shouldLog = (msgLevel: LogLevel): boolean => LOG_LEVEL_PRIORITY[msgLevel] <= threshold;

  const formatMeta = (meta?: Record<string, unknown>): string =>
    meta ? ` ${JSON.stringify(meta)}` : "";

  return {
    error(message, meta) {
      if (shouldLog("error")) {
        console.error(`[ERROR] ${message}${formatMeta(meta)}`);
      }
    },
    warn(message, meta) {
      if (shouldLog("warn")) {
        console.warn(`[WARN] ${message}${formatMeta(meta)}`);
      }
    },
    info(message, meta) {
      if (shouldLog("info")) {
        console.log(`[INFO] ${message}${formatMeta(meta)}`);
      }
    },
    debug(message, meta) {
      if (shouldLog("debug")) {
        console.log(`[DEBUG] ${message}${formatMeta(meta)}`);
      }
    },
  };
}

/** Default logger singleton (level: "info"). */
export const defaultLogger: ProducerLogger = createConsoleLogger("info");
