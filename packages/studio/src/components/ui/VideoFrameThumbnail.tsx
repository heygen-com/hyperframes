import { useState, useEffect } from "react";

/**
 * Extracts a representative JPEG frame from a video URL using a hidden
 * video + canvas. Seeks to ~10% of duration to avoid black opening frames.
 * Used by AssetThumbnail (assets tab) and RenderQueueItem (renders tab).
 */
export function VideoFrameThumbnail({ src }: { src: string }) {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
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

    video.addEventListener("error", cleanup);
    video.src = src;
    video.load();

    return cleanup;
  }, [src]);

  if (!frame) {
    return <div className="w-full h-full bg-neutral-800 animate-pulse" />;
  }

  return <img src={frame} alt="" draggable={false} className="w-full h-full object-contain" />;
}
