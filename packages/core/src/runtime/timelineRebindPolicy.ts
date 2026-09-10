export const TIMELINE_REBIND_INTERVAL_FRAMES = 60;
export const PLAY_REBIND_HOLD_SECONDS = 2;
/** How often the transport re-posts the clip manifest, in animation frames. */
export const TIMELINE_POST_INTERVAL_FRAMES = 20;
/** How often the transport re-binds metadata listeners, in animation frames. */
export const MEDIA_BIND_INTERVAL_FRAMES = 30;
/**
 * The floor the change-driven (parked) path holds itself to, so a consumer
 * never sees the manifest arrive faster than the frame counter alone produced
 * it: `TIMELINE_POST_INTERVAL_FRAMES` frames at a 60 Hz display.
 */
export const CHANGE_DRIVEN_SERVICE_MIN_INTERVAL_MS = (1000 * TIMELINE_POST_INTERVAL_FRAMES) / 60;

export function shouldAttemptPeriodicTimelineBind(input: {
  tick: number;
  isPlaying: boolean;
  hasCapturedTimeline: boolean;
  currentTimeSeconds: number;
  /**
   * The transport saw a composition change this tick and would like a rebind
   * sooner than the frame counter allows. It is an INPUT to this policy, never
   * a way around it: the play hold below still wins. A caller that ORs its own
   * trigger in front of this function has removed the hold, which exists so an
   * async rebind cannot race the first two seconds of playback.
   */
  compositionChanged?: boolean;
}): boolean {
  // The hold is the outer rule and applies to every trigger.
  if (
    input.isPlaying &&
    input.hasCapturedTimeline &&
    input.currentTimeSeconds < PLAY_REBIND_HOLD_SECONDS
  ) {
    return false;
  }
  if (input.compositionChanged === true) return true;
  return (
    Number.isInteger(input.tick) &&
    input.tick > 0 &&
    input.tick % TIMELINE_REBIND_INTERVAL_FRAMES === 0
  );
}
