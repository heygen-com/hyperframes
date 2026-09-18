// Object-space signed distance fields, on the CPU (raycast + interior sampling) and in TSL (shaders).
// The shape sits centered at the origin; `size` = 1 gives a torus of major radius 1.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
const { Fn, vec2, vec3, float, length, max, min, abs, dot, sqrt, clamp, sign, select, texture3D } =
  tsl;
import type { ShapeName } from "../dials/defaults";

type N = any;

export interface ShapeSpec {
  name: ShapeName;
  size: number;
  tubeRatio: number;
  /** Half extent of the bounding cube used for the erosion field (object space). */
  bound: number;
  /** CPU signed distance. */
  sdf: (x: number, y: number, z: number) => number;
  /** TSL signed distance for a vec3 node. */
  sdfNode: (p: N) => N;
  /** Approximate tube half-thickness (used for the surface-bias sampling shell). */
  thickness: number;
  /** Object-space voxel spacing; follows the active shape during retargeting. */
  voxelSize?: N;
}

const ICOSA_NORMALS: [number, number, number][] = (() => {
  const phi = (1 + Math.sqrt(5)) / 2;
  const n: [number, number, number][] = [];
  const push = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z);
    n.push([x / l, y / l, z / l]);
  };
  // 20 face normals of a regular icosahedron = vertices of a dodecahedron
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) push(sx, sy, sz);
  for (const s1 of [-1, 1])
    for (const s2 of [-1, 1]) {
      push(0, s1 / phi, s2 * phi);
      push(s1 / phi, s2 * phi, 0);
      push(s1 * phi, 0, s2 / phi);
    }
  return n;
})();

const CUBE_POS: [number, number, number][] = [];
const RECT_POS: [number, number, number][] = [];

