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

function look(el: HTMLVideoElement, film: number): void {
  looks.set(el, { film, time: el.currentTime });
}

function judge(clip: RuntimeMediaClip, el: HTMLVideoElement, last: Look, film: number): void {
  const due = mediaSourceTimeAt(clip, film) - mediaSourceTimeAt(clip, last.film);
  const moved = el.currentTime - last.time;
  const standing = due >= FROZEN_PICTURE.minDueSeconds && moved < due * FROZEN_PICTURE.movedShare;
  if (standing) stood.add(el);
  else stood.delete(el);
}

/** Whether any video in the window shows nothing, or its clock stands still against its clip's own timing. */
export function hasFrozenPicture(clips: readonly RuntimeMediaClip[], filmTime: number): boolean {
  let frozen = false;
  for (const clip of clips) {
    const el = clip.el;
    if (!isVideoElement(el)) continue;
    const last = looks.get(el);
    if (!last || filmTime < last.film) {
      look(el, filmTime);
      stood.delete(el);
    } else if (filmTime - last.film >= FROZEN_PICTURE.lookSeconds) {
      judge(clip, el, last, filmTime);
      look(el, filmTime);
    }
    if (el.readyState < HAVE_CURRENT_DATA || stood.has(el)) frozen = true;
  }
  return frozen;
}
