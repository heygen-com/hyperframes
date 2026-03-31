/**
 * CompositionThumbnail — Single server-rendered JPEG stretched across the clip.
 *
 * Takes one screenshot at the midpoint of the clip and covers the full width —
 * same approach as After Effects for precomps. This avoids the 1-2s per-frame
 * Puppeteer cost of rendering multiple filmstrip frames.
 */

import { memo } from "react";

interface CompositionThumbnailProps {
  previewUrl: string;
  label: string;
  labelColor: string;
  seekTime?: number;
  duration?: number;
  width?: number;
  height?: number;
}

export const CompositionThumbnail = memo(function CompositionThumbnail({
  previewUrl,
  label,
  labelColor,
  seekTime = 2,
  duration = 5,
}: CompositionThumbnailProps) {
  // Single screenshot at the midpoint of the clip
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");
  const midTime = seekTime + duration / 2;
  const url = `${thumbnailBase}?t=${midTime.toFixed(2)}`;

  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-950">
      <img
        src={url}
        alt=""
        draggable={false}
        loading="lazy"
        onLoad={(e) => {
          (e.target as HTMLImageElement).style.opacity = "1";
        }}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0, transition: "opacity 200ms ease-out" }}
      />

      {/* Label */}
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
