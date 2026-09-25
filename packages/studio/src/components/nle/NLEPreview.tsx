import {
  readPreviewCompositionSize,
  type PreviewCompositionSize,
} from "../../utils/previewCompositionSize";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Player } from "../../player";
import type { PreviewIframeSlot } from "../../player/hooks/useTimelineSyncCallbacks";
import {
  DEFAULT_PREVIEW_ZOOM,
  canStartPreviewPan,
  clampPreviewPan,
  clampPreviewZoomPercent,
  ownsPreviewPanTarget,
  resolvePreviewVisibleRegion,
  resolvePreviewWheelPan,
  resolvePreviewWheelZoom,
  toDomPrecision,
  type PreviewZoomState,
} from "./previewZoom";
import { RULER_GUTTER_PX, usePreviewGuidesStore } from "../editor/previewGuidesStore";
import { usePreviewFirstFrameTelemetry } from "../../player/hooks/usePreviewFirstFrameTelemetry";
import { PreviewPoster, usePreviewPoster } from "./PreviewPoster";
interface NLEPreviewProps {
  projectId: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
  previewSlots: PreviewIframeSlot[];
  onShadowIframeLoad: (gen: number) => void;
  onShadowReadyChange: (gen: number, ready: boolean) => void;
  onShadowError: (gen: number, message: string) => void;
  setShadowIframeNode: (node: HTMLIFrameElement | null) => void;
  resetPreviewSlots: () => void;
  onCompositionLoadingChange?: (loading: boolean) => void;
  portrait?: boolean;
  directUrl?: string;
  suppressLoadingOverlay?: boolean;
  onStageRef?: (ref: React.RefObject<HTMLDivElement | null>) => void;
  /** Reports the authored composition size measured from the loaded preview. */
  onCompositionSizeChange?: (size: PreviewCompositionSize | null) => void;
  /** Draws the picture edge to edge in this box, without Studio's inset band. */
  fillBox?: boolean;
}

export function getPreviewPlayerKey({
  projectId,
  directUrl,
}: {
  projectId: string;
  directUrl?: string;
}): string {
  return directUrl ?? projectId;
}

const ZOOM_HUD_TIMEOUT_MS = 1200;
const ZOOM_SETTLE_MS = 200;
const PREVIEW_STAGE_INSET_PX = 8;
const NAVIGATOR_PX = 112;

// clip-path as well as visibility: the player's loading overlay sets its own
// visibility:visible and would otherwise paint over the live frame.
const SHADOW_IFRAME_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  visibility: "hidden",
  clipPath: "inset(100%)",
  pointerEvents: "none",
};

const isFitZoom = (zoomPercent: number) => Math.abs(zoomPercent - 100) < 0.5;

function isPreviewAtFit(state: PreviewZoomState): boolean {
  return isFitZoom(state.zoomPercent) && Math.abs(state.panX) < 0.1 && Math.abs(state.panY) < 0.1;
}

function zoomChipLabel(zoomPercent: number): string {
  return isFitZoom(zoomPercent) ? "Panned" : `Zoomed ${Math.round(zoomPercent)}%`;
}

function navigatorFrameSize(stage: { width: number; height: number }) {
  const ratio = stage.width > 0 && stage.height > 0 ? stage.width / stage.height : 16 / 9;
  return ratio >= 1
    ? { width: NAVIGATOR_PX, height: toDomPrecision(NAVIGATOR_PX / ratio) }
    : { width: toDomPrecision(NAVIGATOR_PX * ratio), height: NAVIGATOR_PX };
}

export function resolvePreviewStageSize(
  viewportWidth: number,
  viewportHeight: number,
  compositionSize: PreviewCompositionSize | null,
  portrait: boolean | undefined,
  gutterPx = 0,
  insetPx = PREVIEW_STAGE_INSET_PX,
): { width: number; height: number } {
  const availableWidth = Math.max(0, viewportWidth - 2 * (insetPx + gutterPx));
  const availableHeight = Math.max(0, viewportHeight - 2 * (insetPx + gutterPx));
  const aspectRatio =
    compositionSize && compositionSize.width > 0 && compositionSize.height > 0
      ? compositionSize.width / compositionSize.height
      : portrait
        ? 9 / 16
        : 16 / 9;

  if (availableWidth === 0 || availableHeight === 0) {
    return { width: 0, height: 0 };
  }

  let width = availableWidth;
  let height = width / aspectRatio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * aspectRatio;
  }

  return {
    width: toDomPrecision(width),
    height: toDomPrecision(height),
  };
}

