/**
 * Per-chunk runtime constants for `RenderChunk` Lambda invocations.
 * Threshold drives the warning surfaced by the CLI when the slowest
 * observed chunk approaches Lambda's hard cap.
 */

/** Lambda's hard per-invocation cap. */
export const LAMBDA_TIMEOUT_MS = 900_000;

/** Pre-computed 80% of {@link LAMBDA_TIMEOUT_MS} — the warning threshold. */
export const CHUNK_RUNTIME_WARN_MS = LAMBDA_TIMEOUT_MS * 0.8;
