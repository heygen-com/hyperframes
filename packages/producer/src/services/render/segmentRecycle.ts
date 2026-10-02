/**
 * Browser recycling and retry classification for segmented capture
 * (spec §5 Phase 2 item 4).
 *
 * A long render's failures cluster in one class: Chrome loses the target
 * mid-capture after tens of thousands of frames. Segmentation makes that
 * survivable — the segment boundary is a safe point to hand the next segment
 * a fresh browser, and a lost target costs one segment's retry rather than
 * the render.
 */

/** Recycle the browser every N segments; 0 disables. ~3 x 3000 frames keeps a session under the 10k-frame band (spec §2.5). */
export const DEFAULT_SEGMENT_BROWSER_RECYCLE = 3;

export function resolveSegmentBrowserRecycle(env: NodeJS.ProcessEnv): number {
  const raw = env.HF_SEGMENT_BROWSER_RECYCLE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SEGMENT_BROWSER_RECYCLE;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_SEGMENT_BROWSER_RECYCLE;
}

const TARGET_LOSS_PATTERNS = [/target closed/i, /detached frame/i, /session closed/i];

/**
 * The mid-capture Chrome target-loss class from spec §2.5 — the only class a
 * segment retry can fix. Encoder failures and authoring errors reproduce on a
 * fresh browser, so retrying them just doubles the time to the same failure.
 */
export function isTargetLossError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return TARGET_LOSS_PATTERNS.some((re) => re.test(error.message));
}
