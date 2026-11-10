import { buildProjectApiPath } from "../../utils/projectRouting";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import {
  thumbnailScheduler,
  type ThumbnailRequest,
  type ThumbnailSnapshot,
} from "../../player/lib/thumbnailScheduler";
import {
  buildCompositionThumbnailUrl,
  compositionThumbnailRequest,
  THUMBNAIL_SEEK_TIME_SECONDS,
} from "../../player/components/CompositionThumbnail";
import { setPreviewMediaMuted } from "../../player/lib/timelineIframeHelpers";
import { postFrameDisplayScale, postRuntimeControlMessage } from "../../player/lib/runtimeProtocol";
import { usePlayerStore } from "../../player/store/playerStore";
import { thumbnailRevisionOf } from "../../player/store/thumbnailSlice";
import { encodePreviewPath } from "../../player/components/thumbnailUtils";
import { TIMELINE_COMPOSITION_MIME } from "../../utils/timelineCompositionDrop";
import { Tooltip } from "../ui/Tooltip";

interface CompositionsTabProps {
  projectId: string;
  compositions: string[];
  activeComposition: string | null;
  /** The project's root composition (same value App.tsx auto-opens on load), or null if none. */
  masterCompositionPath?: string | null;
  onSelect: (comp: string) => void;
  onRenderComposition?: (comp: string) => void;
  onAddToTimeline?: (comp: string) => void;
  isRendering?: boolean;
  lintFindingsByFile?: Map<string, { count: number; messages: string[] }>;
}

const DEFAULT_PREVIEW_STAGE = { width: 1920, height: 1080 };
const CARD_W = 80;
const CARD_H = 45;

const OPAQUE_ORIGIN_SCRIPTS_ONLY_SANDBOX = "allow-scripts";

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

function compositionPreviewUrl(projectId: string, comp: string): string {
  return buildProjectApiPath(projectId, `/preview/comp/${encodePreviewPath(comp)}`);
}

export function compositionCardThumbnailUrl(
  projectId: string,
  comp: string,
  contentRevision: number,
): string {
  return buildCompositionThumbnailUrl({
    previewUrl: compositionPreviewUrl(projectId, comp),
    seekTime: THUMBNAIL_SEEK_TIME_SECONDS,
    duration: 0,
    origin: window.location.origin,
    contentRevision,
  });
}

function positiveDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stageSizeFromRuntimeTimelineMessage(
  data: unknown,
): { width: number; height: number } | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.source !== "hf-preview" || message.type !== "timeline") return null;
  return {
    width: positiveDimension(message.compositionWidth, DEFAULT_PREVIEW_STAGE.width),
    height: positiveDimension(message.compositionHeight, DEFAULT_PREVIEW_STAGE.height),
  };
}

function muteThenPlayOverRuntimeBridge(iframe: HTMLIFrameElement | null): void {
  if (!iframe) return;
  setPreviewMediaMuted(iframe, true);
  postRuntimeControlMessage(iframe.contentWindow, "play");
}

const imageUrlOf = (snapshot: ThumbnailSnapshot) =>
  snapshot.status === "ready" && snapshot.value.kind === "image" ? snapshot.value.url : null;

// A layout effect takes the old frame's lease before the passive cleanup drops the first one.
function useLastFrame(request: ThumbnailRequest | null, snapshot: ThumbnailSnapshot) {
  const current = imageUrlOf(snapshot);
  const [kept, setKept] = useState<{ request: ThumbnailRequest; url: string } | null>(null);
  if (request && current && kept?.request !== request) setKept({ request, url: current });
  useLayoutEffect(() => {
    if (!kept || kept.request === request) return;
    const lease = thumbnailScheduler.acquire(kept.request, () => {});
    return () => lease.release();
  }, [kept, request]);
  return current ?? kept?.url ?? null;
}

function useNearViewport<T extends Element>(): [(element: T | null) => void, boolean] {
  const [element, setElement] = useState<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!element || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && setNear(true),
      { root: element.closest("[data-composition-list]"), rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, near]);
  return [setElement, near];
}