export function makeShape(
  name: ShapeName,
  size: number,
  tubeRatio: number,
  logoSDF?: LogoSDF,
): ShapeSpec {
  const R = size,
    r = size * tubeRatio;
  switch (name) {
    case "torus": {
      return {
        name,
        size,
        tubeRatio,
        bound: (R + r) * 1.12,
        thickness: r,
        sdf: (x, y, z) => {
          const qx = Math.hypot(x, y) - R;
          return Math.hypot(qx, z) - r;
        },
        sdfNode: (p) => length(vec2(length(p.xy).sub(R), p.z)).sub(r),
      };
    }
    case "sphere": {
      const rad = size * 1.15;
      return {
        name,
        size,
        tubeRatio,
        bound: rad * 1.15,
        thickness: rad,
        sdf: (x, y, z) => Math.hypot(x, y, z) - rad,
        sdfNode: (p) => length(p).sub(rad),
      };
    }
    case "roundedBox": {
      const h = size * 0.92,
        rr = size * 0.22;
      return {
        name,
        size,
        tubeRatio,
        bound: (h + rr) * 1.12,
        thickness: h,
        sdf: (x, y, z) => {
          const qx = Math.abs(x) - h + rr,
            qy = Math.abs(y) - h + rr,
            qz = Math.abs(z) - h * 0.55 + rr;
          const ox = Math.max(qx, 0),
            oy = Math.max(qy, 0),
            oz = Math.max(qz, 0);
          return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - rr;
        },
        sdfNode: (p) => {
          const q = abs(p).sub(vec3(h - rr, h - rr, h * 0.55 - rr));
          return length(max(q, 0))
            .add(min(max(q.x, max(q.y, q.z)), 0))
            .sub(rr);
        },
      };
    }
    case "pyramid": {
      // square pyramid, apex up (+y), base half-width b, height hgt, with a rounding radius
      const b = size * 1.05,
        hgt = size * 1.5,
        rr = size * 0.06;
      const ny = b / Math.hypot(b, hgt),
        nx = hgt / Math.hypot(b, hgt);
      const yOff = -hgt * 0.4;
      return {
        name,
        size,
        tubeRatio,
        bound: Math.max(b, hgt) * 1.25,
        thickness: b * 0.6,
        sdf: (x, y, z) => {
          y -= yOff;
          const ax = Math.abs(x),
            az = Math.abs(z);
          const dSide = Math.max(ax * nx + y * ny - hgt * ny, az * nx + y * ny - hgt * ny);
          const dBase = -y;
          return Math.max(dSide, dBase) - rr;
        },
        sdfNode: (p) => {
          const pp = vec3(p.x, p.y.sub(yOff), p.z);
          const ax = abs(pp.x),
            az = abs(pp.z);
          const dSide = max(
            ax
              .mul(nx)
              .add(pp.y.mul(ny))
              .sub(hgt * ny),
            az
              .mul(nx)
              .add(pp.y.mul(ny))
              .sub(hgt * ny),
          );
          return max(dSide, pp.y.negate()).sub(rr);
        },
      };
    }
    case "icosahedron": {
      const h = size * 1.05,
        rr = size * 0.05;
      return {
        name,
        size,
        tubeRatio,
        bound: h * 1.3,
        thickness: h * 0.8,
        sdf: (x, y, z) => {
          let d = -Infinity;
          for (const n of ICOSA_NORMALS) d = Math.max(d, x * n[0] + y * n[1] + z * n[2]);
          return d - h - rr;
        },
        sdfNode: (p) => {
          let d: N = float(-100);
          for (const n of ICOSA_NORMALS) d = max(d, dot(p, vec3(n[0], n[1], n[2])));
          return d.sub(h + rr);
        },
      };
    }
    case "logo": {
      // `size` scales the loaded mark uniformly (geometry, bound and distance field alike)
      const ls = logoSDF!,
        k = size;
      const sampleBoundNode = (ls.sampleBoundNode ??= tsl.uniform(ls.sampleDomain.value));
      return {
        name,
        size,
        tubeRatio,
        bound: ls.bound * k,
        thickness: ls.thickness * k,
        voxelSize: sampleBoundNode.mul((2 * k) / ls.res),
        sdf: (x, y, z) => ls.sample(x / k, y / k, z / k) * k,
        sdfNode: (p) => {
          const sampleBound = sampleBoundNode.mul(k);
          const uvw = p.div(sampleBound.mul(2)).add(0.5);
          const distance = texture3D(ls.texture, uvw)
            .r.mul(ls.range * 2)
            .sub(ls.range)
            .mul(k);
          const outside = max(abs(p).sub(sampleBound), 0);
          return select(
            max(outside.x, max(outside.y, outside.z)).greaterThan(0),
            max(distance, length(outside)),
            distance,
          );
        },
      };
    }
  }
}

/** Voxelised SDF for arbitrary meshes (logo). Values stored normalised: (d + range) / (2 range). */
export interface LogoSDF {
  texture: THREE.Data3DTexture;
  res: number;
  bound: number;
  range: number;
  thickness: number;
  data: Float32Array;
  sample: (x: number, y: number, z: number) => number;
  sampleDomain: { value: number };
  sampleBoundNode?: N;
}

