// fallow-ignore-file code-duplication
import { useCallback, useRef, useState } from "react";
import type { DomEditSelection } from "./domEditing";
import { collectDomEditLayerItems, resolveDomEditSelection } from "./domEditingLayers";
import { isElementComputedVisible } from "./domEditingElement";
import { coversComposition } from "../../utils/studioPreviewHelpers";
import { rectsOverlap, type Rect } from "../../utils/marqueeGeometry";
import { toVisibleOverlayRect } from "./domEditOverlayGeometry";

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  pointerId: number;
  pastThreshold: boolean;
}

const MARQUEE_THRESHOLD_PX = 4;

interface MarqueeHit {
  element: HTMLElement;
  rect: Rect;
}

/**
 * Every element the marquee could hit, with the overlay-space rect it would be
 * tested against. Uses the SAME `toOverlayRect` basis as the single-selection /
 * group-selection boxes, so what the marquee highlights and selects is exactly
 * the box the user sees when they click an element.
 *
 * Measured once per drag rather than per pointer-move: this reads layout for
 * every element in the document, and a captured page has enough of them that
 * doing it 60 times a second stalls the tab. The iframe DOM does not mutate
 * mid-drag, so the rects it returns stay true for the whole gesture.
 */
// fallow-ignore-next-line complexity
function collectMarqueeCandidates(
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
  activeCompositionPath: string,
): MarqueeHit[] {
  const doc = iframe.contentDocument;
  if (!doc) return [];

  const root = doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.body;
  const isMasterView = !activeCompositionPath || activeCompositionPath === "index.html";
  const items = collectDomEditLayerItems(root, { activeCompositionPath, isMasterView });

  const rootEl = doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement;
  const declW = Number.parseFloat(rootEl?.getAttribute("data-width") ?? "");
  const declH = Number.parseFloat(rootEl?.getAttribute("data-height") ?? "");
  const viewport = {
    width: declW > 0 ? declW : rootEl.getBoundingClientRect().width || 1,
    height: declH > 0 ? declH : rootEl.getBoundingClientRect().height || 1,
  };

  const candidates: MarqueeHit[] = [];
  for (const item of items) {
    const el = item.element;
    if (!isElementComputedVisible(el)) continue;
    if (coversComposition(el.getBoundingClientRect(), viewport)) continue;
    const overlayRect = toVisibleOverlayRect(overlayEl, iframe, el);
    if (!overlayRect) continue;
    candidates.push({
      element: el,
      rect: {
        left: overlayRect.left,
        top: overlayRect.top,
        width: overlayRect.width,
        height: overlayRect.height,
      },
    });
  }

  return candidates;
}

function hitsWithin(rect: Rect, candidates: MarqueeHit[]): MarqueeHit[] {
  return candidates.filter((candidate) => rectsOverlap(rect, candidate.rect));
}

async function runMarqueeIntersection(
  rect: Rect,
  candidates: MarqueeHit[],
  activeCompositionPath: string,
): Promise<DomEditSelection[]> {
  const isMasterView = !activeCompositionPath || activeCompositionPath === "index.html";
  const hits: DomEditSelection[] = [];
  for (const { element } of hitsWithin(rect, candidates)) {
    const sel = await resolveDomEditSelection(element, {
      activeCompositionPath,
      isMasterView,
      skipSourceProbe: true,
    });
    if (sel) hits.push(sel);
  }
  return hits;
}

interface MarqueeGesturesDeps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  activeCompositionPathRef: React.RefObject<string | null>;
  onMarqueeSelectRef: React.RefObject<
    ((selections: DomEditSelection[], additive: boolean) => void) | undefined
  >;
  selectionRef: React.RefObject<DomEditSelection | null>;
  gestures: {
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    clearPointerState: (ref: React.RefObject<DomEditSelection | null>) => void;
  };
}

