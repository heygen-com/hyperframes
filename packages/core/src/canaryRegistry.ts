/**
 * The canary registry — every staged rollout in the product, in one file.
 *
 * Why a registry rather than a percentage inlined at each call site: the repo
 * already carries 57 loose `HF_*` / `PRODUCER_*` toggles with no index, so
 * nobody can answer "what is currently rolling out, to how many people, and
 * who owns it" without grepping. One table fixes that, and gives the
 * telemetry and `doctor` surfaces something to enumerate.
 *
 * ## Adding one
 *
 * 1. Add an entry below. Start at `percentage: 0` and merge that — a canary
 *    at 0 is dead code you can land safely and ramp without a code review.
 * 2. Read it at the decision point via the surface's binding (in the CLI,
 *    `isCanaryEnabled("your-feature")`).
 * 3. Ramp by editing `percentage` in a patch release: 0 → 5 → 25 → 100.
 *    Widening is inclusive, so the earlier cohort stays enrolled and the
 *    before/after comparison survives the ramp.
 * 4. At 100 and holding, DELETE the entry and the branch it guarded. That is
 *    the point of `sunsetAfter`.
 *
 * ## Overriding
 *
 * `HF_CANARY_<FEATURE>` with the feature name upper-snake-cased, e.g.
 * `HF_CANARY_DE_PARALLEL_ROUTER=on` (also: off/true/false/1/0/yes/no).
 * An override always wins over the percentage, in both directions.
 */

export interface CanaryDefinition {
  /** Registry key. Kebab-case; also the hash input, so renaming reshuffles the cohort. */
  name: string;
  /** 0-100. Start at 0, ramp in patch releases. */
  percentage: number;
  /** What turning this on actually changes, in one line. */
  description: string;
  /** Who to ask. */
  owner: string;
  /**
   * ISO date after which this canary is overdue for removal. A canary that
   * outlives its rollout is a permanent fork of the product with none of the
   * review a permanent fork would have received. The scheduled `Canary sunset`
   * workflow runs `scripts/check-canary-sunset.ts` weekly and fails once the
   * date passes, so this is an enforced deadline rather than a good intention.
   */
  sunsetAfter: string;
}

export const CANARIES: readonly CanaryDefinition[] = [
  // ── Calibration ──────────────────────────────────────────────────────────
  // Two INERT canaries that gate nothing. They exist to validate the rollout
  // mechanism against real traffic before anything real depends on it, and
  // they answer questions the synthetic tests cannot:
  //
  //   1. Does a requested percentage land on target in the wild? The unit
  //      tests use generated UUIDs and weight every install equally; real
  //      render volume is heavily skewed toward a few heavy installs, so the
  //      render-weighted share could differ from the install-weighted one.
  //   2. How fast does CUMULATIVE exposure drift above the target? Install
  //      ids churn (measured: 24.7x more distinct ids over 30 days than in
  //      any single day), so the set of installs enrolled AT SOME POINT grows
  //      even though the instantaneous share stays flat. That drift is the
  //      real limit on a canary's blast-radius guarantee.
  //   3. Are two canaries actually independent on real ids, not just on
  //      generated ones? Overlap should be ~p1*p2, not ~min(p1,p2).
  //
  // Two different percentages so the answer is a line, not a point.
  // Delete both once the calibration window is read.
  {
    name: "calibration-10",
    percentage: 10,
    description: "Inert. Validates rollout accuracy and cumulative-exposure drift at 10%.",
    owner: "vance",
    sunsetAfter: "2026-09-15",
  },
  {
    name: "calibration-50",
    percentage: 50,
    description:
      "Inert. Second calibration point, and an independence check against calibration-10.",
    owner: "vance",
    sunsetAfter: "2026-09-15",
  },
  // ── Audio FX ─────────────────────────────────────────────────────────────
  {
    name: "audio-fx-rack",
    percentage: 0,
    description:
      "Show the Audio FX rack on audio tracks in Studio — effects, presets, the voiceover carve and levelling. Gates the AUTHORING surface only: a composition that already carries data-fx-chain still plays and renders it, because a canary should stage who can reach a feature, not make a written attribute silently inert.",
    owner: "vance",
    sunsetAfter: "2026-11-15",
  },
  {
    name: "audio-track-mute",
    percentage: 0,
    description:
      "Label the visibility control as Mute on audio tracks, and make preview " +
      "silence data-hidden audio the way the render already does. Fixes a " +
      "shipped preview/export mismatch, so it is gated separately.",
    owner: "vance",
    sunsetAfter: "2026-12-15",
  },
] as const;

export function findCanary(name: string): CanaryDefinition | undefined {
  return CANARIES.find((c) => c.name === name);
}

/** Env-var name for a feature's manual override: `de-parallel-router` → `HF_CANARY_DE_PARALLEL_ROUTER`. */
export function canaryEnvVar(name: string): string {
  return `HF_CANARY_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/**
 * Names of canaries whose sunset date has passed — either finish the rollout
 * and delete the entry, or push the date with a reason. Exposed as a function
 * (not a lint rule) so the check runs in the normal test suite.
 */
export function overdueCanaries(now: Date = new Date()): string[] {
  return CANARIES.filter((c) => {
    // End of the sunset day, not its start. The field is documented as the
    // date AFTER which a canary is overdue, but comparing against midnight UTC
    // made it overdue ON that date — and earlier still for anyone west of UTC.
    const sunsetEnd = Date.parse(`${c.sunsetAfter}T23:59:59.999Z`);
    return Number.isFinite(sunsetEnd) && now.getTime() > sunsetEnd;
  }).map((c) => c.name);
}
