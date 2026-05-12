import { memo, useCallback, useEffect, useRef, useState } from "react";

interface CompositionsTabProps {
  projectId: string;
  compositions: string[];
  activeComposition: string | null;
  onSelect: (comp: string) => void;
}

const DEFAULT_PREVIEW_STAGE = { width: 1920, height: 1080 };
const THUMBNAIL_SEEK_TIME_SECONDS = 3;
const THUMBNAIL_PLAYBACK_SYNC_ATTEMPTS = 10;

type PreviewWindow = Window & {
  __player?: {
    play?: () => void;
    pause?: () => void;
    seek?: (time: number) => void;
    getDuration?: () => number;
  };
};

export function resolveCompositionPreviewScale(input: {
  cardWidth: number;
  cardHeight: number;
  stageWidth: number;
  stageHeight: number;
}): number {
  const safeStageWidth =
    Number.isFinite(input.stageWidth) && input.stageWidth > 0
      ? input.stageWidth
      : DEFAULT_PREVIEW_STAGE.width;
  const safeStageHeight =
    Number.isFinite(input.stageHeight) && input.stageHeight > 0
      ? input.stageHeight
      : DEFAULT_PREVIEW_STAGE.height;
  const scaleX = input.cardWidth / safeStageWidth;
  const scaleY = input.cardHeight / safeStageHeight;
  return Math.min(scaleX, scaleY);
}

export function resolveThumbnailSeekTime(durationSeconds: number | null | undefined): number {
  if (
    Number.isFinite(durationSeconds) &&
    durationSeconds != null &&
    durationSeconds > 0 &&
    durationSeconds < THUMBNAIL_SEEK_TIME_SECONDS
  ) {
    return durationSeconds / 2;
  }

  return THUMBNAIL_SEEK_TIME_SECONDS;
}

function parsePositiveNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveIframeDuration(iframe: HTMLIFrameElement | null): number | null {
  const win = iframe?.contentWindow as PreviewWindow | null;
  const playerDuration = win?.__player?.getDuration?.();
  if (Number.isFinite(playerDuration) && playerDuration != null && playerDuration > 0) {
    return playerDuration;
  }

  const doc = iframe?.contentDocument;
  const root = doc?.querySelector("[data-composition-id]") ?? doc?.documentElement ?? null;
  return (
    parsePositiveNumber(root?.getAttribute("data-composition-duration") ?? null) ??
    parsePositiveNumber(root?.getAttribute("data-duration") ?? null)
  );
}

function syncIframePlayback(iframe: HTMLIFrameElement | null, shouldPlay: boolean): boolean {
  const player = (iframe?.contentWindow as PreviewWindow | null)?.__player;
  if (!player) return false;

  if (shouldPlay) {
    player.play?.();
    return true;
  }

  player.pause?.();
  player.seek?.(resolveThumbnailSeekTime(resolveIframeDuration(iframe)));
  return true;
}

function CompCard({
  projectId,
  comp,
  isActive,
  onSelect,
}: {
  projectId: string;
  comp: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [stageSize, setStageSize] = useState(DEFAULT_PREVIEW_STAGE);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestIframePlaybackSync = useCallback((shouldPlay: boolean) => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }

    const sync = (remainingAttempts: number) => {
      if (syncIframePlayback(iframeRef.current, shouldPlay) || remainingAttempts <= 0) return;

      syncTimer.current = setTimeout(() => sync(remainingAttempts - 1), 100);
    };

    sync(THUMBNAIL_PLAYBACK_SYNC_ATTEMPTS);
  }, []);

  const handleEnter = () => {
    hoverTimer.current = setTimeout(() => setHovered(true), 300);
  };
  const handleLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(false);
  };
  const name = comp.replace(/^compositions\//, "").replace(/\.html$/, "");
  const previewUrl = `/api/projects/${projectId}/preview/comp/${comp}`;
  const previewScale = resolveCompositionPreviewScale({
    cardWidth: 80,
    cardHeight: 45,
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
  });

  useEffect(() => {
    requestIframePlaybackSync(hovered);
  }, [hovered, requestIframePlaybackSync]);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, []);

  return (
    <div
      onClick={onSelect}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      className={`w-full text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
        isActive
          ? "bg-studio-accent/10 border-l-2 border-studio-accent"
          : "border-l-2 border-transparent hover:bg-neutral-800/50"
      }`}
    >
      <div className="w-20 h-[45px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 relative">
        <iframe
          ref={iframeRef}
          src={previewUrl}
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
          className="absolute left-0 top-0 border-none pointer-events-none"
          style={{
            transformOrigin: "0 0",
            width: stageSize.width,
            height: stageSize.height,
            transform: `scale(${previewScale})`,
          }}
          onLoad={(e) => {
            try {
              const iframe = e.currentTarget;
              const root = iframe.contentDocument?.querySelector("[data-composition-id]");
              const width = Number(root?.getAttribute("data-width")) || DEFAULT_PREVIEW_STAGE.width;
              const height =
                Number(root?.getAttribute("data-height")) || DEFAULT_PREVIEW_STAGE.height;
              setStageSize({ width, height });
              requestIframePlaybackSync(hovered);
            } catch {
              setStageSize(DEFAULT_PREVIEW_STAGE);
            }
          }}
          title={`${name} preview`}
          tabIndex={-1}
        />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-medium text-neutral-300 truncate block">{name}</span>
        <span className="text-[9px] text-neutral-600 truncate block">{comp}</span>
      </div>
    </div>
  );
}

export const CompositionsTab = memo(function CompositionsTab({
  projectId,
  compositions,
  activeComposition,
  onSelect,
}: CompositionsTabProps) {
  if (compositions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-neutral-600 text-center">No compositions found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {compositions.map((comp) => (
        <CompCard
          key={comp}
          projectId={projectId}
          comp={comp}
          isActive={activeComposition === comp}
          onSelect={() => onSelect(comp)}
        />
      ))}
    </div>
  );
});
