/**
 * Studio overlay for authored `data-safe-frames` crop windows.
 *
 * Rects live in the Studio document — never inside the composition iframe —
 * so they cannot burn into snapshots or renders.
 */

import { memo, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Crop } from "@phosphor-icons/react";
import {
  parseSafeFrames,
  pixelRect,
  type PixelRect,
  type SafeFrame,
} from "@hyperframes/parsers/safe-frames";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";

export interface SafeFrameOverlayRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function overlayRectsForSafeFrames(
  frames: SafeFrame[],
  composition: { width: number; height: number },
  iframeBox: { left: number; top: number; width: number; height: number },
  overlayBox: { left: number; top: number },
): SafeFrameOverlayRect[] {
  const scaleX = iframeBox.width / composition.width;
  const scaleY = iframeBox.height / composition.height;
  return frames.map((frame) => {
    const crop: PixelRect = pixelRect(frame, composition.width, composition.height);
    return {
      id: frame.id,
      left: iframeBox.left - overlayBox.left + crop.x * scaleX,
      top: iframeBox.top - overlayBox.top + crop.y * scaleY,
      width: crop.width * scaleX,
      height: crop.height * scaleY,
    };
  });
}

function readFramesFromIframe(iframe: HTMLIFrameElement | null): {
  frames: SafeFrame[];
  composition: { width: number; height: number } | null;
} {
  try {
    const doc = iframe?.contentDocument;
    const root = doc?.querySelector("[data-composition-id]");
    if (!root) return { frames: [], composition: null };
    const parsed = parseSafeFrames(root);
    const width = Number.parseFloat(root.getAttribute("data-width") ?? "");
    const height = Number.parseFloat(root.getAttribute("data-height") ?? "");
    if (!parsed.ok || !(width > 0) || !(height > 0)) return { frames: [], composition: null };
    return { frames: parsed.frames, composition: { width, height } };
  } catch {
    return { frames: [], composition: null };
  }
}

interface SafeFrameOverlayProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

export const SafeFrameOverlay = memo(function SafeFrameOverlay({
  iframeRef,
}: SafeFrameOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => readStudioUiPreferences().safeFramesVisible === true,
  );
  const [rects, setRects] = useState<SafeFrameOverlayRect[]>([]);
  const [hasFrames, setHasFrames] = useState(
    () => readFramesFromIframe(iframeRef.current).frames.length > 0,
  );

  const measure = useCallback(() => {
    const iframe = iframeRef.current;
    const overlay = overlayRef.current;
    const { frames, composition } = readFramesFromIframe(iframe);
    setHasFrames(frames.length > 0);
    if (!visible || !iframe || !overlay || !composition || frames.length === 0) {
      setRects([]);
      return;
    }
    const iframeBox = iframe.getBoundingClientRect();
    const overlayBox = overlay.getBoundingClientRect();
    setRects(overlayRectsForSafeFrames(frames, composition, iframeBox, overlayBox));
  }, [iframeRef, visible]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  const toggle = useCallback(() => {
    setVisible((prev) => {
      const next = !prev;
      writeStudioUiPreferences({ safeFramesVisible: next });
      return next;
    });
  }, []);

  if (!hasFrames && !visible) {
    return <div ref={overlayRef} className="absolute inset-0 pointer-events-none" aria-hidden />;
  }

  return (
    <>
      <button
        type="button"
        data-safe-frame-toggle
        className={`absolute top-2 left-2 z-50 rounded-md p-1.5 transition-colors active:scale-[0.95] ${
          visible
            ? "bg-studio-accent/20 text-studio-accent"
            : "bg-black/40 text-white/60 hover:bg-black/60 hover:text-white/80"
        }`}
        onClick={toggle}
        title={visible ? "Hide safe frames" : "Show safe frames"}
        aria-label={visible ? "Hide safe frames" : "Show safe frames"}
        aria-pressed={visible}
      >
        <Crop size={16} weight={visible ? "fill" : "regular"} />
      </button>
      {visible ? (
        <div
          ref={overlayRef}
          data-safe-frame-overlay
          className="absolute inset-0 z-40 pointer-events-none"
        >
          {rects.map((rect) => (
            <div
              key={rect.id}
              data-safe-frame-id={rect.id}
              className="absolute box-border border-2 border-cyan-300/80"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            >
              <span className="absolute -top-5 left-0 rounded bg-cyan-300/90 px-1 text-[10px] font-medium text-black">
                {rect.id}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div ref={overlayRef} className="absolute inset-0 pointer-events-none" aria-hidden />
      )}
    </>
  );
});
