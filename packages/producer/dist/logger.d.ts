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
    /**
     * Optional fast level check used to skip expensive metadata construction
     * at the call site. When the call site needs to build a non-trivial meta
     * object (e.g. snapshot a struct, format numbers, run `Array.find` over
     * scene state) just to attach to a debug log, gate it with this method:
     *
     * ```ts
     * if (log.isLevelEnabled?.("debug") ?? true) {
     *   const meta = buildExpensiveMeta();
     *   log.debug("hot-path event", meta);
     * }
     * ```
     *
     * The default coalescence (`?? true`) preserves today's behavior for
     * loggers that omit this method — they keep building the meta object as
     * before. Custom integrations (Pino, Winston, structured loggers) should
     * implement this to enable the optimization.
     */
    isLevelEnabled?(level: LogLevel): boolean;
}
/**
 * Create a console-based logger with level filtering.
 *
 * Messages at or below the configured level are printed;
 * everything else is silently dropped.
 */
export declare function createConsoleLogger(level?: LogLevel): ProducerLogger;
/** Default logger singleton (level: "info"). */
export declare const defaultLogger: ProducerLogger;
//# sourceMappingURL=logger.d.ts.map