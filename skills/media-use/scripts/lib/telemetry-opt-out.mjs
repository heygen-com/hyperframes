// The one rule for "telemetry is off" in a process's environment. It has no imports, so the CLI, the media-use
// skill scripts (published as standalone files) and Studio's build configs can all read it.
export const TELEMETRY_OPT_OUT_VARIABLES = ["HYPERFRAMES_NO_TELEMETRY", "DO_NOT_TRACK"];
export const TELEMETRY_OPT_OUT_VALUES = ["1", "true", "yes", "on"];

/** The variable in `variables` that turns telemetry off, or null when none does. */
export function telemetryOptOutVariable(variables) {
  for (const name of TELEMETRY_OPT_OUT_VARIABLES) {
    const value = variables[name];
    if (typeof value === "string" && TELEMETRY_OPT_OUT_VALUES.includes(value.trim().toLowerCase()))
      return name;
  }
  return null;
}
