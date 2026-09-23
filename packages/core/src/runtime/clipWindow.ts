/** Half-open: two back-to-back clips never both hold the shared boundary instant. */
export const isInClipWindow = (time: number, start: number, end: number): boolean =>
  time >= start && time < end;

const TERMINAL_EPSILON_SECONDS = 1e-6;

/**
 * Visibility window: half-open, except a clip that runs to the composition's end also owns
 * the terminal instant, so a finished film rests on its last frame instead of going blank.
 */
export const isClipVisibleAt = (
  time: number,
  start: number,
  end: number,
  compositionDuration: number,
): boolean =>
  isInClipWindow(time, start, end) ||
  (time >= start &&
    compositionDuration > 0 &&
    end >= compositionDuration - TERMINAL_EPSILON_SECONDS);
