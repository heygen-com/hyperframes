import type { EditingRequestKind } from "@hyperframes/core/runtime/editing-port";

/** Anything Studio knows of that can change what a sealed frame answers about its elements. A cache of frame reads
 *  is current while `frameFactsGeneration()` is unchanged; it calls `watchStoreFrameFacts()` once for the stores. */
export type FrameFactChange =
  | "draft"
  | "write"
  | "save"
  | "time"
  | "history"
  | "load"
  | "selection"
  | "geometry"
  | "size";

let generation = 0;
const listeners = new Set<(change: FrameFactChange) => void>();

export function frameFactsChanged(change: FrameFactChange): void {
  generation += 1;
  for (const listener of listeners) listener(change);
}

/** Requests that only read the frame. Any other kind may change what it answers, a kind added later included. */
const FRAME_READS: ReadonlySet<EditingRequestKind> = new Set<EditingRequestKind>([
  "hello",
  "runtime-snapshot",
  "wait-for-seek",
  "computed-styles",
  "authored-styles",
  "font-faces",
  "elements-at-point",
  "pointer-targets",
  "describe",
  "ancestors",
  "query",
  "geometry",
  "layers",
  "gesture-start",
  "gesture-base",
  "console-errors",
  "watch-keys",
  "caption-words",
  "color-grading-status",
  "watch-geometry",
  "audio-meter",
  "document-markup",
  "gsap-snapshot",
  "max-z-index",
  "stacking-family",
]);

export function frameRequestSent(kind: EditingRequestKind): void {
  if (FRAME_READS.has(kind)) return;
  frameFactsChanged(kind === "draft" ? "draft" : "write");
}

export const frameFactsGeneration = (): number => generation;

export function onFrameFactsChanged(listener: (change: FrameFactChange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
