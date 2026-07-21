import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey, type ThumbnailPriority } from "../lib/thumbnailScheduler";
import { decodeVideoThumbnail } from "../lib/thumbnailVideoDecoder";
import { computeThumbnailStrip, THUMBNAIL_CLIP_HEIGHT } from "./thumbnailUtils";

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
  rich?: boolean;
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
  rich = false,
}: VideoThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const request = useMemo(
    () => ({
      key: createThumbnailKey({
        kind: "video",
        source: videoSrc,
        start: sourceStart,
        duration: sourceRangeDuration ?? duration,
        frames: rich ? 6 : 1,
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
            frameCount: rich ? 6 : 1,
            fit: "cover",
          },
          signal,
        ),
    }),
    [duration, priority, projectId, rich, sessionEpoch, sourceRangeDuration, sourceStart, videoSrc],
  );
  const snapshot = useThumbnailLease(request);
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

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      {urls.length > 0 && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }, (_, index) => (
            <img
              key={index}
              src={urls[index % urls.length]}
              alt=""
              draggable={false}
              className="h-full flex-shrink-0 object-cover"
              style={{ width: frameW }}
            />
          ))}
        </div>
      )}
      {snapshot.status === "loading" && urls.length === 0 && (
        <div className="absolute inset-0 animate-pulse bg-white/[0.035]" />
      )}
      {label && (
        <div className="absolute inset-x-0 bottom-0 z-10 px-1.5 pb-0.5 pt-3">
          <span
            className="block truncate text-[9px] font-semibold leading-tight"
            style={{ color: labelColor }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
