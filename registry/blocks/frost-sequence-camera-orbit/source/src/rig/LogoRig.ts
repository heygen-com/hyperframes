/** Timeline controls sampled at fixed simulation time, independent of render FPS. */
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
import type { World } from "../World";
import { D } from "../dials/store";
import { assemblyFrontPhase } from "../powder/returnGroups";
import { sim } from "../core/state";
const {
  Fn,
  uniform,
  instancedArray,
  instanceIndex,
  uint,
  ivec3,
  vec3,
  vec4,
  float,
  If,
  texture3D,
  textureStore,
  clamp,
  abs,
  max,
  min,
  length,
  mix,
  smoothstep,
  sin,
} = tsl;
export interface RigSample {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  breakup: number;
  assembly: number;
  target?: number;
  fade?: number;
}
export interface LogoRigOptions {
  duration: number;
  mode: "physical" | "directed" | "hybrid";
  sequence?: boolean;
  sample: (t: number) => RigSample;
  retarget?: (target: number) => void;
}
export class LogoRig {
  private previousBreak = 0;
  private previousAssembly = 0;
  private assembling = false;
  private capturePending = false;
  private readonly from = uniform(0);
  private readonly to = uniform(0);
  private readonly progress = uniform(0);
  private readonly mode = uniform(0);
  private readonly start;
  private readonly captureProgress;
  private readonly returnRadius;
  private newCut = false;
  private readonly fracture;
  private readonly capture;
  private readonly guide;
  private sample!: RigSample;
  private target = 0;
  private breakLatch = false;
  constructor(
    private world: World,
    private options: LogoRigOptions,
  ) {
    const e = world.erosion,
      pw = world.powder,
      B = pw.buffers,
      u = pw.u,
      R = e.res,
      i = instanceIndex;
    this.start = instancedArray(pw.count, "vec4");
    this.captureProgress = instancedArray(pw.count, "float");
    this.returnRadius = instancedArray(pw.count, "vec2");
    const previous = texture3D(e.tex),
      cells = texture3D(e.cellTex);
    this.fracture = Fn(() => {
      const c = ivec3(i.mod(uint(R)), i.div(uint(R)).mod(uint(R)), i.div(uint(R * R)));
      const cell = cells.load(c).level(0).toVar(),
        old = previous.load(c).level(0).toVar();
      // A diagonal front through the existing fracture cells: same shard geometry, no mesh displacement.
      const rank = clamp(
        abs(cell.y.add(cell.x.mul(0.3)))
          .div(e.bound * 1.3)
          .add(cell.w.mul(0.07)),
        0.00001,
        0.99999,
      );
      const cut = rank.greaterThan(this.from).and(rank.lessThanEqual(this.to));
      If(cut, () => {
        old.assign(vec4(1, 0, 0, 1));
      }).Else(() => {
        old.a.assign(old.a.mul(0.5));
      });
      textureStore(e.scratch, c, old).toWriteOnly();
    })().compute(R ** 3, [64]);
    this.capture = Fn(() => {
      this.start.element(i).assign(B.pos.element(i));
      this.captureProgress.element(i).assign(this.progress);
      this.returnRadius
        .element(i)
        .assign(length(B.pos.element(i).xyz.sub(u.model.mul(vec4(B.rest.element(i).xyz, 1)).xyz)));
    })().compute(pw.count, [64]);
    this.guide = Fn(() => {
      const P = B.pos.element(i),
        V = B.vel.element(i),
        M = B.meta.element(i),
        home = u.model.mul(vec4(B.rest.element(i).xyz, 1)).xyz;
      const state = M.x;
      // A landed shard must stay landed; never revive its captured size or old path.
      If(state.greaterThan(4.5), () => {
        P.xyz.assign(home);
        P.w.assign(0);
        V.xyz.assign(vec3(0));
      });
      If(state.greaterThan(0.5).and(state.lessThan(2.5)), () => {
        // Shards released during an overlapping breakup begin their own continuous approach here.
        If(state.lessThan(1.5), () => {
          this.start.element(i).assign(P);
          this.captureProgress.element(i).assign(this.progress);
          B.heal.element(i).assign(vec4(P.xyz, u.time));
          this.returnRadius.element(i).assign(length(P.xyz.sub(home)));
        });
        const phase = max(
          this.captureProgress.element(i),
          assemblyFrontPhase(B.rest.element(i).xyz, u).mul(0.22),
        );
        const p = clamp(
          this.progress.sub(phase).div(max(0.000001, float(1).sub(phase))),
          0,
          1,
        ).toVar();
        If(this.progress.greaterThanEqual(0.99999), () => {
          p.assign(1);
        });
        const ease = p.mul(p).mul(float(3).sub(p.mul(2)));
        const start = this.start.element(i).xyz;
        const bend = sin(p.mul(Math.PI)).mul(0.35);
        const path = mix(start, home, ease).add(
          vec3(bend.mul(sin(M.y.mul(12))), bend.mul(0.5), bend),
        );
        If(this.mode.greaterThan(0.5), () => {
          P.xyz.assign(path);
        }).Else(() => {
          // Keep physical tangential motion, bounded by a shrinking distance to the
          // current home. Guidance can pull inward, but cannot undo spring progress.
          const radius = this.returnRadius.element(i);
          const offset = P.xyz.sub(home).toVar();
          const distance = length(offset);
          const allowed = min(radius.y, radius.x.mul(float(1).sub(ease)));
          const nextDistance = min(distance, allowed);
          P.xyz.assign(home.add(offset.mul(nextDistance.div(max(distance, 0.000001)))));
          radius.y.assign(nextDistance);
        });
        // AssemblyField may restore a region only when its visible shard actually reaches it.
        M.x.assign(2);
        P.w.assign(max(P.w, this.start.element(i).w.mul(float(1).sub(smoothstep(0.9, 1, p)))));
        If(p.greaterThanEqual(0.99999), () => {
          P.xyz.assign(home);
          P.w.assign(0);
          V.xyz.assign(vec3(0));
          M.x.assign(5);
        });
      });
    })().compute(pw.count, [64]);
    pw.beforeIntegrate = () => {
      u.strokeDir.value.set(1, -0.3, 0).normalize();
      u.strokeSpeed.value = 3;
      u.rigStrength.value =
        this.options.mode === "physical" ? this.progress.value : this.progress.value > 0 ? 1 : 0;
      u.returnAfter.value = 0;
      u.heal.value = this.progress.value > 0 ? 1 : 0;
      u.repel.value = this.progress.value > 0 ? 0 : 1;
    };
    pw.beforeAssembly = () => {
      if (this.capturePending) {
        world.renderer.compute(this.capture);
        this.capturePending = false;
      }
      if (this.assembling && this.options.mode !== "physical") world.renderer.compute(this.guide);
      if (this.assembling && this.newCut) pw.prepareAssembly(world.renderer);
    };
    pw.assemblyEnabled = false;
    u.rigEnabled.value = 1;
    world.onBeforeSimulation = (t, dt) => this.update(t, dt);
  }
  pose(t: number) {
    const s = this.options.sample(t);
    this.sample = s;
    this.world.motionGroup.position.set(s.x, s.y + 0.05, s.z);
    this.world.motionGroup.rotation.set(
      (s.rx * Math.PI) / 180,
      (s.ry * Math.PI) / 180,
      (s.rz * Math.PI) / 180,
      "YXZ",
    );
    this.world.objectGroup.quaternion.identity();
    const target = s.target ?? 0;
    if (target !== this.target) {
      this.target = target;
      this.options.retarget?.(target);
      this.previousBreak = 0;
      this.previousAssembly = 0;
      this.breakLatch = false;
      this.assembling = false;
      this.capturePending = false;
      this.progress.value = 0;
    }
  }
  reset() {
    this.target = 0;
    this.breakLatch = false;
    this.previousBreak = 0;
    this.previousAssembly = 0;
    this.assembling = false;
    this.capturePending = false;
    this.world.powder.assemblyEnabled = false;
    this.progress.value = 0;
    this.world.powder.restoreThresholds(this.world.renderer);
  }
  private update(t: number, dt: number) {
    if (dt <= 0) return;
    const s = this.sample || this.options.sample(t),
      w = this.world,
      pw = w.powder;
    const b = Math.max(0, Math.min(1, s.breakup / 100)),
      a = Math.max(0, Math.min(1, s.assembly / 100));
    D.performance.idleSkip = false;
    w.erosion.u.reconstruct.value = 1;
    this.newCut = b > this.previousBreak;
    if (this.options.sequence && this.newCut) {
      if (!this.breakLatch) pw.restoreThresholds(w.renderer);
      this.breakLatch = true;
    }
    if (this.options.sequence && b === 0 && a === 0) this.breakLatch = false;
    this.from.value = this.previousBreak;
    this.to.value = b;
    w.renderer.compute(this.fracture);
    w.erosion.commitAssembly(w.renderer);
    if (a > 0 && this.previousAssembly <= 0 && !this.breakLatch) {
      if (!this.options.sequence) {
        pw.retarget(w.renderer, pw.restInit);
        pw.restoreThresholds(w.renderer);
      }
      pw.assemblyEnabled = true;
      this.assembling = true;
      this.capturePending = true;
      pw.u.assemblyEnd.value = 1e6;
      sim.lastStrokeT = t;
    }
    if (a === 0 || this.breakLatch) {
      this.assembling = false;
      pw.assemblyEnabled = false;
    }
    const returning = a > 0 && !this.breakLatch;
    sim.healing = returning;
    this.progress.value = returning ? a : 0;
    this.mode.value = this.options.mode === "directed" ? 1 : 0;
    // Repulsion fights return; use the original eject physics only while no return is requested.
    pw.u.repel.value = returning ? 0 : 1;
    this.previousBreak = b;
    this.previousAssembly = a;
  }
  dispose() {
    this.start.value.dispose?.();
    this.captureProgress.value.dispose?.();
    this.returnRadius.value.dispose?.();
  }
}
