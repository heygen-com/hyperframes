// Mesh geometry per shape. Every shape ends up as a closed, densely tessellated surface whose
// vertices lie on the SDF zero set (so the raymarch / erosion coupling stays consistent).
import * as THREE from "three/webgpu";
import { ShapeSpec, sdfNormal } from "./sdf";

/** Push each vertex onto the SDF zero set along the gradient (few Newton steps) and take SDF normals. */
function projectOntoSDF(geo: THREE.BufferGeometry, s: ShapeSpec, steps = 4) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    for (let k = 0; k < steps; k++) {
      const d = s.sdf(x, y, z);
      const n = sdfNormal(s, x, y, z);
      x -= n[0] * d;
      y -= n[1] * d;
      z -= n[2] * d;
    }
    const n = sdfNormal(s, x, y, z, 0.004);
    pos.setXYZ(i, x, y, z);
    nrm[i * 3] = n[0];
    nrm[i * 3 + 1] = n[1];
    nrm[i * 3 + 2] = n[2];
  }
  pos.needsUpdate = true;
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return geo;
}

export function buildGeometry(
  s: ShapeSpec,
  segments: number,
  logoGeometry?: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const R = s.size,
    r = s.size * s.tubeRatio;
  switch (s.name) {
    case "torus": {
      const g = new THREE.TorusGeometry(R, r, Math.max(24, Math.round(segments * 0.4)), segments);
      // TorusGeometry lies in XY with the hole along Z — matches the sdf.
      return g;
    }
    case "sphere":
      return projectOntoSDF(
        new THREE.SphereGeometry(1, segments, Math.round(segments * 0.6)),
        s,
        2,
      );
    case "roundedBox": {
      const seg = Math.max(8, Math.round(segments / 4));
      const h = s.size * 0.92;
      const g = new THREE.BoxGeometry(
        2 * h,
        2 * h,
        2 * h * 0.55,
        seg,
        seg,
        Math.max(4, Math.round(seg * 0.55)),
      );
      // pre-round: blend vertices toward a sphere before projecting so the corners get tessellation
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          y = pos.getY(i),
          z = pos.getZ(i);
        const l = Math.hypot(x, y, z) || 1;
        const t = 0.35;
        pos.setXYZ(
          i,
          x * (1 - t) + (x / l) * h * t,
          y * (1 - t) + (y / l) * h * t,
          z * (1 - t) + (z / l) * h * t,
        );
      }
      return projectOntoSDF(g, s, 6);
    }
    case "pyramid": {
      const g = new THREE.IcosahedronGeometry(s.size * 1.4, 6);
      return projectOntoSDF(g, s, 8);
    }
    case "icosahedron": {
      const g = new THREE.IcosahedronGeometry(s.size * 1.2, 6);
      return projectOntoSDF(g, s, 6);
    }
    case "logo": {
      const g = (logoGeometry ?? new THREE.TorusGeometry(R, r, 64, segments)).clone();
      if (logoGeometry)
        g.scale(s.size, s.size, s.size); // normals are unaffected by a uniform scale
      else g.computeVertexNormals();
      return g;
    }
  }
}

/** Small irregular grain meshes (lumpy icospheres and shards). */
export function buildGrainVariants(
  count: number,
  rand: () => number,
  faceted = false,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let v = 0; v < count; v++) {
    if (faceted) {
      out.push(buildFacetedShard(v, rand));
      continue;
    }
    const shard = v % 3 === 2;
    const g = shard
      ? new THREE.TetrahedronGeometry(1, 1) // 16 tris
      : new THREE.IcosahedronGeometry(1, v % 2); // 20 / 80 tris
    const pos = g.attributes.position as THREE.BufferAttribute;
    const sx = 0.7 + rand() * 0.6,
      sy = 0.7 + rand() * 0.6,
      sz = shard ? 0.35 + rand() * 0.3 : 0.7 + rand() * 0.6;
    const seed = rand() * 100;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const l =
        1 + 0.28 * Math.sin(seed + x * 5.1 + y * 3.7) * Math.cos(seed * 0.7 + z * 4.3 + x * 2.2);
      pos.setXYZ(i, x * l * sx, y * l * sy, z * l * sz);
    }
    g.computeVertexNormals();
    out.push(g);
  }
  return out;
}

/** Flat-shaded shard: a low-poly convex solid with per-vertex jitter and hard edges, so every face catches
 *  the key light separately (glass-splinter look). 8-20 tris, no more than the smooth variants. */
function buildFacetedShard(v: number, rand: () => number): THREE.BufferGeometry {
  const kind = v % 3;
  const g =
    kind === 0
      ? new THREE.IcosahedronGeometry(1, 0)
      : kind === 1
        ? new THREE.OctahedronGeometry(1, 0)
        : new THREE.TetrahedronGeometry(1, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // elongated splinter proportions; one axis thin
  const sx = 0.55 + rand() * 0.9,
    sy = 0.55 + rand() * 0.9,
    sz = 0.25 + rand() * 0.4;
  // jitter shared per unique vertex position so the faces stay planar and closed
  const jit = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let j = jit.get(k);
    if (!j) {
      j = [(rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5];
      jit.set(k, j);
    }
    pos.setXYZ(i, (x + j[0]) * sx, (y + j[1]) * sy, (z + j[2]) * sz);
  }
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  return flat;
}
