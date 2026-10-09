// Runtime material lookup, independent of SVG geometry. Store a boundary PLANE,
// then evaluate its distance at the real pixel, so fine lines stay sharp.
// Nearest-plane selection is approximate around cell junctions; opt-in experiment.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
import { voronoiEdge } from "../tsl/noise";
import { D } from "../dials/store";
import { rwMetrics } from "../rewrite";
const {
  Fn,
  vec3,
  vec4,
  float,
  uint,
  uniform,
  instanceIndex,
  uvec3,
  ivec3,
  texture3D,
  textureStore,
  dot,
  abs,
} = tsl;
export class CrackPlanes {
  private signature = "";
  private entries: any[] = [];
  constructor(
    private renderer: THREE.WebGPURenderer,
    private bound: number,
    private seed: number,
    private res = 128,
  ) {
    for (let j = 0; j < 2; j++) {
      const tex = new THREE.Storage3DTexture(res, res, res);
      tex.type = THREE.FloatType;
      tex.format = THREE.RGBAFormat;
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      const center = uniform(new THREE.Vector3()),
        extent = uniform(1),
        coverage = uniform(0.5),
        s = uniform(seed + j * 7);
      const kernel = Fn(() => {
        const i = instanceIndex,
          c = uvec3(i.mod(uint(res)), i.div(uint(res)).mod(uint(res)), i.div(uint(res * res)));
        const p = vec3(c).add(0.5).div(res).sub(0.5).mul(extent.mul(2)).add(center).toVar();
        const e = voronoiEdge(p, s, coverage).toVar();
        textureStore(tex, c, vec4(e.xyz, dot(e.xyz, p).add(e.w))).toWriteOnly();
      })().compute(res ** 3, [64]);
      this.entries.push({ tex, center, extent, coverage, s, kernel });
    }
    this.update();
  }
  update() {
    const C = D.ice.cracks,
      sig = JSON.stringify([
        C.largeScale,
        C.fineScale,
        C.warp,
        C.coverage,
        C.fineCoverage,
        this.seed,
      ]);
    if (sig === this.signature) return;
    this.signature = sig;
    const seedV = new THREE.Vector3(this.seed * 0.731, this.seed * 0.137, this.seed * 0.529),
      ratio = C.fineScale / C.largeScale;
    const e0 = this.entries[0],
      e1 = this.entries[1];
    e0.center.value.copy(seedV).multiplyScalar(0.37);
    e0.extent.value = this.bound * C.largeScale + Math.abs(C.warp) * 2 + 0.1;
    e0.coverage.value = C.coverage;
    e1.center.value.copy(e0.center.value).multiplyScalar(ratio).add(seedV);
    e1.extent.value = e0.extent.value * ratio;
    e1.coverage.value = C.fineCoverage;
    for (const e of this.entries) this.renderer.compute(e.kernel);
    rwMetrics.materialPlanes = {
      res: this.res,
      bytes: 2 * this.res ** 3 * 16,
      builds: (rwMetrics.materialPlanes?.builds || 0) + 1,
    };
  }
  sample(p: any, fine = false) {
    const e = this.entries[+fine],
      uv = p.sub(e.center).div(e.extent.mul(2)).add(0.5);
    const plane = texture3D(e.tex).sample(uv).level(0).toVar();
    return vec4(plane.xyz, abs(plane.w.sub(dot(plane.xyz, p))));
  }
  dispose() {
    for (const e of this.entries) {
      e.tex.dispose();
      e.kernel.dispose();
    }
  }
}
