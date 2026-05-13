import { memo, useRef, useState, useCallback, type Ref } from "react";
import { Player } from "../../player";

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

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.1;
const SCALE_STORAGE_KEY = "hyperframes/previewScale";

function loadScale(): number {
  try {
    const stored = localStorage.getItem(SCALE_STORAGE_KEY);
    if (stored !== null) {
      const parsed = Number.parseFloat(stored);
      if (Number.isFinite(parsed) && parsed >= MIN_SCALE && parsed <= MAX_SCALE) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return 1;
}

function saveScale(scale: number): void {
  try {
    localStorage.setItem(SCALE_STORAGE_KEY, String(scale));
  } catch {
    /* ignore */
  }
}

/**
 * Manages the composition preview with crossfade on reload.
 *
 * When refreshKey changes, a new Player is mounted alongside the old one.
 * The old Player stays visible (opacity 1) until the new one fires onLoad,
 * at which point the old is removed. This avoids the flash that a simple
 * key-swap remount would cause.
 *
 * Uses the render-time state adjustment pattern (React-sanctioned) to detect
 * refreshKey changes — no useEffect needed.
 */
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
  const [retiringKey, setRetiringKey] = useState<string | null>(null);
  const retiringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [previewScale, setPreviewScale] = useState(loadScale);

  // Detect refreshKey change during render (React-sanctioned derived state pattern).
  // When the key changes, the current active player becomes the retiring player
  // and a new active player is mounted alongside it.
  if (refreshKey !== prevRefreshKeyRef.current) {
    const oldKey = `${baseKey}:${prevRefreshKeyRef.current ?? 0}`;
    prevRefreshKeyRef.current = refreshKey;
    setRetiringKey(oldKey);
  }

  const activeKey = `${baseKey}:${refreshKey ?? 0}`;

  const handleNewPlayerLoad = () => {
    onIframeLoad();
    if (retiringTimerRef.current) clearTimeout(retiringTimerRef.current);
    retiringTimerRef.current = setTimeout(() => {
      setRetiringKey(null);
      retiringTimerRef.current = null;
    }, 160);
  };

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      setPreviewScale((prev) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta));
        saveScale(next);
        return next;
      });
    },
    [],
  );

  const handleResetZoom = useCallback(() => {
    setPreviewScale(1);
    saveScale(1);
  }, []);

  const scalePercent = Math.round(previewScale * 100);
  const showReset = previewScale !== 1;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="relative flex-1 flex items-center justify-center p-2 overflow-hidden min-h-0 outline-none focus:ring-1 focus:ring-studio-accent/40"
        tabIndex={0}
        aria-label="Composition preview"
        onWheel={handleWheel}
      >
        {/* Zoom transform container */}
        <div
          className="relative w-full h-full flex items-center justify-center"
          style={{
            overflow: "hidden",
            // Translate so the zoom centers on the container midpoint
            transformOrigin: "center center",
            transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
            transition: "transform 0.15s ease-out",
          }}
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
            onLoad={retiringKey ? handleNewPlayerLoad : onIframeLoad}
            onCompositionLoadingChange={onCompositionLoadingChange}
            portrait={portrait}
            style={retiringKey ? { position: "absolute", inset: 0, zIndex: 1 } : undefined}
            suppressLoadingOverlay={suppressLoadingOverlay}
          />
        </div>

        {/* Zoom controls overlay */}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          {/* Scale label */}
          <span className="text-xs text-white/50 select-none pointer-events-none">
            {scalePercent}%
          </span>
          {/* Reset button — only shown when zoomed */}
          {showReset && (
            <button
              type="button"
              onClick={handleResetZoom}
              title="Reset zoom (Ctrl+0)"
              className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors text-xs font-medium"
              aria-label="Reset preview zoom"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
});