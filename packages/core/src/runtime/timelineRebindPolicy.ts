export const TIMELINE_REBIND_INTERVAL_FRAMES = 60;
export const PLAY_REBIND_HOLD_SECONDS = 2;

export function shouldAttemptPeriodicTimelineBind(input: {
  tick: number;
  isPlaying: boolean;
  hasCapturedTimeline: boolean;
  currentTimeSeconds: number;
}): boolean {
  if (
    !Number.isInteger(input.tick) ||
    input.tick <= 0 ||
    input.tick % TIMELINE_REBIND_INTERVAL_FRAMES !== 0
  ) {
    return false;
  }
  return !(
    input.isPlaying &&
    input.hasCapturedTimeline &&
    input.currentTimeSeconds < PLAY_REBIND_HOLD_SECONDS
  );
}
