import { memo, useState, useCallback, useRef } from "react";
import { useCaptionStore } from "../store";
import { useMountEffect } from "../../hooks/useMountEffect";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaptionOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface WordBox {
  segmentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Query all `.word` elements in the iframe document, filter to those whose
 * parent `.caption-group` is visible (opacity > 0.01), and return positioned
 * boxes mapped to segment IDs via the `data-segment-id` attribute.
 */
function readWordBoxes(
  iframe: HTMLIFrameElement,
  scale: number,
  offsetX: number,
  offsetY: number,
): WordBox[] {
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    // Cross-origin — bail out silently
    return [];
  }
  if (!doc) return [];

  const wordEls = doc.querySelectorAll<HTMLElement>(".word[data-segment-id]");
  const boxes: WordBox[] = [];

  for (const el of wordEls) {
    // Only include words whose caption-group ancestor is visible
    const group = el.closest(".caption-group") as HTMLElement | null;
    if (group) {
      const style = doc.defaultView?.getComputedStyle(group);
      const opacity = parseFloat(style?.opacity ?? "1");
      if (opacity <= 0.01) continue;
    }

    const segmentId = el.getAttribute("data-segment-id");
    if (!segmentId) continue;

    const rect = el.getBoundingClientRect();
    // rect is relative to the iframe viewport — apply scale and offset to map
    // into the overlay coordinate space.
    boxes.push({
      segmentId,
      x: rect.left * scale + offsetX,
      y: rect.top * scale + offsetY,
      width: rect.width * scale,
      height: rect.height * scale,
    });
  }

  return boxes;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CaptionOverlay = memo(function CaptionOverlay({
  iframeRef,
  scale,
  offsetX,
  offsetY,
}: CaptionOverlayProps) {
  const isEditMode = useCaptionStore((s) => s.isEditMode);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const selectSegment = useCaptionStore((s) => s.selectSegment);
  const clearSelection = useCaptionStore((s) => s.clearSelection);

  const [wordBoxes, setWordBoxes] = useState<WordBox[]>([]);

  // Keep latest props in a ref so the interval callback always sees fresh values
  // without needing to be recreated on every render.
  const propsRef = useRef({ scale, offsetX, offsetY });
  propsRef.current = { scale, offsetX, offsetY };

  useMountEffect(() => {
    if (!isEditMode) return;

    const tick = () => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const { scale: s, offsetX: ox, offsetY: oy } = propsRef.current;
      setWordBoxes(readWordBoxes(iframe, s, ox, oy));
    };

    const id = setInterval(tick, 66); // ~15 fps
    tick(); // run immediately on mount
    return () => clearInterval(id);
  });

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Only clear when clicking directly on the overlay backdrop, not on a word box
      if (e.target === e.currentTarget) {
        clearSelection();
      }
    },
    [clearSelection],
  );

  if (!isEditMode) return null;

  return (
    <div className="absolute inset-0 z-50" onClick={handleBackgroundClick}>
      {wordBoxes.map((box) => {
        const isSelected = selectedSegmentIds.has(box.segmentId);
        return (
          <div
            key={box.segmentId}
            className={[
              "absolute cursor-pointer rounded-sm transition-[box-shadow] duration-75",
              isSelected ? "ring-2 ring-studio-accent" : "hover:ring-1 hover:ring-white/30",
            ].join(" ")}
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
            }}
            onClick={(e) => {
              e.stopPropagation();
              selectSegment(box.segmentId, e.shiftKey);
            }}
          />
        );
      })}
    </div>
  );
});
