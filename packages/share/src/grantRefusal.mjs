// @ts-check
const PREFIX = "ReviewGrantRefusal:v1:";
const REASONS = new Set(["revision_conflict", "grant_exists", "operation_result_revoked"]);

/** Definitive refusals are per-call data, not the project's mutable last-issue lookup.
 * @param {unknown} error */
export function rejectedGrantRequest(error) {
  return error instanceof Error && "reason" in error && REASONS.has(String(error.reason));
}

/** An explicit wire protocol survives Electron's Error-only serialization and the browser bridge.
 * @param {string} reason @param {string} message */
export function grantRefusalMessage(reason, message) {
  return REASONS.has(reason) ? PREFIX + JSON.stringify({ reason, message }) : message;
}

/** @param {unknown} error */
export function decodeGrantRefusal(error) {
  if (!(error instanceof Error) || !error.message.startsWith(PREFIX)) return error;
  try {
    const data = JSON.parse(error.message.slice(PREFIX.length));
    if (REASONS.has(data.reason) && typeof data.message === "string")
      return Object.assign(new Error(data.message), { reason: data.reason });
  } catch {
    // An invalid wire payload remains an ambiguous failure and keeps its saved request.
  }
  return error;
}