/** Central-difference normal from the CPU sdf. */
export function sdfNormal(
  s: ShapeSpec,
  x: number,
  y: number,
  z: number,
  e = 1e-3,
): [number, number, number] {
  const nx = s.sdf(x + e, y, z) - s.sdf(x - e, y, z);
  const ny = s.sdf(x, y + e, z) - s.sdf(x, y - e, z);
  const nz = s.sdf(x, y, z + e) - s.sdf(x, y, z - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** TSL gradient normal from the shape sdf. */
export const sdfNormalNode = (s: ShapeSpec, p: N, e = 0.002) => {
  const ex = vec3(e, 0, 0),
    ey = vec3(0, e, 0),
    ez = vec3(0, 0, e);
  const n = vec3(
    s.sdfNode(p.add(ex)).sub(s.sdfNode(p.sub(ex))),
    s.sdfNode(p.add(ey)).sub(s.sdfNode(p.sub(ey))),
    s.sdfNode(p.add(ez)).sub(s.sdfNode(p.sub(ez))),
  );
  return n.div(max(length(n), 1e-6));
};

export interface RayHit {
  entry: THREE.Vector3;
  exit: THREE.Vector3;
  tEntry: number;
  tExit: number;
}

/**
 * Sphere-trace the object-space sdf. Returns entry and exit points along the ray, or null.
 * `origin`/`dir` in object space; dir normalised.
 */
export function raycastSDF(
  s: ShapeSpec,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist = 60,
  target?: RayHit,
): RayHit | null {
  let t = 0;
  let px = origin.x,
    py = origin.y,
    pz = origin.z;
  // enter
  let entered = false;
  for (let i = 0; i < 160; i++) {
    px = dir.x * t + origin.x;
    py = dir.y * t + origin.y;
    pz = dir.z * t + origin.z;
    const d = s.sdf(px, py, pz);
    if (d < 0.0015) {
      entered = true;
      break;
    }
    t += Math.max(d, 0.002);
    if (t > maxDist) break;
  }
  if (!entered) return null;
  const tEntry = t;
  const hit = target ?? {
    entry: new THREE.Vector3(),
    exit: new THREE.Vector3(),
    tEntry: 0,
    tExit: 0,
  };
  hit.entry.set(px, py, pz);
  // exit: march inside using the interior distance
  let tt = t + 0.004;
  for (let i = 0; i < 200; i++) {
    px = dir.x * tt + origin.x;
    py = dir.y * tt + origin.y;
    pz = dir.z * tt + origin.z;
    const d = s.sdf(px, py, pz);
    if (d > 0.0015) break;
    tt += Math.max(-d, 0.004);
    if (tt - t > s.bound * 4) break;
  }
  hit.exit.set(dir.x * tt + origin.x, dir.y * tt + origin.y, dir.z * tt + origin.z);
  hit.tEntry = tEntry;
  hit.tExit = tt;
  return hit;
}

export interface InteriorSamples {
  positions: Float32Array; // xyz per point
  depths: Float32Array; // 0 at the surface .. 1 deep inside (relative to thickness)
  count: number;
}

/** Rejection-sample the interior of the shape. `surfaceBias` fraction of points fall within the outer `shell` fraction of thickness. */
export function sampleInterior(
  s: ShapeSpec,
  count: number,
  surfaceBias: number,
  shell: number,
  rand: () => number,
  box?: [number, number, number],
): InteriorSamples {
  const positions = new Float32Array(count * 3);
  const depths = new Float32Array(count);
  // FROST: optional half extents of the shape itself (a thin headline fills ~1% of the bound cube, so sampling
  // the cube starves the guard below and leaves most points at the origin)
  const BX = box ? box[0] : s.bound,
    BY = box ? box[1] : s.bound,
    BZ = box ? box[2] : s.bound;
  const B = s.bound;
  const shellDepth = s.thickness * shell;
  const nSurf = Math.round(count * surfaceBias);
  let i = 0;
  let guard = 0;
  while (i < count && guard < count * 400) {
    guard++;
    const x = (rand() * 2 - 1) * BX,
      y = (rand() * 2 - 1) * BY,
      z = (rand() * 2 - 1) * BZ;
    const d = s.sdf(x, y, z);
    if (d >= 0) continue;
    const depth = -d;
    const wantSurface = i < nSurf;
    // Thin glyphs may have no deep core. Relax the bias after the bounded first
    // pass; never silently return zero-filled homes at the origin.
    if (guard < count * 60) {
      if (wantSurface && depth > shellDepth) continue;
      if (!wantSurface && depth <= shellDepth) continue;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    depths[i] = Math.min(1, depth / s.thickness);
    i++;
  }
  if (i !== count)
    throw new Error(`Frost: sampled only ${i}/${count} interior homes; check shape bounds and SDF`);
  return { positions, depths, count: i };
}

void CUBE_POS;
void RECT_POS;
void sqrt;
void clamp;
void sign;
void select;
void Fn;
