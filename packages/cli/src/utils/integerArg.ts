import { CliUsageError } from "./commandResult.js";

/** A whole-number flag from 1 to max; unset returns undefined, anything else is a usage error. */
export function parsePositiveIntegerArg(
  value: unknown,
  flag: string,
  options: { max?: number; unit?: string } = {},
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  const { max, unit } = options;
  if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    const range = max === undefined ? "a positive integer" : `an integer from 1 to ${max}`;
    throw new CliUsageError(`${flag} must be ${range}${unit ? ` number of ${unit}` : ""}`);
  }
  return parsed;
}
