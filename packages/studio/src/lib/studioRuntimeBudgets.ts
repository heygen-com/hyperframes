/**
 * Budgets for the Studio runtime-cost gate: idle CPU past quiescence, scrub
 * cost, request volume on open, and heap retained per project switch.
 *
 * Distinct from `player/lib/timelineViewportBudgets.ts`, which bounds the
 * timeline viewport and its virtualization. These four numbers describe what a
 * project costs while it is simply open, which no open-time measurement sees.
 *
 * Every field here is enforced by `tests/e2e/studio-runtime-cost.mjs`. Numbers
 * the gate reports but does not gate on (byte totals, request counts, node and
 * listener counts) are deliberately absent: a declared budget with no consumer
 * is the state this plan exists to remove.
 */
export interface StudioRuntimeBudgets {
  /** Length of one idle sampling window. */
  idleWindowMs: number;
  /** Give up if quiescence is not reached within this many windows. */
  idleMaxWindows: number;
  /** Two windows are "the same" when their recalc counts differ by no more than this fraction. */
  idleQuiescenceToleranceRatio: number;
  /** How many consecutive same-as-previous windows quiescence requires. */
  idleQuiescenceStableWindows: number;
  /** Fraction of one CPU core the renderer may spend across a quiescent idle window. */
  idleCpuFractionOfCore: number;
  /** Relaxed CPU ceiling for shared runners, which are slower and noisier. */
  constrainedIdleCpuFractionOfCore: number;
  /** Style recalculations per second across a quiescent idle window. */
  idleStyleRecalcsPerSecond: number;
  /** Layouts per second across a quiescent idle window. */
  idleLayoutsPerSecond: number;
  /** requestAnimationFrame calls per second, summed over every frame and call site. */
  idleAnimationFrameCallsPerSecond: number;
  /** Horizontal distance the synthetic playhead drag covers. */
  scrubDistancePx: number;
  /** Pointer moves the drag is split into. */
  scrubSteps: number;
  /** Full-document `video, audio` queries permitted across the whole drag. */
  scrubFullDocumentMediaQueries: number;
  /** Media requests permitted per distinct media source on open. */
  openMediaRequestsPerDistinctSource: number;
  /** No new request for this long means the open has settled. */
  openQuietPeriodMs: number;
  /** Project switches sampled, alternating two projects. */
  switchCycles: number;
  /** JS heap growth permitted per switch, measured after a forced collection. */
  switchHeapBytesPerCycle: number;
  /** A project that is not interactive within this window fails on timeout. */
  readyTimeoutMs: number;
  /** Relaxed readiness window for shared runners. */
  constrainedReadyTimeoutMs: number;
}

const MEBIBYTE = 1024 * 1024;

/**
 * Targets, not observations. `studio-runtime-cost.baseline.json` records what
 * the build measured today; these are what it must reach.
 */
export const STUDIO_RUNTIME_BUDGETS: Readonly<StudioRuntimeBudgets> = Object.freeze({
  idleWindowMs: 10_000,
  idleMaxWindows: 8,
  idleQuiescenceToleranceRatio: 0.1,
  idleQuiescenceStableWindows: 2,
  idleCpuFractionOfCore: 0.01,
  constrainedIdleCpuFractionOfCore: 0.03,
  idleStyleRecalcsPerSecond: 5,
  idleLayoutsPerSecond: 5,
  idleAnimationFrameCallsPerSecond: 5,
  scrubDistancePx: 400,
  scrubSteps: 40,
  scrubFullDocumentMediaQueries: 0,
  openMediaRequestsPerDistinctSource: 1.2,
  openQuietPeriodMs: 3_000,
  switchCycles: 8,
  switchHeapBytesPerCycle: 0.1 * MEBIBYTE,
  readyTimeoutMs: 90_000,
  constrainedReadyTimeoutMs: 180_000,
});

const INTEGER_FIELDS = [
  "idleWindowMs",
  "idleMaxWindows",
  "idleQuiescenceStableWindows",
  "scrubDistancePx",
  "scrubSteps",
  "scrubFullDocumentMediaQueries",
  "openQuietPeriodMs",
  "switchCycles",
  "readyTimeoutMs",
  "constrainedReadyTimeoutMs",
] as const;

const RATIO_FIELDS = [
  "idleQuiescenceToleranceRatio",
  "idleCpuFractionOfCore",
  "constrainedIdleCpuFractionOfCore",
] as const;

function assertValidBudget(name: keyof StudioRuntimeBudgets, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Studio runtime budget ${name} must be a finite non-negative number`);
  }
}

export function resolveStudioRuntimeBudgets(
  overrides: Partial<StudioRuntimeBudgets> = {},
): Readonly<StudioRuntimeBudgets> {
  for (const [name, value] of Object.entries(overrides)) {
    assertValidBudget(name as keyof StudioRuntimeBudgets, value);
  }
  const resolved = { ...STUDIO_RUNTIME_BUDGETS, ...overrides };
  for (const name of INTEGER_FIELDS) {
    if (!Number.isInteger(resolved[name])) {
      throw new RangeError(`Studio runtime budget ${name} must be an integer`);
    }
  }
  for (const name of RATIO_FIELDS) {
    if (resolved[name] > 1) {
      throw new RangeError(`Studio runtime budget ${name} cannot exceed 1`);
    }
  }
  // Quiescence needs at least one same-as-previous comparison to mean anything,
  // and enough windows left to reach it, or the gate reports the backlog it was
  // written to sample past.
  if (resolved.idleQuiescenceStableWindows < 1) {
    throw new RangeError("Studio runtime budget idleQuiescenceStableWindows must be at least 1");
  }
  if (resolved.idleMaxWindows <= resolved.idleQuiescenceStableWindows) {
    throw new RangeError(
      "Studio runtime budget idleMaxWindows must exceed idleQuiescenceStableWindows",
    );
  }
  if (resolved.scrubSteps < 2) {
    throw new RangeError("Studio runtime budget scrubSteps must be at least 2 to form a drag");
  }
  if (resolved.switchCycles < 2) {
    throw new RangeError("Studio runtime budget switchCycles must be at least 2 to alternate");
  }
  if (resolved.openMediaRequestsPerDistinctSource < 1) {
    throw new RangeError(
      "Studio runtime budget openMediaRequestsPerDistinctSource cannot be below 1: " +
        "every distinct source is fetched at least once",
    );
  }
  return Object.freeze(resolved);
}

/**
 * Index of the first idle window that is past quiescence, or null while the
 * measurement is still watching a transient.
 *
 * Quiescence is a condition, not an elapsed time. The first ten seconds of a
 * media project drain the thumbnail-extraction backlog and read several times
 * the steady state, so a fixed sleep gates on a transient. A window qualifies
 * only once it and the required number of windows before it each match their
 * predecessor within the tolerance.
 */
export function findIdleQuiescentWindow(
  styleRecalcsPerWindow: readonly number[],
  budgets: Readonly<StudioRuntimeBudgets> = STUDIO_RUNTIME_BUDGETS,
): number | null {
  const { idleQuiescenceStableWindows: stable, idleQuiescenceToleranceRatio: tolerance } = budgets;
  for (let index = stable; index < styleRecalcsPerWindow.length; index += 1) {
    let settled = true;
    for (let back = 0; back < stable; back += 1) {
      const current = styleRecalcsPerWindow[index - back];
      const previous = styleRecalcsPerWindow[index - back - 1];
      const scale = Math.max(current, previous);
      if (scale > 0 && Math.abs(current - previous) > tolerance * scale) {
        settled = false;
        break;
      }
    }
    if (settled) return index;
  }
  return null;
}
