/**
 * CompositionThumbnail — Film-strip of server-rendered JPEG thumbnails.
 *
 * Requests multiple thumbnails at different timestamps across the clip duration
 * and tiles them horizontally — like VideoThumbnail does for video clips.
 * Each frame is a separate <img> from /api/projects/:id/thumbnail/:path?t=X.
 *
 * Lazy-loaded via IntersectionObserver. Uses ResizeObserver to adapt frame count
 * when the clip width changes (zoom).
 */

import { memo, useRef, useState, useCallback, useEffect } from "react";

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
  const [visible, setVisible] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadedFrames, setLoadedFrames] = useState<Set<number>>(new Set());
  const ioRef = useRef<IntersectionObserver | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    ioRef.current?.disconnect();
    roRef.current?.disconnect();
    if (!el) return;

    // Walk up to data-clip parent for accurate width
    let target: HTMLElement = el;
    let parent = el.parentElement;
    while (parent && !parent.hasAttribute("data-clip")) parent = parent.parentElement;
    if (parent) target = parent;

    requestAnimationFrame(() => {
      const w = target.clientWidth || target.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(w);
    });

    ioRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          ioRef.current?.disconnect();
          requestAnimationFrame(() => {
            const w = target.clientWidth || target.getBoundingClientRect().width;
            if (w > 0) setContainerWidth(w);
          });
        }
      },
      { rootMargin: "300px" },
    );
    ioRef.current.observe(el);

    roRef.current = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    roRef.current.observe(target);
  }, []);

  useEffect(
    () => () => {
      ioRef.current?.disconnect();
      roRef.current?.disconnect();
    },
    [],
  );

  // Convert preview URL to thumbnail base URL
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");

  // Calculate frame layout
  const aspect = width / height;
  const frameW = Math.round(CLIP_HEIGHT * aspect);
  const frameCount = containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / frameW)) : 1;
  const uniqueFrames = Math.min(frameCount, MAX_UNIQUE_FRAMES);

  // Generate timestamps spread across the clip duration.
  // Start at 30% into the scene to skip entrance animations (opacity:0 → 1).
  // End at 90% to avoid catching exit animations.
  const timestamps: number[] = [];
  const startOffset = duration * 0.3;
  const endOffset = duration * 0.9;
  const range = endOffset - startOffset;
  for (let i = 0; i < uniqueFrames; i++) {
    const frac = uniqueFrames === 1 ? 0 : i / (uniqueFrames - 1);
    timestamps.push(seekTime + startOffset + frac * range);
  }

  const hasAnyFrame = loadedFrames.size > 0;

  return (
    <div ref={setRef} className="absolute inset-0 overflow-hidden bg-neutral-950">
      {/* Film strip */}
      {visible && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }).map((_, i) => {
            const uniqueIdx = i % uniqueFrames;
            const t = timestamps[uniqueIdx];
            const url = `${thumbnailBase}?t=${t.toFixed(2)}`;
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
                  onLoad={() => setLoadedFrames((prev) => new Set(prev).add(uniqueIdx))}
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{
                    opacity: loadedFrames.has(uniqueIdx) ? 1 : 0,
                    transition: "opacity 200ms ease-out",
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Shimmer while loading */}
      {(!visible || !hasAnyFrame) && (
        <div
          className="absolute inset-0 animate-pulse"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
          }}
        />
      )}

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
