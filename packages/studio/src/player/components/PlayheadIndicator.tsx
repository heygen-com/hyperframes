/**
 * The timeline's playhead: a vertical line, a glow, and a grab-handle head.
 *
 * The vertical line + glow span the full track height; the grab-handle HEAD is
 * `position: sticky; top: 0` so it pins to the top of the (vertically) scrolling
 * track area — the ruler is sticky too, so the head stays visible and grabbable
 * no matter how far the tracks are scrolled. The head is OUTLINE-only at rest and
 * FILLED while the playhead is actively held/scrubbed (`scrubbing`).
 */
import { PLAYHEAD_HEAD_W } from "./timelineLayout";

/**
 * The playhead's reserved colour (R3, AE7). Not the accent: the playhead
 * crosses selected clips and accented controls constantly, and while all three
 * were the same green the eye could not tell which was which. The line, the
 * head and the glow all read this one token, so they cannot drift apart, and
 * changing the playhead's colour is an edit to `theme.css` rather than here.
 */
const PLAYHEAD_COLOR = "var(--color-playhead)";
const PLAYHEAD_GLOW = "color-mix(in srgb, var(--color-playhead) 14%, transparent)";

interface PlayheadIndicatorProps {
  /** Whether the playhead is being actively scrubbed — fills the head. */
  scrubbing?: boolean;
}

export function PlayheadIndicator({ scrubbing = false }: PlayheadIndicatorProps) {
  // Head chip dimensions — used to compute the centering offset and the
  // point where the vertical line starts (so it begins at the head's bottom
  // edge rather than running through the hollow diamond center). The width is
  // the shared PLAYHEAD_HEAD_W constant: getTimelinePlayheadLeft shifts the
  // wrapper by -PLAYHEAD_HEAD_W/2 so the 1px line (centered at 50% of the
  // wrapper) lands exactly on GUTTER + time * pps — the ruler ticks' center x.
  const HEAD_W = PLAYHEAD_HEAD_W;
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
          background: `radial-gradient(closest-side, ${PLAYHEAD_GLOW}, transparent)`,
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
          background: PLAYHEAD_COLOR,
          boxShadow: `0 0 6px ${PLAYHEAD_GLOW}`,
        }}
      />
      {/* Head chip — sticky so it pins to the ruler while tracks scroll.
          Centering logic: wrapper width = HEAD_W (chip forces it). The line sits
          at wrapper.left + HEAD_W/2 (left:"50%" of wrapper). The sticky element's
          natural flow position is wrapper.left; so placing it there with no
          horizontal translate puts its LEFT edge at wrapper.left and its CENTER
          at wrapper.left + HEAD_W/2 — exactly on the line. */}
      {/* Zero height keeps it from covering rows (sticky strip trick). */}
      <div className="sticky top-0 left-0 h-0">
        <div
          style={{
            width: HEAD_W,
            height: HEAD_H,
            borderRadius: 2,
            marginTop: 1,
            // Outline-only at rest, filled while scrubbing.
            background: scrubbing ? PLAYHEAD_COLOR : "transparent",
            // Longhands, not the `border` shorthand: a shorthand carrying a
            // `var()` is a pending-substitution value that the CSSOM will not
            // read back, so nothing could assert the head's colour.
            borderWidth: 1.5,
            borderStyle: "solid",
            borderColor: PLAYHEAD_COLOR,
            boxSizing: "border-box",
            boxShadow: `0 1px 3px rgba(0,0,0,0.55), 0 0 5px ${PLAYHEAD_GLOW}`,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    </>
  );
}
