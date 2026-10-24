/**
 * Pose math for capture motion blur: where an element's box sits in composition space at a
 * given timeline time, and the in-between poses the shutter sweeps through.
 *
 * A pose is the full 2D affine from the element's own border box to the composition root:
 * layout offsets plus every CSS transform up the ancestor chain. Reading it costs style and
 * layout reads only; no paint.
 */

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function translate(m: Affine, x: number, y: number): Affine {
  return multiply(m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
}

export function invert(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** The four corners of a w×h box under `m`. */
export function corners(m: Affine, w: number, h: number): Array<[number, number]> {
  return [
    [m.e, m.f],
    [m.a * w + m.e, m.b * w + m.f],
    [m.c * h + m.e, m.d * h + m.f],
    [m.a * w + m.c * h + m.e, m.b * w + m.d * h + m.f],
  ];
}

/**
 * Interpolate two poses by translation, rotation, scale and shear rather than matrix entries:
 * entry-wise lerp of a rotating box shrinks it mid-segment (halfway through a 90° turn it is
 * scaled by cos 45°). Rotation takes the short way round.
 */
export function interpolate(p: Affine, q: Affine, f: number): Affine {
  const dp = decompose(p);
  const dq = decompose(q);
  let turn = dq.angle - dp.angle;
  if (turn > Math.PI) turn -= 2 * Math.PI;
  else if (turn < -Math.PI) turn += 2 * Math.PI;
  const lerp = (x: number, y: number): number => x + (y - x) * f;
  return compose({
    angle: dp.angle + turn * f,
    sx: lerp(dp.sx, dq.sx),
    sy: lerp(dp.sy, dq.sy),
    shear: lerp(dp.shear, dq.shear),
    e: lerp(p.e, q.e),
    f: lerp(p.f, q.f),
  });
}

interface Decomposed {
  angle: number;
  sx: number;
  sy: number;
  shear: number;
  e: number;
  f: number;
}

// QR split of the linear part: first column = sx·(cos, sin), second = shear·(cos, sin) + sy·(−sin, cos).
function decompose(m: Affine): Decomposed {
  const sx = Math.hypot(m.a, m.b);
  if (sx < 1e-12) return { angle: 0, sx: 0, sy: m.d, shear: m.c, e: m.e, f: m.f };
  return {
    angle: Math.atan2(m.b, m.a),
    sx,
    sy: (m.a * m.d - m.b * m.c) / sx,
    shear: (m.a * m.c + m.b * m.d) / sx,
    e: m.e,
    f: m.f,
  };
}

function compose(d: Decomposed): Affine {
  const cos = Math.cos(d.angle);
  const sin = Math.sin(d.angle);
  return {
    a: d.sx * cos,
    b: d.sx * sin,
    c: d.shear * cos - d.sy * sin,
    d: d.shear * sin + d.sy * cos,
    e: d.e,
    f: d.f,
  };
}

/**
 * `samples` taps spread evenly across the shutter, interpolated from `reads` poses read at
 * evenly spaced times from the start to the end of the shutter (endpoints included).
 */
export function tapsFromReads(reads: Affine[], samples: number): Affine[] {
  if (reads.length === 0) return [];
  if (reads.length === 1) return Array.from({ length: samples }, () => reads[0] as Affine);
  const last = reads.length - 1;
  return Array.from({ length: samples }, (_, k) => {
    const x = ((k + 0.5) / samples) * last;
    const j = Math.min(last - 1, Math.floor(x));
    return interpolate(reads[j] as Affine, reads[j + 1] as Affine, x - j);
  });
}

export interface Sweep {
  /** Path length of the box's fastest corner across the taps, in pixels. */
  travel: number;
  /** Pixel rect covering every tap, clipped to the frame; null when off-frame. */
  rect: { x: number; y: number; w: number; h: number } | null;
}

export function sweep(taps: Affine[], w: number, h: number, frameW: number, frameH: number): Sweep {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let travel = 0;
  let prev: Array<[number, number]> | null = null;
  for (const m of taps) {
    const cs = corners(m, w, h);
    for (const [x, y] of cs) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    if (prev) {
      let step = 0;
      for (let j = 0; j < 4; j++) {
        const [px, py] = prev[j] as [number, number];
        const [cx, cy] = cs[j] as [number, number];
        step = Math.max(step, Math.hypot(cx - px, cy - py));
      }
      travel += step;
    }
    prev = cs;
  }
  // 2 px of slack for bilinear filtering at the edges.
  const rx0 = Math.max(0, Math.floor(x0) - 2);
  const ry0 = Math.max(0, Math.floor(y0) - 2);
  const rx1 = Math.min(frameW, Math.ceil(x1) + 2);
  const ry1 = Math.min(frameH, Math.ceil(y1) + 2);
  const rect = rx1 > rx0 && ry1 > ry0 ? { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 } : null;
  return { travel, rect };
}

/** Per-tap alphas, whole 1/255 units summing to 1: canvas quantizes image alpha to them. */
export function tapWeights(n: number): number[] {
  const base = Math.floor(255 / n);
  const extra = 255 - base * n;
  return Array.from(
    { length: n },
    (_, i) => (base + Math.floor(((i + 1) * extra) / n) - Math.floor((i * extra) / n)) / 255,
  );
}

const PROBE_TAPS = 16;

/** Taps sized to the smear: about one per `spacing` px of travel, `min` to `max`. */
export function autoTaps(
  reads: Affine[],
  w: number,
  h: number,
  frameW: number,
  frameH: number,
  spacing = 2,
  max = 128,
  min = 32,
): Affine[] {
  const { travel } = sweep(tapsFromReads(reads, PROBE_TAPS), w, h, frameW, frameH);
  return tapsFromReads(reads, Math.min(max, Math.max(min, Math.ceil(travel / spacing))));
}

/** About one tap per `spacing` px of travel (no visible steps), at least 2, at most all. */
export function thinTaps(taps: Affine[], travel: number, spacing = 1.5): Affine[] {
  const n = Math.min(taps.length, Math.max(2, Math.ceil(travel / spacing)));
  if (n >= taps.length) return taps;
  return Array.from({ length: n }, (_, i) => {
    const k = Math.round(((i + 0.5) / n) * taps.length - 0.5);
    return taps[k] as Affine;
  });
}

/**
 * Reads poses relative to `scene`, memoised for one timeline time: movers share ancestors, so
 * each node's matrix is computed once from its parent's. Call `reset()` after every seek.
 *
 * `dynamic` names the nodes whose transform can change over time; everyone else's own
 * transform is read once and cached for the reader's lifetime.
 */
export function createPoseReader(scene: HTMLElement, dynamic: ReadonlySet<Element>) {
  const staticOwn = new Map<Element, Affine | null>();
  let positions = new Map<Element, [number, number]>();
  let matrices = new Map<Element, Affine>();

  const ownTransform = (n: HTMLElement): Affine | null => {
    const cached = !dynamic.has(n) && staticOwn.has(n);
    if (cached) return staticOwn.get(n) ?? null;
    const cs = getComputedStyle(n);
    const t = multiplyAll([
      individualTransform(cs, n.offsetWidth, n.offsetHeight),
      parseTransform(cs.transform),
    ]);
    let own: Affine | null = null;
    if (t) {
      const [ox = 0, oy = 0] = cs.transformOrigin.split(" ").map((v) => parseFloat(v) || 0);
      own = translate(multiply(translate(IDENTITY, ox, oy), t), -ox, -oy);
    }
    if (!dynamic.has(n)) staticOwn.set(n, own);
    return own;
  };

  // Untransformed border-box position relative to the scene, along the offsetParent chain.
  // offsetLeft/Top measure from the offsetParent's padding edge, so its border is added back.
  const layoutPos = (n: Element | null): [number, number] => {
    if (!n || n === scene || !isOffsetElement(n)) return [0, 0];
    let p = positions.get(n);
    if (!p) {
      const op = n.offsetParent;
      const [px, py] = layoutPos(op);
      p = [px + n.offsetLeft + (op?.clientLeft ?? 0), py + n.offsetTop + (op?.clientTop ?? 0)];
      positions.set(n, p);
    }
    return p;
  };

  const matrixOf = (n: Element | null): Affine => {
    if (!n || n === scene || !isOffsetElement(n)) return IDENTITY;
    let m = matrices.get(n);
    if (!m) {
      const parent = n.parentElement;
      const [x, y] = layoutPos(n);
      const [px, py] = layoutPos(parent);
      const [sx, sy] = scrollOf(parent);
      m = translate(matrixOf(parent), x - px - sx, y - py - sy);
      const own = ownTransform(n);
      if (own) m = multiply(m, own);
      matrices.set(n, m);
    }
    return m;
  };

  return {
    pose: matrixOf as (el: HTMLElement) => Affine,
    reset(): void {
      positions = new Map();
      matrices = new Map();
    },
  };
}

function scrollOf(el: Element | null): [number, number] {
  return el ? [el.scrollLeft, el.scrollTop] : [0, 0];
}

function multiplyAll(ms: Array<Affine | null>): Affine | null {
  let out: Affine | null = null;
  for (const m of ms) if (m) out = out ? multiply(out, m) : m;
  return out;
}

type IndividualProps = Pick<CSSStyleDeclaration, "translate" | "rotate" | "scale">;

// Splits at spaces outside parentheses (`calc(50% + 10px) 5%` is two tokens).
const tokens = (value: string): string[] => value.trim().split(/\s+(?![^(]*\))/);

// A computed length or percentage (`calc(50% + 10px)` included) in px against `basis`.
function lengthPx(token: string, basis: number): number {
  let sum = 0;
  for (const m of token.matchAll(/([+-]?\s*[\d.]+(?:e[+-]?\d+)?)(px|%)?/g)) {
    const v = Number(m[1]?.replace(/\s/g, ""));
    sum += m[2] === "%" ? (v / 100) * basis : v;
  }
  return sum;
}

const ANGLE_UNIT: Record<string, number> = {
  deg: Math.PI / 180,
  rad: 1,
  grad: Math.PI / 200,
  turn: 2 * Math.PI,
};

/**
 * The `translate`, `rotate` and `scale` properties as one 2D affine, in the CSS order (translate,
 * then rotate, then scale; `transform` comes after). Null when none is set.
 */
export function individualTransform(
  cs: Partial<IndividualProps>,
  width: number,
  height: number,
): Affine | null {
  const t = cs.translate ?? "none";
  const r = cs.rotate ?? "none";
  const s = cs.scale ?? "none";
  const parts: Array<Affine | null> = [];
  if (t !== "none") {
    const [x = "0", y = "0"] = tokens(t);
    parts.push({ ...IDENTITY, e: lengthPx(x, width), f: lengthPx(y, height) });
  }
  const turn = /^(-?[\d.]+)(deg|rad|grad|turn)$/.exec(r);
  if (turn) {
    const a = Number(turn[1]) * (ANGLE_UNIT[turn[2] ?? "deg"] ?? 0);
    parts.push({ a: Math.cos(a), b: Math.sin(a), c: -Math.sin(a), d: Math.cos(a), e: 0, f: 0 });
  }
  if (s !== "none") {
    const [sx = 1, sy = sx] = tokens(s).map(Number);
    parts.push({ ...IDENTITY, a: sx, d: sy });
  }
  return multiplyAll(parts);
}

/** Whether `translate` has a z part or `rotate` an axis: a 3D move the 2D pose cannot track. */
export function individualIs3d(cs: Partial<IndividualProps>): boolean {
  const t = cs.translate ?? "none";
  const r = cs.rotate ?? "none";
  return (t !== "none" && tokens(t).length > 2) || !/^(none|-?[\d.]+[a-z]+)$/.test(r);
}

/**
 * A computed `transform` (always `none`, `matrix(...)` or `matrix3d(...)` once resolved) as its
 * 2D affine part; null for `none` or anything unparsable.
 */
export function parseTransform(value: string): Affine | null {
  const match = /^matrix(3d)?\(([^)]*)\)$/.exec(value.trim());
  if (!match) return null;
  const v = (match[2] ?? "").split(",").map(Number);
  if (v.some((x) => !Number.isFinite(x))) return null;
  const pick = match[1] ? [0, 1, 4, 5, 12, 13] : [0, 1, 2, 3, 4, 5];
  if (v.length !== (match[1] ? 16 : 6)) return null;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = pick.map((i) => v[i] ?? 0);
  return { a, b, c, d, e, f };
}

function isOffsetElement(n: Element): n is HTMLElement {
  return typeof (n as HTMLElement).offsetLeft === "number";
}
