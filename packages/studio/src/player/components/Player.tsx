import { forwardRef, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

interface PlayerProps {
  projectId?: string;
  directUrl?: string;
  onLoad: () => void;
  portrait?: boolean;
  style?: React.CSSProperties;
}

interface HyperframesPlayerElement extends HTMLElement {
  iframeElement: HTMLIFrameElement;
}

function enableInteractiveIframe(player: HyperframesPlayerElement): void {
  const root = player.shadowRoot;
  if (!root) return;

  const container = root.querySelector<HTMLElement>(".hfp-container");
  const iframe = root.querySelector<HTMLIFrameElement>(".hfp-iframe");

  container?.style.setProperty("pointer-events", "auto");
  iframe?.style.setProperty("pointer-events", "auto");
}

function isLottieAnimationReady(anim: unknown): boolean {
  if (typeof anim !== "object" || anim === null) return true;
  const maybe = anim as { isLoaded?: boolean; totalFrames?: number };
  if (maybe.isLoaded === true) return true;
  if (typeof maybe.totalFrames === "number" && maybe.totalFrames > 0) return true;
  return false;
}

function hasUnloadedAssets(iframe: HTMLIFrameElement, lastResult: boolean): boolean {
  try {
    const win = iframe.contentWindow as unknown as (Window & { __hfLottie?: unknown[] }) | null;
    const doc = iframe.contentDocument;
    if (!win || !doc) return lastResult;

    for (const el of doc.querySelectorAll("video, audio")) {
      if (el instanceof HTMLMediaElement && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        return true;
      }
    }

    const lotties = win.__hfLottie;
    if (lotties?.length) {
      for (const anim of lotties) {
        if (!isLottieAnimationReady(anim)) return true;
      }
    }

    return false;
  } catch {
    return lastResult;
  }
}

export const Player = forwardRef<HTMLIFrameElement, PlayerProps>(
  ({ projectId, directUrl, onLoad, portrait, style }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const assetPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [assetsLoading, setAssetsLoading] = useState(false);

    useMountEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let canceled = false;
      let cleanup: (() => void) | undefined;

      import("@hyperframes/player").then(() => {
        if (canceled) return;

        const player = document.createElement("hyperframes-player") as HyperframesPlayerElement;
        const src = directUrl || `/api/projects/${projectId}/preview`;
        player.setAttribute("src", src);
        player.setAttribute("width", String(portrait ? 1080 : 1920));
        player.setAttribute("height", String(portrait ? 1920 : 1080));
        player.style.width = "100%";
        player.style.height = "100%";
        player.style.display = "block";
        container.appendChild(player);
        enableInteractiveIframe(player);

        const iframe = player.iframeElement;
        if (typeof ref === "function") {
          ref(iframe);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
        }

        const preventToggle = (e: Event) => e.stopImmediatePropagation();
        player.addEventListener("click", preventToggle, { capture: true });

        const handleLoad = () => {
          onLoad();

          if (assetPollRef.current) clearInterval(assetPollRef.current);
          let lastUnloaded = hasUnloadedAssets(iframe, false);
          if (lastUnloaded) {
            setAssetsLoading(true);
            let attempts = 0;
            assetPollRef.current = setInterval(() => {
              attempts += 1;
              lastUnloaded = hasUnloadedAssets(iframe, lastUnloaded);
              if (!lastUnloaded || attempts > 100) {
                if (assetPollRef.current) clearInterval(assetPollRef.current);
                assetPollRef.current = null;
                setAssetsLoading(false);
              }
            }, 100);
          } else {
            setAssetsLoading(false);
          }
        };
        iframe.addEventListener("load", handleLoad);

        cleanup = () => {
          iframe.removeEventListener("load", handleLoad);
          player.removeEventListener("click", preventToggle, { capture: true });
          if (assetPollRef.current) clearInterval(assetPollRef.current);
          assetPollRef.current = null;
          container.removeChild(player);
          if (typeof ref === "function") {
            ref(null);
          } else if (ref) {
            (ref as React.MutableRefObject<HTMLIFrameElement | null>).current = null;
          }
        };
      });

      return () => {
        canceled = true;
        cleanup?.();
      };
    });

    return (
      <div
        className="relative w-full h-full max-w-full max-h-full overflow-hidden bg-black flex items-center justify-center"
        style={style}
      >
        <div ref={containerRef} className="w-full h-full" />
        {assetsLoading && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20 pointer-events-none">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <span className="text-white/60 text-xs mt-3">Loading assets…</span>
          </div>
        )}
      </div>
    );
  },
);

Player.displayName = "Player";
