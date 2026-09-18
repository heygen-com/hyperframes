// Debug overlays: erosion field slice, density grid slice, SDF hit points.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
const { vec3, vec4, uniform, uv, texture3D, float } = tsl;
import { D } from "../dials/store";
import type { ErosionField } from "../erosion/ErosionField";
import type { Powder } from "../powder/Powder";
import type { Interaction } from "../core/interaction";

export class DebugViews {
  readonly group = new THREE.Group();
  private erosionQuad: THREE.Mesh;
  private densityQuad: THREE.Mesh;
  private hitEntry: THREE.Mesh;
  private hitExit: THREE.Mesh;
  private uSlice = uniform(0.5);

  constructor(
    readonly camera: THREE.Camera,
    erosion: ErosionField,
    powder: Powder,
  ) {
    const mkQuad = (tex: THREE.Texture, mode: "erosion" | "density") => {
      const m = new THREE.MeshBasicNodeMaterial();
      const s = texture3D(tex).sample(vec3(uv(), this.uSlice)).level(0);
      m.colorNode =
        mode === "erosion"
          ? vec4(s.r, s.r.mul(0.6).add(s.g.mul(0.8)), s.r.mul(0.6), 1.0)
          : vec4(s.r.mul(2.0), s.g, s.b, 1.0);
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = false;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
      q.renderOrder = 1000;
      q.frustumCulled = false;
      return q;
    };
    this.erosionQuad = mkQuad(erosion.tex, "erosion");
    this.densityQuad = mkQuad(powder.densityTex, "density");
    const dot = new THREE.SphereGeometry(0.03, 12, 8);
    this.hitEntry = new THREE.Mesh(dot, new THREE.MeshBasicNodeMaterial({ color: "#ff4040" }));
    this.hitExit = new THREE.Mesh(dot, new THREE.MeshBasicNodeMaterial({ color: "#40a0ff" }));
    this.group.add(this.hitEntry, this.hitExit);
    // slices live in camera space (lower-left corner)
    camera.add(this.erosionQuad, this.densityQuad);
    void float;
  }

  update(interaction: Interaction) {
    const dbg = D.debug;
    this.uSlice.value = dbg.erosionSliceZ;
    const cam = this.camera as THREE.PerspectiveCamera;
    const dist = 3;
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)),
      w = h * cam.aspect;
    const size = h * 0.28;
    this.erosionQuad.visible = dbg.showErosionSlice;
    this.erosionQuad.scale.set(size, size, 1);
    this.erosionQuad.position.set(-w / 2 + size * 0.6, -h / 2 + size * 0.6, -dist);
    this.densityQuad.visible = dbg.showDensityGrid;
    this.densityQuad.scale.set(size, size, 1);
    this.densityQuad.position.set(
      -w / 2 + size * (dbg.showErosionSlice ? 1.75 : 0.6),
      -h / 2 + size * 0.6,
      -dist,
    );
    const show = dbg.showHitPoints && interaction.hasHit;
    this.hitEntry.visible = show;
    this.hitExit.visible = show;
    if (show) {
      this.hitEntry.position.copy(interaction.hitEntry);
      this.hitExit.position.copy(interaction.hitExit);
    }
  }

  dispose() {
    this.camera.remove(this.erosionQuad, this.densityQuad);
    this.erosionQuad.geometry.dispose();
    this.densityQuad.geometry.dispose();
    (this.erosionQuad.material as THREE.Material).dispose();
    (this.densityQuad.material as THREE.Material).dispose();
  }
}
