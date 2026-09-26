export { STUDIO_MOTION_PATH } from "./studioMotionTypes";
export { controlPointsForGsapEase, parseStudioCustomEaseData } from "./studioMotionOps";

import { readStudioMotionFromElement as readMotionAttr } from "./studioMotionOps";
import {
  STUDIO_MOTION_ATTR,
  STUDIO_MOTION_TIMELINE_ID,
  type StudioMotionPayload,
  type StudioMotionWindow,
} from "./studioMotionTypes";

function readCurrentTime(win: StudioMotionWindow, fallback?: number): number {
  if (typeof fallback === "number" && Number.isFinite(fallback)) return Math.max(0, fallback);
  try {
    const playerTime = win.__player?.getTime?.();
    if (typeof playerTime === "number" && Number.isFinite(playerTime))
      return Math.max(0, playerTime);
  } catch {
    // fall through
  }
  try {
    const timelineTime = win.__timeline?.time?.();
    if (typeof timelineTime === "number" && Number.isFinite(timelineTime)) {
      return Math.max(0, timelineTime);
    }
  } catch {
    // fall through
  }
  return 0;
}

export function applyStudioMotionFromDom(document: Document, currentTime?: number): number {
  const win = document.defaultView as StudioMotionWindow | null;
  if (!win) return 0;
  const gsap = win.gsap;
  win.__timelines = win.__timelines ?? {};
  win.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
  delete win.__timelines[STUDIO_MOTION_TIMELINE_ID];

  const HTMLElementCtor = document.defaultView?.HTMLElement;
  if (!HTMLElementCtor) return 0;

  // Collect elements that have JSON motion data in their attribute
  const motionElements: Array<{
    element: HTMLElement;
    motion: StudioMotionPayload;
  }> = [];

  for (const el of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
    if (!(el instanceof HTMLElementCtor)) continue;
    const motionData = readMotionAttr(el);
    if (motionData) {
      motionElements.push({ element: el, motion: motionData });
    }
  }

  if (!gsap?.timeline || motionElements.length === 0) return 0;

  const timeline = gsap.timeline({
    paused: true,
    defaults: { overwrite: "auto" },
  });
  let applied = 0;
  for (const { element, motion } of motionElements) {
    if (!timeline.fromTo) continue;
    const fromVars: Record<string, unknown> = { ...motion.from };
    const ease = resolveGsapEaseFromPayload(win, motion);
    const toVars: Record<string, unknown> = {
      ...motion.to,
      duration: motion.duration,
      ease,
      overwrite: "auto",
      immediateRender: false,
    };
    timeline.fromTo(element, fromVars, toVars, motion.start);
    applied += 1;
  }

  if (applied === 0) {
    timeline.kill?.();
    return 0;
  }
  win.__timelines[STUDIO_MOTION_TIMELINE_ID] = timeline;
  timeline.pause?.();
  const safeTime = readCurrentTime(win, currentTime);
  if (timeline.totalTime) timeline.totalTime(safeTime, false);
  else timeline.time?.(safeTime);
  return applied;
}

function resolveGsapEaseFromPayload(
  win: StudioMotionWindow,
  motion: { ease: string; customEase?: { id: string; data: string } },
): string {
  const customEase = motion.customEase;
  if (!customEase) return motion.ease;
  const customEasePlugin = win.CustomEase;
  if (typeof customEasePlugin?.create !== "function") return motion.ease;
  try {
    win.gsap?.registerPlugin?.(customEasePlugin);
    customEasePlugin.create(customEase.id, customEase.data);
    return customEase.id;
  } catch {
    return motion.ease;
  }
}
