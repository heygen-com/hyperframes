import type { EditingRequestKind } from "@hyperframes/core/runtime/editing-port";

/** Anything Studio knows of that can change what a sealed frame answers about its elements. A cache of frame reads
 *  is current while `frameFactsGeneration()` is unchanged; it calls `watchStoreFrameFacts()` once for the stores. */
export type FrameFactChange =
  /** A draft was sent to the frame (`previewChannel`). */
  | "draft"
  /** Any other request that may change the frame was sent: an edit, a soft reload, a scene swap (`previewChannel`). */
  | "write"
  /** An edit started or finished saving (`studioPendingEdits`). */
  | "save"
  /** The playhead moved or playback started or stopped (`frameFactsFromStores`). */
  | "time"
  /** Undo or redo started or finished (`useEditHistoryActions`), or the frame reran one in place (`sceneSwap`). */
  | "history"
  /** A frame loaded, swapped scenes or was promoted (`sceneSwap`), or a new live frame (`frameFactsFromStores`). */
  | "load"
  /** The selection changed (`useGestureStartReadAhead`). */
  | "selection"
  /** The selection's box the frame reports moved, by Studio or by the frame itself (`useDomEditOverlayRects`). */
  | "geometry"
  /** The live frame's size changed (`frameFactsFromStores`). Zoom scales the frame without changing it. */
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

/** Called for every request Studio sends a frame. */
export function frameRequestSent(kind: EditingRequestKind): void {
  if (FRAME_READS.has(kind)) return;
  frameFactsChanged(kind === "draft" ? "draft" : "write");
}

export const frameFactsGeneration = (): number => generation;

export function onFrameFactsChanged(listener: (change: FrameFactChange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
