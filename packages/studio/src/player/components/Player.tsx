import { forwardRef, useEffect, useRef, useState } from "react";
import { isLottieAnimationLoaded } from "@hyperframes/core/runtime/lottie-readiness";
import { useMountEffect } from "../../hooks/useMountEffect";
import { HyperframesLoader } from "../../components/ui";
// NOTE: importing "@hyperframes/player" registers a class extending HTMLElement
// at module load, which throws under SSR. Defer the import to the mount effect
// so it only runs in the browser.

interface PlayerProps {
  projectId?: string;
  directUrl?: string;
  onLoad: () => void;
  portrait?: boolean;
}

interface HyperframesPlayerElement extends HTMLElement {
  iframeElement: HTMLIFrameElement;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getShaderTransitionLoading(event: Event): boolean | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (!isRecord(detail)) return null;
  const state = detail.state;
  if (!isRecord(state)) return null;
  return state.loading === true && state.ready !== true;
}

// Assets are considered ready when every `<video>`/`<audio>` has enough data
// to play through without buffering, and every registered Lottie animation has
// finished loading.
//
// Returns whichever value was returned last on cross-origin / transient DOM
// races so a brief access failure (e.g. an iframe that just swapped src)
// doesn't flicker the overlay state — we keep showing whatever was most
// recently true.
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
        if (!isLottieAnimationLoaded(anim)) return true;
      }
    }

    return false;
  } catch {
    return lastResult;
  }
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
    const assetPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const assetFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [assetsLoading, setAssetsLoading] = useState(false);
    const [assetOverlayVisible, setAssetOverlayVisible] = useState(false);
    const [assetOverlayFading, setAssetOverlayFading] = useState(false);
    const [shaderTransitionLoading, setShaderTransitionLoading] = useState(false);

    useMountEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let canceled = false;
      let cleanup: (() => void) | undefined;

      // Dynamic import registers the custom element in the browser only.
      import("@hyperframes/player").then(() => {
        if (canceled) return;

        // Create the web component imperatively to avoid JSX custom-element typing.
        const player = document.createElement("hyperframes-player") as HyperframesPlayerElement;
        const src = directUrl || `/api/projects/${projectId}/preview`;
        player.setAttribute("shader-capture-scale", "1");
        player.setAttribute("shader-loading", "player");
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

        const handleShaderTransitionState = (event: Event) => {
          const loading = getShaderTransitionLoading(event);
          if (loading !== null) setShaderTransitionLoading(loading);
        };
        player.addEventListener("shadertransitionstate", handleShaderTransitionState);

        // Forward the iframe's native load event to the studio's onIframeLoad.
        const handleLoad = () => {
          loadCountRef.current++;
          setShaderTransitionLoading(false);
          // Reveal animation on reload (hot-reload, composition switch)
          if (loadCountRef.current > 1) {
            container.classList.remove("preview-revealing");
            void container.offsetWidth;
            container.classList.add("preview-revealing");
            const onEnd = () => container.classList.remove("preview-revealing");
            container.addEventListener("animationend", onEnd, { once: true });
          }
          onLoad();

          // Show a loading overlay until every `<video>`/`<audio>` and Lottie
          // asset is ready. Without this users can click play before audio has
          // buffered — the runtime is resilient (queued play() resolves once
          // data arrives), but the overlay communicates why the first frame
          // or first audio beat may lag.
          //
          // Poll with a 10 s safety cap (100 ticks × 100 ms). If the cap
          // trips we hide the overlay so the UI doesn't appear stuck forever,
          // but we log a debug warning so the case is diagnosable — a long
          // cold video or a broken asset can legitimately exceed 10 s on a
          // slow network.
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
                if (lastUnloaded) {
                  console.debug(
                    "[Player] Asset-loading overlay timed out after 10s; hiding anyway. Check network or asset integrity.",
                  );
                }
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
          player.removeEventListener("shadertransitionstate", handleShaderTransitionState);
          if (assetPollRef.current) clearInterval(assetPollRef.current);
          assetPollRef.current = null;
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

    useEffect(() => {
      if (assetFadeRef.current) {
        clearTimeout(assetFadeRef.current);
        assetFadeRef.current = null;
      }

      if (assetsLoading) {
        setAssetOverlayVisible(true);
        setAssetOverlayFading(false);
        return;
      }

      setAssetOverlayFading(true);
      assetFadeRef.current = setTimeout(() => {
        setAssetOverlayVisible(false);
        setAssetOverlayFading(false);
        assetFadeRef.current = null;
      }, 240);

      return () => {
        if (assetFadeRef.current) {
          clearTimeout(assetFadeRef.current);
          assetFadeRef.current = null;
        }
      };
    }, [assetsLoading]);

    const showAssetOverlay = assetOverlayVisible && !shaderTransitionLoading;

    return (
      <div className="relative w-full h-full max-w-full max-h-full overflow-hidden bg-black flex items-center justify-center">
        <div ref={containerRef} className="w-full h-full" />
        {showAssetOverlay && (
          <div
            className="absolute inset-0 bg-black flex items-center justify-center z-20 select-none"
            data-hyperframes-ignore=""
            draggable={false}
            style={{
              opacity: assetOverlayFading ? 0 : 1,
              pointerEvents: assetOverlayFading ? "none" : "auto",
              transition: "opacity 240ms ease-out",
            }}
            onDragStart={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => event.preventDefault()}
          >
            <HyperframesLoader
              title="Preparing preview assets"
              detail="Waiting for media and motion assets before playback starts."
              size={56}
            />
          </div>
        )}
      </div>
    );
  },
);

Player.displayName = "Player";
