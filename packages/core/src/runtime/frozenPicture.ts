/** A playing film's video whose picture is not moving: it has no frame to show, or its own clock stands still while the
 * film's runs. Both are invisible to "waiting" (a paused element, or one that decoded its last frame). */
export const FROZEN_PICTURE = {
  /** Film seconds between two looks at a video's clock. */
  lookSeconds: 1,
  /** A video's clock must cover this share of the film seconds that passed, or it stands still. */
  movedShare: 0.1,
} as const;

const HAVE_CURRENT_DATA = 2;

type Look = { film: number; time: number };
const looks = new WeakMap<HTMLVideoElement, Look>();
const stood = new WeakSet<HTMLVideoElement>();

/** One call per tick with the videos on screen now: whether any shows nothing, or stands still. */
export function hasFrozenPicture(
  videos: readonly HTMLVideoElement[],
  filmTime: number,
  rate: number,
): boolean {
  let frozen = false;
  for (const el of videos) {
    const look = looks.get(el);
    if (!look || filmTime < look.film) {
      looks.set(el, { film: filmTime, time: el.currentTime });
      stood.delete(el);
    } else if (filmTime - look.film >= FROZEN_PICTURE.lookSeconds) {
      const moved = el.currentTime - look.time;
      const due = (filmTime - look.film) * rate * FROZEN_PICTURE.movedShare;
      if (!el.ended && moved < due) stood.add(el);
      else stood.delete(el);
      looks.set(el, { film: filmTime, time: el.currentTime });
    }
    if (el.readyState < HAVE_CURRENT_DATA || stood.has(el)) frozen = true;
  }
  return frozen;
}
