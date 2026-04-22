import { memo, useCallback, useState, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

interface CompositionThumbnailProps {
  previewUrl: string;
  label: string;
  labelColor: string;
  accentColor?: string;
  selector?: string;
  seekTime?: number;
  duration?: number;
  width?: number;
  height?: number;
}

const CLIP_HEIGHT = 66;
const THUMBNAIL_URL_VERSION = "v2";

export const CompositionThumbnail = memo(function CompositionThumbnail({
  previewUrl,
  label,
  labelColor,
  accentColor = "#6B7280",
  selector,
  seekTime = 2,
  duration = 5,
}: CompositionThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [aspect, setAspect] = useState(16 / 9);
  const roRef = useRef<ResizeObserver | null>(null);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;

    const measured = el.parentElement?.clientWidth || el.clientWidth;
    setContainerWidth(measured);

    const target = el.parentElement || el;
    roRef.current = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    roRef.current.observe(target);
  }, []);

  useMountEffect(() => () => {
    roRef.current?.disconnect();
  });

  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");
  const midTime = seekTime + duration / 2;
  const thumbnailUrl = new URL(thumbnailBase, window.location.origin);
  thumbnailUrl.searchParams.set("t", midTime.toFixed(2));
  thumbnailUrl.searchParams.set("v", THUMBNAIL_URL_VERSION);
  if (selector) thumbnailUrl.searchParams.set("selector", selector);
  const url = thumbnailUrl.toString();
  const frameW = Math.max(48, Math.round(CLIP_HEIGHT * aspect));
  const frameCount = containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / frameW)) : 1;

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      <img
        src={url}
        alt=""
        draggable={false}
        loading="lazy"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setAspect(img.naturalWidth / img.naturalHeight);
          }
          setLoaded(true);
        }}
        className="hidden"
      />

      {loaded ? (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }).map((_, i) => (
            <div
              key={i}
              className="relative h-full flex-shrink-0 overflow-hidden"
              style={{ width: frameW }}
            >
              <img
                src={url}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover opacity-60"
              />
            </div>
          ))}
        </div>
      ) : (
        <div
          className="absolute inset-0 animate-pulse"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
          }}
        />
      )}

      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(120deg, ${accentColor}2e, transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.08))`,
        }}
      />

      <div className="absolute left-2 top-2 z-10">
        <span
          className="block max-w-full truncate rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none"
          style={{
            color: labelColor,
            background: `${accentColor}2e`,
            boxShadow: `inset 0 0 0 1px ${accentColor}40`,
          }}
        >
          {label}
        </span>
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 z-10 px-1.5 pb-0.5 pt-3"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
        }}
      >
        <span
          className="block truncate text-[9px] font-semibold leading-tight"
          style={{ color: labelColor, textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
});
