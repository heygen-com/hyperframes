// `logo` shape: load an SVG, round corners, extrude with a bevel, crease normals, voxelise a signed distance grid
// (three-mesh-bvh) so raycast, sampling and raymarch match the primitives. FROST: loadLogo() is split into
// loadLogoShapes() + extrudeShapes() + voxelize() so headlines share the pipeline and several shapes share one `bound`.
import { unionOutlines } from "./unionOutlines";
import * as THREE from "three/webgpu";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeVertices, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";
import type { LogoSDF } from "./sdf";

export interface LogoParams {
  /** overall width of the mark in world units */
  width: number;
  /** extrusion depth as a fraction of the width */
  depth: number;
  bevelThickness: number;
  bevelSize: number;
  bevelOffset: number;
  bevelSegments: number;
  curveSegments: number;
  /** rounding radius applied to the 2D outline corners (fraction of the width, 0 = keep hard corners) */
  cornerRadius: number;
  /** normals are hard above this angle (degrees) and smooth below it */
  creaseAngle: number;
  /** SDF grid resolution */
  sdfRes: number;
}
export const DEFAULT_LOGO_PARAMS: LogoParams = {
  width: 2.6,
  depth: 0.22,
  bevelThickness: 0.06,
  bevelSize: 0.05,
  bevelOffset: 0,
  bevelSegments: 5,
  curveSegments: 24,
  cornerRadius: 0.03,
  creaseAngle: 40,
  sdfRes: 64,
};

/** Round the corners of a closed polygon: cut each sharp corner back by `r` and bridge it with a quadratic curve. */
function roundPolygon(pts: THREE.Vector2[], r: number): THREE.Path {
  // Closed paths repeat their first point. Keeping that duplicate makes both end
  // segments zero-length and drops the first real corner (e.g. the H's left foot).
  pts = pts.filter((p, i) => i === 0 || p.distanceToSquared(pts[i - 1]) > 1e-18);
  if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-18)
    pts = pts.slice(0, -1);
  const n = pts.length;
  const path = new THREE.Path();
  if (r <= 0 || n < 3) {
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) path.lineTo(pts[i].x, pts[i].y);
    path.closePath();
    return path;
  }
  const segs: { a: THREE.Vector2; c: THREE.Vector2; b: THREE.Vector2; sharp: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      prev = pts[(i - 1 + n) % n],
      next = pts[(i + 1) % n];
    const d1 = prev.clone().sub(p),
      d2 = next.clone().sub(p);
    const l1 = d1.length(),
      l2 = d2.length();
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const ang = Math.acos(THREE.MathUtils.clamp(d1.dot(d2) / (l1 * l2), -1, 1));
    const sharp = ang < THREE.MathUtils.degToRad(168);
    const rr = Math.min(r, l1 * 0.45, l2 * 0.45);
    segs.push({
      a: p.clone().addScaledVector(d1.normalize(), sharp ? rr : 0),
      c: p,
      b: p.clone().addScaledVector(d2.normalize(), sharp ? rr : 0),
      sharp,
    });
  }
  segs.forEach((s, i) => {
    if (i === 0) path.moveTo(s.a.x, s.a.y);
    else path.lineTo(s.a.x, s.a.y);
    if (s.sharp) path.quadraticCurveTo(s.c.x, s.c.y, s.b.x, s.b.y);
  });
  path.closePath();
  return path;
}

/** The SVG's shapes fitted to `P.width`, centred, y-up (world units). */
export async function loadLogoShapes(
  url: string,
  params: Partial<LogoParams> = {},
): Promise<THREE.Shape[]> {
  const P = { ...DEFAULT_LOGO_PARAMS, ...params };
  const text = await fetch(url).then((r) =>
    r.ok ? r.text() : Promise.reject(new Error("no logo")),
  );
  const data = new SVGLoader().parse(text);
  const raw: THREE.Shape[] = [];
  for (const p of data.paths) raw.push(...(p as any).toShapes(true));
  if (!raw.length) return [];
  // svg units -> world units (fit the width), y-up
  const box = new THREE.Box2();
  for (const s of raw) for (const pt of s.getPoints(8)) box.expandByPoint(pt);
  const size = box.getSize(new THREE.Vector2()),
    centre = box.getCenter(new THREE.Vector2());
  const k = P.width / Math.max(size.x, size.y);
  const tx = (v: THREE.Vector2) => new THREE.Vector2((v.x - centre.x) * k, -(v.y - centre.y) * k);
  return raw.map((s) => {
    const shape = new THREE.Shape(s.getPoints(P.curveSegments).map(tx));
    shape.holes = s.holes.map((h) => new THREE.Path(h.getPoints(P.curveSegments).map(tx)));
    return shape;
  });
}

