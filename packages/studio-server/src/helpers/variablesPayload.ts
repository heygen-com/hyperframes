/**
 * Shared shape check for composition-variable payloads (`?variables=` on the
 * preview routes, `body.variables` on the render route) — one contract, one
 * error string, so the routes can't drift.
 */

export const VARIABLES_PAYLOAD_ERROR = "variables must be a JSON object of {variableId: value}";

export function isVariablesPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
