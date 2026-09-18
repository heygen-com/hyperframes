// Procedural noise library in TSL. Everything is deterministic from the `seed` node passed in.
import { tsl } from "./t";
const {
  Fn,
  vec3,
  vec4,
  float,
  floor,
  fract,
  dot,
  mix,
  abs,
  max,
  min,
  sqrt,
  normalize,
  cross,
  sin,
  cos,
  int,
  If,
  Loop,
  mx_noise_float,
  mx_noise_vec3,
  smoothstep,
  select,
} = tsl;

type N = any;

/** vec3 -> float hash in [0,1). */
export const hash31 = Fn(([p]: [N]) => {
  const q = fract(vec3(p).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  q.addAssign(dot(q, q.yxz.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
});

/** vec3 -> vec3 hash in [0,1)^3. */
export const hash33 = Fn(([p]: [N]) => {
  const q = fract(vec3(p).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  q.addAssign(dot(q, q.yxz.add(33.33)));
  return fract(q.xxy.add(q.yxx).mul(q.zyx));
});

/** float -> float hash. */
export const hash11 = Fn(([x]: [N]) => {
  const q = fract(float(x).mul(0.1031)).toVar();
  q.mulAssign(q.add(33.33));
  q.mulAssign(q.add(q));
  return fract(q);
});

/**
 * Decorrelated per-particle random in [0,1) from a seed in [0,1) and a small integer channel `k`.
 * (hash11 on small inputs is a smooth function of its argument, which made "random" grain rotations
 * correlate with the seed.)
 */
export const hashSeed = (seed: N, k: number) =>
  hash31(
    vec3(
      float(seed)
        .mul(1024.7)
        .add(k * 3.1),
      float(seed)
        .mul(2047.3)
        .add(k * 7.7 + 1.3),
      float(seed)
        .mul(511.1)
        .add(k * 13.9 + 2.9),
    ),
  );

/** Perlin gradient noise, ~[-1,1]. */
export const gnoise = (p: N) => mx_noise_float(p);

/**
 * vec3 gradient noise built from three float Perlin evaluations. (three's mx_noise_vec3 is avoided:
 * its WGSL stalls SwiftShader's compiler in fragment shaders, which is our only headless check.)
 */
export const vnoise3 = (p: N) =>
  vec3(
    mx_noise_float(p),
    mx_noise_float(vec3(p).yzx.add(vec3(17.1, 9.7, 3.3))),
    mx_noise_float(vec3(p).zxy.add(vec3(31.7, 5.9, 21.3))),
  );

/** Fractal Brownian motion, unrolled `octaves` times. Returns roughly [-1,1]. */
export function fbm(p: N, octaves: number, lacunarity = 2.0, gain = 0.5): N {
  let sum: N = float(0);
  let amp = 1;
  let norm = 0;
  let q: N = vec3(p);
  for (let i = 0; i < octaves; i++) {
    sum = sum.add(mx_noise_float(q).mul(amp));
    norm += amp;
    amp *= gain;
    q = q.mul(lacunarity).add(vec3(17.3, 9.1, 31.7));
  }
  return sum.div(norm);
}

/** Ridged fbm in [0,1] (sharp creases) — used for frost crystal texture. */
export function ridged(p: N, octaves: number): N {
  let sum: N = float(0);
  let amp = 1;
  let norm = 0;
  let q: N = vec3(p);
  for (let i = 0; i < octaves; i++) {
    const n = abs(mx_noise_float(q)).oneMinus();
    sum = sum.add(n.mul(n).mul(amp));
    norm += amp;
    amp *= 0.5;
    q = q.mul(2.1).add(vec3(5.2, 1.3, 8.7));
  }
  return sum.div(norm);
}

/** Divergence-free curl noise from a vec3 potential (finite differences). */
export const curlNoise = Fn(([p]: [N]) => {
  const e = float(0.02);
  const dx = vec3(e, 0, 0),
    dy = vec3(0, e, 0),
    dz = vec3(0, 0, e);
  const px0 = vnoise3(p.sub(dx)),
    px1 = vnoise3(p.add(dx));
  const py0 = vnoise3(p.sub(dy)),
    py1 = vnoise3(p.add(dy));
  const pz0 = vnoise3(p.sub(dz)),
    pz1 = vnoise3(p.add(dz));
  const x = py1.z.sub(py0.z).sub(pz1.y.sub(pz0.y));
  const y = pz1.x.sub(pz0.x).sub(px1.z.sub(px0.z));
  const z = px1.y.sub(px0.y).sub(py1.x.sub(py0.x));
  return vec3(x, y, z).div(e.mul(2));
});

/**
 * 3D Voronoi over the 27-cell neighbourhood.
 * Returns vec4( nearest feature point (3), sqrt F1 ) — feature point acts as the cell id.
 */
export const voronoiCell = Fn(([p, seed]: [N, N]) => {
  const ip = floor(p).toVar();
  const fp = fract(p).toVar();
  const f1 = float(8).toVar();
  const center = vec3(0).toVar();
  const rng = { start: int(-1), end: int(1), condition: "<=" };
  Loop(rng, rng, rng, ({ i, j, k }: any) => {
    const g = vec3(float(i), float(j), float(k));
    const cell = ip.add(g);
    const o = hash33(cell.add(seed));
    const r = g.add(o).sub(fp);
    const d = dot(r, r);
    If(d.lessThan(f1), () => {
      f1.assign(d);
      center.assign(cell.add(o));
    });
  });
  return vec4(center, sqrt(f1));
});

/**
 * Cheaper Voronoi: feature points on a jittered lattice, only the 2x2x2 cells around p are searched.
 * ~3x cheaper than the 27-cell version; the nearest point is occasionally missed near cell corners.
 */
export const voronoiCell8 = Fn(([p, seed]: [N, N]) => {
  const ip = floor(vec3(p).sub(0.5)).toVar();
  const f1 = float(8).toVar();
  const center = vec3(0).toVar();
  const rng = { start: int(0), end: int(1), condition: "<=" };
  Loop(rng, rng, rng, ({ i, j, k }: any) => {
    const cell = ip.add(vec3(float(i), float(j), float(k)));
    const fp = cell.add(hash33(cell.add(seed)));
    const r = fp.sub(p);
    const d = dot(r, r);
    If(d.lessThan(f1), () => {
      f1.assign(d);
      center.assign(fp);
    });
  });
  return vec4(center, sqrt(f1));
});

/**
 * Distance to the nearest Voronoi cell boundary (true plane distance, IQ-style second pass).
 * Boundaries whose pair-hash exceeds `coverage` are culled (so cells are not fully enclosed).
 * Returns vec4( boundary normal (3), distance ).
 */
export const voronoiEdge = Fn(([p, seed, coverage]: [N, N, N]) => {
  const ip = floor(p).toVar();
  const fp = fract(p).toVar();
  const md = float(8).toVar();
  const mr = vec3(0).toVar();
  const mc = vec3(0).toVar();
  const rng1 = { start: int(-1), end: int(1), condition: "<=" };
  Loop(rng1, rng1, rng1, ({ i, j, k }: any) => {
    const g = vec3(float(i), float(j), float(k));
    const cell = ip.add(g);
    const o = hash33(cell.add(seed));
    const r = g.add(o).sub(fp);
    const d = dot(r, r);
    If(d.lessThan(md), () => {
      md.assign(d);
      mr.assign(r);
      mc.assign(cell);
    });
  });
  md.assign(8);
  const mn = vec3(0, 0, 1).toVar();
  const rng2 = { start: int(-2), end: int(2), condition: "<=" };
  Loop(rng2, rng2, rng2, ({ i, j, k }: any) => {
    const g = vec3(float(i), float(j), float(k));
    const cell = ip.add(g);
    const o = hash33(cell.add(seed));
    const r = g.add(o).sub(fp);
    const diff = r.sub(mr);
    const keep = hash31(cell.add(mc).mul(0.731).add(seed)).lessThan(coverage);
    If(dot(diff, diff).greaterThan(0.00001).and(keep), () => {
      const n = normalize(diff);
      const d = dot(mr.add(r).mul(0.5), n);
      If(d.lessThan(md), () => {
        md.assign(d);
        mn.assign(n);
      });
    });
  });
  return vec4(mn, md);
});

/** Smooth 0..1 threshold helper. */
export const softThreshold = (x: N, threshold: N, softness: N) =>
  smoothstep(
    float(threshold).sub(float(softness).mul(0.5)),
    float(threshold).add(float(softness).mul(0.5)),
    x,
  );

/** Orthonormal basis (tangent, bitangent) for a normal. */
export const basisFor = (n: N) => {
  const nn = normalize(n);
  const up = select(abs(nn.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0));
  const t = normalize(cross(up, nn));
  const b = cross(nn, t);
  return { t, b };
};

/** Rotation of vector v around axis a by angle ang (Rodrigues). */
export const rotateAxis = (v: N, a: N, ang: N) => {
  const c = cos(ang),
    s = sin(ang);
  return v
    .mul(c)
    .add(cross(a, v).mul(s))
    .add(a.mul(dot(a, v)).mul(float(1).sub(c)));
};

export const saturate = (x: N) => min(max(x, 0), 1);
