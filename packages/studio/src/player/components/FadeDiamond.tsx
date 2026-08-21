import type { FadeSampler } from "./clipFades";

/**
 * The fade handle: a diamond with the fade's own curve drawn inside it.
 *
 * The glyph is a readout, not decoration. Bend the fade and the line inside the
 * diamond bends with it, sampled from the same function that will play it, so
 * the handle answers "what shape is this fade" without the reader having to
 * trace a two-pixel line across a busy clip. It is also why one handle can own
 * both gestures: the thing you are dragging shows you which one you changed.
 *
 * A diamond rather than a square or a circle because it reads as a point ON a
 * curve, which is exactly what it is, and because nothing else on the clip bar
 * is diamond-shaped: at a glance you can tell a fade handle from a trim handle
 * without aiming at it.
 */

export interface FadeDiamondProps {
  /** Diamond width and height, in px. */
  size: number;
  /** How the fade rises, for the curve drawn inside. */
  sample: FadeSampler;
  /** A fade-out is the same rise read backwards, so its glyph mirrors. */
  edge: "in" | "out";
  /** The clip's accent, which the curve is stroked in. */
  accent: string;
  /** Dimmed until the clip is worth aiming at. */
  active: boolean;
}

/** Points along the inner curve; enough that any bend reads as a curve. */
const SAMPLES = 12;

/**
 * The box the curve is drawn in, inset from the diamond's points where the
 * shape is too narrow to show a line anyway.
 *
 * Wider than it is tall, deliberately. A square box draws a straight ramp along
 * the diamond's own corners, at the same angle as the fade line passing behind
 * it, and the glyph then reads as that line slicing through rather than as a
 * picture of the shape. Flattened, the inside is always its own mark.
 */
const PAD_X = 0.24;
const PAD_Y = 0.33;

/**
 * The curve, and the area under it, in the diamond's own 0..1 box.
 *
 * The fill is what stops a straight ramp reading as the fade line cutting the
 * diamond in half: a line has two identical sides, a wedge has a bottom. It is
 * also the same picture as the wedge on the clip, one shrunk into the handle
 * that draws it.
 */
function innerCurve(sample: FadeSampler, edge: "in" | "out"): { line: string; fill: string } {
  const spanX = 1 - PAD_X * 2;
  const spanY = 1 - PAD_Y * 2;
  const floor = 1 - PAD_Y;
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const progress = i / SAMPLES;
    const level = edge === "in" ? sample(progress) : sample(1 - progress);
    const x = PAD_X + spanX * progress;
    const y = floor - spanY * level;
    points.push(`${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  const line = `M ${points.join(" L ")}`;
  return { line, fill: `${line} L ${(1 - PAD_X).toFixed(3)} ${floor} L ${PAD_X} ${floor} Z` };
}

export function FadeDiamond({ size, sample, edge, accent, active }: FadeDiamondProps) {
  const { line, fill } = innerCurve(sample, edge);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1 1"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* The body. Dark and opaque so the curve inside reads against whatever
          the clip's own fill and thumbnails happen to be underneath. */}
      <path
        d="M 0.5 0.02 L 0.98 0.5 L 0.5 0.98 L 0.02 0.5 Z"
        fill="rgba(12,14,18,0.92)"
        stroke={accent}
        strokeWidth={0.07}
        strokeLinejoin="round"
        opacity={active ? 1 : 0.75}
      />
      <path d={fill} fill={accent} fillOpacity={active ? 0.32 : 0.24} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth={0.075}
        strokeLinecap="round"
        opacity={active ? 1 : 0.8}
      />
    </svg>
  );
}
