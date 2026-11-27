/**
 * A gesture on a preview frame Studio cannot script edits the selection's stand-in element. What the
 * gesture draws on the stand-in is drawn on the frame's own element too, over the frame's channel,
 * so the preview follows the pointer. One request is in flight per frame; draws until a microtask, or waiting, merge.
 */
import {
  MAX_DESCRIBE_HANDLES,
  type EditingDraft,
  type EditingDraftEnd,
  type EditingDraftProps,
  type EditingDraftRotate,
} from "@hyperframes/core/runtime/editing-port";
import { computeDraggedGsapPosition } from "../../hooks/draggedGsapPosition";
import { roundTo3 } from "../../utils/rounding";
import { previewRequest } from "../../player/lib/previewChannel";

type Drawn = {
  translate: { x: number; y: number; route?: "gsap" } | null;
  size: { width: number; height: number } | null;
  rotate?: EditingDraftRotate | null;
  props?: EditingDraftProps | null;
};

/** One gesture's draft: `draft` is the frame's number for it, `saving` the selector its save will patch. */
type Entry = Drawn & { gesture: object; draft?: number; saving?: string };

interface Queue {
  ops: EditingDraft[];
  drawn: Map<string, Entry>;
  sending: boolean;
  sent: Array<() => void>;
  sendQueued: boolean;
  gsapSetTakesDrafts?: boolean;
}

const standIns = new WeakMap<Element, { iframe: HTMLIFrameElement; handle: string }>();
const queues = new WeakMap<HTMLIFrameElement, Queue>();

export const previewStandInHandle = (standIn: Element) => standIns.get(standIn)?.handle;

export function registerPreviewStandIn(
  standIn: Element,
  iframe: HTMLIFrameElement,
  handle: string,
): void {
  standIns.set(standIn, { iframe, handle });
}

export const previewStandIn = (standIn: Element) => standIns.get(standIn);

export function previewDraftLive(standIn: Element): boolean {
  const target = standIns.get(standIn);
  return !!target && !!queues.get(target.iframe)?.drawn.has(target.handle);
}

function queueFor(iframe: HTMLIFrameElement): Queue {
  let queue = queues.get(iframe);
  if (!queue) {
    queue = { ops: [], drawn: new Map(), sending: false, sent: [], sendQueued: false };
    queues.set(iframe, queue);
  }
  return queue;
}

const opGesture = new WeakMap<EditingDraft, object>();

function send(iframe: HTMLIFrameElement, queue: Queue): void {
  if (queue.sending) return;
  if (!queue.ops.length) return void queue.sent.splice(0).forEach((done) => done());
  const drafts = queue.ops.splice(0, MAX_DESCRIBE_HANDLES);
  queue.sending = true;
  void previewRequest(iframe, "draft", { drafts })
    .then((reply) => {
      if (reply?.gsapSetTakesDrafts) queue.gsapSetTakesDrafts = true;
      for (const op of drafts) {
        const entry = queue.drawn.get(op.handle);
        const draft = reply?.drafts?.[op.handle];
        if (draft && entry && entry.gesture === opGesture.get(op)) entry.draft = draft;
      }
    })
    .finally(() => {
      queue.sending = false;
      send(iframe, queue);
    });
}

function sendOnMicrotask(iframe: HTMLIFrameElement, queue: Queue): void {
  if (queue.sendQueued) return;
  queue.sendQueued = true;
  queueMicrotask(() => {
    queue.sendQueued = false;
    send(iframe, queue);
  });
}

type Point = { x: number; y: number };
type DraftedMember = {
  element: HTMLElement;
  initialOffset: Point;
  baseGsap: Point;
  frameDraftRoute?: "gsap";
};

export function frameDraftTranslate(member: DraftedMember, offset: Point) {
  if (member.frameDraftRoute !== "gsap")
    return {
      x: roundTo3(offset.x) - member.initialOffset.x,
      y: roundTo3(offset.y) - member.initialOffset.y,
    };
  const { newX, newY } = computeDraggedGsapPosition(member.element, offset, member.baseGsap);
  return { x: newX, y: newY, route: "gsap" as const };
}

function nextDraw(element: Element, part: Partial<Drawn>) {
  const target = standIns.get(element);
  if (!target) return null;
  const queue = queueFor(target.iframe);
  const prior = queue.drawn.get(target.handle);
  const entry: Entry = { translate: null, size: null, gesture: {}, ...prior, ...part };
  if (prior?.saving) delete entry.saving;
  queue.drawn.set(target.handle, entry);
  const { translate, size, rotate } = entry;
  const op = {
    handle: target.handle,
    translate,
    size,
    ...("rotate" in entry && { rotate }),
    ...(entry.props && { props: entry.props }),
  };
  opGesture.set(op, entry.gesture);
  return { target, queue, op };
}

