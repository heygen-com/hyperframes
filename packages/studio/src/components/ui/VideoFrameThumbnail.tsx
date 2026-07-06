import { useState, useEffect } from "react";

/**
 * Extracts a representative JPEG frame from a video URL using a hidden
 * video + canvas. Seeks to ~10% of duration to avoid black opening frames.
 * Used by AssetThumbnail (assets tab) and RenderQueueItem (renders tab).
 */
export function VideoFrameThumbnail({
  src,
  fallbackLabel,
}: {
  src: string;
  /** Shown instead of an endless shimmer when the video can't be decoded. */
  fallbackLabel?: string;
}) {
  const [frame, setFrame] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const cleanup = () => {
      video.src = "";
      video.load();
    };

    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(2, video.duration * 0.1 || 2);
    });

    video.addEventListener("seeked", () => {
      if (!ctx) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      setFrame(canvas.toDataURL("image/jpeg", 0.7));
      cleanup();
    });

    video.addEventListener("error", () => {
      // Resolve the loading state — a permanent shimmer reads as "still loading".
      setFailed(true);
      cleanup();
    });
    video.src = src;
    video.load();

    return cleanup;
  }, [src]);

  if (failed && !frame) {
    return (
      <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
        <span className="text-[9px] font-medium text-neutral-600">{fallbackLabel ?? "VIDEO"}</span>
      </div>
    );
  }

  if (!frame) {
    return (
      <div className="w-full h-full bg-neutral-800 animate-pulse motion-reduce:animate-none" />
    );
  }

  return <img src={frame} alt="" draggable={false} className="w-full h-full object-contain" />;
}
