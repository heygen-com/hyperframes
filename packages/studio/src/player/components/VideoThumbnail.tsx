import { memo, useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import {
  extractVideoFrames,
  mediaCacheKey,
  thumbnailResolver,
  type VideoFrames,
} from "../lib/mediaResolver";
import { computeThumbnailStrip, THUMBNAIL_CLIP_HEIGHT } from "./thumbnailUtils";

interface VideoThumbnailProps {
  videoSrc: string;
  label: string;
  labelColor: string;
  duration?: number;
}

const CLIP_HEIGHT = THUMBNAIL_CLIP_HEIGHT;
const MAX_UNIQUE_FRAMES: number = 6;
const EMPTY: VideoFrames = { frames: [], aspect: 16 / 9 };

/** Evenly spaced stops across the *clip's* duration, nudged off a black frame 0. */
function stripTimestamps(duration: number): number[] {
  const minSeek = Math.min(0.4, duration * 0.05);
  const stops: number[] = [];
  for (let i = 0; i < MAX_UNIQUE_FRAMES; i++) {
    const raw =
      MAX_UNIQUE_FRAMES === 1 ? duration * 0.15 : (i / (MAX_UNIQUE_FRAMES - 1)) * duration;
    stops.push(Math.max(raw, minSeek));
  }
  return stops;
}

/**
 * Renders a film-strip of video frames extracted client-side via a hidden
 * <video> + <canvas>. Each frame is a fixed-width tile; frames repeat to
 * fill the clip width — matching ClipThumbnail's visual pattern.
 */
export const VideoThumbnail = memo(function VideoThumbnail({
  videoSrc,
  label,
  labelColor,
  duration = 5,
}: VideoThumbnailProps) {
  // Keyed on (source, clip duration): two clips trimmed differently from one
  // source derive different timestamps and must not share an entry. Memoised so
  // scrub re-renders don't re-parse the URL.
  const cacheKey = useMemo(() => mediaCacheKey(videoSrc, "strip", duration), [videoSrc, duration]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [strip, setStrip] = useState<VideoFrames>(() => thumbnailResolver.peek(cacheKey) ?? EMPTY);
  const [failed, setFailed] = useState(false);
  const { frames, aspect } = strip;
  const ioRef = useRef<IntersectionObserver | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    ioRef.current?.disconnect();
    roRef.current?.disconnect();
    if (!el) return;

    const measured = el.parentElement?.clientWidth || el.clientWidth;
    setContainerWidth(measured);

    ioRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          ioRef.current?.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    // fallow-ignore-next-line code-duplication
    ioRef.current.observe(el);

    const target = el.parentElement || el;
    roRef.current = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    roRef.current.observe(target);
  }, []);

  useMountEffect(() => () => {
    ioRef.current?.disconnect();
    roRef.current?.disconnect();
  });

  // One extraction per (source, duration) across every mounted consumer; each
  // frame still appears as soon as it's ready, via the resolver's partials.
  // Note: useEffect with deps is acceptable — syncs with an external resolver,
  // requires cleanup (ignore late results) when inputs change.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    // Reset for the new inputs, seeding from cache so a re-mount or a re-keyed
    // clip doesn't flash the shimmer for frames we already hold.
    setStrip(thumbnailResolver.peek(cacheKey) ?? EMPTY);
    setFailed(false);

    const apply = (result: VideoFrames) => {
      if (!cancelled) setStrip(result);
    };

    thumbnailResolver
      .resolve(
        cacheKey,
        (emit) =>
          extractVideoFrames(
            videoSrc,
            stripTimestamps(duration),
            { frameHeight: CLIP_HEIGHT * 2, quality: 0.6 },
            emit,
          ),
        apply,
      )
      .then(apply)
      .catch(() => {
        // A tainted canvas or a no-CORS load failure yields no usable strip.
        // Mark failed so the shimmer stops spinning and the clip falls back to
        // its plain background (#2214) instead of loading forever.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, videoSrc, duration, cacheKey]);

  const { frameW, frameCount } = computeThumbnailStrip(containerWidth, aspect, CLIP_HEIGHT);

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      {visible && frames.length > 0 && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }).map((_, i) => {
            const src = frames[i % frames.length];
            return (
              <div
                key={i}
                className="flex-shrink-0 h-full relative overflow-hidden bg-neutral-900"
                style={{ width: frameW }}
              >
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
            );
          })}
        </div>
      )}

      {visible && frames.length === 0 && !failed && (
        <div
          className="absolute inset-0 animate-pulse"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
          }}
        />
      )}

      {label && (
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
      )}
    </div>
  );
});
