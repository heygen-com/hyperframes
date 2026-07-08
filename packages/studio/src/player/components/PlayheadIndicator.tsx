// fallow-ignore-file dead-code
/**
 * Shared playhead visual used by TimelineCanvas (real playhead) and
 * TimelineEditorNotice (animated illustration).
 */
interface PlayheadIndicatorProps {
  /** CSS color, defaults to the HF accent variable */
  color?: string;
  /** Glow shadow color, defaults to translucent accent */
  glowColor?: string;
}

export function PlayheadIndicator({
  color = "var(--hf-accent, #3CE6AC)",
  glowColor = "rgba(60,230,172,0.14)",
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
      <div className="absolute" style={{ left: "50%", top: 1, transform: "translateX(-50%)" }}>
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: 2,
            background: color,
            boxShadow: `0 1px 3px rgba(0,0,0,0.55), 0 0 5px ${glowColor}`,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    </>
  );
}
