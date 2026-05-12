// Public re-exports — consumers import from this file as before.
export {
  STUDIO_MANUAL_EDITS_PATH,
  STUDIO_OFFSET_X_PROP,
  STUDIO_OFFSET_Y_PROP,
  STUDIO_WIDTH_PROP,
  STUDIO_HEIGHT_PROP,
  STUDIO_ROTATION_PROP,
  type StudioManualEditTarget,
  type StudioPathOffsetEdit,
  type StudioBoxSizeEdit,
  type StudioRotationEdit,
  type StudioManualEdit,
  type StudioManualEditManifest,
  type StudioManualEditSeekWindow,
  type StudioBoxSizeSnapshot,
  type StudioRotationSnapshot,
  type StudioPathOffsetSnapshot,
} from "./manualEditsTypes";

export {
  emptyStudioManualEditManifest,
  parseStudioManualEditManifest,
  serializeStudioManualEditManifest,
  readStudioFileChangePath,
  isStudioManualEditManifestPath,
  upsertStudioPathOffsetEdit,
  upsertStudioBoxSizeEdit,
  upsertStudioRotationEdit,
  removeStudioManualEditsForSelection,
} from "./manualEditsParsing";

export {
  beginStudioManualEditGesture,
  endStudioManualEditGesture,
  isStudioManualEditGestureCurrent,
  readStudioPathOffset,
  readStudioBoxSize,
  readStudioRotation,
  applyStudioPathOffset,
  applyStudioPathOffsetDraft,
  applyStudioBoxSize,
  applyStudioBoxSizeDraft,
  applyStudioRotation,
  applyStudioRotationDraft,
  clearStudioPathOffset,
  clearStudioRotation,
  clearStudioBoxSize,
} from "./manualEditsDom";

export {
  captureStudioBoxSize,
  captureStudioRotation,
  captureStudioPathOffset,
  restoreStudioBoxSize,
  restoreStudioRotation,
  restoreStudioPathOffset,
} from "./manualEditsSnapshot";

import type {
  StudioManualEdit,
  StudioManualEditManifest,
  StudioManualEditSeekWindow,
} from "./manualEditsTypes";
import {
  STUDIO_MANUAL_EDITS_APPLY_PROP,
  STUDIO_MANUAL_EDITS_WRAPPED_PROP,
  STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP,
} from "./manualEditsTypes";
import { finiteNumber } from "./manualEditsParsing";
import {
  applyStudioPathOffset,
  applyStudioBoxSize,
  applyStudioRotation,
  isStudioManualEditGestureActive,
  clearStudioPathOffset,
  clearStudioBoxSize,
  clearStudioRotation,
} from "./manualEditsDom";
import { collectStudioManualEditElements } from "./manualEditsSnapshot";

/* ── Seek/play reapply wrappers ───────────────────────────────────── */
function markWrapped(fn: (...args: unknown[]) => unknown): void {
  try {
    Object.defineProperty(fn, STUDIO_MANUAL_EDITS_WRAPPED_PROP, {
      configurable: false,
      enumerable: false,
      value: true,
    });
  } catch {
    try {
      (fn as unknown as Record<string, unknown>)[STUDIO_MANUAL_EDITS_WRAPPED_PROP] = true;
    } catch {
      // Ignore non-extensible functions.
    }
  }
}

function isWrapped(fn: (...args: unknown[]) => unknown): boolean {
  return Boolean((fn as unknown as Record<string, unknown>)[STUDIO_MANUAL_EDITS_WRAPPED_PROP]);
}

function wrapSeekReapplyFunction(
  win: StudioManualEditSeekWindow,
  owner: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const fn = owner?.[key];
  if (!owner || typeof fn !== "function") return false;
  const seek = fn as (...args: unknown[]) => unknown;
  if (isWrapped(seek)) return true;

  const wrappedSeek = function (this: unknown, ...args: unknown[]): unknown {
    const result = seek.apply(this, args);
    win.__hfStudioManualEditsApply?.();
    return result;
  };
  markWrapped(wrappedSeek);
  try {
    owner[key] = wrappedSeek;
  } catch {
    return false;
  }
  return true;
}

function readOwnerNumber(owner: Record<string, unknown>, key: string): number | null {
  const fn = owner[key];
  if (typeof fn !== "function") return null;
  try {
    return finiteNumber(fn.call(owner));
  } catch {
    return null;
  }
}

function hasRemainingTimelineTime(owner: Record<string, unknown>): boolean {
  const duration = readOwnerNumber(owner, "duration") ?? readOwnerNumber(owner, "getDuration");
  if (duration == null) return true;
  if (duration <= 0) return false;

  const time =
    readOwnerNumber(owner, "time") ??
    readOwnerNumber(owner, "totalTime") ??
    readOwnerNumber(owner, "getTime");
  if (time == null) return true;
  return time < duration;
}

