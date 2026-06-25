// Pure, Node-side geometry + SVG generation for the onion-skin motion shot.
//
// The headless step (motionShot.ts) only SAMPLES — it seeks the live timeline
// and reads each element's projected corners. Everything else (which times to
// sample, how to fit/lay them out, and the SVG markup) lives here as pure
// functions so it can be unit-tested without a browser.

export interface Pt {
  x: number;
  y: number;
}

/** One time-sample of one element: its 4 projected corners, centre, colour, opacity. */
export interface OnionSample {
  t: number;
  q: Pt[];
  c: Pt;
  color: string;
  opacity: number;
}

export interface OnionElement {
  selector: string;
  samples: OnionSample[];
}

export type ShotLayout = "path" | "strip";

export interface ShotLayoutOptions {
  layout: ShotLayout;
  fit: boolean;
  width: number;
  height: number;
  /** Caption drawn top-left (camera / framing / window info). */
  label?: string;
}

export interface Camera {
  yaw: number;
  pitch: number;
}

const ANGLE_PRESETS: Record<string, [number, number]> = {
  front: [0, 0],
  iso: [30, -22],
  top: [0, -68],
  side: [78, 0],
  "rear-iso": [205, -22],
};

/** Parse an angle preset name or "yaw,pitch" degrees into a Camera. */
export function parseAngle(a?: string): Camera {
  if (!a) return { yaw: 0, pitch: 0 };
  const preset = ANGLE_PRESETS[a];
  if (preset) return { yaw: preset[0], pitch: preset[1] };
  const [y, p] = a.split(",").map((n) => Number.parseFloat(n));
  return { yaw: Number.isFinite(y) ? y! : 0, pitch: Number.isFinite(p) ? p! : 0 };
}

/** Resolve which animated selectors a `--shot --selector SCOPE` should sample.
 *
 * The scope element is often a STATIC wrapper (the standard `.clip` root) whose
 * animated CHILDREN carry the tweens — so a literal match against animated
 * targets finds nothing. We fall back to the animated descendants of the scope:
 *
 *   1. scope itself is animated            → sample just scope (exact selection)
 *   2. scope is static but has animated     → sample those descendants
 *      descendants (e.g. `.clip` wrapper)
 *   3. scope contains nothing animated      → sample [] (caller errors, naming
 *                                             the nearest animated elements)
 *
 * `isDescendant(scope, target)` is supplied by the caller (DOM-aware in the
 * browser); kept as a param so this decision is pure and unit-testable.
 */
export function resolveShotSelectors(
  scope: string,
  animated: string[],
  isDescendant: (scope: string, target: string) => boolean,
): string[] {
  if (animated.includes(scope)) return [scope];
  return animated.filter((target) => isDescendant(scope, target));
}

/** N equal-time sample points across [from?, to?] within [0, dur]. */
export function sampleTimes(
  dur: number,
  n: number,
  from: number | null,
  to: number | null,
): number[] {
  const t0 = from != null ? Math.max(0, Math.min(from, dur)) : 0;
  const t1 = to != null ? Math.max(0, Math.min(to, dur)) : dur;
  const count = Math.max(1, Math.floor(n));
  if (count === 1) return [t0];
  return Array.from({ length: count }, (_, i) => {
    const t = t0 + (i / (count - 1)) * (t1 - t0);
    return Math.round(t * 1000) / 1000;
  });
}

/** Scale+centre transform that fits `pts` into a W×H frame (with padding). */
export function fitTransform(
  pts: Pt[],
  width: number,
  height: number,
): { k: number; cx: number; cy: number } {
  if (pts.length === 0) return { k: 1, cx: width / 2, cy: height / 2 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const k = Math.max(0.3, Math.min(7, (Math.min(width, height) * 0.8) / span));
  return { k, cx, cy };
}

/** Grid geometry for the filmstrip layout. */
export function stripCells(n: number, width: number, height: number) {
  const cols = n <= 5 ? Math.max(1, n) : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows, cellW: width / cols, cellH: height / rows };
}

const timeColor = (f: number) => `hsl(${190 + f * 150} 90% 65%)`;

