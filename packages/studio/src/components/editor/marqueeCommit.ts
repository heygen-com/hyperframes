import { useCallback, useRef, useState } from "react";
import type { DomEditSelection } from "./domEditing";
import { collectDomEditLayerItems, resolveDomEditSelection } from "./domEditingLayers";
import { isElementComputedVisible } from "./domEditingElement";
import { coversComposition } from "../../utils/studioPreviewHelpers";
import {
  elementObbCorners,
  marqueeIntersectsObb,
  type Corners,
  type Rect,
} from "../../utils/marqueeGeometry";

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
  corners: Corners;
}

/**
 * Synchronous core of the marquee: the elements whose OBB intersects the
 * marquee rect, with their overlay-space corners. Shared by the live
 * candidate highlight (per pointer-move) and the mouse-up commit. No async
 * source probe — that only happens once, on commit.
 */
// fallow-ignore-next-line complexity
function collectMarqueeHits(
  rect: Rect,
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

  const hits: MarqueeHit[] = [];
  for (const item of items) {
    const el = item.element;
    if (!isElementComputedVisible(el)) continue;
    if (coversComposition(el.getBoundingClientRect(), viewport)) continue;
    const corners = elementObbCorners(el, overlayEl, iframe);
    if (!corners) continue;
    if (!marqueeIntersectsObb(rect, corners)) continue;
    hits.push({ element: el, corners });
  }

  return hits;
}

/** Axis-aligned bounding box of an OBB's corners, in overlay-pixel space. */
function cornersToRect(corners: Corners): Rect {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

async function runMarqueeIntersection(
  rect: Rect,
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
  activeCompositionPath: string,
): Promise<DomEditSelection[]> {
  const isMasterView = !activeCompositionPath || activeCompositionPath === "index.html";
  const hits: DomEditSelection[] = [];
  for (const { element } of collectMarqueeHits(rect, iframe, overlayEl, activeCompositionPath)) {
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

  const commitMarquee = useCallback(
    async (
      rect: { left: number; top: number; width: number; height: number },
      additive: boolean,
    ) => {
      const iframe = deps.iframeRef.current;
      const overlay = deps.overlayRef.current;
      if (!iframe || !overlay || !deps.onMarqueeSelectRef.current) return;
      const acp = deps.activeCompositionPathRef.current ?? "index.html";
      const hits = await runMarqueeIntersection(rect, iframe, overlay, acp);
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
          setCandidateRects(
            collectMarqueeHits(rect, iframe, overlay, acp).map((h) => cornersToRect(h.corners)),
          );
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
      return;
    }
    deps.gestures.clearPointerState(deps.selectionRef);
  }, [deps.gestures, deps.selectionRef]);

  return { marqueeRef, marqueeRect, candidateRects, onPointerMove, onPointerUp, onPointerCancel };
}