function isTimelinePlaying(owner: Record<string, unknown> | undefined): boolean {
  if (!owner) return false;
  const isPlaying = owner.isPlaying;
  if (typeof isPlaying === "function") {
    try {
      return Boolean(isPlaying.call(owner));
    } catch {
      return false;
    }
  }

  const paused = owner.paused;
  if (typeof paused === "function") {
    try {
      if (paused.call(owner)) return false;
    } catch {
      return false;
    }

    const isActive = owner.isActive;
    if (typeof isActive === "function") {
      try {
        if (isActive.call(owner)) return true;
      } catch {
        return false;
      }
    }

    return hasRemainingTimelineTime(owner);
  }

  const isActive = owner.isActive;
  if (typeof isActive === "function") {
    try {
      return Boolean(isActive.call(owner));
    } catch {
      return false;
    }
  }

  return false;
}

function isStudioManualEditPlaybackActive(win: StudioManualEditSeekWindow): boolean {
  if (isTimelinePlaying(win.__player)) return true;
  if (isTimelinePlaying(win.__timeline)) return true;
  return Object.values(win.__timelines ?? {}).some(isTimelinePlaying);
}

function startStudioManualEditPlaybackReapply(win: StudioManualEditSeekWindow): void {
  win.__hfStudioManualEditsApply?.();
  if (win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] != null) return;

  const tick = () => {
    win.__hfStudioManualEditsApply?.();
    if (!isStudioManualEditPlaybackActive(win)) {
      win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] = null;
      return;
    }
    win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] = win.requestAnimationFrame(tick);
  };

  win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] = win.requestAnimationFrame(tick);
}

function wrapPlayReapplyFunction(
  win: StudioManualEditSeekWindow,
  owner: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const fn = owner?.[key];
  if (!owner || typeof fn !== "function") return false;
  const play = fn as (...args: unknown[]) => unknown;
  if (isWrapped(play)) return true;

  const wrappedPlay = function (this: unknown, ...args: unknown[]): unknown {
    const result = play.apply(this, args);
    startStudioManualEditPlaybackReapply(win);
    return result;
  };
  markWrapped(wrappedPlay);
  try {
    owner[key] = wrappedPlay;
  } catch {
    return false;
  }
  return true;
}

function wrapApplyAfterFunction(
  win: StudioManualEditSeekWindow,
  owner: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const fn = owner?.[key];
  if (!owner || typeof fn !== "function") return false;
  const applyAfter = fn as (...args: unknown[]) => unknown;
  if (isWrapped(applyAfter)) return true;

  const wrappedApplyAfter = function (this: unknown, ...args: unknown[]): unknown {
    const result = applyAfter.apply(this, args);
    win.__hfStudioManualEditsApply?.();
    return result;
  };
  markWrapped(wrappedApplyAfter);
  try {
    owner[key] = wrappedApplyAfter;
  } catch {
    return false;
  }
  return true;
}

export function installStudioManualEditSeekReapply(win: Window, apply: () => void): boolean {
  const studioWin = win as StudioManualEditSeekWindow;
  studioWin[STUDIO_MANUAL_EDITS_APPLY_PROP] = apply;

  const wrappedHfSeek = wrapSeekReapplyFunction(studioWin, studioWin.__hf, "seek");
  const wrappedPlayerSeek = wrapSeekReapplyFunction(studioWin, studioWin.__player, "seek");
  const wrappedPlayerRenderSeek = wrapSeekReapplyFunction(
    studioWin,
    studioWin.__player,
    "renderSeek",
  );
  const wrappedTimelineSeek = wrapSeekReapplyFunction(studioWin, studioWin.__timeline, "seek");
  const wrappedPlayerPlay = wrapPlayReapplyFunction(studioWin, studioWin.__player, "play");
  const wrappedTimelinePlay = wrapPlayReapplyFunction(studioWin, studioWin.__timeline, "play");
  const wrappedPlayerPause = wrapApplyAfterFunction(studioWin, studioWin.__player, "pause");
  const wrappedTimelinePause = wrapApplyAfterFunction(studioWin, studioWin.__timeline, "pause");
  let wrappedNamedTimelineSeek = false;
  let wrappedNamedTimelinePlay = false;
  let wrappedNamedTimelinePause = false;
  for (const timeline of Object.values(studioWin.__timelines ?? {})) {
    wrappedNamedTimelineSeek =
      wrapSeekReapplyFunction(studioWin, timeline, "seek") || wrappedNamedTimelineSeek;
    wrappedNamedTimelinePlay =
      wrapPlayReapplyFunction(studioWin, timeline, "play") || wrappedNamedTimelinePlay;
    wrappedNamedTimelinePause =
      wrapApplyAfterFunction(studioWin, timeline, "pause") || wrappedNamedTimelinePause;
  }

  if (isStudioManualEditPlaybackActive(studioWin)) {
    startStudioManualEditPlaybackReapply(studioWin);
  }

  return (
    wrappedHfSeek ||
    wrappedPlayerSeek ||
    wrappedPlayerRenderSeek ||
    wrappedTimelineSeek ||
    wrappedPlayerPlay ||
    wrappedTimelinePlay ||
    wrappedPlayerPause ||
    wrappedTimelinePause ||
    wrappedNamedTimelineSeek ||
    wrappedNamedTimelinePlay ||
    wrappedNamedTimelinePause
  );
}

