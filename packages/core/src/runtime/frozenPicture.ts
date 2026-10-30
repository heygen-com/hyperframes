import { isVideoElement } from "./domRealm";
import { mediaSourceTimeAt } from "./media";
import type { RuntimeMediaClip } from "./types";

/** A playing film's video whose picture is not moving: it has no frame to show, or its own clock stands still while the
 * film's runs. Both are invisible to "waiting" (a paused element, or one that decoded its last frame). */
export const FROZEN_PICTURE = {
  /** Film seconds between two looks at a video's clock. */
  lookSeconds: 1,
  /** A video's clock must cover this share of what the clip's own timing says it should, or it stands still. */
  movedShare: 0.1,
  /** A look that should have moved the clock less than this proves nothing (a held last frame, a near-stopped ramp). */
  minDueSeconds: 0.05,
} as const;

const HAVE_CURRENT_DATA = 2;

type Look = { film: number; time: number };
const looks = new WeakMap<HTMLVideoElement, Look>();
const stood = new WeakSet<HTMLVideoElement>();

/** One call per tick with the clips on screen now: whether any video shows nothing, or stands still. The clock a clip
 * should have is the clip's own (rate, speed ramp, loop), so a loop's wrap or a slow clip is never a stall. */
export function hasFrozenPicture(clips: readonly RuntimeMediaClip[], filmTime: number): boolean {
  let frozen = false;
  for (const clip of clips) {
    const el = clip.el;
    if (!isVideoElement(el)) continue;
    const look = looks.get(el);
    if (!look || filmTime < look.film) {
      looks.set(el, { film: filmTime, time: el.currentTime });
      stood.delete(el);
    } else if (filmTime - look.film >= FROZEN_PICTURE.lookSeconds) {
      const due = mediaSourceTimeAt(clip, filmTime) - mediaSourceTimeAt(clip, look.film);
      // A negative due is a loop's wrap: the span has no straight line to judge.
      if (due >= FROZEN_PICTURE.minDueSeconds) {
        if (el.currentTime - look.time < due * FROZEN_PICTURE.movedShare) stood.add(el);
        else stood.delete(el);
      } else stood.delete(el);
      looks.set(el, { film: filmTime, time: el.currentTime });
    }
    if (el.readyState < HAVE_CURRENT_DATA || stood.has(el)) frozen = true;
  }
  return frozen;
}
