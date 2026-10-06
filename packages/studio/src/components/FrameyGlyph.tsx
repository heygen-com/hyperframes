import type { Ref } from "react";

// Framey, the desktop app's cursor mascot, as hyperframes-internal packages/nib draws it: a rounded triangle with a
// white rim and one eye. The viewBox frames the body with its rim; the tip points up and left like a cursor.
const BODY = "M77.55 48.44 L122.77 65.85 L99.3 89.41 Z";
const EYE = { cx: 111.6, cy: 68.2, r: 11.5 };

/** `eyeRef` moves the pupils (a translate of a few px) without re-rendering. */
export function FrameyGlyph({
  size,
  className,
  eyeRef,
}: {
  size: number;
  className?: string;
  eyeRef?: Ref<SVGGElement>;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="58 30 82 76"
      aria-hidden="true"
      className={className}
      overflow="visible"
    >
      <path
        d={BODY}
        fill="var(--color-white)"
        stroke="var(--color-white)"
        strokeWidth={24}
        strokeLinejoin="round"
      />
      <path
        d={BODY}
        fill="var(--color-framey)"
        stroke="var(--color-framey)"
        strokeWidth={19}
        strokeLinejoin="round"
      />
      <circle cx={EYE.cx} cy={EYE.cy} r={EYE.r} fill="var(--color-white)" />
      <g ref={eyeRef} className="hf-framey-eye">
        <path
          d={`M${EYE.cx - 2.6} ${EYE.cy - 2} V${EYE.cy + 2} M${EYE.cx + 2.6} ${EYE.cy - 2} V${EYE.cy + 2}`}
          stroke="var(--color-framey-ink)"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
