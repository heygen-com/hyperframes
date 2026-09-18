import { memo, useRef, type RefObject } from "react";
import { useDomEditCompositionRect } from "./useDomEditCompositionRect";
import { RULER_GUTTER_PX, usePreviewGuidesStore } from "./previewGuidesStore";
import { CAPTION_BAND_HEIGHT, resolveSafeMargins } from "../../utils/previewSafeMargins";

interface PreviewGuidesProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

/** Fraction to a CSS percent, rounded so float noise never reaches the style. */
const pct = (fraction: number) => `${Number((fraction * 100).toFixed(3))}%`;
const TICKS = Array.from({ length: 11 }, (_, i) => i * 10);
const INK = "rgba(255,255,255,0.7)";
const SAFE_COLOR = "rgba(250,204,21,0.9)";
const CAPTION_COLOR = "rgba(56,189,248,0.9)";

/** Ruler and safe-margin boxes drawn over the preview pane, never inside the composition. */
export const PreviewGuides = memo(function PreviewGuides({ iframeRef }: PreviewGuidesProps) {
  const rulerVisible = usePreviewGuidesStore((s) => s.rulerVisible);
  const safeMarginsVisible = usePreviewGuidesStore((s) => s.safeMarginsVisible);
  if (!rulerVisible && !safeMarginsVisible) return null;
  return (
    <ActiveGuides
      iframeRef={iframeRef}
      rulerVisible={rulerVisible}
      safeMarginsVisible={safeMarginsVisible}
    />
  );
});

interface ActiveGuidesProps extends PreviewGuidesProps {
  rulerVisible: boolean;
  safeMarginsVisible: boolean;
}

/** Owns the composition-rect subscription, so it only runs while a guide is on. */
function ActiveGuides({ iframeRef, rulerVisible, safeMarginsVisible }: ActiveGuidesProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const rect = useDomEditCompositionRect({ iframeRef, overlayRef: paneRef });
  const ready = rect.width > 0 && rect.height > 0;
  const safe = ready ? resolveSafeMargins(rect.width, rect.height) : null;

  return (
    <div ref={paneRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20">
      {ready && rulerVisible && (
        <>
          <div
            data-testid="preview-ruler-top"
            className="absolute bg-black/70"
            style={{
              left: rect.left,
              top: rect.top - RULER_GUTTER_PX,
              width: rect.width,
              height: RULER_GUTTER_PX,
            }}
          >
            {TICKS.map((pct) => (
              <span
                key={pct}
                className="absolute bottom-0 border-l text-[9px] leading-none tabular-nums pl-0.5 h-2.5"
                style={{ left: `${pct}%`, borderColor: INK, color: INK }}
              >
                {pct}
              </span>
            ))}
          </div>
          <div
            data-testid="preview-ruler-left"
            className="absolute bg-black/70"
            style={{
              left: rect.left - RULER_GUTTER_PX,
              top: rect.top,
              width: RULER_GUTTER_PX,
              height: rect.height,
            }}
          >
            {TICKS.map((pct) => (
              <span
                key={pct}
                className="absolute right-0 border-t text-[9px] leading-none tabular-nums pt-0.5 w-2.5"
                style={{ top: `${pct}%`, borderColor: INK, color: INK }}
              >
                {pct}
              </span>
            ))}
          </div>
        </>
      )}
      {safe && safeMarginsVisible && (
        <div
          className="absolute"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          {safe.boxes.map((box, index) => (
            <div
              key={box.kind}
              data-testid={`preview-safe-${box.kind}`}
              className="absolute border border-dashed"
              style={{
                left: pct(box.left),
                top: pct(box.top),
                right: pct(box.right),
                bottom: pct(box.bottom),
                borderColor: SAFE_COLOR,
              }}
            >
              <span
                className="absolute left-1 text-[10px] leading-none"
                style={{ top: 2 + index * 12, color: SAFE_COLOR }}
              >
                {box.label}
              </span>
            </div>
          ))}
          <div
            data-testid="preview-safe-captions"
            className="absolute border-y border-dashed"
            style={{
              left: pct(safe.captionBox.left),
              right: pct(safe.captionBox.right),
              top: pct(safe.captionBottom - CAPTION_BAND_HEIGHT),
              height: pct(CAPTION_BAND_HEIGHT),
              borderColor: CAPTION_COLOR,
              backgroundColor: "rgba(56,189,248,0.08)",
            }}
          >
            <span
              className="absolute right-1 top-0.5 text-[10px] leading-none"
              style={{ color: CAPTION_COLOR }}
            >
              Captions
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
