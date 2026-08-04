export const TIMELINE_REBIND_INTERVAL_FRAMES = 60;
export const PLAY_REBIND_HOLD_SECONDS = 2;

/**
 * Period of the transport's PAUSED schedule. The frame loop only runs while the
 * clock is playing; paused, the tick's passengers (periodic timeline rebind,
 * duration re-sync, the re-seek that re-applies animated state after a DOM
 * edit) move onto this timer instead. 500ms keeps the same wall-clock cadence
 * the 60fps loop gave `bindMediaMetadataListeners` while costing ~2 style
 * recalcs/second instead of ~120.
 */
export const PAUSED_TRANSPORT_TICK_INTERVAL_MS = 500;

/**
 * Divisor for the tick's periodic work while on the paused schedule. Two ticks
 * of {@link PAUSED_TRANSPORT_TICK_INTERVAL_MS} is one second — the cadence the
 * frame loop's `% 60` rebind gate produced at 60fps.
 */
export const PAUSED_TRANSPORT_SLOW_WORK_EVERY_TICKS = 2;

export function shouldAttemptPeriodicTimelineBind(input: {
  tick: number;
  isPlaying: boolean;
  hasCapturedTimeline: boolean;
  currentTimeSeconds: number;
  /** Ticks between attempts; defaults to the 60fps frame-loop interval. */
  intervalTicks?: number;
}): boolean {
  const interval = input.intervalTicks ?? TIMELINE_REBIND_INTERVAL_FRAMES;
  if (
    !Number.isInteger(input.tick) ||
    input.tick <= 0 ||
    !Number.isInteger(interval) ||
    interval <= 0 ||
    input.tick % interval !== 0
  ) {
    return false;
  }
  return !(
    input.isPlaying &&
    input.hasCapturedTimeline &&
    input.currentTimeSeconds < PLAY_REBIND_HOLD_SECONDS
  );
}
