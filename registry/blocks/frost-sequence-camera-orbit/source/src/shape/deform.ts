import * as THREE from "three/webgpu";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import { mergeVertices, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { rng } from "../core/seed";
import approvedPreset from "../../presets/approved-material.json";
import { refineText, textRefinementSettings, repairTextSeams } from "./textRefine";
import { logoRefinementSettings } from "./logoRefine";

export interface Deformation {
  strength: number;
  scale: number;
  seed: number;
}
export const DEFORMATION_DEFAULTS: Readonly<Deformation> = Object.freeze({
  strength: approvedPreset.deformStrength,
  scale: approvedPreset.deformScale,
  seed: approvedPreset.deformSeed,
});
export function validateDeformationScale(value: number) {
  if (!Number.isFinite(value) || value < 0.001 || value > 0.5)
    throw new RangeError(
      `Noise feature size ${value} is outside 0.001–0.5. Edit this value to load the preset; other settings have not been changed.`,
    );
  return value;
}
export function resolveDeformation(input?: Partial<Deformation>): Deformation {
  const number = (key: keyof Deformation, min: number, max: number) => {
    const v = input?.[key];
    return typeof v === "number" && Number.isFinite(v)
      ? Math.max(min, Math.min(max, v))
      : DEFORMATION_DEFAULTS[key];
  };
  return {
    strength: number("strength", 0, 0.08),
    scale: validateDeformationScale(input?.scale ?? DEFORMATION_DEFAULTS.scale),
    seed: Math.round(number("seed", 0, 65535)),
  };
}

/** Three octave Perlin noise, like the original shader FBM, baked in object space.
 * Sequential noise shears keep a one-to-one continuous map (each shear has determinant 1),
 * so opposite sides of thin strokes/counters move together instead of inflating into each other.
 */
export function makeDeformation(input: Deformation) {
  const { strength, scale, seed } = resolveDeformation(input);
  const noise = new ImprovedNoise(),
    rand = rng(seed);
  const offsets = Array.from({ length: 3 }, () => [rand() * 256, rand() * 256, rand() * 256]);
  function fbm(a: number, b: number, channel: number) {
    const o = offsets[channel];
    let x = a / scale + o[0],
      y = b / scale + o[1],
      z = o[2],
      sum = 0,
      amp = 1;
    for (let i = 0; i < 3; i++) {
      sum += amp * noise.noise(x, y, z);
      x = x * 2 + 17.3;
      y = y * 2 + 9.1;
      z = z * 2 + 31.7;
      amp *= 0.5;
    }
    return sum / 1.75;
  }
  return (x: number, y: number, z: number): [number, number, number] => {
    if (strength === 0) return [x, y, z];
    x += strength * fbm(y, z, 0);
    y += strength * fbm(z, x, 1);
    z += strength * fbm(x, y, 2);
    return [x, y, z];
  };
}

/** Conforming shared-edge subdivision. Stop before exceeding a fixed extra-triangle budget.
 * Every marked edge is split in ALL adjacent triangles, including cap/side seams.
 */
function refine(positions: number[], initial: number[], maxEdge: number) {
  let triangles = initial;
  const limit = initial.length / 3 + 6000,
    maxLength2 = maxEdge * maxEdge;
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let pass = 0; pass < 8; pass++) {
    const marked = new Map<string, number>();
    let extra = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i],
        b = triangles[i + 1],
        c = triangles[i + 2];
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const dx = positions[u * 3] - positions[v * 3],
          dy = positions[u * 3 + 1] - positions[v * 3 + 1],
          dz = positions[u * 3 + 2] - positions[v * 3 + 2];
        if (dx * dx + dy * dy + dz * dz > maxLength2) {
          marked.set(key(u, v), -1);
          extra++;
        }
      }
    }
    if (!marked.size || triangles.length / 3 + extra > limit) break;
    for (const [edge] of marked) {
      const [a, b] = edge.split(":").map(Number),
        m = positions.length / 3;
      positions.push(
        (positions[a * 3] + positions[b * 3]) / 2,
        (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2,
        (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2,
      );
      marked.set(edge, m);
    }
    const out: number[] = [];
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i],
        b = triangles[i + 1],
        c = triangles[i + 2];
      const ab = marked.get(key(a, b)),
        bc = marked.get(key(b, c)),
        ca = marked.get(key(c, a));
      if (ab !== undefined && bc !== undefined && ca !== undefined)
        out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (ab !== undefined && bc !== undefined) out.push(b, bc, ab, a, ab, c, ab, bc, c);
      else if (bc !== undefined && ca !== undefined) out.push(c, ca, bc, b, bc, a, bc, ca, a);
      else if (ca !== undefined && ab !== undefined) out.push(a, ab, ca, c, ca, b, ca, ab, b);
      else if (ab !== undefined) out.push(a, ab, c, ab, b, c);
      else if (bc !== undefined) out.push(b, bc, a, bc, c, a);
      else if (ca !== undefined) out.push(c, ca, b, ca, a, b);
      else out.push(a, b, c);
    }
    triangles = out;
  }
  return triangles;
}

/** Zero is an exact identity, including original buffers/normals. Caller owns the returned geometry. */
export function deformGeometry(
  source: THREE.BufferGeometry,
  input: Deformation,
  creaseAngle = 40,
  textMeshDetail?: number,
  logoMeshDetail?: number,
): THREE.BufferGeometry {
  const options = resolveDeformation(input);
  if (options.strength === 0) return source;
  const copy = source.clone();
  // The material uses object-space fields, not UVs. Weld geometric seams before refinement.
  for (const name of Object.keys(copy.attributes))
    if (name !== "position") copy.deleteAttribute(name);
  copy.clearGroups();
  const welded = mergeVertices(copy, 1e-7);
  copy.dispose();
  const positions = Array.from(welded.getAttribute("position").array);
  const original = Array.from(welded.index!.array);
  welded.dispose();
  // Independent text/logo budgets share conforming surface refinement. Legacy callers
  // without a mesh-detail argument retain the original refinement path.
  const settings =
    textMeshDetail !== undefined
      ? textRefinementSettings(options.scale, textMeshDetail)
      : logoMeshDetail !== undefined
        ? logoRefinementSettings(source, logoMeshDetail)
        : null;
  const triangles = settings
    ? refineText(
        positions,
        repairTextSeams(positions, original),
        settings.maxEdge,
        settings.extraTriangles,
      )
    : refine(positions, original, options.scale * 0.3);
  const warp = makeDeformation(options);
  for (let i = 0; i < positions.length; i += 3) {
    const q = warp(positions[i], positions[i + 1], positions[i + 2]);
    positions[i] = q[0];
    positions[i + 1] = q[1];
    positions[i + 2] = q[2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(triangles);
  const result = toCreasedNormals(geometry, THREE.MathUtils.degToRad(creaseAngle));
  if (result !== geometry) geometry.dispose();
  // Keep the centered-geometry contract used by bounds and shard-home sampling.
  result.center();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}
