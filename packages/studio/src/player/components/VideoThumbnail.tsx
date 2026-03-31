import { memo, useRef, useState, useCallback, useEffect } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

interface VideoThumbnailProps {
  videoSrc: string;
  label: string;
  labelColor: string;
  duration?: number;
}

const CLIP_HEIGHT = 66;
const MAX_UNIQUE_FRAMES: number = 6;

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
  const [containerWidth, setContainerWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [aspect, setAspect] = useState(16 / 9);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const extractingRef = useRef(false);

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

  // Extract frames progressively — each frame appears as soon as it's ready.
  // Note: useEffect with deps is acceptable — syncs with external video element API,
  // requires cleanup (cancel extraction, revoke URLs) when inputs change.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!visible || extractingRef.current) return;
    extractingRef.current = true;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      extractingRef.current = false;
      return;
    }

    const timestamps: number[] = [];
    const minSeek = Math.min(0.4, duration * 0.05);
    for (let i = 0; i < MAX_UNIQUE_FRAMES; i++) {
      const raw =
        MAX_UNIQUE_FRAMES === 1 ? duration * 0.15 : (i / (MAX_UNIQUE_FRAMES - 1)) * duration;
      timestamps.push(Math.max(raw, minSeek));
    }

    let idx = 0;
    let cancelled = false;

    const extractNext = () => {
      if (cancelled || idx >= timestamps.length) {
        if (!cancelled) {
          video.src = "";
          video.load();
        }
        return;
      }
      video.currentTime = timestamps[idx];
    };

    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setAspect(video.videoWidth / video.videoHeight);
        const h = CLIP_HEIGHT * 2;
        const w = Math.round(h * (video.videoWidth / video.videoHeight));
        canvas.width = w;
        canvas.height = h;
      }
      extractNext();
    });

    video.addEventListener("seeked", () => {
      if (cancelled) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      // Stream each frame immediately
      setFrames((prev) => [...prev, dataUrl]);
      idx++;
      extractNext();
    });

    video.addEventListener("error", () => {
      /* keep whatever frames we have */
    });

    video.src = videoSrc;
    video.load();

    return () => {
      cancelled = true;
      extractingRef.current = false;
      setFrames([]);
      video.src = "";
      video.load();
    };
  }, [visible, videoSrc, duration]);

  const frameW = Math.round(CLIP_HEIGHT * aspect);
  const frameCount = containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / frameW)) : 1;

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

      {visible && frames.length === 0 && (
        <div
          className="absolute inset-0 animate-pulse"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
          }}
        />
      )}

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
