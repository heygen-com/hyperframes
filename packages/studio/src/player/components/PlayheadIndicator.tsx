// fallow-ignore-file dead-code
/**
 * Shared playhead visual used by TimelineCanvas (real playhead) and
 * TimelineEditorNotice (animated illustration).
 *
 * The vertical line + glow span the full track height; the grab-handle HEAD is
 * `position: sticky; top: 0` so it pins to the top of the (vertically) scrolling
 * track area — the ruler is sticky too, so the head stays visible and grabbable
 * no matter how far the tracks are scrolled. The head is OUTLINE-only at rest and
 * FILLED while the playhead is actively held/scrubbed (`scrubbing`).
 */
interface PlayheadIndicatorProps {
  /** CSS color, defaults to the HF accent variable */
  color?: string;
  /** Glow shadow color, defaults to translucent accent */
  glowColor?: string;
  /** Whether the playhead is being actively scrubbed — fills the head. */
  scrubbing?: boolean;
  /**
   * When false, the head chip is rendered in normal flow (top:1) instead of the
   * sticky pin — used by the static illustration where there is no scroll area.
   */
  stickyHead?: boolean;
}

export function PlayheadIndicator({
  color = "var(--hf-accent, #3CE6AC)",
  glowColor = "rgba(60,230,172,0.14)",
  scrubbing = false,
  stickyHead = true,
}: PlayheadIndicatorProps) {
  // Head chip dimensions — used to compute the centering offset and the
  // point where the vertical line starts (so it begins at the head's bottom
  // edge rather than running through the hollow diamond center).
  const HEAD_W = 9;
  const HEAD_H = 9;
  // marginTop(1) + HEAD_H = where the line should start.
  const HEAD_TOTAL_H = 1 + HEAD_H;

  return (
    <>
      {/* Glow — spans full height, centered on the line. */}
      <div
        aria-hidden="true"
        className="absolute top-0 bottom-0"
        style={{
          left: "50%",
          width: 13,
          transform: "translateX(-50%)",
          background: `radial-gradient(closest-side, ${glowColor}, transparent)`,
        }}
      />
      {/* Vertical line — starts at the bottom edge of the head chip so nothing
          shows through the hollow diamond center. */}
      <div
        className="absolute bottom-0"
        style={{
          left: "50%",
          top: HEAD_TOTAL_H,
          width: 1,
          marginLeft: -0.5,
          background: color,
          boxShadow: `0 0 6px ${glowColor}`,
        }}
      />
      {/* Head chip — sticky so it pins to the ruler while tracks scroll.
          Centered exactly on the playhead x via negative half-width offset. */}
      <div
        className={stickyHead ? "sticky" : "absolute"}
        style={{
          left: "50%",
          top: stickyHead ? 0 : 1,
          // Center the chip exactly on the line: shift left by half its width.
          transform: `translateX(-${HEAD_W / 2}px)`,
          // Zero height keeps it from covering rows (sticky strip trick).
          height: stickyHead ? 0 : undefined,
        }}
      >
        <div
          style={{
            width: HEAD_W,
            height: HEAD_H,
            borderRadius: 2,
            marginTop: 1,
            // Outline-only at rest, filled while scrubbing.
            background: scrubbing ? color : "transparent",
            border: `1.5px solid ${color}`,
            boxSizing: "border-box",
            boxShadow: `0 1px 3px rgba(0,0,0,0.55), 0 0 5px ${glowColor}`,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    </>
  );
}
