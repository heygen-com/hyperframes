import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey, type ThumbnailPriority } from "../lib/thumbnailScheduler";
import { TIMELINE_VIEWPORT_BUDGETS } from "../lib/timelineViewportBudgets";
import { computeThumbnailStrip, probeImageAspect } from "./thumbnailUtils";

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
  projectId?: string;
  sessionEpoch?: number;
  priority?: ThumbnailPriority;
  rich?: boolean;
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
  output,
}: {
  previewUrl: string;
  seekTime?: number;
  duration?: number;
  selector?: string;
  selectorIndex?: number;
  origin: string;
  /**
   * Capture density. Omitted, the route bounds the image to its preview cap —
   * right for the timeline, where thumbnails are small and numerous and their
   * decoded bytes are budgeted. `"source"` captures at the composition's own
   * dimensions, for the rare surface that shows one poster large enough to read.
   */
  output?: "source";
}): string {
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");
  const thumbnailUrl = new URL(thumbnailBase, origin);
  thumbnailUrl.searchParams.set("t", (seekTime + duration / 2).toFixed(2));
  thumbnailUrl.searchParams.set("v", THUMBNAIL_URL_VERSION);
  if (output) thumbnailUrl.searchParams.set("output", output);
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
  try {
    const aspect = await probeImageAspect(objectUrl, signal);
    return {
      value: { kind: "image" as const, url: objectUrl, aspect },
      weight:
        TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalWidth *
        TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalHeight *
        4,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
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
  projectId = previewUrl,
  sessionEpoch = 0,
  priority = "visible",
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
  const { frameW, frameCount } = computeThumbnailStrip(
    containerWidth,
    value?.aspect ?? 16 / 9,
    CLIP_HEIGHT,
    48,
  );

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

  useMountEffect(() => () => observerRef.current?.disconnect());

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      {value && (
        <div
          className="absolute inset-0 flex"
          style={{ animation: "hf-thumb-fade 200ms ease-out", mixBlendMode: "lighten" }}
        >
          {Array.from({ length: frameCount }, (_, index) => (
            <div
              key={index}
              className="relative h-full flex-shrink-0 overflow-hidden"
              style={{ width: frameW }}
            >
              <img
                src={value.url}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ opacity: 0.7 }}
              />
            </div>
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
            style={{
              color: labelColor,
              textShadow: value ? "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" : "none",
            }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
