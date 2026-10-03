import type { RuntimeSeekOptions, RuntimeTimelineLike } from "../types";

type GsapChildPrivateFields = { _dur?: number; _zTime?: number; ratio?: number };
const GSAP_ARMED_Z_TIME = 1e-8;
const spentAtEventfulSeek = new WeakMap<object, Set<GsapChildPrivateFields>>();

function recordSpent(timeline: Pick<RuntimeTimelineLike, "getChildren">): void {
  const children = (timeline.getChildren?.(true, true, true) ?? []) as GsapChildPrivateFields[];
  const spent = children.filter((child) => child._dur === 0 && child.ratio === 1);
  spentAtEventfulSeek.set(timeline, new Set(spent));
}

function disarmLandedSpent(timeline: object): void {
  for (const child of spentAtEventfulSeek.get(timeline) ?? []) {
    if (child._zTime === GSAP_ARMED_Z_TIME) child._zTime = 0;
  }
  spentAtEventfulSeek.delete(timeline);
}

/**
 * Only access to GSAP private fields (3.x; 3.12.5 to 3.15 checked). A silent landing on a spent
 * zero-duration tween re-arms it (`_zTime` 1e-8) and the next eventful seek fires it again, so the
 * eventful seek records what it left spent and its silent return disarms only those.
 */
export function keepLandedGsapCallbacksSpent(
  timeline: Pick<RuntimeTimelineLike, "getChildren">,
  options: RuntimeSeekOptions | undefined,
): void {
  if (options?.keepFiredCallbacksSpent !== true) return;
  if (options.suppressEvents === true) disarmLandedSpent(timeline);
  else recordSpent(timeline);
}
