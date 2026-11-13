/**
 * A gesture on a preview frame Studio cannot script edits the selection's stand-in element. What the
 * gesture draws on the stand-in is drawn on the frame's own element too, over the frame's channel,
 * so the preview follows the pointer. One request is in flight per frame; later draws wait and merge.
 */
import { MAX_DESCRIBE_HANDLES, type EditingDraft } from "@hyperframes/core/runtime/editing-port";
import { previewRequest } from "../../player/lib/previewChannel";

type Drawn = {
  translate: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
};

interface Queue {
  ops: EditingDraft[];
  drawn: Map<string, Drawn>;
  sending: boolean;
}

const standIns = new WeakMap<Element, { iframe: HTMLIFrameElement; handle: string }>();
const queues = new WeakMap<HTMLIFrameElement, Queue>();

export function registerPreviewStandIn(
  standIn: Element,
  iframe: HTMLIFrameElement,
  handle: string,
): void {
  standIns.set(standIn, { iframe, handle });
}

function queueFor(iframe: HTMLIFrameElement): Queue {
  let queue = queues.get(iframe);
  if (!queue) {
    queue = { ops: [], drawn: new Map(), sending: false };
    queues.set(iframe, queue);
  }
  return queue;
}

function send(iframe: HTMLIFrameElement, queue: Queue): void {
  if (queue.sending || !queue.ops.length) return;
  const drafts = queue.ops.splice(0, MAX_DESCRIBE_HANDLES);
  queue.sending = true;
  void previewRequest(iframe, "draft", { drafts }).finally(() => {
    queue.sending = false;
    send(iframe, queue);
  });
}

/** Draws `part` of the stand-in's draft on its frame element; any other element is left alone. */
export function drawPreviewDraft(element: Element, part: Partial<Drawn>): void {
  const target = standIns.get(element);
  if (!target) return;
  const queue = queueFor(target.iframe);
  const drawn = { translate: null, size: null, ...queue.drawn.get(target.handle), ...part };
  queue.drawn.set(target.handle, drawn);
  const op = { handle: target.handle, ...drawn };
  const last = queue.ops.map((queued) => queued.handle).lastIndexOf(target.handle);
  const waiting = queue.ops[last];
  if (waiting && !("end" in waiting)) queue.ops[last] = op;
  else queue.ops.push(op);
  send(target.iframe, queue);
}

/** Ends the stand-in's draft on its frame: "keep" once saved or regrabbed mid-save, else "restore". */
export function endPreviewDraft(element: Element, end: "keep" | "restore"): void {
  const target = standIns.get(element);
  if (!target) return;
  const queue = queueFor(target.iframe);
  if (!queue.drawn.delete(target.handle)) return;
  queue.ops.push({ handle: target.handle, end });
  send(target.iframe, queue);
}
