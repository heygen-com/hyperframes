import type { MarqueeBand, Rect } from "../../utils/marqueeGeometry";

export interface MarqueeOverlayProps {
  /** Elements the marquee currently intersects — outlined live before mouse-up. */
  candidateRects: Rect[];
  /** The marquee drag rectangle itself, or null when not marquee-selecting. */
  marqueeRect: MarqueeBand | null;
}

/**
 * The marquee selection visuals: a live "candidate" outline on each element the
 * box currently touches, plus the dashed drag rectangle. Extracted from
 * DomEditOverlay to keep that file under the 600-line cap.
 */
export function MarqueeOverlay({ candidateRects, marqueeRect }: MarqueeOverlayProps) {
  const subtracting = marqueeRect?.mode === "subtract";
  const candidateClass = subtracting
    ? "border-danger bg-danger/5"
    : "border-studio-accent bg-studio-accent/5";
  const bandClass = subtracting
    ? "border-danger bg-danger/10"
    : "border-studio-accent bg-studio-accent/10";
  return (
    <>
      {candidateRects.map((r, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-xs border ${candidateClass}`}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
      {marqueeRect && (
        <div
          aria-hidden="true"
          data-marquee-mode={marqueeRect.mode}
          className={`pointer-events-none absolute border border-dashed ${bandClass}`}
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}
    </>
  );
}
