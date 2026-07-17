import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey, type ThumbnailPriority } from "../lib/thumbnailScheduler";
import { TIMELINE_VIEWPORT_BUDGETS } from "../lib/timelineViewportBudgets";
import { computeThumbnailStrip } from "./thumbnailUtils";

interface ImageThumbnailProps {
  imageSrc: string;
  label: string;
  labelColor: string;
  projectId: string;
  sessionEpoch: number;
  priority: ThumbnailPriority;
  rich: boolean;
}

function probeImage(imageSrc: string, signal: AbortSignal) {
  return new Promise<{ aspect: number }>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Aborted", "AbortError"));
    };
    image.onload = () => {
      cleanup();
      resolve({
        aspect:
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : 16 / 9,
      });
    };
    image.onerror = () => {
      cleanup();
      if (/\.svg($|\?)/i.test(imageSrc)) resolve({ aspect: 16 / 9 });
      else reject(new Error("Image thumbnail failed to load"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    image.src = imageSrc;
  });
}

/** A scheduler-backed still-image strip. Mounting is the sole work trigger. */
export const ImageThumbnail = memo(function ImageThumbnail({
  imageSrc,
  label,
  labelColor,
  projectId,
  sessionEpoch,
  priority,
  rich,
}: ImageThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const request = useMemo(
    () => ({
      key: createThumbnailKey({ kind: "image", source: imageSrc, rich: Number(rich) }),
      projectId,
      sessionEpoch,
      kind: "image" as const,
      priority,
      rich,
      load: async (signal: AbortSignal) => {
        const { aspect } = await probeImage(imageSrc, signal);
        return {
          value: { kind: "image" as const, url: imageSrc, aspect },
          weight:
            TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalWidth *
            TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalHeight *
            4,
        };
      },
    }),
    [imageSrc, priority, projectId, rich, sessionEpoch],
  );
  const snapshot = useThumbnailLease(request);
  const value = snapshot.status === "ready" ? snapshot.value : null;
  const aspect = value?.kind === "image" ? value.aspect : 16 / 9;
  const { frameW, frameCount } = computeThumbnailStrip(containerWidth, aspect);

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
      {value?.kind === "image" && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }, (_, index) => (
            <img
              key={index}
              src={value.url}
              alt=""
              draggable={false}
              className="h-full flex-shrink-0 object-cover"
              style={{ width: frameW }}
            />
          ))}
        </div>
      )}
      {snapshot.status === "loading" && (
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
