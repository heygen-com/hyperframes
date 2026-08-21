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
  | "excluded"
  // Telemetry is off, so the install is not enrolled. Distinct from
  // "excluded" because the caller decides this BEFORE evaluate is reached —
  // and because "why is my canary off" has a very different answer in the two
  // cases. Never appears in telemetry by construction: an install that
  // resolves this way sends nothing.
  | "telemetry_opt_out";

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
 *
 * ASCII-only by contract. `charCodeAt` yields UTF-16 code units — two
 * surrogate halves for an astral character — whereas reference FNV-1a is
 * byte-oriented, so the two agree only on ASCII. Both inputs are constrained
 * to satisfy that: canary names by the registry's kebab-case assertion in
 * `canary.test.ts`, unit ids by being UUIDs. Widening either means switching
 * to a UTF-8 encoding here first, which is not free in the browser bundle
 * (`TextEncoder` is fine; `Buffer` is not).
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

  // Ahead of `exclude` and the unit-id check: at 100 the registry's step 4
  // says to delete the entry and the guard, so anything still resolving false
  // here would take the new path for the FIRST time at deletion, unstaged.
  // CI and seedless installs are exactly the populations a dashboard cannot
  // see, so "100% and holding" looked green while they were never exercised.
  if (pct >= 100) return { enabled: true, reason: "in_cohort" };

  if (input.exclude) return { enabled: false, reason: "excluded" };

  const unitId = input.unitId?.trim();
  if (!unitId) return { enabled: false, reason: "no_unit_id" };

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

/**
 * Property-name prefix for canary assignments on telemetry events.
 *
 * PostHog treats `$feature/<key>` as a first-class flag property: breakdowns,
 * funnels split by cohort and the experiment surfaces all key on it. Emitting
 * assignments in that shape means the analysis tooling works on a canary with
 * nothing configured server-side — the decision still happens locally and
 * offline, which the render path requires (no render-time network calls, and
 * behaviour must not depend on analytics being reachable).
 *
 * The `canary-` infix is deliberate. A real PostHog flag namespace already
 * exists in this project, owned by the web app (e.g. `enable-chat-tab`, set by
 * posthog-js). Namespacing guarantees a canary key can never alias a real flag
 * key and have the two fight over the same property.
 */
export const CANARY_FEATURE_PREFIX = "$feature/canary-";

/** `de-parallel-router` → `$feature/canary-de-parallel-router`. */
export function canaryFeatureKey(name: string): string {
  return `${CANARY_FEATURE_PREFIX}${name}`;
}

/**
 * Companion key carrying WHY a canary resolved as it did.
 *
 * Deliberately outside the `$feature/` namespace: PostHog treats those as flag
 * values and a non-boolean there would corrupt the flag's own breakdowns. This
 * is an ordinary property that sits alongside.
 *
 * `de-parallel-router` → `canary_reason_de_parallel_router`.
 */
export function canaryReasonKey(name: string): string {
  return `canary_reason_${name.replace(/[^A-Za-z0-9]+/g, "_")}`;
}

/**
 * Build the telemetry properties for a set of resolved canaries.
 *
 * Emits EVERY registered canary, not just the enrolled ones, because absent
 * and `"false"` mean different things: absent is "this build predates the
 * canary", `"false"` is "this build has it and this install is not enrolled".
 * Collapsing those makes a ramp unreadable — you cannot tell a control group
 * from an old version.
 *
 * Values are the strings `"true"` / `"false"` to match how PostHog records
 * boolean flag values, so the property is directly comparable to a real flag.
 *
 * **The reason rides alongside when supplied**, under `canary_reason_<name>`.
 * Without it the assignment alone is ambiguous in the one case that matters:
 * an install reporting both `"true"` and `"false"` for a canary whose
 * percentage never moved is indistinguishable from a developer toggling
 * `HF_CANARY_*`. The first calibration read hit exactly that wall — 304
 * installs reported both values and the genuinely anomalous ones could not be
 * separated from deliberate overrides. The registry doc deferred this until
 * the stability check came back dirty; it did.
 *
 * `reason` is optional so existing callers keep working; a caller that has the
 * full decision should pass it.
 */
export function canaryFeatureProperties(
  entries: ReadonlyArray<{ name: string; enabled: boolean; reason?: CanaryReason }>,
): Record<string, string> {
  const props: Record<string, string> = {};
  for (const entry of entries) {
    props[canaryFeatureKey(entry.name)] = entry.enabled ? "true" : "false";
    if (entry.reason !== undefined) props[canaryReasonKey(entry.name)] = entry.reason;
  }
  return props;
}
