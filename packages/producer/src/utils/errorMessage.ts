/**
 * Normalize an unknown thrown value into a human-readable string.
 *
 * The default `String(error)` pattern produces `[object Object]` when the
 * thrown value is a plain object — masking the real error in telemetry.
 * This utility tries, in order:
 *   1. `Error.message`
 *   2. Raw string pass-through
 *   3. `.message` property on a plain object
 *   4. `JSON.stringify` for any other object
 *   5. `String()` fallback for primitives (number, boolean, symbol, bigint)
 *   6. `"unknown error"` for null / undefined
 */
export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(error);
    } catch {
      try {
        return `{${Object.keys(error as object).join(", ")}}`;
      } catch {
        /* truly opaque object */
      }
    }
  }
  return String(error ?? "unknown error");
}
