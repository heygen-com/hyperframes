import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import {
  createThumbnailKey,
  type ThumbnailPriority,
  type ThumbnailSnapshot,
} from "../lib/thumbnailScheduler";
import { decodeVideoThumbnail } from "../lib/thumbnailVideoDecoder";
import {
  computeThumbnailStrip,
  quantizeThumbnailFrameCount,
  THUMBNAIL_CLIP_HEIGHT,
} from "./thumbnailUtils";

interface VideoThumbnailProps {
  videoSrc: string;
  label: string;
  labelColor: string;
  duration?: number;
  sourceStart?: number;
  sourceRangeDuration?: number;
  projectId?: string;
  sessionEpoch?: number;
  priority?: ThumbnailPriority;
}

function createVideoThumbnailRequest(
  props: Pick<VideoThumbnailProps, "videoSrc" | "sourceStart" | "sourceRangeDuration"> &
    Required<Pick<VideoThumbnailProps, "duration" | "projectId" | "sessionEpoch" | "priority">>,
  frameCount: number,
  rich: boolean,
) {
  const {
    videoSrc,
    sourceStart,
    sourceRangeDuration,
    duration,
    projectId,
    sessionEpoch,
    priority,
  } = props;
  return {
    key: createThumbnailKey({
      kind: "video",
      source: videoSrc,
      start: sourceStart,
      duration: sourceRangeDuration ?? duration,
      frames: frameCount,
    }),
    projectId,
    sessionEpoch,
    kind: "video" as const,
    priority,
    rich,
    load: (signal: AbortSignal) =>
      decodeVideoThumbnail(
        {
          source: videoSrc,
          sourceStart,
          sourceRangeDuration: sourceRangeDuration ?? duration,
          frameCount,
          fit: "cover",
        },
        signal,
      ),
  };
}

function selectThumbnailSnapshot(
  poster: ThumbnailSnapshot,
  rich: ThumbnailSnapshot,
): ThumbnailSnapshot {
  if (rich.status === "ready") return rich;
  if (poster.status === "ready") return poster;
  if (rich.status === "loading" || poster.status === "loading") return { status: "loading" };
  return poster;
}

/** Sparse, bounded video frames supplied by the shared thumbnail scheduler. */
export const VideoThumbnail = memo(function VideoThumbnail({
  videoSrc,
  label,
  labelColor,
  duration = 5,
  sourceStart,
  sourceRangeDuration,
  projectId = videoSrc,
  sessionEpoch = 0,
  priority = "visible",
}: VideoThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const requestFrameCount = quantizeThumbnailFrameCount(
    computeThumbnailStrip(containerWidth, 16 / 9).frameCount,
  );
  const requestProps = useMemo(
    () => ({
      videoSrc,
      sourceStart,
      sourceRangeDuration,
      duration,
      projectId,
      sessionEpoch,
      priority,
    }),
    [duration, priority, projectId, sessionEpoch, sourceRangeDuration, sourceStart, videoSrc],
  );
  const posterRequest = useMemo(
    () => createVideoThumbnailRequest(requestProps, 1, false),
    [requestProps],
  );
  const richRequest = useMemo(
    () => createVideoThumbnailRequest(requestProps, requestFrameCount, true),
    [requestFrameCount, requestProps],
  );
  const measured = containerWidth > 0;
  const posterSnapshot = useThumbnailLease(measured ? posterRequest : null);
  const richSnapshot = useThumbnailLease(measured && requestFrameCount > 1 ? richRequest : null);
  const snapshot = selectThumbnailSnapshot(posterSnapshot, richSnapshot);
  const value = snapshot.status === "ready" ? snapshot.value : null;
  const urls =
    value?.kind === "filmstrip" ? value.urls : value?.kind === "image" ? [value.url] : [];
  const aspect = value?.kind === "image" || value?.kind === "filmstrip" ? value.aspect : 16 / 9;
  const { frameW, frameCount } = computeThumbnailStrip(
    containerWidth,
    aspect,
    THUMBNAIL_CLIP_HEIGHT,
  );

  const setContainerRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!element) return;
    const target = element.parentElement ?? element;
    setContainerWidth(target.clientWidth);
    observerRef.current = new ResizeObserver(([entry]) =>
      setContainerWidth(entry.contentRect.width),
    );
    observerRef.current.observe(target);
  }, []);

  useMountEffect(() => () => observerRef.current?.disconnect());

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      {urls.length > 0 && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }, (_, index) => {
            const src = urls[index % urls.length];
            return (
              <div
                key={index}
                className="relative h-full shrink-0 overflow-hidden bg-neutral-900"
                style={{ width: frameW }}
              >
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            );
          })}
        </div>
      )}
      {snapshot.status === "loading" && urls.length === 0 && (
        <div
          className="absolute inset-0 animate-pulse motion-reduce:animate-none"
          style={{
            background: "var(--timeline-thumbnail-shimmer)",
          }}
        />
      )}
      {snapshot.status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/60">
          <span className="rounded-sm bg-black/50 px-1 text-[8px] text-neutral-500">
            no preview
          </span>
        </div>
      )}
      {label && (
        <div
          className="absolute inset-x-0 bottom-0 z-10 px-1.5 pb-0.5 pt-3"
          style={{
            background: "var(--timeline-thumbnail-label-gradient)",
          }}
        >
          <span
            className="block truncate text-[9px] font-semibold leading-tight"
            style={{ color: labelColor, textShadow: "var(--timeline-thumbnail-label-shadow)" }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
