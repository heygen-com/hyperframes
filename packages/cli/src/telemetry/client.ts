import { readConfig, writeConfig } from "./config.js";
import { VERSION } from "../version.js";
import { c } from "../ui/colors.js";
import { diag } from "../ui/diagnostics.js";
import { isDevMode } from "../utils/env.js";
import { getSystemMeta } from "./system.js";
import { enqueue, POSTHOG_API_KEY, type EventProperties } from "./transport.js";

// ---------------------------------------------------------------------------
// CLI-facing telemetry policy: opt-out checks, system-metadata enrichment, and
// the first-run disclosure notice. The reliability-critical delivery layer
// (the event queue, `flush()`, and the exit-time `flushSync()`) lives in
// transport.ts. `flush` / `flushSync` are re-exported here so existing callers
// (events.ts, index.ts, the cli.ts exit handlers) keep importing from
// `./client.js` unchanged.
// ---------------------------------------------------------------------------

export { flush, flushSync } from "./transport.js";

let telemetryEnabled: boolean | null = null;

/**
 * Check if telemetry should be active.
 * Disabled when: dev mode, user opted out, CI environment, or HYPERFRAMES_NO_TELEMETRY set.
 */
export function shouldTrack(): boolean {
  if (telemetryEnabled !== null) return telemetryEnabled;

  if (process.env["HYPERFRAMES_NO_TELEMETRY"] === "1" || process.env["DO_NOT_TRACK"] === "1") {
    telemetryEnabled = false;
    return false;
  }

  if (isDevMode()) {
    telemetryEnabled = false;
    return false;
  }

  // Safety check: ensure the API key has been configured (phc_ prefix = valid PostHog key)
  if (!POSTHOG_API_KEY.startsWith("phc_")) {
    telemetryEnabled = false;
    return false;
  }

  const config = readConfig();
  telemetryEnabled = config.telemetryEnabled;
  return telemetryEnabled;
}

/**
 * Queue a telemetry event. Non-blocking, fail-silent.
 * Enriches the event with system metadata, then hands it to the transport
 * queue (which stamps the dedup uuid + timestamp).
 */
export function trackEvent(
  event: string,
  properties: EventProperties = {},
  distinctId?: string,
): void {
  if (!shouldTrack()) return;

  const sys = getSystemMeta();
  enqueue(
    event,
    {
      ...properties,
      cli_version: VERSION,
      os: process.platform,
      arch: process.arch,
      node_version: process.version,
      os_release: sys.os_release,
      cpu_count: sys.cpu_count,
      cpu_model: sys.cpu_model ?? undefined,
      cpu_speed: sys.cpu_speed ?? undefined,
      memory_total_mb: sys.memory_total_mb,
      is_docker: sys.is_docker,
      is_ci: sys.is_ci,
      ci_name: sys.ci_name ?? undefined,
      is_wsl: sys.is_wsl,
      is_tty: sys.is_tty,
      sandbox_runtime: sys.sandbox_runtime ?? undefined,
      agent_runtime: sys.agent_runtime ?? undefined,
      // New-agent discovery signals — populated only when agent_runtime is null.
      agent_hint: sys.agent_hint ?? undefined,
      term_program: sys.term_program ?? undefined,
      agent_env_hints: sys.agent_env_hints ?? undefined,
    },
    distinctId,
  );
}

/**
 * Show the first-run telemetry notice if it hasn't been shown yet.
 * Must be called BEFORE any tracking calls so the user sees the disclosure
 * before any data is sent.
 */
export function showTelemetryNotice(): boolean {
  if (!shouldTrack()) return false;

  const config = readConfig();
  if (config.telemetryNoticeShown) return false;

  // Persist the notice flag first, before any tracking occurs,
  // so the user is never tracked without having seen the disclosure.
  config.telemetryNoticeShown = true;
  writeConfig(config);

  // stderr (via diag), not stdout: this first-run disclosure is not gated by
  // --json (the guard in cli.ts filters by command only), so a stdout banner
  // would corrupt the JSON envelope of the very first `check --json` etc.
  diag.notice();
  diag.notice(`  ${c.dim("Hyperframes collects anonymous usage data to improve the tool.")}`);
  diag.notice(`  ${c.dim("File paths and composition content are never collected.")}`);
  diag.notice(
    `  ${c.dim("If you sign in to HeyGen, your account (email, or username) is linked to your usage.")}`,
  );
  diag.notice();
  diag.notice(`  ${c.dim("Disable anytime:")} ${c.accent("hyperframes telemetry disable")}`);
  diag.notice();

  return true;
}
