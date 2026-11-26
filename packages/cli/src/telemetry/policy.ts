import { telemetryOptOutVariable } from "../media-use/lib/telemetry-opt-out.mjs";
import { isDevMode } from "../utils/env.js";
import { POSTHOG_API_KEY } from "./posthogKey.js";

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

/**
 * Return the runtime/build override that suppresses telemetry before the
 * persisted preference is considered.
 */
export function telemetryRuntimeOverride(): Exclude<TelemetryStatusSource, "config"> | null {
  const envOptOut = telemetryOptOutVariable(process.env);
  if (envOptOut) return envOptOut;
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
