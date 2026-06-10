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
  glowColor = "rgba(60,230,172,0.5)",
}: PlayheadIndicatorProps) {
  return (
    <>
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: "50%",
          width: 2,
          marginLeft: -1,
          background: color,
          boxShadow: `0 0 8px ${glowColor}`,
        }}
      />
      <div className="absolute" style={{ left: "50%", top: 0, transform: "translateX(-50%)" }}>
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: `8px solid ${color}`,
            filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
          }}
        />
      </div>
    </>
  );
}
