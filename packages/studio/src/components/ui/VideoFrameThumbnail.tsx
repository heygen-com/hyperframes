import { useState, useEffect, useMemo } from "react";
import {
  extractVideoFrames,
  mediaCacheKey,
  thumbnailResolver,
} from "../../player/lib/mediaResolver";

/** Seek to ~10% of the *source's* duration to avoid black opening frames. */
const posterTimestamps = (sourceDuration: number) => [Math.min(2, sourceDuration * 0.1 || 2)];

/**
 * Extracts a representative JPEG frame from a video URL, sharing the one
 * document-wide extractor and its cache with the timeline strip thumbnails.
 * Used by AssetThumbnail (assets tab) and RenderQueueItem (renders tab).
 */
export function VideoFrameThumbnail({
  src,
  fallbackLabel,
}: {
  src: string;
  /** Shown instead of an endless shimmer when the video can't be decoded. */
  fallbackLabel?: string;
}) {
  const cacheKey = useMemo(() => mediaCacheKey(src, "poster"), [src]);
  const [frame, setFrame] = useState<string | null>(
    () => thumbnailResolver.peek(cacheKey)?.frames[0] ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    let cancelled = false;
    thumbnailResolver
      .resolve(cacheKey, () => extractVideoFrames(src, posterTimestamps, { quality: 0.7 }))
      .then((result) => {
        if (!cancelled) setFrame(result.frames[0] ?? null);
      })
      .catch(() => {
        // Resolve the loading state — a permanent shimmer reads as "still loading".
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, cacheKey]);

  if (failed && !frame) {
    return (
      <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
        <span className="text-[9px] font-medium text-neutral-600">{fallbackLabel ?? "VIDEO"}</span>
      </div>
    );
  }

  if (!frame) {
    return (
      <div className="w-full h-full bg-neutral-800 animate-pulse motion-reduce:animate-none" />
    );
  }

  return <img src={frame} alt="" draggable={false} className="w-full h-full object-contain" />;
}
