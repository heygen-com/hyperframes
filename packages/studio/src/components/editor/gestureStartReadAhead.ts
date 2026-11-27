/**
 * A press on a sealed preview starts from what the frame answers about its elements. Read before the press, while
 * the frame is at rest, that answer lets the press start at once, as it does on a preview Studio can read in place.
 */
import { useEffect, useRef, type RefObject } from "react";
import { gsapSnapshotSettled } from "../../hooks/gsapFrameSnapshot";
import { useMountEffect } from "../../hooks/useMountEffect";
import {
  frameFactsChanged,
  frameFactsGeneration,
  onFrameFactsChanged,
} from "../../player/lib/frameFacts";
import { previewFrameOpaque } from "../../player/lib/previewChannel";
import { watchStoreFrameFacts } from "../../player/store/frameFactsFromStores";
import { previewGestureStart } from "../../player/lib/previewElements";
import { isPreviewChanging } from "../../player/previewReloading";
import { usePlayerStore } from "../../player/store/playerStore";
import { isStudioEditSaving } from "../../utils/studioPendingEdits";
import type { DomEditSelection } from "./domEditing";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { readShownGestureStarts, type ShownStartsRead } from "./previewGestureStartRead";

type Refs = Pick<
  UseDomEditOverlayGesturesOptions,
  | "waitingPressRef"
  | "iframeRef"
  | "overlayRef"
  | "activeCompositionPathRef"
  | "selectionRef"
  | "groupOverlayItemsRef"
  | "gestureRef"
  | "groupGestureRef"
>;

interface Held {
  frame: HTMLIFrameElement;
  elements: HTMLElement[];
  generation: number;
  read: ShownStartsRead;
}

/** Per overlay mount, keyed like `pressOutlineOf`. */
const helds = new WeakMap<RefObject<unknown>, Held>();
/** One read in flight per overlay, so a selection the frame keeps moving costs one read at a time. */
const reading = new WeakSet<RefObject<unknown>>();
const mounted = new WeakSet<RefObject<unknown>>();

/** Nothing Studio knows of is changing the frame, so its answers hold until a frame fact changes. */
const frameAtRest = () =>
  !usePlayerStore.getState().isPlaying && !isPreviewChanging() && !isStudioEditSaving();

const sameElements = (elements: readonly HTMLElement[], targets: readonly DomEditSelection[]) =>
  elements.length === targets.length &&
  targets.every((target, i) => target.element === elements[i]);

/** What the next press on this overlay starts a gesture on: the group when one is drawn, else the selection. */
function nextPressTargets(refs: Refs): DomEditSelection[] {
  const items = refs.groupOverlayItemsRef.current;
  if (items.length) return items.map((item) => item.selection);
  const selection = refs.selectionRef.current;
  return selection ? [selection] : [];
}

/** The frame and selections a read ahead is made for now; null while a press or gesture holds the overlay. */
function readAheadFor(
  refs: Refs,
): { iframe: HTMLIFrameElement; targets: DomEditSelection[] } | null {
  const iframe = refs.iframeRef.current;
  const targets = nextPressTargets(refs);
  const held =
    refs.gestureRef.current || refs.groupGestureRef.current || refs.waitingPressRef.current;
  if (held || !iframe || !previewFrameOpaque(iframe) || !targets.length || !frameAtRest())
    return null;
  return { iframe, targets };
}

/** The read held for `targets` on `iframe`, while no frame fact has changed since it was made. */
function heldNow(
  owner: RefObject<unknown>,
  iframe: HTMLIFrameElement,
  targets: readonly DomEditSelection[],
): Held | null {
  const held = helds.get(owner);
  const current = held?.generation === frameFactsGeneration() && held.frame === iframe;
  return current && sameElements(held.elements, targets) ? held : null;
}

function readAhead(refs: Refs): void {
  const now = readAheadFor(refs);
  const generation = frameFactsGeneration();
  const owner = refs.waitingPressRef;
  if (!mounted.has(owner) || !now || heldNow(owner, now.iframe, now.targets)) return;
  if (reading.has(owner)) return;
  reading.add(owner);
  const { iframe, targets } = now;
  const elements = targets.map((target) => target.element);
  const path = refs.activeCompositionPathRef.current;
  void readShownGestureStarts(iframe, refs.overlayRef.current, path, targets)
    .then((read) => {
      if (typeof read !== "object" || !read || frameFactsGeneration() !== generation) return;
      helds.set(owner, { frame: iframe, elements, generation, read });
    })
    .finally(() => {
      reading.delete(owner);
      if (frameFactsGeneration() !== generation) readAhead(refs);
    });
}

/** Keeps a read of what the next press would start from, made again after every frame fact change; stop ends it. */
export function keepGestureStartReadAhead(refs: Refs): () => void {
  watchStoreFrameFacts();
  mounted.add(refs.waitingPressRef);
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => readAhead(refs));
  };
  const stop = onFrameFactsChanged(later);
  later();
  return () => {
    stop();
    cancelAnimationFrame(frame);
    helds.delete(refs.waitingPressRef);
    reading.delete(refs.waitingPressRef);
    mounted.delete(refs.waitingPressRef);
  };
}

/** The read a press on `targets` starts from at once: made at rest on this frame, with no frame fact changed since. */
export function gestureStartReadAhead(
  refs: Pick<Refs, "waitingPressRef">,
  iframe: HTMLIFrameElement,
  targets: readonly DomEditSelection[],
  routeFromSnapshot: boolean,
): ShownStartsRead | null {
  const held = heldNow(refs.waitingPressRef, iframe, targets);
  if (!held || !frameAtRest()) return null;
  if (routeFromSnapshot && !gsapSnapshotSettled(iframe)) return null;
  return held.read;
}

/** Keeps a read ahead for this overlay mount, and says when what its next press starts on changes. */
export function useGestureStartReadAhead(refs: Refs) {
  useMountEffect(() => keepGestureStartReadAhead(refs));
  const shownRef = useRef<HTMLElement[]>([]);
  useEffect(() => {
    const now = nextPressTargets(refs).map((target) => target.element);
    const before = shownRef.current;
    if (now.length === before.length && now.every((element, i) => element === before[i])) return;
    shownRef.current = now;
    frameFactsChanged("selection");
  });
}

/** Debug, on `window.__hfCheckReadAhead`: asks the frame again and logs whether the read a press started from held. */
export function checkReadAheadWithFrame(iframe: HTMLIFrameElement, read: ShownStartsRead): void {
  if (!(globalThis as { __hfCheckReadAhead?: boolean }).__hfCheckReadAhead) return;
  void previewGestureStart(iframe, read.handles).then((fresh) => {
    const held = JSON.stringify(read.reply);
    const now = JSON.stringify(fresh);
    console.info(`[read-ahead] ${held === now ? "match" : `mismatch held=${held} fresh=${now}`}`);
  });
}
