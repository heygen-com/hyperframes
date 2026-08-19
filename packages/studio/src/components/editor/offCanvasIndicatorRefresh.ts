import type React from "react";
import type { OffCanvasRect } from "./OffCanvasIndicators";
import { recomputeOffCanvasIndicators } from "./offCanvasIndicatorGeometry";

interface OffCanvasIndicatorRefreshOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  compRectRef: React.MutableRefObject<{ left: number; top: number; width: number; height: number }>;
  activeCompositionPathRef: React.MutableRefObject<string | null>;
  dirtyRef: React.MutableRefObject<boolean>;
  sigRef: React.MutableRefObject<string>;
  observerRef: React.MutableRefObject<MutationObserver | null>;
  observedDocRef: React.MutableRefObject<Document | null>;
  elementsRef: React.MutableRefObject<Map<string, HTMLElement>>;
  setRects: (rects: OffCanvasRect[]) => void;
}

function compSignature(comp: { left: number; top: number; width: number; height: number }): string {
  return `${Math.round(comp.left)}:${Math.round(comp.top)}:${Math.round(comp.width)}:${Math.round(comp.height)}`;
}

function clearIndicators(options: OffCanvasIndicatorRefreshOptions): void {
  options.dirtyRef.current = false;
  options.sigRef.current = "";
  options.elementsRef.current = new Map();
  options.setRects([]);
}

function observeDoc(doc: Document, markDirty: () => void): MutationObserver | null {
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (!Observer) return null;
  const observer = new Observer(markDirty);
  observer.observe(doc.documentElement, {
    attributes: true,
    // data-hidden is included explicitly: hiding an element writes data-hidden, and
    // although the runtime honoring also writes display:"none" (a style mutation we'd
    // catch anyway), keying on the attribute directly makes the coupling robust to any
    // future throttling of that runtime sync.
    attributeFilter: ["style", "class", "transform", "width", "height", "data-hidden"],
    childList: true,
    subtree: true,
  });
  return observer;
}

/**
 * How often the indicator geometry may be rebuilt.
 *
 * A rebuild walks every element in the preview and reads layout for each —
 * 6.5ms on an 825-element captured page, against a 16.7ms frame. What marks it
 * dirty is a MutationObserver on inline style, which is exactly how animation
 * writes, so playback would pay that on close to every frame. The indicators
 * are a passive affordance: refreshing them a few times a second is
 * indistinguishable on screen and keeps the cost off the frame budget.
 */
export const RECOMPUTE_INTERVAL_MS = 100;

/** Dirty, and far enough past the last rebuild to be worth paying for another. */
export function rebuildDue(dirty: boolean, lastAt: number, now: number): boolean {
  return dirty && now - lastAt >= RECOMPUTE_INTERVAL_MS;
}

export function startOffCanvasIndicatorRefresh(
  options: OffCanvasIndicatorRefreshOptions,
): () => void {
  let frame = 0;
  let lastCompSig = "";
  let lastRecomputeAt = Number.NEGATIVE_INFINITY;
  const markDirty = () => {
    options.dirtyRef.current = true;
  };
  const attachObserver = (doc: Document | null) => {
    options.observerRef.current?.disconnect();
    options.observerRef.current = doc?.documentElement ? observeDoc(doc, markDirty) : null;
    options.observedDocRef.current = doc;
    options.sigRef.current = "";
  };
  const update = () => {
    frame = requestAnimationFrame(update);
    const iframe = options.iframeRef.current;
    const overlayEl = options.overlayRef.current;
    const doc = iframe?.contentDocument ?? null;
    if (doc !== options.observedDocRef.current) {
      attachObserver(doc);
      markDirty();
    }
    const comp = options.compRectRef.current;
    const nextCompSig = compSignature(comp);
    if (nextCompSig !== lastCompSig) {
      lastCompSig = nextCompSig;
      markDirty();
    }
    if (!iframe || !overlayEl) {
      if (options.dirtyRef.current) clearIndicators(options);
      return;
    }
    // Staying dirty while throttled is what makes the next eligible frame rebuild.
    const now = performance.now();
    if (!rebuildDue(options.dirtyRef.current, lastRecomputeAt, now)) return;
    lastRecomputeAt = now;
    options.dirtyRef.current = false;
    recomputeOffCanvasIndicators(
      iframe,
      overlayEl,
      doc,
      comp,
      options.activeCompositionPathRef.current,
      options.sigRef,
      options.elementsRef,
      options.setRects,
    );
  };
  frame = requestAnimationFrame(update);
  return () => {
    cancelAnimationFrame(frame);
    options.observerRef.current?.disconnect();
    options.observerRef.current = null;
    options.observedDocRef.current = null;
  };
}
