// Public surface — re-exports types, constants, and ops; owns DOM application logic.

export {
  STUDIO_MOTION_PATH,
  STUDIO_MOTION_TIMELINE_ID,
  STUDIO_GSAP_EASE_OPTIONS,
  type StudioMotionTarget,
  type StudioGsapMotionValues,
  type StudioGsapCustomEase,
  type StudioCustomEaseControlPoints,
  type StudioGsapMotion,
  type StudioGsapMotionPreset,
  type StudioGsapMotionDirection,
  type StudioGsapPresetMotionOptions,
  type StudioMotionManifest,
  type StudioGsapTimeline,
  type StudioMotionWindow,
} from "./studioMotionTypes";

export {
  clampStudioCustomEasePoints,
  parseStudioCustomEaseData,
  serializeStudioCustomEaseData,
  controlPointsForGsapEase,
  buildStudioGsapPresetMotion,
  emptyStudioMotionManifest,
  parseStudioMotionManifest,
  serializeStudioMotionManifest,
  isStudioMotionManifestPath,
  upsertStudioGsapMotion,
  removeStudioMotionForSelection,
  getStudioMotionForSelection,
} from "./studioMotionOps";

import {
  STUDIO_MOTION_ATTR,
  STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR,
  STUDIO_MOTION_ORIGINAL_OPACITY_ATTR,
  STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR,
  STUDIO_MOTION_TIMELINE_ID,
  type StudioGsapMotion,
  type StudioMotionManifest,
  type StudioMotionTarget,
  type StudioMotionWindow,
} from "./studioMotionTypes";

// ── DOM Helpers ──

function sourceFileForElement(element: HTMLElement, activeCompositionPath: string | null): string {
  let current: HTMLElement | null = element;
  while (current) {
    const sourceFile =
      current.getAttribute("data-composition-file") ?? current.getAttribute("data-composition-src");
    if (sourceFile) return sourceFile;
    current = current.parentElement;
  }
  return activeCompositionPath ?? "index.html";
}

function elementMatchesSourceFile(
  element: HTMLElement,
  sourceFile: string,
  activeCompositionPath: string | null,
): boolean {
  return sourceFileForElement(element, activeCompositionPath) === sourceFile;
}

function querySelectorCandidates(document: Document, selector: string): HTMLElement[] {
  const isCandidate = (element: Element): element is HTMLElement => {
    const HTMLElementCtor = element.ownerDocument.defaultView?.HTMLElement;
    return Boolean(HTMLElementCtor && element instanceof HTMLElementCtor);
  };
  const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
  if (className) {
    return Array.from(document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        isCandidate(element) && element.classList.contains(className),
    );
  }
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
    return Array.from(document.getElementsByTagName(selector)).filter(isCandidate);
  }
  return Array.from(document.querySelectorAll(selector)).filter(isCandidate);
}

function resolveTarget(
  document: Document,
  target: StudioMotionTarget,
  activeCompositionPath: string | null,
): HTMLElement | null {
  const HTMLElementCtor = document.defaultView?.HTMLElement;
  if (target.id) {
    const byId = document.getElementById(target.id);
    if (
      HTMLElementCtor &&
      byId instanceof HTMLElementCtor &&
      elementMatchesSourceFile(byId, target.sourceFile, activeCompositionPath)
    ) {
      return byId;
    }
  }
  if (!target.selector) return null;
  try {
    const matches = querySelectorCandidates(document, target.selector).filter((element) =>
      elementMatchesSourceFile(element, target.sourceFile, activeCompositionPath),
    );
    return matches[Math.max(0, Math.floor(target.selectorIndex ?? 0))] ?? null;
  } catch {
    return null;
  }
}

function captureOriginalMotionStyles(element: HTMLElement): void {
  if (element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  element.setAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR, element.style.transform);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR, element.style.opacity);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR, element.style.visibility);
}

function restoreStudioMotionElement(element: HTMLElement, gsap: StudioMotionWindow["gsap"]): void {
  if (!element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  gsap?.set?.(element, { clearProps: "transform,opacity,visibility" });
  element.style.transform = element.getAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR) ?? "";
  element.style.opacity = element.getAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR) ?? "";
  element.style.visibility = element.getAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR) ?? "";
  element.removeAttribute(STUDIO_MOTION_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR);
}

function restoreStudioMotionElements(document: Document, gsap: StudioMotionWindow["gsap"]): void {
  const HTMLElementCtor = document.defaultView?.HTMLElement;
  if (!HTMLElementCtor) return;
  for (const element of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
    if (element instanceof HTMLElementCtor) restoreStudioMotionElement(element, gsap);
  }
}

function resolveGsapEase(win: StudioMotionWindow, motion: StudioGsapMotion): string {
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

export function applyStudioMotionManifest(
  document: Document,
  manifest: StudioMotionManifest,
  activeCompositionPath: string | null = null,
  currentTime?: number,
): number {
  const win = document.defaultView as StudioMotionWindow | null;
  if (!win) return 0;
  const gsap = win.gsap;
  win.__timelines = win.__timelines ?? {};
  win.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
  delete win.__timelines[STUDIO_MOTION_TIMELINE_ID];
  restoreStudioMotionElements(document, gsap);
  if (!gsap?.timeline || manifest.motions.length === 0) return 0;

  const timeline = gsap.timeline({
    paused: true,
    defaults: { overwrite: "auto" },
  });
  let applied = 0;
  for (const motion of manifest.motions) {
    const element = resolveTarget(document, motion.target, activeCompositionPath);
    if (!element || !timeline.fromTo) continue;
    captureOriginalMotionStyles(element);
    element.setAttribute(STUDIO_MOTION_ATTR, "true");
    const fromVars: Record<string, unknown> = { ...motion.from };
    const toVars: Record<string, unknown> = {
      ...motion.to,
      duration: motion.duration,
      ease: resolveGsapEase(win, motion),
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

export function installStudioMotionSeekReapply(win: Window, apply: () => void): boolean {
  const studioWin = win as StudioMotionWindow;
  studioWin.__hfStudioMotionApply = () => {
    apply();
    return 0;
  };
  if (studioWin.__hfStudioMotionWrapped) return false;
  const player = studioWin.__player;
  if (!player) return false;

  const wrapPlayerMethod = (key: "renderSeek" | "seek") => {
    const original = player[key];
    if (typeof original !== "function") return;
    player[key] = (time: number) => {
      original.call(player, time);
      studioWin.__hfStudioMotionApply?.();
    };
  };
  wrapPlayerMethod("renderSeek");
  wrapPlayerMethod("seek");
  studioWin.__hfStudioMotionWrapped = true;
  return true;
}
