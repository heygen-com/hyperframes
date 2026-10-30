import { isVideoElement } from "./domRealm";
import { mediaSourceTimeAt } from "./media";
import type { RuntimeMediaClip } from "./types";

const FROZEN_PICTURE = {
  lookSeconds: 1,
  movedShare: 0.1,
  minDueSeconds: 0.05,
} as const;

const HAVE_CURRENT_DATA = 2;

type Look = { film: number; time: number };
const looks = new WeakMap<HTMLVideoElement, Look>();
const stood = new WeakSet<HTMLVideoElement>();

/** Whether any video in the window shows nothing, or its clock stands still against its clip's own timing. */
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
