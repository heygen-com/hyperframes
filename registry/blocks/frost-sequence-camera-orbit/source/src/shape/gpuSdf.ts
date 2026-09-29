import * as THREE from "three/webgpu";
import { MeshBVH } from "three-mesh-bvh";
import { BVHComputeData, pointQueryResultStruct, wgslTagFn } from "three-mesh-bvh/webgpu";
import { tsl } from "../tsl/t";
import { makeLogoSDF, halfExtents } from "./logo";
import { rwMetrics } from "../rewrite";
const { Fn, instanceIndex, uint, vec3, float, If, dot, max, instancedArray, uniform } = tsl;

/** Runtime GPU closest-point queries. SVG/text geometry remains fully editable.
 * CPU winding uses the exact existing column algorithm; the simulation API is unchanged. */
export async function voxelizeGPU(
  renderer: THREE.WebGPURenderer,
  geo: THREE.BufferGeometry,
  bound: number,
  res: number,
  sampleBound: number,
) {
  const start = performance.now(),
    half = halfExtents(geo),
    thickness = Math.min(half.x, half.y, half.z),
    n = Math.max(16, Math.round(res));
  const range = bound,
    voxel = (2 * sampleBound) / n,
    maxDist = Math.min(range, Math.max(thickness * 2.5, voxel * 14));
  const bvh = new MeshBVH(geo);
  (geo as any).boundsTree = bvh;
  const data = new BVHComputeData(geo);
  data.update();
  const packed = performance.now();
  const query = wgslTagFn`
 fn frostClosest(p:vec3f,cap:f32)->f32 {
  var hit:${pointQueryResultStruct};
  hit.found=true; hit.distanceSq=cap*cap;
  let found=${data.fns.closestPointToPoint}(p,&hit);
  return select(-1.0,sqrt(hit.distanceSq),found);
 }`;
  const output = instancedArray(n * n * n, "float"),
    offset = uniform(0, "uint");
  const box = geo.boundingBox!,
    lo = vec3(box.min.x, box.min.y, box.min.z),
    hi = vec3(box.max.x, box.max.y, box.max.z);
  const slabs = 8,
    slabCount = n * n * slabs;
  const kernel = Fn(() => {
    const i = instanceIndex.add(offset),
      x = i.mod(uint(n)),
      y = i.div(uint(n)).mod(uint(n)),
      z = i.div(uint(n * n));
    const p = vec3(x, y, z)
      .add(0.5)
      .div(n)
      .sub(0.5)
      .mul(2 * sampleBound)
      .toVar();
    const delta = max(max(lo.sub(p), p.sub(hi)), vec3(0));
    const d = float(-1).toVar();
    If(dot(delta, delta).lessThanEqual(maxDist * maxDist), () => {
      d.assign(query(p, float(maxDist)));
    });
    output.element(i).assign(d);
  })().compute(slabCount, [64]);
  for (let base = 0; base < n * n * n; base += slabCount) {
    offset.value = base;
    renderer.compute(kernel);
    await renderer.backend.device.queue.onSubmittedWorkDone();
  }
  const distances = new Float32Array(await renderer.getArrayBufferAsync(output.value));
  const gpuDone = performance.now();
  // Audit sampled GPU distances against the original CPU mesh query.
  let auditMax = 0,
    auditSum = 0,
    auditCount = 0,
    auditMissing = 0,
    random = 173;
  const auditP = new THREE.Vector3();
  for (let a = 0; a < 2048; a++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const i = random % (n * n * n),
      x = i % n,
      y = Math.floor(i / n) % n,
      z = Math.floor(i / (n * n));
    auditP.set(
      ((x + 0.5) / n - 0.5) * 2 * sampleBound,
      ((y + 0.5) / n - 0.5) * 2 * sampleBound,
      ((z + 0.5) / n - 0.5) * 2 * sampleBound,
    );
    const hit = bvh.closestPointToPoint(auditP, {}, 0, maxDist);
    if (hit && hit.distance <= maxDist && distances[i] >= 0) {
      const e = Math.abs(hit.distance - distances[i]);
      auditMax = Math.max(auditMax, e);
      auditSum += e * e;
      auditCount++;
    } else if (!!(hit && hit.distance <= maxDist) !== distances[i] >= 0) auditMissing++;
  }
  // Match the original nonzero winding rule, including deterministic column nudges.
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const cx = ((x + 0.5) / n - 0.5) * 2 * sampleBound + voxel * 0.013,
        cy = ((y + 0.5) / n - 0.5) * 2 * sampleBound + voxel * 0.017;
      ray.origin.set(cx, cy, -sampleBound - 1);
      const crossings = (bvh.raycast(ray, THREE.DoubleSide) as any[])
        .map((h) => ({ z: h.distance - sampleBound - 1, delta: h.face.normal.z < 0 ? 1 : -1 }))
        .sort((a, b) => a.z - b.z);
      let k = 0,
        winding = 0;
      for (let z = 0; z < n; z++) {
        const pz = ((z + 0.5) / n - 0.5) * 2 * sampleBound;
        while (k < crossings.length && crossings[k].z < pz) winding += crossings[k++].delta;
        const index = x + y * n + z * n * n;
        let d = distances[index] >= 0 ? distances[index] : range;
        if (winding !== 0) d = -d;
        distances[index] = Math.min(1, Math.max(0, (d + range) / (2 * range)));
      }
    }
  const finished = performance.now();
  rwMetrics.sdf.push({
    n,
    triangles: geo.index!.count / 3,
    packMs: packed - start,
    gpuMs: gpuDone - packed,
    signMs: finished - gpuDone,
    totalMs: finished - start,
    audit: {
      samples: 2048,
      compared: auditCount,
      maxDistanceError: auditMax,
      rmsDistanceError: Math.sqrt(auditSum / Math.max(1, auditCount)),
      missing: auditMissing,
    },
  });
  data.dispose();
  output.value.dispose();
  kernel.dispose();
  return makeLogoSDF(distances, n, bound, thickness, sampleBound);
}