const attrs = (o: Record<string, string | number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");

const polygon = (corners: Pt[], fill: string, fillOpacity: number, stroke: string) =>
  `<polygon ${attrs({
    points: corners.map((p) => `${round(p.x)},${round(p.y)}`).join(" "),
    fill,
    "fill-opacity": fillOpacity.toFixed(2),
    stroke,
    "stroke-width": 2.5,
    "stroke-linejoin": "round",
  })}/>`;

const line = (a: Pt, b: Pt, stroke: string, w: number, o: number) =>
  `<line ${attrs({ x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y), stroke, "stroke-width": w, opacity: o, "stroke-linecap": "round" })}/>`;

const circle = (p: Pt, r: number, fill: string) =>
  `<circle ${attrs({ cx: round(p.x), cy: round(p.y), r, fill })}/>`;

const text = (p: Pt, s: string, fill: string, size = 15) =>
  `<text ${attrs({ x: round(p.x), y: round(p.y), fill, "font-family": "ui-monospace,monospace", "font-size": size, "font-weight": 600 })}>${escapeXml(s)}</text>`;

const round = (n: number) => Math.round(n * 100) / 100;
const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ghost = (corners: Pt[], center: Pt, color: string, opacity: number, f: number): string => {
  const tickEnd = {
    x: (corners[0]!.x + corners[1]!.x) / 2,
    y: (corners[0]!.y + corners[1]!.y) / 2,
  };
  return (
    polygon(corners, color, Math.max(0.08, opacity * 0.42), timeColor(f)) +
    line(center, tickEnd, timeColor(f), 3, 0.9)
  );
};

/** Build the full onion-skin SVG overlay markup from sampled elements. */
export function buildOnionSvg(elements: OnionElement[], opt: ShotLayoutOptions): string {
  const { width: W, height: H } = opt;
  let body = "";

  if (opt.layout === "strip") {
    body = stripBody(elements[0]?.samples ?? [], W, H);
  } else {
    body = pathBody(elements, opt.fit, W, H);
  }

  if (opt.label) body += text({ x: 28, y: 40 }, opt.label, timeColor(0), 18);

  return `<svg ${attrs({
    xmlns: "http://www.w3.org/2000/svg",
    style: "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647",
    viewBox: `0 0 ${W} ${H}`,
  })}>${body}</svg>`;
}

function pathBody(elements: OnionElement[], fit: boolean, W: number, H: number): string {
  const all = elements.flatMap((e) => e.samples.flatMap((s) => [...s.q, s.c]));
  const { k, cx, cy } = fit ? fitTransform(all, W, H) : { k: 1, cx: W / 2, cy: H / 2 };
  const M = (p: Pt): Pt => ({ x: (p.x - cx) * k + W / 2, y: (p.y - cy) * k + H / 2 });
  let out = "";
  for (const el of elements) {
    const last = el.samples.length - 1;
    const fOf = (i: number) => (last <= 0 ? 0 : i / last);
    el.samples.forEach((s, i) => (out += ghost(s.q.map(M), M(s.c), s.color, s.opacity, fOf(i))));
    for (let i = 0; i < last; i++)
      out += line(M(el.samples[i]!.c), M(el.samples[i + 1]!.c), timeColor(fOf(i)), 3.5, 0.85);
    el.samples.forEach((s, i) => {
      const c = M(s.c);
      out += circle(c, 4, timeColor(fOf(i)));
      out += text({ x: c.x + 10, y: c.y + (i % 2 === 0 ? -10 : 18) }, `${s.t}s`, timeColor(fOf(i)));
    });
  }
  return out;
}

function stripBody(samples: OnionSample[], W: number, H: number): string {
  if (samples.length === 0) return "";
  const { cols, cellW, cellH } = stripCells(samples.length, W, H);
  let maxExt = 1;
  for (const s of samples)
    for (const p of s.q) maxExt = Math.max(maxExt, Math.hypot(p.x - s.c.x, p.y - s.c.y));
  const cellScale = (Math.min(cellW, cellH) * 0.62) / maxExt;
  const last = samples.length - 1;
  let out = "";
  samples.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cc = { x: cellW * (col + 0.5), y: cellH * (row + 0.5) };
    const f = last <= 0 ? 0 : i / last;
    out += `<rect ${attrs({ x: round(col * cellW + 3), y: round(row * cellH + 3), width: round(cellW - 6), height: round(cellH - 6), fill: "none", stroke: "#1c2531", "stroke-width": 1, rx: 8 })}/>`;
    const corners = s.q.map((p) => ({
      x: cc.x + (p.x - s.c.x) * cellScale,
      y: cc.y + (p.y - s.c.y) * cellScale,
    }));
    out += ghost(corners, cc, s.color, s.opacity, f);
    out += text({ x: col * cellW + 12, y: row * cellH + 24 }, `${s.t}s`, timeColor(f), 16);
  });
  return out;
}
