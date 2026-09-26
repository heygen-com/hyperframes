import type { ReactNode, SVGProps } from "react";
import { GLYPHS, type Glyph, type IconName, type Shape } from "./glyphs";

export type { IconName };

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "fill" | "stroke"> {
  name: IconName;
  /** Rendered size in px; the stroke picks its weight from the size class. */
  size?: number | string;
  /** Standalone icon with no visible label: announced instead of hidden. */
  title?: string;
  /** Active state: the glyph is painted solid. */
  filled?: boolean;
}

// Size classes, not a linear scale: below 14 px the stroke thins to 1.25.
function isSmall(size: number | string): boolean {
  const px = typeof size === "number" ? size : Number.parseFloat(size);
  return Number.isFinite(px) && px < 14;
}
export const strokeWidthFor = (size: number | string): number => (isSmall(size) ? 1.25 : 1.5);

const SOLID = { fill: "currentColor", stroke: "none" } as const;

function renderShape(shape: Shape, i: number) {
  const kind = shape[0];
  const n = shape.split(" ").slice(1).map(Number);
  const solid = kind === "R" || kind === "d" ? SOLID : undefined;
  if (kind === "r" || kind === "R") {
    return <rect key={i} x={n[0]} y={n[1]} width={n[2]} height={n[3]} rx={n[4]} {...solid} />;
  }
  if (kind === "c" || kind === "d")
    return <circle key={i} cx={n[0]} cy={n[1]} r={n[2]} {...solid} />;
  return <path key={i} d={shape} />;
}

// Shape nodes depend only on the glyph and its size class, so build them once.
const nodes = new Map<string, ReactNode[]>();
function shapeNodes(name: IconName, small: boolean): ReactNode[] {
  const key = `${name}:${small}`;
  let built = nodes.get(key);
  if (!built) {
    const glyph: Glyph = GLYPHS[name];
    built = ((small && glyph.small) || glyph.shapes).map(renderShape);
    nodes.set(key, built);
  }
  return built;
}

export function Icon({ name, size = 16, title, filled, ...rest }: IconProps) {
  const glyph: Glyph = GLYPHS[name];
  const solid = glyph.solid || (filled && glyph.fillable);
  const small = isSmall(size);
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={solid ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={small ? 1.25 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
      data-icon={name}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {shapeNodes(name, small)}
    </svg>
  );
}
