import { memo, useRef, useState, useCallback, useEffect } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { computeThumbnailStrip } from "./thumbnailUtils";

interface ImageThumbnailProps {
  imageSrc: string;
  label: string;
  labelColor: string;
}

/**
 * Renders a film-strip of a still image for a timeline clip. The image is a
 * fixed-width tile (sized by its natural aspect ratio) repeated to fill the
 * clip width — matching VideoThumbnail's visual pattern. Loading is lazy
 * (IntersectionObserver) with the same shimmer fallback while decoding.
 */
export const ImageThumbnail = memo(function ImageThumbnail({
  imageSrc,
  label,
  labelColor,
}: ImageThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [aspect, setAspect] = useState(16 / 9);
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

  // Probe the image once visible — measures the natural aspect ratio so the
  // tile width matches, and flips to the error state (plain clip background)
  // if the src can't load. The browser cache makes the tile <img>s free.
  //
  // SVG handling: SVGs without intrinsic width/height report naturalWidth=0 on
  // load (treat as success with the 16:9 default aspect) and may fire onerror
  // in some environments even though the file is valid and can be displayed —
  // fall back to loaded-at-16:9 rather than hiding the strip entirely.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStatus("loading");

    const isSvg = /\.svg($|\?)/i.test(imageSrc);

    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setAspect(probe.naturalWidth / probe.naturalHeight);
      }
      // naturalWidth===0 (e.g. SVG with no intrinsic dimensions) falls through
      // to "loaded" with the default 16:9 aspect already set in state.
      setStatus("loaded");
    };
    probe.onerror = () => {
      if (cancelled) return;
      // SVGs can fail the probe in certain browser/sandbox environments even
      // though the <img> tiles themselves render fine (different security
      // context). Show the strip at the 16:9 fallback rather than blanking.
      if (isSvg) {
        setStatus("loaded");
      } else {
        setStatus("error");
      }
    };
    probe.src = imageSrc;

    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
      probe.src = "";
    };
  }, [visible, imageSrc]);

  const { frameW, frameCount } = computeThumbnailStrip(containerWidth, aspect);

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      {visible && status === "loaded" && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 h-full relative overflow-hidden bg-neutral-900"
              style={{ width: frameW }}
            >
              <img
                src={imageSrc}
                alt=""
                draggable={false}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      )}

      {visible && status === "loading" && (
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
