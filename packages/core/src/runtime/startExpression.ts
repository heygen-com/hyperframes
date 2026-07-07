/**
 * Pure parser for the `data-start` timing expression grammar, shared by the
 * browser runtime resolver (`createRuntimeStartTimeResolver`) and the Node-side
 * video-frame extractor (`parseVideoElements`) so both agree on exactly what a
 * relative reference means. No DOM/browser dependencies — safe to import in
 * Node.
 *
 * Grammar (matches the docs' "Relative Timing" section):
 *   - `"12.5"`            -> absolute seconds
 *   - `"intro"`           -> start when clip `intro` ends
 *   - `"intro + 2"`       -> 2s after `intro` ends
 *   - `"intro - 0.5"`     -> 0.5s before `intro` ends (overlap)
 */

export type ReferenceExpression =
  | { kind: "absolute"; value: number }
  | { kind: "reference"; refId: string; offset: number };

/** Parse a value to a finite number, or `null` if it isn't one. */
export function parseNumeric(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a raw `data-start` value into an absolute time or a clip reference.
 * Returns `null` when the value is empty or not a recognized expression.
 */
export function parseStartExpression(raw: string | null | undefined): ReferenceExpression | null {
  const normalized = (raw ?? "").trim();
  if (!normalized) return null;
  const absolute = parseNumeric(normalized);
  if (absolute != null) {
    return { kind: "absolute", value: absolute };
  }
  const referenceMatch = normalized.match(/^([A-Za-z0-9_.:-]+)(?:\s*([+-])\s*([0-9]*\.?[0-9]+))?$/);
  if (!referenceMatch) return null;
  const refId = (referenceMatch[1] ?? "").trim();
  if (!refId) return null;
  const sign = referenceMatch[2] ?? "+";
  const offsetRaw = referenceMatch[3] ?? "0";
  const parsedOffset = Number.parseFloat(offsetRaw);
  const offsetMagnitude = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
  const offset = sign === "-" ? -offsetMagnitude : offsetMagnitude;
  return { kind: "reference", refId, offset };
}
