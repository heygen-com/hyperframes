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

export const Player = forwardRef<HTMLIFrameElement, PlayerProps>(
  ({ projectId, directUrl, onLoad, portrait }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const dimsRef = useRef({
      w: portrait ? NATIVE_H : NATIVE_W,
      h: portrait ? NATIVE_W : NATIVE_H,
    });
    const [dims, setDims] = useState(dimsRef.current);
    const loadCountRef = useRef(0);

    const updateScale = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const d = dimsRef.current;
      setScale(Math.min(rect.width / d.w, rect.height / d.h));
    }, []);

    useMountEffect(() => {
      updateScale();
      const ro = new ResizeObserver(updateScale);
      if (containerRef.current) ro.observe(containerRef.current);

      // Listen for stage-size messages from the runtime
      const handleMessage = (e: MessageEvent) => {
        const data = e.data;
        if (
          data?.source === "hf-preview" &&
          data?.type === "stage-size" &&
          data.width > 0 &&
          data.height > 0
        ) {
          if (dimsRef.current.w !== data.width || dimsRef.current.h !== data.height) {
            dimsRef.current = { w: data.width, h: data.height };
            setDims(dimsRef.current);
            updateScale();
          }
        }
      };
      window.addEventListener("message", handleMessage);

      return () => {
        ro.disconnect();
        window.removeEventListener("message", handleMessage);
      };
    });

    const handleLoad = useCallback(() => {
      loadCountRef.current++;

      // Auto-detect dimensions from the composition's data-width/data-height
      try {
        const iframeEl = typeof ref === "function" ? null : ref?.current;
        const doc = iframeEl?.contentDocument;
        if (doc) {
          const root = doc.querySelector("[data-composition-id]");
          if (root) {
            const dw = parseInt(root.getAttribute("data-width") || "0", 10);
            const dh = parseInt(root.getAttribute("data-height") || "0", 10);
            if (dw > 0 && dh > 0 && (dw !== dimsRef.current.w || dh !== dimsRef.current.h)) {
              dimsRef.current = { w: dw, h: dh };
              setDims(dimsRef.current);
              // Recalc scale with new dims
              const el = containerRef.current;
              if (el) {
                const rect = el.getBoundingClientRect();
                setScale(Math.min(rect.width / dw, rect.height / dh));
              }
            }
          }
        }
      } catch (err) {
        console.warn("[Player] Could not read iframe dimensions (cross-origin)", err);
      }

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
    }, [onLoad, ref]);

    return (
      <div
        ref={containerRef}
        className="w-full h-full max-w-full max-h-full overflow-hidden bg-black flex items-center justify-center"
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
            width: dims.w,
            height: dims.h,
            border: "none",
            outline: "1px solid black",
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            flexShrink: 0,
          }}
        />
      </div>
    );
  },
);

Player.displayName = "Player";
