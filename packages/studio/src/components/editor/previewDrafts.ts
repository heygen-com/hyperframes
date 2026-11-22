/**
 * A gesture on a preview frame Studio cannot script edits the selection's stand-in element. What the
 * gesture draws on the stand-in is drawn on the frame's own element too, over the frame's channel,
 * so the preview follows the pointer. One request is in flight per frame; later draws wait and merge.
 */
import {
  MAX_DESCRIBE_HANDLES,
  type EditingDraft,
  type EditingDraftEnd,
  type EditingDraftRotate,
} from "@hyperframes/core/runtime/editing-port";
import { previewRequest } from "../../player/lib/previewChannel";

type Drawn = {
  translate: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  rotate?: EditingDraftRotate | null;
};

/** One gesture's draft: `draft` is the frame's number for it, `saving` the selector its save will patch. */
type Entry = Drawn & { gesture: object; draft?: number; saving?: string };

interface Queue {
  ops: EditingDraft[];
  drawn: Map<string, Entry>;
  sending: boolean;
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
    queue = { ops: [], drawn: new Map(), sending: false };
    queues.set(iframe, queue);
  }
  return queue;
}

const opGesture = new WeakMap<EditingDraft, object>();

function send(iframe: HTMLIFrameElement, queue: Queue): void {
  if (queue.sending || !queue.ops.length) return;
  const drafts = queue.ops.splice(0, MAX_DESCRIBE_HANDLES);
  queue.sending = true;
  void previewRequest(iframe, "draft", { drafts })
    .then((reply) => {
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

/** Draws `part` of the stand-in's draft on its frame element; any other element is left alone. */
export function drawPreviewDraft(element: Element, part: Partial<Drawn>): void {
  const target = standIns.get(element);
  if (!target) return;
  const queue = queueFor(target.iframe);
  const entry: Entry = {
    translate: null,
    size: null,
    gesture: {},
    ...queue.drawn.get(target.handle),
    ...part,
  };
  queue.drawn.set(target.handle, entry);
  const { translate, size, rotate } = entry;
  const op = { handle: target.handle, translate, size, ...("rotate" in entry && { rotate }) };
  opGesture.set(op, entry.gesture);
  const last = queue.ops.map((queued) => queued.handle).lastIndexOf(target.handle);
  const waiting = queue.ops[last];
  if (waiting && !("end" in waiting)) queue.ops[last] = op;
  else queue.ops.push(op);
  send(target.iframe, queue);
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
export function endPreviewDraft(element: Element, end: "keep" | "restore"): void {
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
      : { handle, end: end === "restore" ? "restore" : "keep" },
  );
  send(target.iframe, queue);
}
