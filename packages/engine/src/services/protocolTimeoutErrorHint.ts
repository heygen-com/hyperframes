/**
 * Augment Puppeteer CDP protocol-timeout errors with actionable guidance that
 * points at the HyperFrames-specific knobs. Puppeteer's stock error text
 * ("Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting")
 * doesn't tell the user which env var / CLI flag raises this timeout in
 * HyperFrames, or what the currently-applied effective value is — so field
 * reporters have hit this class of failure, given up, and switched to
 * FFmpeg-only encoding rather than raise a knob they didn't know existed
 * (field signal ts=1784047847).
 *
 * The helper is deliberately conservative:
 *   - Only augments errors whose message matches known protocol-timeout
 *     strings (`Runtime.callFunctionOn timed out`, `Target closed`,
 *     `protocolTimeout`).
 *   - Non-matching errors are returned unchanged (same instance).
 *   - Non-Error inputs are coerced with `new Error(String(err))` so callers
 *     get a well-typed `Error` back regardless of what was thrown.
 *   - The original error is preserved via `err.cause`, so stack introspection
 *     and downstream logging still see the raw Puppeteer message.
 */

const PROTOCOL_TIMEOUT_MATCHER = /Runtime\.callFunctionOn timed out|Target closed|protocolTimeout/i;

export function augmentProtocolTimeoutError(err: unknown, effectiveTimeoutMs: number): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  if (!PROTOCOL_TIMEOUT_MATCHER.test(err.message)) return err;
  const augmented = new Error(
    `${err.message}\n\n` +
      `HyperFrames effective protocolTimeout: ${effectiveTimeoutMs} ms.\n\n` +
      `To raise the timeout:\n` +
      `  Env: PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS=<higher-ms>\n` +
      `  CLI: --protocol-timeout <higher-ms>\n\n` +
      `Field signal ts=1784047847: this class of failure appears on RAM-pressured hosts with heavy-asset compositions (9+ videos + 20+ images). If raising the timeout doesn't help, consider FFmpeg-only encoding.`,
  );
  (augmented as Error & { cause?: unknown }).cause = err;
  return augmented;
}

/**
 * Predicate variant: exposed for callers that only need to classify an error
 * (e.g. observability, tests) without materialising an augmented Error. Uses
 * the same matcher as the augmentation path so the two never drift.
 */
export function isProtocolTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return PROTOCOL_TIMEOUT_MATCHER.test(message);
}
