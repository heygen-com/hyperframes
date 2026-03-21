import { forwardRef, useRef, useState, useCallback } from "react";
import { useMountEffect } from "../lib/useMountEffect";

const NATIVE_W = 1920;
const NATIVE_H = 1080;

interface PlayerProps {
  projectId?: string;
  directUrl?: string;
  onLoad: () => void;
  portrait?: boolean;
}

export const Player = forwardRef<HTMLIFrameElement, PlayerProps>(({ projectId, directUrl, onLoad, portrait }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const loadCountRef = useRef(0);

  const w = portrait ? NATIVE_H : NATIVE_W;
  const h = portrait ? NATIVE_W : NATIVE_H;

  const updateScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setScale(Math.min(rect.width / w, rect.height / h));
  }, [w, h]);

  useMountEffect(() => {
    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  });

  // Trigger reveal animation on iframe reload (skip the initial load)
  const handleLoad = useCallback(() => {
    loadCountRef.current++;
    if (loadCountRef.current > 1) {
      const el = containerRef.current;
      if (el) {
        el.classList.remove("preview-revealing");
        void el.offsetWidth;
        el.classList.add("preview-revealing");
        const onEnd = () => el.classList.remove("preview-revealing");
        el.addEventListener("animationend", onEnd, { once: true });
      }
    }
    onLoad();
  }, [onLoad]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full max-w-full max-h-full overflow-hidden shadow-float border border-neutral-800 bg-black flex items-center justify-center rounded-card-inner"
    >
      <iframe
        ref={ref}
        src={directUrl || `/api/projects/${projectId}/preview`}
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin"
        allow="autoplay; fullscreen"
        referrerPolicy="no-referrer"
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
});

Player.displayName = "Player";