/**
 * Round outline corners (radius `P.cornerRadius * ref`), extrude with a bevel (depth and bevel as fractions of
 * `ref`), merge, crease normals and centre. `ref` is the mark's width for the logo, the font size for a headline.
 */
export function extrudeShapes(
  raw: THREE.Shape[],
  P: LogoParams,
  ref: number,
): THREE.BufferGeometry {
  const r = P.cornerRadius * ref;
  const rounded: THREE.Shape[] = unionOutlines(raw, P.curveSegments).map((s) => {
    const outer = roundPolygon(s.getPoints(P.curveSegments), r);
    const shape = new THREE.Shape(outer.getPoints(P.curveSegments));
    shape.holes = s.holes.map((h) => roundPolygon(h.getPoints(P.curveSegments), r));
    return shape;
  });
  const shapes = unionOutlines(rounded, P.curveSegments);
  const bevel = P.bevelThickness > 0 || P.bevelSize > 0;
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shapes, {
    depth: P.depth * ref,
    bevelEnabled: bevel,
    bevelThickness: P.bevelThickness * ref,
    bevelSize: P.bevelSize * ref,
    bevelOffset: P.bevelOffset * ref,
    bevelSegments: Math.max(1, Math.round(P.bevelSegments)),
    curveSegments: Math.max(2, Math.round(P.curveSegments)),
  });
  geo.center();
  geo = mergeVertices(geo, 1e-5);
  geo = toCreasedNormals(geo, THREE.MathUtils.degToRad(P.creaseAngle));
  geo.computeBoundingBox();
  // The broad caps are planes. Averaging adjacent bevel faces into their
  // normals makes Earcut's long triangles show through reflective materials.
  // Keep the end rings tangent to the caps, so the rounded bevel joins smoothly
  // without tilting the entire cap. Positions/topology and the SDF stay identical.
  if (P.bevelThickness > 0 && P.bevelSize > 0) {
    const position = geo.getAttribute("position"),
      normal = geo.getAttribute("normal");
    const { min, max } = geo.boundingBox!;
    const epsilon = Math.max((max.z - min.z) * 1e-6, 1e-8);
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i);
      if (Math.abs(z - min.z) <= epsilon) normal.setXYZ(i, 0, 0, -1);
      else if (Math.abs(z - max.z) <= epsilon) normal.setXYZ(i, 0, 0, 1);
    }
    normal.needsUpdate = true;
  }
  return geo;
}

/** Half extents of a centred geometry. */
export function halfExtents(geo: THREE.BufferGeometry) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const half = new THREE.Vector3();
  geo.boundingBox!.getSize(half).multiplyScalar(0.5);
  return half;
}

/** The texture samples [-sampleBound, sampleBound]^3; bound keeps the shared simulation domain and distance range. */
export function makeLogoSDF(
  data3: Float32Array,
  n: number,
  bound: number,
  thickness: number,
  sampleBound = bound,
): LogoSDF {
  const range = bound;
  // Sampling can be tight per shape while erosion/particles keep a common world domain.
  const sampleDomain = { value: sampleBound };
  const tex = new THREE.Data3DTexture(data3, n, n, n);
  tex.format = THREE.RedFormat;
  tex.type = THREE.FloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const sample = (x: number, y: number, z: number) => {
    const bound = sampleDomain.value;
    const fx = (x / (2 * bound) + 0.5) * n - 0.5,
      fy = (y / (2 * bound) + 0.5) * n - 0.5,
      fz = (z / (2 * bound) + 0.5) * n - 0.5;
    const ix = Math.max(0, Math.min(n - 2, Math.floor(fx))),
      iy = Math.max(0, Math.min(n - 2, Math.floor(fy))),
      iz = Math.max(0, Math.min(n - 2, Math.floor(fz)));
    const tx2 = Math.max(0, Math.min(1, fx - ix)),
      ty = Math.max(0, Math.min(1, fy - iy)),
      tz = Math.max(0, Math.min(1, fz - iz));
    const v = (a: number, b: number, c: number) => data3[a + b * n + c * n * n];
    const c00 = v(ix, iy, iz) * (1 - tx2) + v(ix + 1, iy, iz) * tx2,
      c10 = v(ix, iy + 1, iz) * (1 - tx2) + v(ix + 1, iy + 1, iz) * tx2;
    const c01 = v(ix, iy, iz + 1) * (1 - tx2) + v(ix + 1, iy, iz + 1) * tx2,
      c11 = v(ix, iy + 1, iz + 1) * (1 - tx2) + v(ix + 1, iy + 1, iz + 1) * tx2;
    const c0 = c00 * (1 - ty) + c10 * ty,
      c1 = c01 * (1 - ty) + c11 * ty;
    const outside = Math.abs(x) > bound || Math.abs(y) > bound || Math.abs(z) > bound;
    const distance = (c0 * (1 - tz) + c1 * tz) * 2 * range - range;
    return outside
      ? Math.max(
          distance,
          Math.hypot(
            Math.max(Math.abs(x) - bound, 0),
            Math.max(Math.abs(y) - bound, 0),
            Math.max(Math.abs(z) - bound, 0),
          ),
        )
      : distance;
  };
  return { texture: tex, res: n, bound, range, thickness, data: data3, sample, sampleDomain };
}

