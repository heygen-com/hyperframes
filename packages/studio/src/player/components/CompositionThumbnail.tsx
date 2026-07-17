import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey, type ThumbnailPriority } from "../lib/thumbnailScheduler";
import { TIMELINE_VIEWPORT_BUDGETS } from "../lib/timelineViewportBudgets";

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
  projectId: string;
  sessionEpoch: number;
  priority: ThumbnailPriority;
  rich: boolean;
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
  const thumbnailUrl = new URL(thumbnailBase, origin);
  thumbnailUrl.searchParams.set("t", (seekTime + duration / 2).toFixed(2));
  thumbnailUrl.searchParams.set("v", THUMBNAIL_URL_VERSION);
  if (selector) {
    thumbnailUrl.searchParams.set("selector", selector);
    if (selectorIndex != null && selectorIndex > 0) {
      thumbnailUrl.searchParams.set("selectorIndex", String(selectorIndex));
    }
  }
  return thumbnailUrl.toString();
}

async function loadCompositionImage(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Composition thumbnail failed (${response.status})`);
  const blob = await response.blob();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const objectUrl = URL.createObjectURL(blob);
  return {
    value: { kind: "image" as const, url: objectUrl, aspect: 16 / 9 },
    weight:
      TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalWidth *
      TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalHeight *
      4,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
}

/** Server-rendered composition poster, deduplicated and budgeted by project/session. */
export const CompositionThumbnail = memo(function CompositionThumbnail({
  previewUrl,
  label,
  labelColor,
  selector,
  selectorIndex,
  seekTime = 2,
  duration = 5,
  projectId,
  sessionEpoch,
  priority,
}: CompositionThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const url = buildCompositionThumbnailUrl({
    previewUrl,
    seekTime,
    duration,
    selector,
    selectorIndex,
    origin: window.location.origin,
  });
  const request = useMemo(
    () => ({
      key: createThumbnailKey({ kind: "composition", url }),
      projectId,
      sessionEpoch,
      kind: "composition" as const,
      priority,
      rich: true,
      load: (signal: AbortSignal) => loadCompositionImage(url, signal),
    }),
    [priority, projectId, sessionEpoch, url],
  );
  const snapshot = useThumbnailLease(request);
  const value =
    snapshot.status === "ready" && snapshot.value.kind === "image" ? snapshot.value : null;
  const frameWidth = Math.max(48, Math.round(CLIP_HEIGHT * (value?.aspect ?? 16 / 9)));
  const frameCount = containerWidth > 0 ? Math.max(1, Math.ceil(containerWidth / frameWidth)) : 1;

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
      {value && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: frameCount }, (_, index) => (
            <img
              key={index}
              src={value.url}
              alt=""
              draggable={false}
              className="h-full flex-shrink-0 object-cover opacity-70"
              style={{ width: frameWidth }}
            />
          ))}
        </div>
      )}
      {snapshot.status === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-white/[0.035]" />
      )}
      {label && (
        <div className="absolute inset-y-0 left-3 z-10 flex items-center">
          <span
            className="block max-w-full truncate text-[10px] font-semibold leading-none"
            style={{ color: labelColor }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
