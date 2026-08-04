import { readConfig, writeConfig } from "./config.js";
import { VERSION } from "../version.js";
import { c } from "../ui/colors.js";
import { diag } from "../ui/diagnostics.js";
import { getSystemMeta } from "./system.js";
import { canaryEventProperties } from "./canary.js";
import { enqueue, type EventProperties } from "./transport.js";
import { telemetryRuntimeOverride } from "./policy.js";

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
 * Disabled when: a privacy env var is set, this is a development or
 * telemetry-disabled build, or the persisted preference is off.
 */
export function shouldTrack(): boolean {
  if (telemetryEnabled !== null) return telemetryEnabled;

  if (telemetryRuntimeOverride() !== null) {
    telemetryEnabled = false;
    return false;
  }

  const config = readConfig();
  telemetryEnabled = config.telemetryEnabled;
  return telemetryEnabled;
}

/**
 * Drop the cached posture so the next `shouldTrack()` re-reads the persisted
 * preference.
 *
 * The memo is right for a CLI command — one process, one answer, and the
 * question is asked per event. It is wrong for `hyperframes preview`, which
 * lives for hours: run `hyperframes telemetry disable` in another terminal and
 * this process kept the old answer indefinitely, still resolving canaries and
 * still injecting the CLI id into every page load. Callers that serve requests
 * refresh at a request boundary; see `refreshTelemetryPosture` in
 * server/telemetryIdentity.ts, which invalidates this and the config cache
 * together so the two cannot disagree.
 */
export function resetTelemetryPostureCache(): void {
  telemetryEnabled = null;
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
      // Did this install's mint find a previous install's state marker?
      // The fleet-wide rate of `true` IS the recoverable-churn fraction —
      // the share of "new" ids that are really a config re-mint on a machine
      // we already knew. Absent (not false) when the config predates the
      // marker. Resolved after the shouldTrack guard.
      install_predecessor_found: readConfig().predecessorFound,
      // Splits the `true` share above: a machine we knew but whose record we
      // could not read. Without it a partial disk write is indistinguishable
      // from a genuinely fresh install. Absent in the normal case.
      install_state_file_corrupt: readConfig().stateFileCorrupt,
      // Canary assignments as `$feature/canary-<name>` — PostHog's native flag
      // property shape, so breakdowns and experiment analysis work on a canary
      // with nothing configured server-side. On EVERY event, not just renders:
      // a staged rollout is only as good as the ability to split any metric by
      // cohort. Resolved after the shouldTrack guard, so opted-out installs
      // never pay for it. See telemetry/canary.ts.
      ...canaryEventProperties(),
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
