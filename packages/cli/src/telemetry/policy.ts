import { isDevMode } from "../utils/env.js";
import { POSTHOG_API_KEY } from "./transport.js";

export type TelemetryStatusSource =
  | "config"
  | "HYPERFRAMES_NO_TELEMETRY"
  | "DO_NOT_TRACK"
  | "dev_mode"
  | "telemetry_disabled_build";

export type TelemetryStatus = {
  enabled: boolean;
  source: TelemetryStatusSource;
};

const ENV_OPT_OUT_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Parse privacy-control environment variables consistently at every CLI
 * surface. Be liberal about common affirmative spellings so an explicit
 * opt-out never silently becomes an opt-in.
 */
function isEnvOptOutValue(value: string | undefined): boolean {
  return value !== undefined && ENV_OPT_OUT_VALUES.has(value.trim().toLowerCase());
}

/**
 * Return the runtime/build override that suppresses telemetry before the
 * persisted preference is considered.
 */
export function telemetryRuntimeOverride(): Exclude<TelemetryStatusSource, "config"> | null {
  if (isEnvOptOutValue(process.env["HYPERFRAMES_NO_TELEMETRY"])) {
    return "HYPERFRAMES_NO_TELEMETRY";
  }
  if (isEnvOptOutValue(process.env["DO_NOT_TRACK"])) {
    return "DO_NOT_TRACK";
  }
  if (isDevMode()) {
    return "dev_mode";
  }
  if (!POSTHOG_API_KEY.startsWith("phc_")) {
    return "telemetry_disabled_build";
  }
  return null;
}

/**
 * The single effective-status policy shared by the user-facing command and
 * the event emitter. This prevents `telemetry status` from disagreeing with
 * whether events can actually be sent.
 */
export function effectiveTelemetryStatus(configEnabled: boolean): TelemetryStatus {
  const override = telemetryRuntimeOverride();
  if (override !== null) return { enabled: false, source: override };
  return { enabled: configEnabled, source: "config" };
}
