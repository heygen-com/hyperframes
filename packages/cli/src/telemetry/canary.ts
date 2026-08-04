/**
 * CLI binding for the canary registry.
 *
 * `@hyperframes/core` owns the decision (pure, browser-safe, caller supplies
 * everything). This file supplies the three things only the CLI knows: the
 * install's stable id, the env override, and whether we're on CI.
 *
 * Using one, from anywhere in the CLI / producer call path:
 *
 * ```ts
 * import { isCanaryEnabled } from "../telemetry/canary.js";
 * if (isCanaryEnabled("de-parallel-router")) { ...ramped path... }
 * ```
 *
 * That is the whole API. Percentage lives in the registry, not at the call
 * site, so ramping is a one-line edit in a patch release and never touches
 * the feature's own code.
 */

// Leaf subpath imports, not the "@hyperframes/core" barrel: this resolves on
// the CLI startup path, and the barrel pulls the whole core surface. Same
// reason the producer is lazily loaded.
import {
  canaryFeatureProperties,
  evaluateCanary,
  parseCanaryOverride,
  type CanaryDecision,
} from "@hyperframes/core/canary";
import { CANARIES, canaryEnvVar, findCanary } from "@hyperframes/core/canary-registry";
import { readConfig } from "./config.js";
import { telemetryRuntimeOverride } from "./policy.js";
import { getSystemMeta } from "./system.js";

/**
 * Opting out of telemetry opts you out of canaries.
 *
 * A canary is a measured rollout: we enrol a slice precisely so we can compare
 * it against everyone else. An install that sends nothing can't be compared,
 * so enrolling it buys no signal — it only changes that user's code path, on
 * an experimental feature, without their knowledge and with no way for us to
 * see the result. That is the wrong side of an opt-out.
 *
 * Deliberately mirrors `shouldTrack()` rather than importing it: client.ts
 * already imports this module for `canaryEventProperties`, so depending on it
 * here would be a cycle. Both read the same two inputs (`policy.ts`'s runtime
 * override, then the persisted preference), so they cannot disagree.
 */
function telemetryActive(): boolean {
  if (telemetryRuntimeOverride() !== null) return false;
  return readConfig().telemetryEnabled;
}

/**
 * Decisions are memoized per process: a `--batch` run asks the same question
 * once per row, and a canary must not change its mind mid-process — a render
 * that starts enrolled has to finish enrolled, and its telemetry has to agree
 * with what actually ran.
 */
const decisions = new Map<string, CanaryDecision>();

// The memo is scoped to a telemetry posture, not to the process. Within one
// render nothing may change (a render that starts enrolled must finish
// enrolled), but `hyperframes preview` is a long-lived server that re-serves
// decisions on every page load — and it used to keep serving pre-opt-out
// decisions for hours after `hyperframes telemetry disable`, which is exactly
// what the docs promise cannot happen.
let decisionsTelemetryPosture: boolean | undefined;

/** Test-only: drop memoized decisions so cases don't leak into each other. */
export function __resetCanaryCacheForTests(): void {
  decisions.clear();
  decisionsTelemetryPosture = undefined;
}

/** The uncached decision. Split out so `resolveCanary` is purely the memo. */
function decideCanary(name: string): CanaryDecision {
  const definition = findCanary(name);
  if (!definition) return { enabled: false, reason: "out_of_cohort" };

  const override = parseCanaryOverride(process.env[canaryEnvVar(definition.name)]);

  // Resolved ahead of evaluate so an opted-out install is never bucketed at
  // all. An explicit HF_CANARY_* override still wins: that is a deliberate
  // local choice (support session, bisect, developer testing), not silent
  // enrolment, and it stays the way to exercise a canary with telemetry off.
  if (override === undefined && !telemetryActive()) {
    return { enabled: false, reason: "telemetry_opt_out" };
  }

  const config = readConfig();
  return evaluateCanary({
    feature: definition.name,
    // The bucket seed, NOT the anonymousId: the seed is inherited across
    // config.json re-mints via the install-state file, so cohorts hold when
    // the telemetry id re-rolls. Both files live in ~/.hyperframes, so
    // deleting that directory clears the cohort too — intentional. Fallback
    // covers only a failed backfill write on a legacy config.
    unitId: config.bucketSeed ?? config.anonymousId,
    percentage: definition.percentage,
    override,
    // CI installs regenerate their config per run, so their ids are
    // ephemeral — they would hop cohorts between runs, adding noise to the
    // rollout signal while saying nothing about real users. An explicit
    // override still gets through, which is how you test a canary in CI.
    exclude: getSystemMeta().is_ci,
  });
}

