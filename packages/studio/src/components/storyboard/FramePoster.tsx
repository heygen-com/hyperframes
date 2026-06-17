import { useEffect, useState } from "react";
import { buildCompositionThumbnailUrl } from "../../player/components/CompositionThumbnail";

export interface FramePosterProps {
  projectId: string;
  /** Project-relative path to the frame's HTML sub-composition. */
  src: string;
  /** Time (seconds) to seek to for the poster. */
  seconds: number;
  title: string;
  /** `cover` fills+crops (contact-sheet tile); `contain` letterboxes (focus hero). */
  fit?: "cover" | "contain";
}

/**
 * Server-rendered poster for a frame. The thumbnail route seeks the composition
 * by time (at its real fps) and caches the result, so there's no live iframe,
 * no postMessage seek, and no client-side fps assumption. Shared by the
 * contact-sheet tile and the frame-focus view.
 */
export function FramePoster({ projectId, src, seconds, title, fit = "cover" }: FramePosterProps) {
  const [failed, setFailed] = useState(false);
  // The <img> is reused (no key) when a tile/hero swaps to a different frame, so a
  // prior load error would stick. Reset when the poster target changes.
  useEffect(() => setFailed(false), [src, seconds]);
  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[11px] text-neutral-600">
        Preview unavailable
      </div>
    );
  }
  const url = buildCompositionThumbnailUrl({
    previewUrl: `/api/projects/${projectId}/preview/comp/${src}`,
    seekTime: seconds,
    duration: 0,
    origin: window.location.origin,
  });
  return (
    <img
      src={url}
      alt={title}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
    />
  );
}

/** Time (seconds) to show a frame at — past the intro so the key moment is visible. */
export function posterTime(frame: { poster?: number; durationSeconds?: number }): number {
  if (frame.poster != null) return frame.poster;
  if (frame.durationSeconds != null) return frame.durationSeconds * 0.66;
  return 1.5;
}
