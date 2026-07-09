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
  return (
    <>
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
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: "50%",
          width: 1,
          marginLeft: -0.5,
          background: color,
          boxShadow: `0 0 6px ${glowColor}`,
        }}
      />
      <div
        className={stickyHead ? "sticky" : "absolute"}
        style={{
          left: "50%",
          top: stickyHead ? 0 : 1,
          transform: "translateX(-50%)",
          // A tiny sticky strip so the head pins to the top of the scrolled track
          // area (the ruler is sticky too). Zero height keeps it from covering rows.
          height: stickyHead ? 0 : undefined,
        }}
      >
        <div
          style={{
            width: 9,
            height: 9,
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