/**
 * Full decision for a registered canary, including the reason — use this when
 * you want to record WHY, not just whether.
 *
 * An unregistered name resolves to off rather than throwing: a canary is a
 * rollout control, and a typo in one must never take down a render.
 */
export function resolveCanary(name: string): CanaryDecision {
  const posture = telemetryActive();
  if (decisionsTelemetryPosture !== posture) {
    decisions.clear();
    decisionsTelemetryPosture = posture;
  }
  const cached = decisions.get(name);
  if (cached) return cached;

  const decision = decideCanary(name);
  decisions.set(name, decision);
  return decision;
}

/** Is this canary on for this install? The everyday call. */
export function isCanaryEnabled(name: string): boolean {
  return resolveCanary(name).enabled;
}

/**
 * One canary's outcome as handed to Studio: the answer, plus whether it came
 * from an explicit override rather than a percentage roll.
 */
export interface CliCanaryDecision {
  enabled: boolean;
  forced: boolean;
}

/**
 * Every registered canary's resolved on/off for this process, for handing to
 * a CLI-launched Studio.
 *
 * Studio adopts these wholesale instead of re-deriving, because re-deriving
 * cannot agree in three cases:
 *
 *   - **Telemetry off.** The CLI resolves `telemetry_opt_out`; Studio's own
 *     opt-out is a separate localStorage flag on a different machine-level
 *     switch, so it would evaluate normally and could enrol.
 *   - **`HF_CANARY_*` override.** Env vars do not cross into the browser at
 *     all — Studio only reads its URL param / sessionStorage — so a support
 *     session forcing a canary on got the CLI forced and Studio guessing.
 *   - **No seed injected.** Whenever the seed is withheld Studio falls back
 *     to a different unit id, i.e. a different bucket.
 *
 * Shipping the decision rather than the inputs makes divergence structurally
 * impossible: one evaluation, two surfaces. It is also strictly less to
 * expose — booleans about features, not the seed the buckets derive from.
 */
export function canaryDecisionsForStudio(): Record<string, CliCanaryDecision> {
  const out: Record<string, CliCanaryDecision> = {};
  for (const canary of CANARIES) {
    const { enabled, reason } = resolveCanary(canary.name);
    out[canary.name] = {
      enabled,
      // Provenance, not decoration. Studio has its own telemetry opt-out that
      // the CLI cannot see, and it must be able to refuse ordinary cohort
      // enrolment while still honouring a deliberate `HF_CANARY_*` override.
      // A bare boolean cannot express that difference, so Studio would have
      // had to either ignore its own opt-out or drop the override.
      forced: reason === "forced_on" || reason === "forced_off",
    };
  }
  return out;
}

/**
 * Canary assignments as PostHog flag properties — `$feature/canary-<name>`
 * set to `"true"` / `"false"` for every registered canary. Spread onto every
 * event so any metric can be broken down by cohort using PostHog's native
 * flag tooling, with nothing configured server-side. See
 * `canaryFeatureProperties` for why non-enrolled canaries are emitted too.
 */
export function canaryEventProperties(): Record<string, string> {
  return canaryFeatureProperties(
    CANARIES.map((c) => ({ name: c.name, enabled: resolveCanary(c.name).enabled })),
  );
}
