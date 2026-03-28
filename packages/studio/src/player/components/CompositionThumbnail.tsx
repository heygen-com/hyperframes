/**
 * CompositionThumbnail — Film-strip of server-rendered JPEG thumbnails.
 *
 * Requests multiple thumbnails at different timestamps across the clip duration
 * and tiles them horizontally — like VideoThumbnail does for video clips.
 * Each frame is a separate <img> from /api/projects/:id/thumbnail/:path?t=X.
 *
 * Uses ResizeObserver to adapt frame count when the clip width changes (zoom).
 */

import { memo, useRef, useState, useCallback } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

const CLIP_HEIGHT = 66;
const MAX_UNIQUE_FRAMES = 6;

interface CompositionThumbnailProps {
  previewUrl: string;
  label: string;
  labelColor: string;
  seekTime?: number;
  duration?: number;
  width?: number;
  height?: number;
}

export const CompositionThumbnail = memo(function CompositionThumbnail({
  previewUrl,
  label,
  labelColor,
  seekTime = 0.4,
  duration = 5,
  width = 1920,
  height = 1080,
}: CompositionThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;

    // Walk up to data-clip parent for accurate width
    let target: HTMLElement = el;
    let parent = el.parentElement;
    let depth = 0;
    while (parent && !parent.hasAttribute("data-clip") && depth < 5) {
      parent = parent.parentElement;
      depth++;
    }
    if (parent?.hasAttribute("data-clip")) target = parent;

    requestAnimationFrame(() => {
      const w = target.clientWidth || target.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(w);
    });

    roRef.current = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    roRef.current.observe(target);
  }, []);

  useMountEffect(() => () => {
    roRef.current?.disconnect();
  });

  // Convert preview URL to thumbnail base URL
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");

  // Calculate frame layout
  const aspect = width / height;
  const frameW = Math.round(CLIP_HEIGHT * aspect);
  const frameCount = containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / frameW)) : 1;
  const uniqueFrames = Math.min(frameCount, MAX_UNIQUE_FRAMES);

  // Each frame tile represents a real position in the clip.
  // Offset slightly (0.5s) into each segment to avoid landing on transition
  // points where content is invisible due to fade-in/fade-out animations.
  const timestamps: number[] = [];
  const pad = Math.min(0.5, duration * 0.05);
  for (let i = 0; i < uniqueFrames; i++) {
    const frac = uniqueFrames === 1 ? 0.5 : i / (uniqueFrames - 1);
    const raw = seekTime + frac * duration;
    // Clamp to [pad, duration - pad] to stay inside visible content
    timestamps.push(seekTime + Math.max(pad, Math.min(duration - pad, raw - seekTime)));
  }

  return (
    <div ref={setRef} className="absolute inset-0 overflow-hidden bg-neutral-950">
      {/* Film strip — each tile maps to its real timeline position */}
      <div className="absolute inset-0 flex">
        {Array.from({ length: frameCount }).map((_, i) => {
          // Map this tile's visual position to a timestamp
          const tileFrac = frameCount === 1 ? 0.5 : i / (frameCount - 1);
          const t = seekTime + tileFrac * duration;
          // Use the nearest cached unique frame
          const uniqueIdx = Math.min(Math.round(tileFrac * (uniqueFrames - 1)), uniqueFrames - 1);
          const cachedT = timestamps[uniqueIdx];
          const url = `${thumbnailBase}?t=${(cachedT ?? t).toFixed(2)}`;
          return (
            <div
              key={i}
              className="flex-shrink-0 h-full relative overflow-hidden bg-neutral-900"
              style={{ width: frameW }}
            >
              <img
                src={url}
                alt=""
                draggable={false}
                loading="lazy"
                onLoad={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "1";
                }}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ opacity: 0, transition: "opacity 200ms ease-out" }}
              />
            </div>
          );
        })}
      </div>

      {/* Label */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 px-1.5 pb-0.5 pt-3"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
        }}
      >
        <span
          className="text-[9px] font-semibold truncate block leading-tight"
          style={{ color: labelColor, textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
});