/* ── DOM target resolution ────────────────────────────────────────── */
function getManualEditSourceFileForElement(
  el: HTMLElement,
  activeCompositionPath: string | null,
): string {
  let current: HTMLElement | null = el;
  while (current) {
    const sourceFile =
      current.getAttribute("data-composition-file") ?? current.getAttribute("data-composition-src");
    if (sourceFile) return sourceFile;
    current = current.parentElement;
  }
  return activeCompositionPath ?? "index.html";
}

function elementMatchesManualEditSourceFile(
  element: HTMLElement,
  sourceFile: string,
  activeCompositionPath: string | null,
): boolean {
  return getManualEditSourceFileForElement(element, activeCompositionPath) === sourceFile;
}

function queryManualEditSelectorCandidates(
  doc: Document,
  selector: string,
  htmlElement: typeof HTMLElement,
): HTMLElement[] {
  const isCandidate = (element: Element): element is HTMLElement => element instanceof htmlElement;

  const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
  if (className) {
    return Array.from(doc.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        isCandidate(element) && element.classList.contains(className),
    );
  }

  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
    return Array.from(doc.getElementsByTagName(selector)).filter(isCandidate);
  }

  return Array.from(doc.querySelectorAll(selector)).filter(isCandidate);
}

function resolveManualEditTarget(
  doc: Document,
  edit: StudioManualEdit,
  activeCompositionPath: string | null,
): HTMLElement | null {
  const htmlElement = doc.defaultView?.HTMLElement;
  if (!htmlElement) return null;

  if (edit.target.id) {
    const byId = doc.getElementById(edit.target.id);
    if (
      byId instanceof htmlElement &&
      elementMatchesManualEditSourceFile(byId, edit.target.sourceFile, activeCompositionPath)
    ) {
      return byId;
    }

    const matchesById = [doc.documentElement, ...Array.from(doc.getElementsByTagName("*"))].filter(
      (element): element is HTMLElement =>
        element instanceof htmlElement &&
        element.id === edit.target.id &&
        elementMatchesManualEditSourceFile(element, edit.target.sourceFile, activeCompositionPath),
    );
    if (matchesById[0]) return matchesById[0];
  }

  if (!edit.target.selector) return null;
  try {
    const matches = queryManualEditSelectorCandidates(
      doc,
      edit.target.selector,
      htmlElement,
    ).filter((element) =>
      elementMatchesManualEditSourceFile(element, edit.target.sourceFile, activeCompositionPath),
    );
    return matches[edit.target.selectorIndex ?? 0] ?? null;
  } catch {
    return null;
  }
}

/* ── Manifest application ─────────────────────────────────────────── */
export function applyStudioManualEditManifest(
  doc: Document,
  manifest: StudioManualEditManifest,
  activeCompositionPath: string | null,
): number {
  const resolvedEdits: Array<{ edit: StudioManualEdit; element: HTMLElement }> = [];
  const pathOffsetTargets = new Set<HTMLElement>();
  const boxSizeTargets = new Set<HTMLElement>();
  const rotationTargets = new Set<HTMLElement>();

  for (const edit of manifest.edits) {
    const element = resolveManualEditTarget(doc, edit, activeCompositionPath);
    if (!element) continue;
    if (isStudioManualEditGestureActive(element)) {
      continue;
    }
    resolvedEdits.push({ edit, element });
    if (edit.kind === "path-offset") pathOffsetTargets.add(element);
    if (edit.kind === "box-size") boxSizeTargets.add(element);
    if (edit.kind === "rotation") rotationTargets.add(element);
  }

  for (const element of collectStudioManualEditElements(doc)) {
    if (isStudioManualEditGestureActive(element)) continue;
    if (!pathOffsetTargets.has(element)) {
      clearStudioPathOffset(element);
    }
    if (!boxSizeTargets.has(element)) {
      clearStudioBoxSize(element);
    }
    if (!rotationTargets.has(element)) {
      clearStudioRotation(element);
    }
  }

  let applied = 0;
  for (const { edit, element } of resolvedEdits) {
    if (edit.kind === "path-offset") {
      applyStudioPathOffset(element, { x: edit.x, y: edit.y });
    } else if (edit.kind === "box-size") {
      applyStudioBoxSize(element, { width: edit.width, height: edit.height });
    } else {
      applyStudioRotation(element, { angle: edit.angle });
    }
    applied += 1;
  }
  return applied;
}
