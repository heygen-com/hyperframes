export type TelemetryOptOutVariable = "HYPERFRAMES_NO_TELEMETRY" | "DO_NOT_TRACK";
export const TELEMETRY_OPT_OUT_VARIABLES: readonly TelemetryOptOutVariable[];
export const TELEMETRY_OPT_OUT_VALUES: readonly string[];
export function telemetryOptOutVariable(
  variables: Readonly<Record<string, string | undefined>>,
): TelemetryOptOutVariable | null;