/**
 * Voxel SDF over [-bound, bound]^3 at `res` per axis: unsigned BVH closest-point distance, sign from ray parity
 * along z (odd crossings = interior). The closest face's normal gives wrong signs near edges and bevels; those
 * voxels read as solid and never erode, leaving slivers (visible at the full 192 field). The closest-point
 * query is capped a few voxels past the surface (far voxels are outside for these thin extrusions).
 */
export function voxelize(
  geo: THREE.BufferGeometry,
  bound: number,
  res: number,
  sampleBound = bound,
): LogoSDF {
  const half = halfExtents(geo);
  const thickness = Math.min(half.x, half.y, half.z);
  const bvh = new MeshBVH(geo);
  const n = Math.max(16, Math.round(res)),
    data3 = new Float32Array(n * n * n);
  const p = new THREE.Vector3();
  const range = bound;
  const voxel = (2 * sampleBound) / n;
  const maxDist = Math.min(range, Math.max(thickness * 2.5, voxel * 14));
  const box = geo.boundingBox!;
  const maxDistSquared = maxDist * maxDist;
  const hit: any = {};
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
  const inside = new Uint8Array(n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // one ray per column, nudged off the grid so it never grazes an edge exactly
      const cx = ((x + 0.5) / n - 0.5) * 2 * sampleBound + voxel * 0.013,
        cy = ((y + 0.5) / n - 0.5) * 2 * sampleBound + voxel * 0.017;
      ray.origin.set(cx, cy, -sampleBound - 1);
      const hits = bvh.raycast(ray, THREE.DoubleSide) as { distance: number }[];
      const crossings = (hits as any[])
        .map((h) => ({ z: h.distance - sampleBound - 1, delta: h.face.normal.z < 0 ? 1 : -1 }))
        .sort((a, b) => a.z - b.z);
      let k = 0,
        winding = 0;
      for (let z = 0; z < n; z++) {
        const pz = ((z + 0.5) / n - 0.5) * 2 * sampleBound;
        while (k < crossings.length && crossings[k].z < pz) winding += crossings[k++].delta;
        inside[z] = Number(winding !== 0);
      }
      for (let z = 0; z < n; z++) {
        p.set(
          ((x + 0.5) / n - 0.5) * 2 * sampleBound,
          ((y + 0.5) / n - 0.5) * 2 * sampleBound,
          ((z + 0.5) / n - 0.5) * 2 * sampleBound,
        );
        // A thin extrusion occupies little of the cube. The box distance is a
        // lower bound: skip BVH work only when the capped query cannot find a hit.
        const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
        const dy = Math.max(box.min.y - p.y, 0, p.y - box.max.y);
        const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
        const res2 =
          dx * dx + dy * dy + dz * dz > maxDistSquared
            ? null
            : bvh.closestPointToPoint(p, hit, 0, maxDist);
        let d = res2 ? res2.distance : range;
        if (inside[z]) d = -d;
        data3[x + y * n + z * n * n] = Math.min(1, Math.max(0, (d + range) / (2 * range)));
      }
    }
  return makeLogoSDF(data3, n, bound, thickness, sampleBound);
}

/** The experiment's original entry point: SVG -> extruded geometry + its own SDF. */
export async function loadLogo(
  url: string,
  params: Partial<LogoParams> = {},
): Promise<{ sdf: LogoSDF; geometry: THREE.BufferGeometry } | undefined> {
  const P = { ...DEFAULT_LOGO_PARAMS, ...params };
  const shapes = await loadLogoShapes(url, P);
  if (!shapes.length) return undefined;
  const geo = extrudeShapes(shapes, P, P.width);
  const half = halfExtents(geo);
  const bound = Math.max(half.x, half.y, half.z) * 1.15;
  return { sdf: voxelize(geo, bound, P.sdfRes), geometry: geo };
}
