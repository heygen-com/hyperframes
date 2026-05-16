import { memo, useCallback, useEffect, useRef, useState, type Ref } from "react";
import { Player } from "../../player";
import {
  DEFAULT_PREVIEW_ZOOM,
  canStartPreviewPan,
  clampPreviewPan,
  clampPreviewZoomPercent,
  ownsPreviewPanTarget,
  resolvePreviewWheelPan,
  resolvePreviewWheelZoom,
  toDomPrecision,
  type PreviewZoomState,
} from "./previewZoom";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";

interface NLEPreviewProps {
  projectId: string;
  iframeRef: Ref<HTMLIFrameElement>;
  onIframeLoad: () => void;
  onCompositionLoadingChange?: (loading: boolean) => void;
  portrait?: boolean;
  directUrl?: string;
  refreshKey?: number;
  suppressLoadingOverlay?: boolean;
}

export function getPreviewPlayerKey({
  projectId,
  directUrl,
}: {
  projectId: string;
  directUrl?: string;
  refreshKey?: number;
}): string {
  return directUrl ?? projectId;
}

const ZOOM_HUD_TIMEOUT_MS = 1200;
const ZOOM_SETTLE_MS = 200;
const PREVIEW_STAGE_INSET_PX = 16;

function isPreviewAtFit(state: PreviewZoomState): boolean {
  return (
    Math.abs(state.zoomPercent - 100) < 0.5 &&
    Math.abs(state.panX) < 0.1 &&
    Math.abs(state.panY) < 0.1
  );
}

function loadInitialZoom(): PreviewZoomState {
  const stored = readStudioUiPreferences().previewZoom;
  return stored
    ? {
        zoomPercent: clampPreviewZoomPercent(stored.zoomPercent),
        panX: stored.panX,
        panY: stored.panY,
      }
    : DEFAULT_PREVIEW_ZOOM;
}