// fallow-ignore-next-line complexity
export function useMarqueeGestures(deps: MarqueeGesturesDeps) {
  const marqueeRef = useRef<MarqueeState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  // Live "candidate" highlight: the elements the marquee currently touches,
  // shown before mouse-up so you can see what you're about to select. The
  // iframe DOM doesn't mutate during a drag, so a sync intersection per move
  // is cheap (clean layout → no thrash).
  const [candidateRects, setCandidateRects] = useState<Rect[]>([]);
  // Measured once when the drag passes the threshold and reused until it ends.
  const candidatesRef = useRef<MarqueeHit[] | null>(null);

  const commitMarquee = useCallback(
    async (
      rect: { left: number; top: number; width: number; height: number },
      additive: boolean,
    ) => {
      const iframe = deps.iframeRef.current;
      const overlay = deps.overlayRef.current;
      if (!iframe || !overlay || !deps.onMarqueeSelectRef.current) return;
      const acp = deps.activeCompositionPathRef.current ?? "index.html";
      const candidates = candidatesRef.current ?? collectMarqueeCandidates(iframe, overlay, acp);
      const hits = await runMarqueeIntersection(rect, candidates, acp);
      deps.onMarqueeSelectRef.current(hits, additive);
    },
    [deps.iframeRef, deps.overlayRef, deps.onMarqueeSelectRef, deps.activeCompositionPathRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const m = marqueeRef.current;
      if (m) {
        const oRect = deps.overlayRef.current?.getBoundingClientRect();
        if (!oRect) return;
        m.currentX = event.clientX - oRect.left;
        m.currentY = event.clientY - oRect.top;
        if (!m.pastThreshold) {
          const dx = m.currentX - m.startX;
          const dy = m.currentY - m.startY;
          if (Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) return;
          m.pastThreshold = true;
          candidatesRef.current = null;
        }
        const rect: Rect = {
          left: Math.min(m.startX, m.currentX),
          top: Math.min(m.startY, m.currentY),
          width: Math.abs(m.currentX - m.startX),
          height: Math.abs(m.currentY - m.startY),
        };
        setMarqueeRect(rect);
        const iframe = deps.iframeRef.current;
        const overlay = deps.overlayRef.current;
        if (iframe && overlay) {
          const acp = deps.activeCompositionPathRef.current ?? "index.html";
          candidatesRef.current ??= collectMarqueeCandidates(iframe, overlay, acp);
          setCandidateRects(hitsWithin(rect, candidatesRef.current).map((h) => h.rect));
        }
        return;
      }
      deps.gestures.onPointerMove(event);
    },
    [deps.gestures, deps.overlayRef, deps.iframeRef, deps.activeCompositionPathRef],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const m = marqueeRef.current;
      if (m) {
        marqueeRef.current = null;
        try {
          (event.currentTarget as HTMLElement).releasePointerCapture(m.pointerId);
        } catch {
          /* already released */
        }
        if (m.pastThreshold) {
          commitMarquee(
            {
              left: Math.min(m.startX, m.currentX),
              top: Math.min(m.startY, m.currentY),
              width: Math.abs(m.currentX - m.startX),
              height: Math.abs(m.currentY - m.startY),
            },
            event.shiftKey,
          );
        } else {
          deps.onMarqueeSelectRef.current?.([], false);
        }
        setMarqueeRect(null);
        setCandidateRects([]);
        candidatesRef.current = null;
        return;
      }
      deps.gestures.onPointerUp(event);
    },
    [deps.gestures, commitMarquee, deps.onMarqueeSelectRef],
  );

  const onPointerCancel = useCallback(() => {
    if (marqueeRef.current) {
      marqueeRef.current = null;
      setMarqueeRect(null);
      setCandidateRects([]);
      candidatesRef.current = null;
      return;
    }
    deps.gestures.clearPointerState(deps.selectionRef);
  }, [deps.gestures, deps.selectionRef]);

  return { marqueeRef, marqueeRect, candidateRects, onPointerMove, onPointerUp, onPointerCancel };
}
