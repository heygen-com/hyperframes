import { memo, useCallback, useEffect, useRef, useState } from "react";

interface CompositionsTabProps {
  projectId: string;
  compositions: string[];
  activeComposition: string | null;
  onSelect: (comp: string) => void;
  onRenderComposition?: (comp: string) => void;
  isRendering?: boolean;
  lintFindingsByFile?: Map<string, { count: number; messages: string[] }>;
}

const DEFAULT_PREVIEW_STAGE = { width: 1920, height: 1080 };
const CARD_W = 80;
const CARD_H = 45;
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

// fallow-ignore-next-line complexity
function resolveIframeDuration(iframe: HTMLIFrameElement | null): number | null {
  try {
    const win = iframe?.contentWindow as PreviewWindow | null;
    const playerDuration = win?.__player?.getDuration?.();
    if (Number.isFinite(playerDuration) && playerDuration != null && playerDuration > 0) {
      return playerDuration;
    }
  } catch {
    /* cross-origin iframe */
  }

  try {
    const doc = iframe?.contentDocument;
    const root = doc?.querySelector("[data-composition-id]") ?? doc?.documentElement ?? null;
    return (
      parsePositiveNumber(root?.getAttribute("data-composition-duration") ?? null) ??
      parsePositiveNumber(root?.getAttribute("data-duration") ?? null)
    );
  } catch {
    return null;
  }
}

function syncIframePlayback(iframe: HTMLIFrameElement | null, shouldPlay: boolean): boolean {
  try {
    const player = (iframe?.contentWindow as PreviewWindow | null)?.__player;
    if (!player) return false;

    if (shouldPlay) {
      player.play?.();
      return true;
    }

    player.pause?.();
    player.seek?.(resolveThumbnailSeekTime(resolveIframeDuration(iframe)));
    return true;
  } catch {
    return false;
  }
}

function CompCard({
  projectId,
  comp,
  isActive,
  onSelect,
  onRender,
  isRendering,
  lintInfo,
}: {
  projectId: string;
  comp: string;
  isActive: boolean;
  onSelect: () => void;
  onRender?: () => void;
  isRendering?: boolean;
  lintInfo?: { count: number; messages: string[] };
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
    cardWidth: CARD_W,
    cardHeight: CARD_H,
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
  });
  const thumbnailOffsetX = (CARD_W - stageSize.width * previewScale) / 2;
  const thumbnailOffsetY = (CARD_H - stageSize.height * previewScale) / 2;

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
      className={`group/card w-full text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
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
          className="absolute border-none pointer-events-none"
          style={{
            transformOrigin: "0 0",
            width: stageSize.width,
            height: stageSize.height,
            left: thumbnailOffsetX,
            top: thumbnailOffsetY,
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
      <div
        className="min-w-0 flex-1"
        title={lintInfo && lintInfo.count > 0 ? lintInfo.messages.join("\n") : undefined}
      >
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-neutral-300 truncate">{name}</span>
          {lintInfo && lintInfo.count > 0 && (
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-400" />
          )}
        </div>
        <span className="text-[9px] text-neutral-600 truncate block">{comp}</span>
      </div>
      {onRender && (
        <button
          type="button"
          title={isRendering ? "Rendering..." : `Render ${name}`}
          aria-label={isRendering ? "Rendering..." : `Render ${name}`}
          disabled={isRendering}
          onClick={(e) => {
            e.stopPropagation();
            onRender();
          }}
          className={`flex-shrink-0 p-1 rounded transition-colors ${
            isRendering
              ? "text-neutral-600 cursor-not-allowed"
              : "text-neutral-600 hover:text-studio-accent hover:bg-neutral-800"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      )}
    </div>
  );
}

export const CompositionsTab = memo(function CompositionsTab({
  projectId,
  compositions,
  activeComposition,
  onSelect,
  onRenderComposition,
  isRendering,
  lintFindingsByFile,
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
          onRender={onRenderComposition ? () => onRenderComposition(comp) : undefined}
          isRendering={isRendering}
          lintInfo={lintFindingsByFile?.get(comp)}
        />
      ))}
    </div>
  );
});
