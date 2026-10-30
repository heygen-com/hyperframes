/** Drift a playing element may carry before sync pulls it back onto the playhead. */
export const MEDIA_SYNC_TOLERANCE_SECONDS = 0.04;
export const MEDIA_HARD_SYNC_SECONDS = 0.5;

// Steered by rate, not seeked (a seek resets a video's decoder and clicks in audio); steps keep rate writes rare.
const MEDIA_STEER = 0.03;
const MEDIA_STEER_STEPS: readonly (readonly [lag: number, steer: number])[] = [
  [0.3, 0.25],
  [0.1, 0.1],
];
const MEDIA_STEER_RELEASE_SECONDS = 0.01;
// Audio never steers past 10%, where speech changes tempo; a lag held past 100 ms is seeked instead.
const AUDIO_MAX_STEER = 0.1;
const AUDIO_STEER_LIMIT_SECONDS = 0.1;

/** Direction (+1 fast, -1 slow) an element is being steered in; absent when it plays at its authored rate. */
const steering = new WeakMap<HTMLMediaElement, number>();

/** Rate or seek for media `offset` s behind (+) or ahead (-); a lag still growing (`settled` false) never seeks. */
export function steerMedia(
  el: HTMLMediaElement,
  offset: number,
  baseRate: number,
  settled: boolean,
  audioOnly = el.tagName === "AUDIO",
): { rate: number; seek: boolean } {
  const lag = Math.abs(offset);
  if (audioOnly && settled && lag > AUDIO_STEER_LIMIT_SECONDS) {
    steering.delete(el);
    return { rate: baseRate, seek: true };
  }
  const direction = Math.sign(offset);
  const current = steering.get(el);
  if (lag > MEDIA_SYNC_TOLERANCE_SECONDS) steering.set(el, direction);
  else if (current !== direction || lag <= MEDIA_STEER_RELEASE_SECONDS) {
    steering.delete(el);
    return { rate: baseRate, seek: false };
  }
  const step = MEDIA_STEER_STEPS.find(([from]) => lag > from)?.[1] ?? MEDIA_STEER;
  const steer = audioOnly ? Math.min(step, AUDIO_MAX_STEER) : step;
  return { rate: baseRate * (1 + direction * steer), seek: false };
}

/** Drop `el`'s steering: it was seeked, paused or replaced, so its old offset says nothing. */
export function forgetSteering(el: HTMLMediaElement): void {
  steering.delete(el);
}

export function isSteering(el: HTMLMediaElement): boolean {
  return steering.has(el);
}
