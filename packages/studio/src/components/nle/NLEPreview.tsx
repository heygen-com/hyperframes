import { memo, useCallback, useEffect, useRef, useState, type Ref } from "react";
import { Player } from "../../player";
import {
  DEFAULT_PREVIEW_ZOOM,
  clampPreviewPan,
  clampPreviewZoomPercent,
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

  const writeTransform = useCallback((state: PreviewZoomState) => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = toDomPrecision(state.zoomPercent / 100);
    const px = toDomPrecision(state.panX);
    const py = toDomPrecision(state.panY);
    stage.style.zoom = String(s);
    stage.style.transform = `translate(${px}px, ${py}px)`;
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
          const zoomed = Math.abs(final.zoomPercent - 100) > 0.5;
          hud.textContent = zoomed ? `${Math.round(final.zoomPercent)}%` : "Fit";
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

    let lastZoomTime = 0;

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
        lastZoomTime = Date.now();
        event.preventDefault();
        event.stopPropagation();

        const next = resolvePreviewWheelZoom({
          state: zoomRef.current,
          deltaY: event.deltaY,
          viewportWidth: rect.width,
          viewportHeight: rect.height,
        });
        applyZoom(next);
        return;
      }

      if (Date.now() - lastZoomTime < 400) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handleWheel, { capture: true });
  }, [applyZoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleDblClick = (event: MouseEvent) => {
      if (Math.abs(zoomRef.current.zoomPercent - 100) < 0.5) return;
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

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (zoomRef.current.zoomPercent <= 100 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: zoomRef.current.panX,
      originY: zoomRef.current.panY,
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
      });
      applyZoom({ ...zoomRef.current, ...pan });
    },
    [applyZoom],
  );

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const initial = zoomRef.current;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={viewportRef}
        className="relative flex-1 flex items-center justify-center p-2 overflow-hidden min-h-0 outline-none focus:ring-1 focus:ring-studio-accent/40 bg-neutral-700"
        tabIndex={0}
        aria-label="Composition preview"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          ref={stageRef}
          className="absolute inset-2"
          style={{
            zoom: toDomPrecision(initial.zoomPercent / 100),
            transform: `translate(${toDomPrecision(initial.panX)}px, ${toDomPrecision(initial.panY)}px)`,
            transformOrigin: "0 0",
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
