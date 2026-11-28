import type { CSSProperties } from "react";
import { cssString } from "../../utils/cssLoads";
import { usePlayerStore } from "../store/playerStore";
import { authoredSrcPath, resolveMediaPreviewUrl } from "./thumbnailUtils";

interface TimelineTransitionBadgeProps {
  centerPx: number;
  top: number;
  widthPx: number;
  outgoingSrc?: string;
  incomingSrc?: string;
}

export function clipPicture(
  src: string | undefined,
  projectId: string | null,
  studioOrigin: string,
): CSSProperties | undefined {
  const url =
    src && projectId ? resolveMediaPreviewUrl(authoredSrcPath(src), projectId, studioOrigin) : "";
  return url ? { backgroundImage: `url(${cssString(url)})` } : undefined;
}

export function TimelineTransitionBadge({
  centerPx,
  top,
  widthPx,
  outgoingSrc,
  incomingSrc,
}: TimelineTransitionBadgeProps) {
  const projectId = usePlayerStore((s) => s.timelineProjectId);
  const picture = (src?: string) => clipPicture(src, projectId, window.location.origin);
  const style = {
    left: centerPx,
    top,
    "--timeline-transition-zone-width": `${widthPx}px`,
  } as CSSProperties;
  return (
    <div className="timeline-transition" style={style} aria-hidden="true">
      <div className="timeline-transition__zone">
        <div
          className="timeline-transition__image timeline-transition__image--out"
          style={picture(outgoingSrc)}
        />
        <div
          className="timeline-transition__image timeline-transition__image--in"
          style={picture(incomingSrc)}
        />
      </div>
      <div className="timeline-transition__badge">
        <svg viewBox="0 0 20 20" role="presentation">
          <defs>
            <filter id="timeline-transition-glyph-blur">
              <feGaussianBlur stdDeviation="0.55" />
            </filter>
          </defs>
          <path
            className="timeline-transition__frame timeline-transition__frame--out"
            d="M3 5h8v10H3z"
          />
          <path
            className="timeline-transition__frame timeline-transition__frame--in"
            d="M9 5h8v10H9z"
          />
          <path
            className="timeline-transition__intersection"
            d="M9 5h2v10H9z"
            filter="url(#timeline-transition-glyph-blur)"
          />
        </svg>
      </div>
    </div>
  );
}
