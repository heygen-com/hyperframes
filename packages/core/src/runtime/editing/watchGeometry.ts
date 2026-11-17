// `watch-geometry`: the frame pushes the named elements' `geometry` fields once per animation frame,
// stamped on the clock both windows share, until an empty list, the page hiding, or the parent's release.
import {
  EDITING_ELEMENT_HANDLE,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_VALUE,
  type EditingElementHandle,
  type EditingRect,
} from "../editingElement";
import { swallow } from "../diagnostics";
import { elementGeometry, type EditingElementGeometry } from "../editingGeometry";

export const MAX_WATCHED_GEOMETRY = 32;
export const MAX_GEOMETRY_WATCHERS = 8;

export type WatchGeometryParams = { handles: EditingElementHandle[] };
/** `at` is `performance.timeOrigin + performance.now()` in the frame when it measured. */
export type EditingGeometryEvent = { at: number; elements: Array<EditingElementGeometry | null> };

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields =>
  Object.prototype.toString.call(value) === "[object Object]";
const keysAre = (value: unknown, keys: string): value is Fields =>
  isRecord(value) && Object.keys(value).sort().join() === keys;
const finite = (value: unknown): value is number => Number.isFinite(value);
const finiteOrNull = (value: unknown) => value === null || finite(value);

export function parseWatchGeometry(params: unknown): WatchGeometryParams | null {
  if (!keysAre(params, "handles") || !Array.isArray(params.handles)) return null;
  const { handles } = params;
  if (handles.length > MAX_WATCHED_GEOMETRY) return null;
  const valid = handles.every((h) => typeof h === "string" && EDITING_ELEMENT_HANDLE.test(h));
  return valid ? { handles } : null;
}

const isRect = (value: unknown): value is EditingRect =>
  keysAre(value, "height,width,x,y") && [value.x, value.y, value.width, value.height].every(finite);
const isPoint = (value: unknown) => keysAre(value, "x,y") && finite(value.x) && finite(value.y);
const isCorners = (value: unknown) =>
  value === null || (keysAre(value, "ne,nw,se,sw") && Object.values(value).every(isPoint));
const isSource = (value: unknown) =>
  value === null ||
  (keysAre(value, "declaredHeight,declaredWidth,height,width") &&
    finite(value.width) &&
    finite(value.height) &&
    finiteOrNull(value.declaredWidth) &&
    finiteOrNull(value.declaredHeight));
const isClipPath = (value: unknown) =>
  value === null || (typeof value === "string" && value.length <= MAX_ELEMENT_VALUE);
const isMembers = (value: unknown) =>
  value === null ||
  (Array.isArray(value) && value.length <= MAX_ELEMENT_ENTRIES && value.every(isRect));

function isGeometry(value: unknown): value is EditingElementGeometry {
  if (!keysAre(value, "angle,clipPath,corners,members,rect,source,visible")) return false;
  return (
    isRect(value.rect) &&
    finite(value.angle) &&
    isCorners(value.corners) &&
    isSource(value.source) &&
    isClipPath(value.clipPath) &&
    typeof value.visible === "boolean" &&
    isMembers(value.members)
  );
}

/** One pushed message off the port, or null for anything with a field it does not allow. */
export function geometryEvent(data: unknown, version: number): EditingGeometryEvent | null {
  if (!keysAre(data, "at,elements,event,v") || data.v !== version || data.event !== "geometry") {
    return null;
  }
  const { at, elements } = data;
  if (!finite(at) || !Array.isArray(elements) || elements.length > MAX_WATCHED_GEOMETRY)
    return null;
  return elements.every((e) => e === null || isGeometry(e)) ? { at, elements } : null;
}

const watches = new Map<MessagePort, EditingElementHandle[]>();
let wireVersion = 0;

function pushTo(port: MessagePort, handles: EditingElementHandle[], at: number): void {
  const { elements } = elementGeometry(handles, undefined);
  try {
    port.postMessage({ v: wireVersion, event: "geometry", at, elements });
  } catch {
    watches.delete(port);
  }
}

function push(): void {
  observer?.unobserve(document.documentElement);
  observing = false;
  const at = performance.timeOrigin + performance.now();
  try {
    for (const [port, handles] of watches) pushTo(port, handles, at);
  } catch (err) {
    swallow("watchGeometry.push", err);
  } finally {
    schedule();
  }
}

// The measure runs in the frame's ResizeObserver step: after every rAF callback and layout, just before paint.
// observe() resets the last reported size, so the root reports once each frame it is observed, resized or not.
// A frame with no size has nothing to report: a hidden frame's pushes pause until it gets one.
let observer: ResizeObserver | null = null;
let observing = false;
let nextFrame = 0;
function observeThisFrame(): void {
  nextFrame = 0;
  if (!watches.size) return;
  observer ??= new ResizeObserver(push);
  observer.observe(document.documentElement);
  observing = true;
}

function schedule(): void {
  if (watches.size && !nextFrame && !observing) nextFrame = requestAnimationFrame(observeThisFrame);
  if (watches.size) return;
  if (nextFrame) cancelAnimationFrame(nextFrame);
  if (observing) observer?.unobserve(document.documentElement);
  nextFrame = 0;
  observing = false;
}

/** Stops `port`'s watch, or every watch when no port is named. */
export function stopWatchingGeometry(port?: MessagePort): void {
  if (port) watches.delete(port);
  else watches.clear();
  schedule();
}

const stopAll = () => stopWatchingGeometry();

export function watchGeometry(
  port: MessagePort,
  { handles }: WatchGeometryParams,
  version: number,
): { watching: number } {
  if (!handles.length) watches.delete(port);
  else if (watches.has(port) || watches.size < MAX_GEOMETRY_WATCHERS) watches.set(port, handles);
  else throw new Error(`at most ${MAX_GEOMETRY_WATCHERS} ports may watch geometry`);
  wireVersion = version;
  window.addEventListener("pagehide", stopAll);
  schedule();
  return { watching: handles.length };
}
