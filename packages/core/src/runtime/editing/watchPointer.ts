// `watch-pointer`: while the parent's pointer rests on the frame, the frame hit-tests that point each animation frame
// and pushes the `pointer-targets` answer only when it changes, until a null point, pagehide, or the release. A hidden
// page pauses it.
import { portMap, postOnPort } from "../runtimePort";
import {
  EDITING_ELEMENT_HANDLE,
  MAX_ELEMENT_VALUE,
  MAX_POINT_STACK,
  type EditingElementHit,
} from "../editingElement";
import { swallow } from "../diagnostics";
import { pointerTargetsAt } from "../editingTargets";

export const MAX_POINTER_WATCHERS = 8;

export const MAX_POINT_SEQ = 2 ** 31 - 1;

/** `point` is in fractions of the root's box, as `pointer-targets` takes it; null stops the watch. */
export type WatchPointerParams = { point: { x: number; y: number } | null; seq?: number };
/** `at` is `performance.timeOrigin + performance.now()` in the frame when it hit-tested. */
export type EditingPointerEvent = {
  at: number;
  target: EditingElementHit | null;
  stack: EditingElementHit[];
  seq?: number;
};

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields =>
  Object.prototype.toString.call(value) === "[object Object]";
const keysAre = (value: unknown, keys: string): value is Fields =>
  isRecord(value) && Object.keys(value).sort().join() === keys;
const finite = (value: unknown): value is number => Number.isFinite(value);
const isSeq = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_POINT_SEQ;
const seqOf = (fields: Fields) => (isSeq(fields.seq) ? { seq: fields.seq } : {});

export function parseWatchPointer(params: unknown): WatchPointerParams | null {
  if (!keysAre(params, "point") && !(keysAre(params, "point,seq") && isSeq(params.seq)))
    return null;
  const { point } = params;
  if (point === null) return { point: null };
  return keysAre(point, "x,y") && finite(point.x) && finite(point.y)
    ? { point: { x: point.x, y: point.y }, ...seqOf(params) }
    : null;
}

const isHit = (value: unknown): value is EditingElementHit =>
  keysAre(value, "handle,rect,tag") &&
  typeof value.handle === "string" &&
  EDITING_ELEMENT_HANDLE.test(value.handle) &&
  typeof value.tag === "string" &&
  value.tag.length <= MAX_ELEMENT_VALUE &&
  keysAre(value.rect, "height,width,x,y") &&
  [value.rect.x, value.rect.y, value.rect.width, value.rect.height].every(finite);

/** One pushed message off the port, or null for anything with a field it does not allow. */
export function pointerEvent(data: unknown, version: number): EditingPointerEvent | null {
  const tagged = keysAre(data, "at,event,seq,stack,target,v") && isSeq(data.seq);
  if ((!tagged && !keysAre(data, "at,event,stack,target,v")) || data.v !== version) return null;
  const { at, target, stack } = data;
  if (data.event !== "pointer-targets" || !finite(at) || !Array.isArray(stack)) return null;
  if (stack.length > MAX_POINT_STACK || !stack.every(isHit)) return null;
  return target === null || isHit(target) ? { at, target, stack, ...seqOf(data) } : null;
}

type Watch = { x: number; y: number; last: string | null; seq?: number };
const watches = portMap<Watch>();
let wireVersion = 0;
let nextFrame = 0;

function check(port: MessagePort, watch: Watch, at: number): void {
  const { target, stack } = pointerTargetsAt(watch.x, watch.y);
  const answer = JSON.stringify([target, stack]);
  if (answer === watch.last) return;
  watch.last = answer;
  try {
    const seq = watch.seq === undefined ? {} : { seq: watch.seq };
    postOnPort(port, { v: wireVersion, event: "pointer-targets", at, target, stack, ...seq });
  } catch {
    watches.delete(port);
  }
}

function checkAll(): void {
  nextFrame = 0;
  const at = performance.timeOrigin + performance.now();
  try {
    watches.forEach((watch, port) => check(port, watch, at));
  } catch (err) {
    swallow("watchPointer.check", err);
  } finally {
    schedule();
  }
}

function schedule(): void {
  if (watches.size() && !document.hidden) {
    nextFrame ||= requestAnimationFrame(checkAll);
    return;
  }
  if (nextFrame) cancelAnimationFrame(nextFrame);
  nextFrame = 0;
}

/** Stops `port`'s watch, or every watch when no port is named. */
export function stopWatchingPointer(port?: MessagePort): void {
  if (port) watches.delete(port);
  else watches.clear();
  schedule();
}

const stopAll = () => stopWatchingPointer();

export function watchPointer(
  port: MessagePort,
  { point, seq }: WatchPointerParams,
  version: number,
): { watching: boolean } {
  if (!point) watches.delete(port);
  else if (watches.has(port) || watches.size() < MAX_POINTER_WATCHERS)
    watches.set(port, { x: point.x, y: point.y, last: null, seq });
  else throw new Error(`at most ${MAX_POINTER_WATCHERS} ports may watch the pointer`);
  wireVersion = version;
  window.addEventListener("pagehide", stopAll);
  // A hidden page checks nothing; its watch resumes when shown, so the parent never holds an answer it thinks is live.
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return { watching: point !== null };
}