export function previewDraftRidingGsapSet(
  element: Element,
  part: Partial<Drawn>,
): EditingDraft | null {
  const target = standIns.get(element);
  if (!target || !queues.get(target.iframe)?.gsapSetTakesDrafts) return null;
  const next = nextDraw(element, part);
  if (!next) return null;
  next.queue.ops = next.queue.ops.filter((op) => op.handle !== next.op.handle || "end" in op);
  return next.op;
}

function drawsNothingNew(element: Element, part: Partial<Drawn>): boolean {
  const target = standIns.get(element);
  const prior = target && queues.get(target.iframe)?.drawn.get(target.handle);
  if (!prior || prior.saving) return false;
  const same = (key: keyof Drawn) =>
    !(key in part) || JSON.stringify(part[key] ?? null) === JSON.stringify(prior[key] ?? null);
  return same("translate") && same("size") && same("rotate") && same("props");
}

export function noteFrameDrawnDraft(element: Element, part: Partial<Drawn>, draft?: number): void {
  const target = standIns.get(element);
  if (!target) return;
  const queue = queueFor(target.iframe);
  const prior = queue.drawn.get(target.handle);
  const entry: Entry = { translate: null, size: null, gesture: {}, ...prior, ...part };
  if (prior?.saving) delete entry.saving;
  if (typeof draft === "number") entry.draft = draft;
  queue.drawn.set(target.handle, entry);
}

/** Draws `part` of the stand-in's draft on its frame element; any other element is left alone. */
export function drawPreviewDraft(element: Element, part: Partial<Drawn>): void {
  if (drawsNothingNew(element, part)) return;
  const next = nextDraw(element, part);
  if (!next) return;
  const { target, queue, op } = next;
  const last = queue.ops.map((queued) => queued.handle).lastIndexOf(target.handle);
  const waiting = queue.ops[last];
  const replaceable = (queued: EditingDraft) => !("end" in queued) && !queued.props;
  if (waiting && replaceable(waiting) && !op.props) queue.ops[last] = op;
  else queue.ops.push(op);
  sendOnMicrotask(target.iframe, queue);
}

/** A gesture's commit started: the save that patches `selector` may carry this draft's end. */
export function armPreviewDraftEnd(element: Element, selector: string | null): void {
  const target = standIns.get(element);
  const entry = target && queueFor(target.iframe).drawn.get(target.handle);
  if (entry && selector) entry.saving = selector;
}

/** Ends a save patching `selectors` carries; one with draws waiting or no number ends alone. */
export function takePreviewDraftEnds(
  iframe: HTMLIFrameElement,
  selectors: readonly string[],
): EditingDraftEnd[] {
  const queue = queueFor(iframe);
  send(iframe, queue);
  const ends: EditingDraftEnd[] = [];
  for (const [handle, entry] of queue.drawn) {
    const waiting = queue.ops.some((op) => op.handle === handle);
    if (!entry.draft || !entry.saving || !selectors.includes(entry.saving) || waiting) continue;
    queue.drawn.delete(handle);
    ends.push({ handle, draft: entry.draft, end: "keep-size" });
  }
  return ends;
}

export function sendPreviewDraftEnds(iframe: HTMLIFrameElement, ends: readonly EditingDraftEnd[]) {
  if (!ends.length) return;
  const queue = queueFor(iframe);
  queue.ops.push(...ends);
  send(iframe, queue);
}

export function endPreviewDraftKeepingSizeOnly(element: Element): void {
  const target = standIns.get(element);
  const entry = target && queueFor(target.iframe).drawn.get(target.handle);
  if (!entry) return;
  if (entry.draft) return endDraft(element, "keep-size");
  drawPreviewDraft(element, { translate: null });
  endDraft(element, "keep");
}

/** Ends the stand-in's draft on its frame: "keep" once saved or regrabbed mid-save, else "restore". */
export function endPreviewDraft(element: Element, end: "keep" | "restore" | "clear"): void {
  endDraft(element, end);
}

function endDraft(element: Element, end: EditingDraftEnd["end"]): void {
  const target = standIns.get(element);
  if (!target) return;
  const queue = queueFor(target.iframe);
  const entry = queue.drawn.get(target.handle);
  if (!entry) return;
  queue.drawn.delete(target.handle);
  const { handle } = target;
  queue.ops.push(
    entry.draft
      ? { handle, draft: entry.draft, end }
      : { handle, end: end === "keep-size" ? "keep" : end },
  );
  send(target.iframe, queue);
}

export function previewDraftsSent(iframe: HTMLIFrameElement): Promise<void> {
  const queue = queueFor(iframe);
  if (!queue.sending && !queue.ops.length) return Promise.resolve();
  return new Promise((done) => queue.sent.push(done));
}
