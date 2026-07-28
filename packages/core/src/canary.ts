/**
 * Canary rollouts — ship a change to a stable slice of installs instead of
 * all-or-nothing.
 *
 * The problem this solves: the repo has ~49 `HF_*` / `PRODUCER_*` boolean
 * toggles, and every one of them is binary. A change is either off (and
 * therefore untested on real traffic) or on for everyone (and therefore a
 * fleet-wide bet). The parallel-drawElement router spent weeks in that gap:
 * default-off collected almost no signal, and flipping it default-on exposed
 * 100% of eligible installs at once. A percentage slice is the missing rung.
 *
 * Design notes worth knowing before you add one:
 *
 * - **Pure and universal.** No fs, no network, no `process` — the caller
 *   supplies the unit id and the overrides. That keeps this importable from
 *   the CLI, the producer, the engine, studio-server, the browser-side studio
 *   bundle, and the embeddable player alike.
 *
 * - **Independent slices.** The bucket is a hash of `feature:unitId`, NOT of
 *   `unitId` alone. If every canary bucketed on the id by itself, they would
 *   all select the SAME installs — one unlucky cohort would receive every
 *   experiment simultaneously, and no two rollouts could be read
 *   independently.
 *
 * - **Ramping is inclusive.** `bucket < percentage` means widening 10 → 25
 *   keeps every install that was already at 10. Cohorts never reshuffle, so
 *   before/after comparisons stay valid across a ramp.
 *
 * - **Stable per install, for the life of the install.** The same id and
 *   feature always resolve the same way, with no persisted state to keep in
 *   sync and nothing to look up at runtime.
 */

/** Why a canary resolved the way it did. Attach to telemetry — a rollout you
 *  can't segment by enrolment reason is a rollout you can't debug. */
export type CanaryReason =
  | "forced_on"
  | "forced_off"
  | "in_cohort"
  | "out_of_cohort"
  | "no_unit_id"
  | "excluded";

export interface CanaryDecision {
  enabled: boolean;
  reason: CanaryReason;
  /** 0-99 slot this unit landed in for this feature; undefined when not computed. */
  bucket?: number;
}

export interface CanaryInput {
  /** Registry key, e.g. "de-parallel-router". Part of the hash, so each feature gets its own slice. */
  feature: string;
  /** Stable per-install id — the CLI's telemetry `anonymousId`. Missing/blank fails closed. */
  unitId: string | undefined;
  /** 0 = off for everyone, 100 = on for everyone. Values outside 0-100 are clamped. */
  percentage: number;
  /**
   * Explicit override, both directions — support escalations, dogfooding, a
   * bisect, or a panic-off. Always wins over the percentage.
   */
  override?: boolean | undefined;
  /**
   * Exclude this unit from percentage-based enrolment (an explicit override
   * still applies). Callers pass `isCI` here: CI installs regenerate their
   * config constantly, so their ids are ephemeral — they would hop cohorts
   * between runs, adding noise to the rollout signal while telling you
   * nothing about real users.
   */
  exclude?: boolean | undefined;
}

/**
 * FNV-1a (32-bit). Chosen over `node:crypto` deliberately: this module has to
 * run in the browser-side studio bundle and the embeddable player too, and a
 * six-line hash beats shipping a polyfill or maintaining two code paths.
 * Distribution is uniform enough for bucketing (pinned by a test).
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619, kept in 32-bit unsigned range without Math.imul overflow
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** The 0-99 slot a unit occupies for a given feature. Exported for tests and diagnostics. */
export function canaryBucket(feature: string, unitId: string): number {
  return fnv1a32(`${feature}:${unitId}`) % 100;
}

/**
 * Resolve whether a feature is on for this unit.
 *
 * Fails closed on a missing id: the canary exists to bound blast radius, so
 * "we don't know who this is" must mean "not enrolled", never "enrol
 * everyone".
 */
export function evaluateCanary(input: CanaryInput): CanaryDecision {
  if (input.override === true) return { enabled: true, reason: "forced_on" };
  if (input.override === false) return { enabled: false, reason: "forced_off" };

  const pct = Math.max(0, Math.min(100, Math.trunc(input.percentage)));
  if (pct <= 0) return { enabled: false, reason: "out_of_cohort" };

  if (input.exclude) return { enabled: false, reason: "excluded" };

  const unitId = input.unitId?.trim();
  if (!unitId) return { enabled: false, reason: "no_unit_id" };

  if (pct >= 100)
    return { enabled: true, reason: "in_cohort", bucket: canaryBucket(input.feature, unitId) };

  const bucket = canaryBucket(input.feature, unitId);
  return bucket < pct
    ? { enabled: true, reason: "in_cohort", bucket }
    : { enabled: false, reason: "out_of_cohort", bucket };
}

/**
 * Parse a canary override from an env-var value.
 *
 * Accepts the spellings people actually type. Returns undefined for
 * unset/empty so the percentage decides — matching how the existing HF_*
 * knobs treat a set-but-empty var, and avoiding the failure mode where an
 * exported-but-empty variable silently forces a feature on.
 */
export function parseCanaryOverride(raw: string | undefined): boolean | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === undefined || v === "") return undefined;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return undefined;
}
