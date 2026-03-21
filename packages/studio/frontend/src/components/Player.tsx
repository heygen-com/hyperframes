import { forwardRef, useRef, useState, useEffect, useCallback } from "react";

const NATIVE_W = 1920;
const NATIVE_H = 1080;

interface PlayerProps {
  projectId: string;
  onLoad: () => void;
  portrait?: boolean;
}

export const Player = forwardRef<HTMLIFrameElement, PlayerProps>(
  ({ projectId, onLoad, portrait }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    const w = portrait ? NATIVE_H : NATIVE_W;
    const h = portrait ? NATIVE_W : NATIVE_H;

    const updateScale = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setScale(Math.min(rect.width / w, rect.height / h));
    }, [w, h]);

    useEffect(() => {
      updateScale();
      const ro = new ResizeObserver(updateScale);
      if (containerRef.current) ro.observe(containerRef.current);
      return () => ro.disconnect();
    }, [updateScale]);

    return (
      <div
        ref={containerRef}
        className="max-w-full max-h-full overflow-hidden shadow-sm border border-neutral-200/60 bg-neutral-900 flex items-center justify-center"
        style={{ aspectRatio: `${w}/${h}`, height: "100%" }}
      >
        <iframe
          ref={ref}
          src={`/api/projects/${projectId}/serve/index.html?parity=1`}
          onLoad={onLoad}
          sandbox="allow-scripts allow-same-origin"
          title="Project Preview"
          style={{
            width: w,
            height: h,
            border: "none",
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            flexShrink: 0,
          }}
        />
      </div>
    );
  }
);

Player.displayName = "Player";
