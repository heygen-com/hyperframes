import type { DomEditViewport } from "../components/editor/domEditing";
import {
  getDomLayerPatchTarget,
  isElementComputedVisible,
  resolveAllVisualDomEditTargets,
} from "../components/editor/domEditingElement";
import { isHtmlElement } from "../components/editor/domEditingDom";
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

const pointerEventsInheritanceFallbackByDocument = new WeakMap<Document, boolean>();

function needsPointerEventsInheritanceFallback(doc: Document, win: Window): boolean {
  const cached = pointerEventsInheritanceFallbackByDocument.get(doc);
  if (cached !== undefined) return cached;

  const parent = doc.createElement("div");
  const child = doc.createElement("div");
  parent.style.pointerEvents = "none";
  parent.appendChild(child);
  const host = doc.body ?? doc.documentElement;
  if (!host) return false;

  host.appendChild(parent);
  const needsFallback = win.getComputedStyle(child).pointerEvents !== "none";
  parent.remove();
  pointerEventsInheritanceFallbackByDocument.set(doc, needsFallback);
  return needsFallback;
}

// Own declared pointer-events value, via computed style rather than inline
// style, so a CSS-class opt-in/opt-out (not just an inline style attribute)
// is honored when walking back down from a pointer-events:none ancestor.
function hasOwnPointerEventsOverride(el: HTMLElement, win: Window): boolean {
  const value = win.getComputedStyle(el).pointerEvents;
  return value !== "" && value !== "inherit" && value !== "unset";
}

function inheritsPointerEventsNoneFromAncestor(el: HTMLElement, win: Window): boolean {
  let current = el.parentElement;
  while (current) {
    if (win.getComputedStyle(current).pointerEvents === "none") {
      let descendant: HTMLElement | null = el;
      while (descendant && descendant !== current) {
        if (hasOwnPointerEventsOverride(descendant, win)) {
          return win.getComputedStyle(descendant).pointerEvents === "none";
        }
        descendant = descendant.parentElement;
      }
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hasAuthorPointerEventsNone(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  if (win.getComputedStyle(el).pointerEvents === "none") return true;
  if (!needsPointerEventsInheritanceFallback(el.ownerDocument, win)) return false;
  return inheritsPointerEventsNoneFromAncestor(el, win);
}

function collectPointerEventsNoneTargets(
  elements: Iterable<Element | null | undefined>,
): WeakSet<HTMLElement> {
  const disabled = new WeakSet<HTMLElement>();
  for (const entry of elements) {
    if (isHtmlElement(entry) && hasAuthorPointerEventsNone(entry)) {
      disabled.add(entry);
    }
  }
  return disabled;
}

// Shared tail of both pointer resolvers: hit-test candidates minus elements the
// author hid from hit-testing via pointer-events:none.
function filterAuthorInteractiveTargets(
  elements: Element[],
  activeCompositionPath: string | null,
): HTMLElement[] {
  const pointerEventsNoneTargets = collectPointerEventsNoneTargets(elements);
  return resolveAllVisualDomEditTargets(elements, { activeCompositionPath }).filter(
    (el) => !pointerEventsNoneTargets.has(el),
  );
}

// Animated group members can move outside their wrapper's static layout box, so
// the empty space inside a group's *visual* bounds (the member-union the overlay
// draws) doesn't hit-test to the group via elementsFromPoint. Recover it: if the
// point falls within a group's live member-union rect, return that wrapper.
// Innermost (smallest-area) group wins for nested groups.
// fallow-ignore-next-line complexity
function findGroupAtPoint(doc: Document, x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = Infinity;
  for (const group of Array.from(doc.querySelectorAll<HTMLElement>("[data-hf-group]"))) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const member of Array.from(group.children)) {
      const r = member.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    if (right < left || x < left || x > right || y < top || y > bottom) continue;
    const area = (right - left) * (bottom - top);
    if (area < bestArea) {
      bestArea = area;
      best = group;
    }
  }
  return best;
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

  let overrideStyle = forcePointerEventsAuto(doc);
  try {
    if (typeof doc.elementsFromPoint === "function") {
      const elements = doc.elementsFromPoint(localPointer.x, localPointer.y);
      removePointerEventsOverride(overrideStyle);
      overrideStyle = null;
      const candidates = filterAuthorInteractiveTargets(elements, activeCompositionPath);
      const visualTarget =
        candidates.find((el) => !isFullBleedTarget(el, localPointer.viewport)) ?? null;
      if (visualTarget) return visualTarget;
    }

    // Belt-and-suspenders: elementsFromPoint is universally supported in the
    // browsers this ships in, so the override is already removed by this
    // point in practice — but guard the environment without it too, so
    // hasAuthorPointerEventsNone below never reads a forced-auto value.
    removePointerEventsOverride(overrideStyle);
    overrideStyle = null;

    // No element hit (e.g. empty space inside an animated group's overlay) — fall
    // back to the group whose member-union contains the point, so the whole group
    // area is hoverable/selectable, not just where a member currently sits.
    const groupHit = findGroupAtPoint(doc, localPointer.x, localPointer.y);
    if (
      groupHit &&
      !hasAuthorPointerEventsNone(groupHit) &&
      getDomLayerPatchTarget(groupHit, activeCompositionPath)
    )
      return groupHit;

    const fallback = getEventTargetElement(doc.elementFromPoint(localPointer.x, localPointer.y));
    if (!fallback || !getDomLayerPatchTarget(fallback, activeCompositionPath)) return null;
    if (hasAuthorPointerEventsNone(fallback)) return null;
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

  let overrideStyle = forcePointerEventsAuto(doc);
  try {
    if (typeof doc.elementsFromPoint === "function") {
      const elements = doc.elementsFromPoint(localPointer.x, localPointer.y);
      removePointerEventsOverride(overrideStyle);
      overrideStyle = null;
      return filterAuthorInteractiveTargets(elements, activeCompositionPath).filter(
        (el) => !isFullBleedTarget(el, localPointer.viewport),
      );
    }
    const fallback = getEventTargetElement(doc.elementFromPoint(localPointer.x, localPointer.y));
    if (!fallback || !getDomLayerPatchTarget(fallback, activeCompositionPath)) return [];
    removePointerEventsOverride(overrideStyle);
    overrideStyle = null;
    if (hasAuthorPointerEventsNone(fallback)) return [];
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
