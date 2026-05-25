import { memo, useCallback, useState, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

interface CompositionThumbnailProps {
  previewUrl: string;
  label: string;
  labelColor: string;
  selector?: string;
  selectorIndex?: number;
  seekTime?: number;
  duration?: number;
  width?: number;
  height?: number;
}

const CLIP_HEIGHT = 66;
const THUMBNAIL_URL_VERSION = "v3";

export function buildCompositionThumbnailUrl({
  previewUrl,
  seekTime = 2,
  duration = 5,
  selector,
  selectorIndex,
  origin,
}: {
  previewUrl: string;
  seekTime?: number;
  duration?: number;
  selector?: string;
  selectorIndex?: number;
  origin: string;
}): string {
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");
  const midTime = seekTime + duration / 2;
  const thumbnailUrl = new URL(thumbnailBase, origin);
  thumbnailUrl.searchParams.set("t", midTime.toFixed(2));
  thumbnailUrl.searchParams.set("v", THUMBNAIL_URL_VERSION);
  if (selector) {
    thumbnailUrl.searchParams.set("selector", selector);
    if (selectorIndex != null && selectorIndex > 0) {
      thumbnailUrl.searchParams.set("selectorIndex", String(selectorIndex));
    }
  }
  return thumbnailUrl.toString();
}

export const CompositionThumbnail = memo(function CompositionThumbnail({
  previewUrl,
  label,
  labelColor,
  selector,
  selectorIndex,
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

  const url = buildCompositionThumbnailUrl({
    previewUrl,
    seekTime,
    duration,
    selector,
    selectorIndex,
    origin: window.location.origin,
  });
  const frameW = Math.max(48, Math.round(CLIP_HEIGHT * aspect));
  const frameCount = containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / frameW)) : 1;

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      <img
        src={url}
        alt=""
        draggable={false}
        loading="eager"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setAspect(img.naturalWidth / img.naturalHeight);
          }
          setLoaded(true);
        }}
        className="hidden"
      />

      {loaded && (
        <div
          className="absolute inset-0 flex"
          style={{ animation: "hf-thumb-fade 200ms ease-out", mixBlendMode: "lighten" }}
        >
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
                className="absolute inset-0 h-full w-full object-cover"
                style={{ opacity: 0.7 }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="absolute left-3 top-0 bottom-0 flex items-center" style={{ zIndex: 10 }}>
        <span
          className="block max-w-full truncate text-[10px] font-semibold leading-none"
          style={{
            color: labelColor,
            textShadow: loaded ? "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" : "none",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
});
