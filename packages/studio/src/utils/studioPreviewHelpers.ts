import type { DomEditViewport } from "../components/editor/domEditing";
import {
  getDomLayerPatchTarget,
  isElementComputedVisible,
  resolveAllVisualDomEditTargets,
} from "../components/editor/domEditingElement";
import { getEventTargetElement } from "./studioHelpers";

interface PreviewLocalPointer {
  x: number;
  y: number;
  viewport: DomEditViewport;
}

// An element is "full-bleed" when its box spans nearly the whole composition on
// BOTH axes. Such elements (scene wrappers, backdrops) are excluded from canvas
// click-picking so a click lands on inner content — or deselects on empty area —
// instead of grabbing the giant container. The Layers panel still selects them.
// ponytail: pure size heuristic; tighten the ratio if decorative full-bleed art
// should remain canvas-selectable.
const FULL_BLEED_RATIO = 0.95;

export function coversComposition(
  elRect: { width: number; height: number },
  viewport: DomEditViewport,
): boolean {
  if (viewport.width <= 1 || viewport.height <= 1) return false;
  return (
    elRect.width / viewport.width >= FULL_BLEED_RATIO &&
    elRect.height / viewport.height >= FULL_BLEED_RATIO
  );
}

function isFullBleedTarget(el: HTMLElement, viewport: DomEditViewport): boolean {
  return coversComposition(el.getBoundingClientRect(), viewport);
}

function resolvePreviewLocalPointer(
  iframe: HTMLIFrameElement,
  doc: Document,
  win: Window,
  clientX: number,
  clientY: number,
): PreviewLocalPointer | null {
  const iframeRect = iframe.getBoundingClientRect();
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  const rootWidth = rootRect?.width || win.innerWidth;
  const rootHeight = rootRect?.height || win.innerHeight;
  if (!rootWidth || !rootHeight) return null;

  const scaleX = iframeRect.width / rootWidth;
  const scaleY = iframeRect.height / rootHeight;
  return {
    x: (clientX - iframeRect.left) / scaleX,
    y: (clientY - iframeRect.top) / scaleY,
    viewport: { width: rootWidth, height: rootHeight },
  };
}

const POINTER_EVENTS_OVERRIDE_ID = "__hf_studio_pointer_events_override__";

function forcePointerEventsAuto(doc: Document): HTMLStyleElement | null {
  try {
    const style = doc.createElement("style");
    style.id = POINTER_EVENTS_OVERRIDE_ID;
    style.textContent = "* { pointer-events: auto !important; }";
    doc.head.appendChild(style);
    return style;
  } catch {
    return null;
  }
}

function removePointerEventsOverride(style: HTMLStyleElement | null): void {
  try {
    style?.remove();
  } catch {
    // cross-origin or detached doc
  }
}

// fallow-ignore-next-line complexity
export function getPreviewTargetFromPointer(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
  activeCompositionPath: string | null,
): HTMLElement | null {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return null;
  }
  if (!doc || !win) return null;

  const localPointer = resolvePreviewLocalPointer(iframe, doc, win, clientX, clientY);
  if (!localPointer) return null;

  const overrideStyle = forcePointerEventsAuto(doc);
  try {
    if (typeof doc.elementsFromPoint === "function") {
      const candidates = resolveAllVisualDomEditTargets(
        doc.elementsFromPoint(localPointer.x, localPointer.y),
        { activeCompositionPath },
      );
      const visualTarget =
        candidates.find((el) => !isFullBleedTarget(el, localPointer.viewport)) ?? null;
      if (visualTarget) return visualTarget;
    }

    const fallback = getEventTargetElement(doc.elementFromPoint(localPointer.x, localPointer.y));
    if (!fallback || !getDomLayerPatchTarget(fallback, activeCompositionPath)) return null;
    if (!isElementComputedVisible(fallback)) return null;
    if (isFullBleedTarget(fallback, localPointer.viewport)) return null;
    return fallback;
  } finally {
    removePointerEventsOverride(overrideStyle);
  }
}

/** Returns all independently-selectable elements at the pointer (topmost first). */
export function getAllPreviewTargetsFromPointer(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
  activeCompositionPath: string | null,
): HTMLElement[] {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return [];
  }
  if (!doc || !win) return [];

  const localPointer = resolvePreviewLocalPointer(iframe, doc, win, clientX, clientY);
  if (!localPointer) return [];

  const overrideStyle = forcePointerEventsAuto(doc);
  try {
    if (typeof doc.elementsFromPoint === "function") {
      return resolveAllVisualDomEditTargets(doc.elementsFromPoint(localPointer.x, localPointer.y), {
        activeCompositionPath,
      }).filter((el) => !isFullBleedTarget(el, localPointer.viewport));
    }
    const fallback = getEventTargetElement(doc.elementFromPoint(localPointer.x, localPointer.y));
    if (!fallback || !getDomLayerPatchTarget(fallback, activeCompositionPath)) return [];
    if (!isElementComputedVisible(fallback)) return [];
    if (isFullBleedTarget(fallback, localPointer.viewport)) return [];
    return [fallback];
  } finally {
    removePointerEventsOverride(overrideStyle);
  }
}

function objectLike(value: unknown): object | null {
  return value && (typeof value === "object" || typeof value === "function") ? value : null;
}

function callPlaybackMethod(target: object | null, key: string): void {
  const method = target ? Reflect.get(target, key) : null;
  if (typeof method !== "function") return;
  try {
    method.call(target);
  } catch {
    // Best-effort playback freeze; drag should still work if playback control is unavailable.
  }
}

function readPlaybackTime(target: object | null, key: string): number | null {
  const method = target ? Reflect.get(target, key) : null;
  if (typeof method !== "function") return null;
  try {
    const value = method.call(target);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function pauseStudioPreviewPlayback(iframe: HTMLIFrameElement | null): number | null {
  const win = iframe?.contentWindow;
  if (!win) return null;

  try {
    const player = objectLike(Reflect.get(win, "__player"));
    const playerPausedTime = readPlaybackTime(player, "getTime");
    const playerPause = player ? Reflect.get(player, "pause") : null;
    if (typeof playerPause === "function") {
      callPlaybackMethod(player, "pause");
      return playerPausedTime;
    }

    let pausedTime: number | null = null;
    const timeline = objectLike(Reflect.get(win, "__timeline"));
    pausedTime = pausedTime ?? readPlaybackTime(timeline, "time");
    callPlaybackMethod(timeline, "pause");

    const timelines = objectLike(Reflect.get(win, "__timelines"));
    if (timelines) {
      for (const value of Object.values(timelines)) {
        const timelineRecord = objectLike(value);
        pausedTime = pausedTime ?? readPlaybackTime(timelineRecord, "time");
        callPlaybackMethod(timelineRecord, "pause");
      }
    }

    return pausedTime;
  } catch {
    return null;
  }
}
