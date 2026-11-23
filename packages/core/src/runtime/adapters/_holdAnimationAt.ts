import { swallow } from "../diagnostics";

export function holdAnimationAt(
  animation: Animation,
  timeMs: number,
  currentTimeSite: string,
  pauseSite: string,
): void {
  let pauseFailed = false;
  // Pause first so the pending pause holds the seek time, not the next frame's time.
  try {
    animation.pause();
  } catch (err) {
    pauseFailed = true;
    swallow(pauseSite, err);
  }
  try {
    animation.currentTime = timeMs;
  } catch (err) {
    swallow(currentTimeSite, err);
  }
  if (pauseFailed) {
    try {
      animation.pause();
    } catch (err) {
      swallow(pauseSite, err);
    }
  }
}
