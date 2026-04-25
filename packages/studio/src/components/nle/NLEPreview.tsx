import { memo, useRef, useState, type Ref } from "react";
import { Player } from "../../player";

interface NLEPreviewProps {
  projectId: string;
  iframeRef: Ref<HTMLIFrameElement>;
  onIframeLoad: () => void;
  portrait?: boolean;
  directUrl?: string;
  refreshKey?: number;
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
  portrait,
  directUrl,
  refreshKey,
}: NLEPreviewProps) {
  const baseKey = getPreviewPlayerKey({ projectId, directUrl, refreshKey });
  const prevRefreshKeyRef = useRef(refreshKey);
  const [retiringKey, setRetiringKey] = useState<string | null>(null);
  const retiringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="relative flex-1 flex items-center justify-center p-2 overflow-hidden min-h-0 outline-none focus:ring-1 focus:ring-studio-accent/40"
        tabIndex={0}
        aria-label="Composition preview"
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
          portrait={portrait}
          style={retiringKey ? { position: "absolute", inset: 0, zIndex: 1 } : undefined}
        />
      </div>
    </div>
  );
});