function resolvePreviewStageSize(
  viewportWidth: number,
  viewportHeight: number,
  portrait: boolean | undefined,
): { width: number; height: number } {
  const availableWidth = Math.max(0, viewportWidth - PREVIEW_STAGE_INSET_PX);
  const availableHeight = Math.max(0, viewportHeight - PREVIEW_STAGE_INSET_PX);
  const aspectRatio = portrait ? 9 / 16 : 16 / 9;

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
  onCompositionLoadingChange,
  portrait,
  directUrl,
  refreshKey,
  suppressLoadingOverlay,
}: NLEPreviewProps) {
  const baseKey = getPreviewPlayerKey({ projectId, directUrl, refreshKey });
  const prevRefreshKeyRef = useRef(refreshKey);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [retiringKey, setRetiringKey] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState(() => resolvePreviewStageSize(0, 0, portrait));
  const retiringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zoomRef = useRef<PreviewZoomState>(loadInitialZoom());
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
      if (retiringTimerRef.current) clearTimeout(retiringTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateStageSize = () => {
      const rect = viewport.getBoundingClientRect();
      setStageSize(resolvePreviewStageSize(rect.width, rect.height, portrait));
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [portrait]);

  const writeTransform = useCallback((state: PreviewZoomState) => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = toDomPrecision(state.zoomPercent / 100);
    const px = toDomPrecision(state.panX);
    const py = toDomPrecision(state.panY);
    stage.style.transform = `translate(${px}px, ${py}px) scale(${s})`;
  }, []);

  const applyZoom = useCallback(
    (next: PreviewZoomState) => {
      const clamped: PreviewZoomState = {
        zoomPercent: clampPreviewZoomPercent(next.zoomPercent),
        panX: Number.isFinite(next.panX) ? next.panX : 0,
        panY: Number.isFinite(next.panY) ? next.panY : 0,
      };
      zoomRef.current = clamped;

      if (!zoomingRef.current) {
        zoomingRef.current = true;
        const hud = hudRef.current;
        if (hud) hud.style.opacity = "1";
      }

      writeTransform(clamped);

      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        zoomingRef.current = false;
        const final = zoomRef.current;
        writeStudioUiPreferences({ previewZoom: final });
        const hud = hudRef.current;
        if (hud) {
          hud.textContent = isPreviewAtFit(final) ? "Fit" : `${Math.round(final.zoomPercent)}%`;
          if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
          hudTimerRef.current = setTimeout(() => {
            if (hudRef.current) hudRef.current.style.opacity = "0";
          }, ZOOM_HUD_TIMEOUT_MS);
        }
      }, ZOOM_SETTLE_MS);
    },
    [writeTransform],
  );

  if (refreshKey !== prevRefreshKeyRef.current) {
    const oldKey = `${baseKey}:${prevRefreshKeyRef.current ?? 0}`;
    prevRefreshKeyRef.current = refreshKey;
    setRetiringKey(oldKey);
  }

  const activeKey = `${baseKey}:${refreshKey ?? 0}`;

  const applyInitialZoom = useCallback(() => {
    const z = zoomRef.current;
    if (Math.abs(z.zoomPercent - 100) > 0.5 || Math.abs(z.panX) > 0.1 || Math.abs(z.panY) > 0.1) {
      writeTransform(z);
    }
  }, [writeTransform]);

  const handleNewPlayerLoad = () => {
    onIframeLoad();
    applyInitialZoom();
    if (retiringTimerRef.current) clearTimeout(retiringTimerRef.current);
    retiringTimerRef.current = setTimeout(() => {
      setRetiringKey(null);
      retiringTimerRef.current = null;
    }, 160);
  };

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

        const next = resolvePreviewWheelZoom({
          state: zoomRef.current,
          deltaY: event.deltaY,
          viewportWidth: rect.width,
          viewportHeight: rect.height,
          contentWidth: stageSize.width,
          contentHeight: stageSize.height,
        });
        applyZoom(next);
        return;
      }

      if (!ownsPreviewPanTarget(event.target, stageRef.current)) return;

      event.preventDefault();
      event.stopPropagation();

      const next = resolvePreviewWheelPan({
        state: zoomRef.current,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        contentWidth: stageSize.width,
        contentHeight: stageSize.height,
      });
      applyZoom(next);
    };

    document.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handleWheel, { capture: true });
  }, [applyZoom, stageSize.height, stageSize.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleDblClick = (event: MouseEvent) => {
      if (isPreviewAtFit(zoomRef.current)) return;
      const rect = viewport.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }
      applyZoom(DEFAULT_PREVIEW_ZOOM);
    };

    document.addEventListener("dblclick", handleDblClick, { capture: true });
    return () => document.removeEventListener("dblclick", handleDblClick, { capture: true });
  }, [applyZoom]);

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
      const pan = clampPreviewPan({
        panX: drag.originX + event.clientX - drag.startX,
        panY: drag.originY + event.clientY - drag.startY,
        zoomPercent: zoomRef.current.zoomPercent,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        contentWidth: stageSize.width,
        contentHeight: stageSize.height,
      });
      applyZoom({ ...zoomRef.current, ...pan });
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
  }, [applyZoom, stageSize.height, stageSize.width]);

  const initial = zoomRef.current;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={viewportRef}
        className="relative flex-1 flex items-center justify-center p-2 overflow-hidden min-h-0 outline-none focus:ring-1 focus:ring-studio-accent/40 bg-neutral-700"
        tabIndex={0}
        aria-label="Composition preview"
      >
        <div className="absolute inset-2 flex items-center justify-center pointer-events-none">
          <div
            ref={stageRef}
            className="relative shrink-0 pointer-events-auto"
            style={{
              width: `${stageSize.width}px`,
              height: `${stageSize.height}px`,
              transform: `translate(${toDomPrecision(initial.panX)}px, ${toDomPrecision(initial.panY)}px) scale(${toDomPrecision(initial.zoomPercent / 100)})`,
              transformOrigin: "center center",
            }}
            data-testid="preview-zoom-stage"
          >
            {retiringKey && (
              <Player
                key={retiringKey}
                projectId={directUrl ? undefined : projectId}
                directUrl={directUrl}
                onLoad={() => {}}
                portrait={portrait}
                style={{ position: "absolute", inset: 0, zIndex: 0, opacity: 1 }}
              />
            )}
            <Player
              key={activeKey}
              ref={iframeRef}
              projectId={directUrl ? undefined : projectId}
              directUrl={directUrl}
              onLoad={
                retiringKey
                  ? handleNewPlayerLoad
                  : () => {
                      onIframeLoad();
                      applyInitialZoom();
                    }
              }
              onCompositionLoadingChange={onCompositionLoadingChange}
              portrait={portrait}
              style={retiringKey ? { position: "absolute", inset: 0, zIndex: 1 } : undefined}
              suppressLoadingOverlay={suppressLoadingOverlay}
            />
          </div>
        </div>
        <div
          ref={hudRef}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-lg px-4 py-2 text-sm font-mono tabular-nums text-white/90 bg-black/60 backdrop-blur-sm shadow-lg"
          style={{ opacity: 0, transition: "opacity 300ms ease-out" }}
          aria-live="polite"
        />
      </div>
    </div>
  );
});
