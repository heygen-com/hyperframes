/**
 * CLI diagnostics logger.
 *
 * Diagnostics (notices, progress, warnings, errors) go to **stderr**. stdout is
 * reserved for a command's machine-readable payload — most importantly `--json`
 * output — and its primary human result. A diagnostic written to stdout corrupts
 * that payload for any consumer that parses it (see #2520 / #2522).
 *
 * This mirrors the producer's `ProducerLogger` contract for the CLI, but without
 * `[LEVEL]` prefixes so user-facing notices keep their own formatting. Route all
 * diagnostic output through `diag` (or `console.error` / `console.warn` directly)
 * — never `console.log` / `console.info` for diagnostics.
 */
export const diag = {
  /** A user-facing notice or progress line (e.g. "Installing … skills…"). */
  notice(...args: unknown[]): void {
    console.error(...args);
  },
  /** A warning the user should see but that isn't fatal. */
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
};