function CompCard({
  projectId,
  comp,
  isActive,
  isRoot,
  onSelect,
  onRender,
  isRendering,
  lintInfo,
  onAddToTimeline,
  contentRevision,
  previewBooted,
}: {
  projectId: string;
  comp: string;
  isActive: boolean;
  isRoot: boolean;
  onSelect: () => void;
  onRender?: () => void;
  isRendering?: boolean;
  lintInfo?: { count: number; messages: string[] };
  onAddToTimeline?: () => void;
  contentRevision: number;
  previewBooted: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [stageSize, setStageSize] = useState(DEFAULT_PREVIEW_STAGE);
  const [livePreviewLoaded, setLivePreviewLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggedRef = useRef(false);

  const handleEnter = () => {
    hoverTimer.current = setTimeout(() => setHovered(true), 300);
  };
  const handleLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(false);
    setLivePreviewLoaded(false);
  };
  const name = comp.replace(/^compositions\//, "").replace(/\.html$/, "");
  const previewUrl = compositionPreviewUrl(projectId, comp);
  const thumbnailUrl = compositionCardThumbnailUrl(projectId, comp, contentRevision);
  const [thumbnailBox, nearViewport] = useNearViewport<HTMLDivElement>();
  const timelineSessionEpoch = usePlayerStore((state) => state.timelineSessionEpoch);
  const thumbnailRequest = useMemo(
    () =>
      previewBooted && nearViewport
        ? compositionThumbnailRequest(thumbnailUrl, projectId, {
            sessionEpoch: timelineSessionEpoch,
            rich: true,
          })
        : null,
    [previewBooted, nearViewport, thumbnailUrl, projectId, timelineSessionEpoch],
  );
  const thumbnail = useThumbnailLease(thumbnailRequest);
  const frameUrl = useLastFrame(thumbnailRequest, thumbnail);
  const thumbnailFailed = thumbnail.status === "error";
  const previewScale = resolveCompositionPreviewScale({
    cardWidth: CARD_W,
    cardHeight: CARD_H,
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
  });
  const thumbnailOffsetX = (CARD_W - stageSize.width * previewScale) / 2;
  const thumbnailOffsetY = (CARD_H - stageSize.height * previewScale) / 2;

  useEffect(() => {
    if (livePreviewLoaded) postFrameDisplayScale(iframeRef.current);
  }, [livePreviewLoaded, previewScale]);

  useEffect(() => {
    if (!hovered) return;
    const onRuntimeMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const runtimeControlListenerInstalled =
        event.data?.source === "hf-preview" && event.data.type === "ready";
      if (runtimeControlListenerInstalled) {
        postFrameDisplayScale(frame);
        muteThenPlayOverRuntimeBridge(frame);
        return;
      }
      const stage = stageSizeFromRuntimeTimelineMessage(event.data);
      if (!stage) return;
      setStageSize((current) =>
        current.width === stage.width && current.height === stage.height ? current : stage,
      );
    };
    window.addEventListener("message", onRuntimeMessage);
    return () => window.removeEventListener("message", onRuntimeMessage);
  }, [hovered]);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-label={`Open composition ${name}`}
      aria-pressed={isActive}
      onDragStart={(event) => {
        draggedRef.current = true;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(TIMELINE_COMPOSITION_MIME, JSON.stringify({ sourcePath: comp }));
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (!draggedRef.current) onSelect();
      }}
      onKeyDown={(event) => {
        // Only when the row itself is focused — keydowns bubbling from the
        // inner controls (play button) must keep their native activation.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      className={`group/card w-full select-none text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-grab active:cursor-grabbing outline-hidden focus-visible:bg-neutral-800/60 ${
        isActive
          ? "bg-studio-accent/10 border-l-2 border-studio-accent"
          : "border-l-2 border-transparent hover:bg-neutral-800/50"
      }`}
    >
      <div
        ref={thumbnailBox}
        className="w-20 h-[45px] rounded-sm overflow-hidden bg-neutral-900 shrink-0 relative"
      >
        {thumbnailFailed ? (
          <div className="absolute inset-0 flex items-center justify-center px-1 text-center text-[8px] leading-tight text-neutral-600">
            Preview unavailable
          </div>
        ) : !frameUrl ? null : (
          <img
            src={frameUrl}
            alt=""
            draggable={false}
            decoding="async"
            className={`absolute inset-0 h-full w-full object-contain transition-opacity ${
              livePreviewLoaded ? "opacity-0" : "opacity-100"
            }`}
          />
        )}
        {hovered && (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            sandbox={OPAQUE_ORIGIN_SCRIPTS_ONLY_SANDBOX}
            className="absolute border-none pointer-events-none"
            style={{
              transformOrigin: "0 0",
              width: stageSize.width,
              height: stageSize.height,
              left: thumbnailOffsetX,
              top: thumbnailOffsetY,
              transform: `scale(${previewScale})`,
            }}
            onLoad={() => setLivePreviewLoaded(true)}
            title={`${name} preview`}
            tabIndex={-1}
          />
        )}
      </div>
      <div
        className="min-w-0 flex-1"
        title={lintInfo && lintInfo.count > 0 ? lintInfo.messages.join("\n") : undefined}
      >
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-neutral-300 truncate">{name}</span>
          {isRoot && (
            <span
              aria-label="Root composition: opens automatically on load"
              title="Root composition: opens automatically on load"
              className="flex-shrink-0 rounded-full bg-neutral-700/60 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-neutral-300"
            >
              Root
            </span>
          )}
          {lintInfo && lintInfo.count > 0 && (
            <span
              aria-label={`${lintInfo.count} lint finding${lintInfo.count === 1 ? "" : "s"}`}
              className="shrink-0 min-w-[16px] text-center rounded-full bg-amber-500/20 px-1 text-[8px] font-bold text-warning-ink"
            >
              {lintInfo.count}
            </span>
          )}
        </div>
        <span className="text-[9px] text-neutral-600 truncate block">{comp}</span>
      </div>
      {onAddToTimeline && (
        <button
          type="button"
          title={`Add ${name} to timeline at playhead`}
          aria-label={`Add ${name} to timeline at playhead`}
          onClick={(event) => {
            event.stopPropagation();
            onAddToTimeline();
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-neutral-600 opacity-0 transition-[color,background-color,opacity] hover:bg-neutral-800 hover:text-accent-ink group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus:opacity-100"
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
      {onRender && (
        <Tooltip label={isRendering ? "A render is already in progress" : `Render ${name}`}>
          <button
            type="button"
            aria-label={isRendering ? "A render is already in progress" : `Render ${name}`}
            disabled={isRendering}
            onClick={(e) => {
              e.stopPropagation();
              onRender();
            }}
            // h-6 w-6 = the 24x24 WCAG 2.2 (2.5.8) minimum target; the 14px glyph
            // is unchanged, only the box grows. The sibling "+" button is h-8 w-8,
            // so the card row already has the room.
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
              isRendering
                ? "text-neutral-600 cursor-not-allowed"
                : "text-neutral-600 hover:text-accent-ink hover:bg-neutral-800"
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
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export const CompositionsTab = memo(function CompositionsTab({
  projectId,
  compositions,
  activeComposition,
  masterCompositionPath = null,
  onSelect,
  onRenderComposition,
  onAddToTimeline,
  isRendering,
  lintFindingsByFile,
}: CompositionsTabProps) {
  const thumbnailRevisions = usePlayerStore((state) => state.thumbnailRevisions);
  const previewBooted = usePlayerStore((state) => state.previewBooted);
  if (compositions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-neutral-600 text-center">No compositions found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" data-composition-list>
      {compositions.map((comp) => (
        <CompCard
          key={`${projectId}:${comp}`}
          projectId={projectId}
          comp={comp}
          isActive={activeComposition === comp}
          isRoot={comp === masterCompositionPath}
          onSelect={() => onSelect(comp)}
          onRender={onRenderComposition ? () => onRenderComposition(comp) : undefined}
          onAddToTimeline={onAddToTimeline ? () => onAddToTimeline(comp) : undefined}
          isRendering={isRendering}
          lintInfo={lintFindingsByFile?.get(comp)}
          contentRevision={thumbnailRevisionOf(thumbnailRevisions, comp)}
          previewBooted={previewBooted}
        />
      ))}
    </div>
  );
});
