import { forwardRef, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import type { HyperframesPlayer } from "@hyperframes/player";
// NOTE: importing "@hyperframes/player" registers a class extending HTMLElement
// at module load, which throws under SSR. Defer the import to the mount effect
// so it only runs in the browser.

interface PlayerProps {
  projectId?: string;
  directUrl?: string;
  onLoad: () => void;
  portrait?: boolean;
}

/**
 * Renders a composition preview using the <hyperframes-player> web component.
 *
 * The web component handles iframe scaling, dimension detection, and
 * ResizeObserver internally. This wrapper bridges its inner iframe to the
 * forwarded ref so useTimelinePlayer can access it for clip manifest parsing,
 * timeline probing, and DOM inspection.
 */
export const Player = forwardRef<HTMLIFrameElement, PlayerProps>(
  ({ projectId, directUrl, onLoad, portrait }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const loadCountRef = useRef(0);

    useMountEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let canceled = false;
      let cleanup: (() => void) | undefined;

      // Dynamic import registers the custom element in the browser only.
      import("@hyperframes/player").then(() => {
        if (canceled) return;

        // Create the web component imperatively to avoid JSX custom-element typing.
        const player = document.createElement("hyperframes-player") as HyperframesPlayer;
        const src = directUrl || `/api/projects/${projectId}/preview`;
        player.setAttribute("src", src);
        player.setAttribute("width", String(portrait ? 1080 : 1920));
        player.setAttribute("height", String(portrait ? 1920 : 1080));
        player.style.width = "100%";
        player.style.height = "100%";
        player.style.display = "block";
        container.appendChild(player);

        // Bridge the inner iframe to the forwarded ref for useTimelinePlayer.
        const iframe = player.iframeElement;
        if (typeof ref === "function") {
          ref(iframe);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
        }

        // Prevent the web component's built-in click-to-toggle behavior.
        // The studio manages playback exclusively via useTimelinePlayer.
        const preventToggle = (e: Event) => e.stopImmediatePropagation();
        player.addEventListener("click", preventToggle, { capture: true });

        // Forward the iframe's native load event to the studio's onIframeLoad.
        const handleLoad = () => {
          loadCountRef.current++;
          // Reveal animation on reload (hot-reload, composition switch)
          if (loadCountRef.current > 1) {
            container.classList.remove("preview-revealing");
            void container.offsetWidth;
            container.classList.add("preview-revealing");
            const onEnd = () => container.classList.remove("preview-revealing");
            container.addEventListener("animationend", onEnd, { once: true });
          }
          onLoad();
        };
        iframe.addEventListener("load", handleLoad);

        cleanup = () => {
          iframe.removeEventListener("load", handleLoad);
          player.removeEventListener("click", preventToggle, { capture: true });
          container.removeChild(player);
          // Clear the forwarded ref
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
        ref={containerRef}
        className="w-full h-full max-w-full max-h-full overflow-hidden bg-black flex items-center justify-center"
      />
    );
  },
);

Player.displayName = "Player";