export const NLEPreview = memo(function NLEPreview({
  projectId,
  iframeRef,
  onIframeLoad,
  previewSlots,
  onShadowIframeLoad,
  onShadowReadyChange,
  onShadowError,
  setShadowIframeNode,
  resetPreviewSlots,
  onCompositionLoadingChange,
  portrait,
  directUrl,
  suppressLoadingOverlay,
  onStageRef,
  onCompositionSizeChange,
  fillBox,
}: NLEPreviewProps) {
  const activeKey = getPreviewPlayerKey({ projectId, directUrl });
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    onStageRef?.(stageRef);
  }, [onStageRef]);

  // Composition switch: drop any in-flight shadow reload (skipped on first mount).
  const previousActiveKeyRef = useRef(activeKey);
  useEffect(() => {
    if (previousActiveKeyRef.current === activeKey) return;
    previousActiveKeyRef.current = activeKey;
    resetPreviewSlots();
  }, [activeKey, resetPreviewSlots]);

  const liveGenRef = useRef<number | null>(null);
  const reportPreviewFirstFrame = usePreviewFirstFrameTelemetry(previewSlots);
  const [compositionSize, setCompositionSize] = useState<PreviewCompositionSize | null>(null);
  const poster = usePreviewPoster(projectId, activeKey, directUrl);
  const gutterPx = usePreviewGuidesStore((s) => (s.rulerVisible ? RULER_GUTTER_PX : 0));
  const insetPx = fillBox ? 0 : PREVIEW_STAGE_INSET_PX;
  const [stageSize, setStageSize] = useState(() => resolvePreviewStageSize(0, 0, null, portrait));

  const zoomRef = useRef<PreviewZoomState>(DEFAULT_PREVIEW_ZOOM);
  const [settledZoom, setSettledZoom] = useState<PreviewZoomState>(DEFAULT_PREVIEW_ZOOM);
  const hudRef = useRef<HTMLDivElement>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomingRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateStageSize = () => {
      const rect = viewport.getBoundingClientRect();
      setStageSize(
        resolvePreviewStageSize(
          rect.width,
          rect.height,
          compositionSize,
          portrait,
          gutterPx,
          insetPx,
        ),
      );
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [compositionSize, portrait, gutterPx, insetPx]);

  const onCompositionSizeChangeRef = useRef(onCompositionSizeChange);
  onCompositionSizeChangeRef.current = onCompositionSizeChange;

  const updateCompositionSizeFromPreview = useCallback(() => {
    const next = readPreviewCompositionSize(previewIframeRef.current);
    // Pure updater — the parent notification happens in the effect below
    // (updaters may run more than once under Strict Mode / concurrent React).
    setCompositionSize((prev) =>
      prev?.width === next?.width && prev?.height === next?.height ? prev : next,
    );
  }, []);

  useEffect(() => {
    onCompositionSizeChangeRef.current?.(compositionSize);
  }, [compositionSize]);

  const setPreviewIframeRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      previewIframeRef.current = node;
      iframeRef.current = node;
    },
    [iframeRef],
  );

  const stageSizeRef = useRef(stageSize);
  stageSizeRef.current = stageSize;

  const navigatorRegionRef = useRef<HTMLDivElement | null>(null);
  const drawNavigator = useCallback((state: PreviewZoomState) => {
    const region = navigatorRegionRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!region || !rect) return;
    const visible = resolvePreviewVisibleRegion({
      state,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      contentWidth: stageSizeRef.current.width,
      contentHeight: stageSizeRef.current.height,
    });
    region.style.left = `${visible.left * 100}%`;
    region.style.top = `${visible.top * 100}%`;
    region.style.width = `${visible.width * 100}%`;
    region.style.height = `${visible.height * 100}%`;
  }, []);
  const setNavigatorRegion = useCallback(
    (node: HTMLDivElement | null) => {
      navigatorRegionRef.current = node;
      drawNavigator(zoomRef.current);
    },
    [drawNavigator],
  );
  useEffect(() => drawNavigator(zoomRef.current), [stageSize, drawNavigator]);

  const writeTransform = useCallback(
    (state: PreviewZoomState) => {
      const stage = stageRef.current;
      if (!stage) return;
      const s = toDomPrecision(state.zoomPercent / 100);
      const px = toDomPrecision(state.panX);
      const py = toDomPrecision(state.panY);
      stage.style.transform = `translate3d(${px}px, ${py}px, 0) scale(${s})`;
      drawNavigator(state);
    },
    [drawNavigator],
  );

  const zoomProjectRef = useRef(projectId);
  // Before paint, so the next project never shows a frame at the previous one's zoom.
  useLayoutEffect(() => {
    if (zoomProjectRef.current === projectId) return;
    zoomProjectRef.current = projectId;
    zoomRef.current = DEFAULT_PREVIEW_ZOOM;
    writeTransform(DEFAULT_PREVIEW_ZOOM);
    setSettledZoom(DEFAULT_PREVIEW_ZOOM);
  }, [projectId, writeTransform]);

  const applyTransform = useCallback(
    (next: PreviewZoomState, showHud: boolean) => {
      const clamped: PreviewZoomState = {
        zoomPercent: clampPreviewZoomPercent(next.zoomPercent),
        panX: Number.isFinite(next.panX) ? next.panX : 0,
        panY: Number.isFinite(next.panY) ? next.panY : 0,
      };
      zoomRef.current = clamped;

      if (showHud) {
        const hud = hudRef.current;
        if (hud) {
          if (!zoomingRef.current) {
            zoomingRef.current = true;
            hud.style.opacity = "1";
          }
          // Live per-frame readout — without this the HUD shows an empty pill
          // on the first-ever zoom and a stale percentage mid-gesture.
          hud.textContent = isPreviewAtFit(clamped) ? "Fit" : `${Math.round(clamped.zoomPercent)}%`;
        }
      }

      writeTransform(clamped);

      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        zoomingRef.current = false;
        const final = zoomRef.current;
        setSettledZoom((prev) =>
          prev.zoomPercent === final.zoomPercent &&
          prev.panX === final.panX &&
          prev.panY === final.panY
            ? prev
            : final,
        );
        if (showHud) {
          const hud = hudRef.current;
          if (hud) {
            hud.textContent = isPreviewAtFit(final) ? "Fit" : `${Math.round(final.zoomPercent)}%`;
            if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
            hudTimerRef.current = setTimeout(() => {
              if (hudRef.current) hudRef.current.style.opacity = "0";
            }, ZOOM_HUD_TIMEOUT_MS);
          }
        }
      }, ZOOM_SETTLE_MS);
    },
    [writeTransform],
  );

  const applyZoom = useCallback(
    (next: PreviewZoomState) => applyTransform(next, true),
    [applyTransform],
  );

  const applyPan = useCallback(
    (next: PreviewZoomState) => applyTransform(next, false),
    [applyTransform],
  );

  const applyInitialZoom = useCallback(() => {
    const z = zoomRef.current;
    if (!isPreviewAtFit(z)) {
      // A composition reload can bring a different frame size than the pan was made on; clamp first.
      const viewport = viewportRef.current;
      const rect = viewport?.getBoundingClientRect();
      const sz = stageSizeRef.current;
      if (rect && rect.width > 0 && rect.height > 0 && sz.width > 0 && sz.height > 0) {
        const pan = clampPreviewPan({
          panX: z.panX,
          panY: z.panY,
          zoomPercent: z.zoomPercent,
          viewportWidth: rect.width,
          viewportHeight: rect.height,
          contentWidth: sz.width,
          contentHeight: sz.height,
        });
        zoomRef.current = { ...z, ...pan };
      }
      writeTransform(zoomRef.current);
    }
  }, [writeTransform]);

  // A promotion does not re-fire Player.onLoad: re-sync the local iframe ref, size and zoom.
  useEffect(() => {
    const live = previewSlots.find((slot) => slot.role === "live");
    if (!live || live.gen === liveGenRef.current) return;
    const isPromotion = liveGenRef.current !== null;
    liveGenRef.current = live.gen;
    if (!isPromotion) return;
    previewIframeRef.current = iframeRef.current;
    updateCompositionSizeFromPreview();
    applyInitialZoom();
  }, [previewSlots, iframeRef, updateCompositionSizeFromPreview, applyInitialZoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      const rect = viewport.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }

      const isZoomGesture = event.ctrlKey || event.metaKey;

      if (isZoomGesture) {
        event.preventDefault();
        event.stopPropagation();

        const sz = stageSizeRef.current;
        const cursorX = event.clientX - (rect.left + rect.width / 2);
        const cursorY = event.clientY - (rect.top + rect.height / 2);
        const next = resolvePreviewWheelZoom({
          state: zoomRef.current,
          deltaY: event.deltaY,
          viewportWidth: rect.width,
          viewportHeight: rect.height,
          contentWidth: sz.width,
          contentHeight: sz.height,
          cursorX,
          cursorY,
        });
        applyZoom(next);
        return;
      }

      if (!ownsPreviewPanTarget(event.target, stageRef.current)) return;

      event.preventDefault();
      event.stopPropagation();

      const sz = stageSizeRef.current;
      const next = resolvePreviewWheelPan({
        state: zoomRef.current,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        contentWidth: sz.width,
        contentHeight: sz.height,
      });
      applyPan(next);
    };

    document.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handleWheel, { capture: true });
  }, [applyZoom, applyPan]);

  useEffect(() => {
    const isInsideViewport = (clientX: number, clientY: number): DOMRect | null => {
      const viewport = viewportRef.current;
      if (!viewport) return null;
      const rect = viewport.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }
      return rect;
    };

    const handlePointerDown = (event: PointerEvent) => {
      const rect = isInsideViewport(event.clientX, event.clientY);
      if (!rect) return;
      if (!ownsPreviewPanTarget(event.target, stageRef.current)) return;
      if (!canStartPreviewPan(event.button)) return;
      event.preventDefault();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: zoomRef.current.panX,
        originY: zoomRef.current.panY,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const viewport = viewportRef.current;
      if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const sz = stageSizeRef.current;
      const pan = clampPreviewPan({
        panX: drag.originX + event.clientX - drag.startX,
        panY: drag.originY + event.clientY - drag.startY,
        zoomPercent: zoomRef.current.zoomPercent,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        contentWidth: sz.width,
        contentHeight: sz.height,
      });
      applyPan({ ...zoomRef.current, ...pan });
    };

    const finishDrag = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null;
      }
    };

    const handleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      if (!isInsideViewport(event.clientX, event.clientY)) return;
      if (!ownsPreviewPanTarget(event.target, stageRef.current)) return;
      event.preventDefault();
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    document.addEventListener("pointermove", handlePointerMove, { capture: true });
    document.addEventListener("pointerup", finishDrag, { capture: true });
    document.addEventListener("pointercancel", finishDrag, { capture: true });
    document.addEventListener("auxclick", handleAuxClick, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      document.removeEventListener("pointermove", handlePointerMove, { capture: true });
      document.removeEventListener("pointerup", finishDrag, { capture: true });
      document.removeEventListener("pointercancel", finishDrag, { capture: true });
      document.removeEventListener("auxclick", handleAuxClick, { capture: true });
    };
  }, [applyPan]);

  const initial = zoomRef.current;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={viewportRef}
        className="relative flex-1 flex items-center justify-center overflow-hidden min-h-0 outline-hidden focus:ring-1 focus:ring-studio-accent/40 bg-[var(--studio-preview-bg,var(--color-neutral-950))]"
        tabIndex={0}
        aria-label="Composition preview"
      >
        <div
          className="absolute flex items-center justify-center pointer-events-none"
          style={{ inset: insetPx }}
        >
          <div
            ref={stageRef}
            className="relative shrink-0 pointer-events-auto"
            style={{
              width: `${stageSize.width}px`,
              height: `${stageSize.height}px`,
              transform: `translate3d(${toDomPrecision(initial.panX)}px, ${toDomPrecision(initial.panY)}px, 0) scale(${toDomPrecision(initial.zoomPercent / 100)})`,
              // resolvePreviewWheelZoom cursor math assumes center-center pivot
              transformOrigin: "center center",
            }}
            data-testid="preview-zoom-stage"
          >
            {directUrl?.includes("/components/") && (
              <Player
                key={`backdrop-${projectId}`}
                projectId={projectId}
                onLoad={() => {}}
                portrait={portrait}
                suppressLoadingOverlay
                style={{ position: "absolute", inset: 0, zIndex: 0 }}
              />
            )}
            {previewSlots.map((slot) =>
              slot.role === "live" ? (
                <Player
                  key={`${activeKey}-${slot.gen}`}
                  ref={setPreviewIframeRef}
                  projectId={directUrl ? undefined : projectId}
                  directUrl={directUrl}
                  onLoad={() => {
                    updateCompositionSizeFromPreview();
                    onIframeLoad();
                    applyInitialZoom();
                  }}
                  onCompositionLoadingChange={onCompositionLoadingChange}
                  onReadyToShowChange={poster.onLiveReadyToShowChange}
                  onPreviewError={poster.onPreviewError}
                  onPainted={(details) => reportPreviewFirstFrame(slot, details)}
                  portrait={portrait}
                  suppressLoadingOverlay={suppressLoadingOverlay}
                  style={
                    directUrl?.includes("/components/")
                      ? { position: "absolute", inset: 0, zIndex: 1 }
                      : undefined
                  }
                />
              ) : (
                // Loads hidden behind the live slot until promoted.
                <Player
                  key={`${activeKey}-${slot.gen}`}
                  ref={setShadowIframeNode}
                  directUrl={slot.url}
                  onLoad={() => onShadowIframeLoad(slot.gen)}
                  onReadyToShowChange={(ready) => onShadowReadyChange(slot.gen, ready)}
                  onPainted={(details) => reportPreviewFirstFrame(slot, details)}
                  onPreviewError={(message) => onShadowError(slot.gen, message)}
                  portrait={portrait}
                  suppressLoadingOverlay
                  style={SHADOW_IFRAME_STYLE}
                />
              ),
            )}
            {poster.mountPoster && (
              <PreviewPoster
                key={activeKey}
                projectId={projectId}
                hidden={poster.hidePoster}
                onSize={(size) => setCompositionSize((prev) => prev ?? size)}
                onLoaded={poster.onPosterLoaded}
                onMissing={poster.onPosterMissing}
              />
            )}
          </div>
        </div>
        <div
          ref={hudRef}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-lg px-4 py-2 text-sm font-mono tabular-nums text-white/90 bg-black/60 backdrop-blur-xs shadow-lg"
          style={{ opacity: 0, transition: "opacity 200ms ease-in" }}
          aria-live="polite"
        />
        {!isPreviewAtFit(settledZoom) && (
          <>
            <div
              className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1 text-xs text-white/80 bg-black/60 backdrop-blur-xs"
              data-testid="preview-zoom-chip"
              // The pane clears the timeline selection on a pointerdown outside the frame.
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="tabular-nums">{zoomChipLabel(settledZoom.zoomPercent)}</span>
              <span aria-hidden="true" className="text-white/30">
                ·
              </span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 font-medium text-studio-accent hover:bg-white/10 transition-colors"
                onClick={() => {
                  applyZoom(DEFAULT_PREVIEW_ZOOM);
                  viewportRef.current?.focus();
                }}
                aria-label="Fit the whole frame in view"
                data-testid="preview-zoom-fit"
              >
                Fit
              </button>
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-3 right-3 z-50 rounded-md p-1.5 bg-black/60 backdrop-blur-xs"
              data-testid="preview-zoom-navigator"
            >
              <div
                className="relative overflow-hidden bg-white/10"
                style={navigatorFrameSize(stageSize)}
              >
                <div
                  ref={setNavigatorRegion}
                  className="absolute rounded-[1px] border border-studio-accent bg-studio-accent/15"
                  data-testid="preview-zoom-navigator-region"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
