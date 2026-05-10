import { memo, useState, useRef } from "react";

interface BlockThumbnailProps {
  blockName: string;
  width?: number;
  height?: number;
}

export const BlockThumbnail = memo(function BlockThumbnail({
  blockName,
  width = 160,
  height = 90,
}: BlockThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const src = `/api/registry/blocks/${blockName}/preview`;
  const scale = width / 1920; // scale 1920px content to thumbnail

  if (error) return null; // fall back to icon

  return (
    <div style={{ width, height, overflow: "hidden", position: "relative" }} className="rounded-lg">
      <iframe
        ref={iframeRef}
        src={src}
        title={`${blockName} preview`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        style={{
          width: 1920,
          height: 1080,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: "none",
          pointerEvents: "none",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s",
        }}
        sandbox="allow-scripts allow-same-origin"
      />
      {!loaded && !error && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-neutral-900"
          style={{ width, height }}
        >
          <div className="h-3 w-3 animate-spin rounded-full border border-neutral-700 border-t-neutral-400" />
        </div>
      )}
    </div>
  );
});
