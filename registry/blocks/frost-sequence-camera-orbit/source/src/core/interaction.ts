// Cursor -> object-space SDF raycast -> stroke capsules (through the volume) + stroke velocity for the powder.
import * as THREE from "three/webgpu";
import type { ShapeSpec } from "../shape/sdf";
import { raycastSDF } from "../shape/sdf";
import { input, sim, heroFrame } from "./state";
import { clock } from "./clock";
import { D } from "../dials/store";
import { damp } from "./ease";
import type { ErosionField } from "../erosion/ErosionField";
import { MAX_SEGMENTS } from "../erosion/ErosionField";
import type { Powder } from "../powder/Powder";

const DEPTH_STEPS = 4;
/** ?stroke=1 drives a synthetic sweep (headless checks). */
const FORCE_STROKE =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("stroke");
/** ?strokeFrames=N stops the synthetic sweep after N frames (to watch what the field does afterwards). */
const STROKE_FRAMES =
  typeof location !== "undefined"
    ? parseInt(new URLSearchParams(location.search).get("strokeFrames") || "1000000", 10)
    : 1e6;
const STROKE_START =
  typeof location !== "undefined"
    ? parseInt(new URLSearchParams(location.search).get("strokeStart") || "0", 10)
    : 0;

export class Interaction {
  readonly strokeSegments: THREE.Vector4[] = Array.from(
    { length: MAX_SEGMENTS * 2 },
    () => new THREE.Vector4(),
  );
  strokeCount = 0;
  /** Smoothed stroke velocity in world units / s and its direction (kept after the stroke ends, speed decays). */
  readonly strokeVel = new THREE.Vector3();
  readonly strokeDir = new THREE.Vector3(1, 0.4, 0).normalize();
  strokeSpeed = 0;
  /** Debug: last entry/exit hit points in world space. */
  readonly hitEntry = new THREE.Vector3();
  readonly hitExit = new THREE.Vector3();
  hasHit = false;

  private prevEntry = new THREE.Vector3();
  private prevExit = new THREE.Vector3();
  private prevEntryWorld = new THREE.Vector3();
  private prevHit = false;
  private prevX = 0;
  private prevY = 0;
  /** Scripted strokes (hero triggers): a sweep along an object-space path, or a burst at a point. */
  /** FROST: a queue instead of one sweep, so a shatter can run several parallel slices with staggered starts. */
  private scripted: {
    kind: "sweep" | "front";
    from: THREE.Vector3;
    to: THREE.Vector3;
    normal?: THREE.Vector3;
    reach?: number;
    t0: number;
    delay: number;
    duration: number;
    radius: number;
    strength: number;
    through: boolean;
    prevT: number;
  }[] = [];
  private scrollP = -1;
  private scrollPath = { from: new THREE.Vector3(-1, -0.6, 0), to: new THREE.Vector3(1, 0.6, 0) };
  private ray = new THREE.Ray();
  private inv = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  private objectRayOrigin = new THREE.Vector3();
  private objectRayDirection = new THREE.Vector3();
  private workA = new THREE.Vector3();
  private workB = new THREE.Vector3();
  private workDirection = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private rayHit = { entry: new THREE.Vector3(), exit: new THREE.Vector3(), tEntry: 0, tExit: 0 };
  private resetDone = true;

  constructor(
    readonly shape: ShapeSpec,
    readonly objectGroup: THREE.Object3D,
    readonly camera: THREE.PerspectiveCamera,
    readonly erosion: ErosionField | null,
    readonly powder: Powder | null,
    /** V2: called when a reset completes (chunks snap home) */
    readonly onReset?: () => void,
  ) {}

  /** Play a sweep across the object (object-space path, fractions of the bound). */
  sweep(
    opts: {
      from?: [number, number, number];
      to?: [number, number, number];
      duration?: number;
      radius?: number;
      strength?: number;
      through?: boolean;
      delay?: number;
    } = {},
  ) {
    const B = this.shape.bound;
    const f = opts.from ?? [-1, -0.55, 0],
      to = opts.to ?? [1, 0.55, 0];
    this.scripted.push({
      kind: "sweep",
      from: new THREE.Vector3(f[0] * B, f[1] * B, f[2] * B),
      to: new THREE.Vector3(to[0] * B, to[1] * B, to[2] * B),
      t0: -1,
      delay: opts.delay ?? 0,
      duration: opts.duration ?? 0.7,
      radius: opts.radius ?? D.erosion.brushRadius,
      strength: opts.strength ?? D.erosion.brushStrength * 1.5,
      through: opts.through ?? true,
      prevT: 0,
    });
  }

  /**
   * FROST: a break front. A band the full length of the slice path (extended by half a bound each way) travels
   * outward from it on both sides, eroding everything it passes, so the break started by the slice continues
   * without a pause until the whole shape is gone. `reach` in bounds; the eject direction stays the slice's.
   */
  front(opts: {
    from: [number, number, number];
    to: [number, number, number];
    delay?: number;
    duration?: number;
    reach?: number;
    radius?: number;
    strength?: number;
  }) {
    const B = this.shape.bound;
    const [fx, fy] = opts.from,
      [tx, ty] = opts.to;
    const dx = tx - fx,
      dy = ty - fy,
      len = Math.hypot(dx, dy) || 1;
    const ex = (dx / len) * 0.5,
      ey = (dy / len) * 0.5;
    this.scripted.push({
      kind: "front",
      from: new THREE.Vector3((fx - ex) * B, (fy - ey) * B, 0),
      to: new THREE.Vector3((tx + ex) * B, (ty + ey) * B, 0),
      normal: new THREE.Vector3(-dy / len, dx / len, 0),
      reach: (opts.reach ?? 1.3) * B,
      t0: -1,
      delay: opts.delay ?? 0,
      duration: opts.duration ?? 1.5,
      radius: opts.radius ?? D.erosion.brushRadius,
      strength: opts.strength ?? D.erosion.brushStrength * 1.5,
      through: true,
      prevT: 0,
    });
  }

  /** FROST: drop every queued sweep (a reset). */
  clearScripted() {
    this.scripted.length = 0;
  }

  /** Burst at a world-space point (e.g. a click hit), eroding a sphere and throwing grains outward. */
  burst(worldPoint: THREE.Vector3, radius: number, strength: number, duration = 0.18) {
    const inv = new THREE.Matrix4().copy(this.objectGroup.matrixWorld).invert();
    const p = worldPoint.clone().applyMatrix4(inv);
    this.scripted.push({
      from: p,
      to: p.clone(),
      t0: -1,
      delay: 0,
      duration,
      radius,
      strength,
      through: false,
      prevT: 0,
    });
    const centre = new THREE.Vector3().setFromMatrixPosition(this.objectGroup.matrixWorld);
    const dir = worldPoint.clone().sub(centre);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    this.strokeDir.copy(dir.normalize());
    this.strokeSpeed = D.erosion.brushSpeedRef * 1.5;
  }

  /** Scroll-driven erosion: erodes along a diagonal as `p` (0..1) advances; call every frame. */
  sweepTo(p: number) {
    this.scrollP = Math.max(0, Math.min(1, p));
  }

  private pushScripted(t: number, dt: number) {
    if (this.scripted.length === 0) return false;
    let pushed = false;
    for (const sc of this.scripted) {
      if (sc.t0 < 0) sc.t0 = t + sc.delay;
      if (t < sc.t0) continue;
      const u = Math.min(1, (t - sc.t0) / Math.max(0.01, sc.duration));
      const B = this.shape.bound;
      if (sc.kind === "front") {
        // the band starts fast and slows down; its radius never drops below the distance it moved this frame
        const ease = (x: number) => 1 - (1 - x) * (1 - x);
        const dPrev = sc.reach! * ease(sc.prevT),
          dNow = sc.reach! * ease(u);
        const r = Math.max(sc.radius, (dNow - dPrev) * 1.5);
        // one band per depth slice: the shapes are thin, so one at z = 0 usually covers them
        const th = this.shape.thickness;
        const zs = th <= r * 0.9 ? [0] : [-th, 0, th];
        if (this.strokeCount + zs.length * 2 > MAX_SEGMENTS) break;
        for (const s of [1, -1]) {
          const a = this.workA.copy(sc.from).addScaledVector(sc.normal!, s * dNow),
            b = this.workB.copy(sc.to).addScaledVector(sc.normal!, s * dNow);
          for (const z of zs) {
            this.strokeSegments[this.strokeCount * 2].set(a.x, a.y, z, r);
            this.strokeSegments[this.strokeCount * 2 + 1].set(b.x, b.y, z, sc.strength);
            this.strokeCount++;
          }
        }
        this.strokeSpeed = Math.max(this.strokeSpeed, (sc.reach! / sc.duration) * 0.6);
        sc.prevT = u;
        pushed = true;
        continue;
      }
      const a = this.workA.copy(sc.from).lerp(sc.to, sc.prevT),
        b = this.workB.copy(sc.from).lerp(sc.to, u);
      const n = sc.through ? 3 : 1;
      if (this.strokeCount + n > MAX_SEGMENTS) break;
      for (let k = 0; k < n; k++) {
        const z = sc.through ? -B + (2 * B * (k + 0.5)) / n : 0;
        this.strokeSegments[this.strokeCount * 2].set(
          a.x,
          a.y,
          sc.through ? z - B / n : a.z,
          sc.radius,
        );
        this.strokeSegments[this.strokeCount * 2 + 1].set(
          b.x,
          b.y,
          sc.through ? z + B / n : b.z,
          sc.strength,
        );
        this.strokeCount++;
      }
      if (sc.from.distanceToSquared(sc.to) > 1e-6) {
        const dirW = this.workDirection
          .copy(sc.to)
          .sub(sc.from)
          .transformDirection(this.objectGroup.matrixWorld);
        this.strokeDir.copy(dirW.normalize());
        this.strokeSpeed = Math.max(
          this.strokeSpeed,
          (sc.from.distanceTo(sc.to) / sc.duration) * 0.6,
        );
      }
      sc.prevT = u;
      pushed = true;
    }
    this.scripted = this.scripted.filter((sc) => sc.prevT < 1);
    void dt;
    return pushed;
  }

  private pushScroll(dt: number) {
    if (this.scrollP < 0) return false;
    const p = this.scrollP;
    if (this.prevScrollP < 0) {
      this.prevScrollP = p;
      return false;
    }
    const dp = p - this.prevScrollP;
    if (Math.abs(dp) < 0.0005) return false;
    const B = this.shape.bound;
    const a = this.workA
      .copy(this.scrollPath.from)
      .lerp(this.scrollPath.to, this.prevScrollP)
      .multiplyScalar(B);
    const b = this.workB.copy(this.scrollPath.from).lerp(this.scrollPath.to, p).multiplyScalar(B);
    if (dp > 0) {
      for (let k = 0; k < 3 && this.strokeCount < MAX_SEGMENTS; k++) {
        const z = -B + (2 * B * (k + 0.5)) / 3;
        this.strokeSegments[this.strokeCount * 2].set(a.x, a.y, z - B / 3, D.erosion.brushRadius);
        this.strokeSegments[this.strokeCount * 2 + 1].set(
          b.x,
          b.y,
          z + B / 3,
          D.erosion.brushStrength * 2.5,
        );
        this.strokeCount++;
      }
      const dirW = this.workDirection
        .copy(b)
        .sub(a)
        .transformDirection(this.objectGroup.matrixWorld);
      if (dirW.lengthSq() > 1e-8) this.strokeDir.copy(dirW.normalize());
      this.strokeSpeed = Math.max(
        this.strokeSpeed,
        Math.min(6, (Math.abs(dp) * 2 * B) / Math.max(dt, 1 / 120)),
      );
    }
    this.prevScrollP = p;
    return dp > 0;
  }
  private prevScrollP = -1;

  update(t: number, dt: number) {
    this.strokeCount = 0;
    const E = D.erosion;
    // --- reset (click / R): fade the powder over `resetFade` ms, then clear everything
    if (sim.resetRequestedAt >= 0) {
      const u = (t - sim.resetRequestedAt) / Math.max(0.05, D.healing.resetFade / 1000);
      sim.fade = Math.max(0, 1 - u);
      if (u >= 1) {
        if (this.erosion) this.erosion.clear(this.erosion.renderer);
        if (this.powder && this.erosion) this.powder.reset(this.erosion.renderer);
        this.onReset?.();
        sim.resetRequestedAt = -1;
        sim.lastStrokeT = -1e9;
        sim.fade = 1;
      }
    } else sim.fade = damp(sim.fade, 1, 0.15, dt);

    const moved = input.x !== this.prevX || input.y !== this.prevY;
    let hit: ReturnType<typeof raycastSDF> = null;
    if (input.inside) {
      // world ray from the cursor, into object space
      this.tmp.set(input.x, input.y, 0.5).unproject(this.camera);
      this.ray.origin.copy(this.camera.position);
      this.ray.direction.copy(this.tmp).sub(this.camera.position).normalize();
      this.inv.copy(this.objectGroup.matrixWorld).invert();
      const o = this.objectRayOrigin.copy(this.ray.origin).applyMatrix4(this.inv);
      const d = this.objectRayDirection.copy(this.ray.direction).transformDirection(this.inv);
      hit = raycastSDF(this.shape, o, d, 60, this.rayHit);
    }
    sim.overObject = !!hit;
    this.hasHit = !!hit;
    if (hit) {
      this.hitEntry.copy(hit.entry).applyMatrix4(this.objectGroup.matrixWorld);
      this.hitExit.copy(hit.exit).applyMatrix4(this.objectGroup.matrixWorld);
    }

    let strokeThisFrame = false;
    if (dt > 0 && this.pushScripted(t, dt)) strokeThisFrame = true;
    if (dt > 0 && this.pushScroll(dt)) strokeThisFrame = true;
    const cursorErodes = !heroFrame.enabled || heroFrame.cursorErodes;
    if (
      cursorErodes &&
      hit &&
      this.prevHit &&
      moved &&
      dt > 0 &&
      this.strokeCount + DEPTH_STEPS <= MAX_SEGMENTS
    ) {
      const entryWorld = this.hitEntry;
      const vel = this.velocity.copy(entryWorld).sub(this.prevEntryWorld).divideScalar(dt);
      const speed = vel.length();
      if (speed > 0.02) {
        strokeThisFrame = true;
        this.strokeVel.lerp(vel, 0.5);
        this.strokeSpeed = damp(this.strokeSpeed, Math.min(speed, E.brushSpeedRef * 3), 0.08, dt);
        if (this.strokeVel.lengthSq() > 1e-6) this.strokeDir.copy(this.strokeVel).normalize();
        const k = THREE.MathUtils.clamp(speed / E.brushSpeedRef, 0.12, 2.5);
        const strength = E.brushStrength * k;
        const radius = E.brushRadius * (0.72 + 0.28 * Math.min(1, k));
        for (let s = 0; s < DEPTH_STEPS; s++) {
          const f = (s / (DEPTH_STEPS - 1)) * E.throughDepth;
          const idx = this.strokeCount + s;
          this.strokeSegments[idx * 2].set(
            THREE.MathUtils.lerp(this.prevEntry.x, this.prevExit.x, f),
            THREE.MathUtils.lerp(this.prevEntry.y, this.prevExit.y, f),
            THREE.MathUtils.lerp(this.prevEntry.z, this.prevExit.z, f),
            radius,
          );
          this.strokeSegments[idx * 2 + 1].set(
            THREE.MathUtils.lerp(hit.entry.x, hit.exit.x, f),
            THREE.MathUtils.lerp(hit.entry.y, hit.exit.y, f),
            THREE.MathUtils.lerp(hit.entry.z, hit.exit.z, f),
            strength,
          );
        }
        this.strokeCount += DEPTH_STEPS;
      }
    }
    if (
      (D.debug.forceStroke ||
        (FORCE_STROKE && clock.frame >= STROKE_START && clock.frame < STROKE_FRAMES)) &&
      dt > 0
    ) {
      // synthetic diagonal sweep (lower-left -> upper-right) for testing without a cursor
      const ph = (t * 0.25) % 1;
      const B = this.shape.bound * 0.9;
      const ax = -B + ph * 2 * B,
        ay = -B * 0.7 + ph * 1.4 * B;
      const bx = ax + 0.15,
        by = ay + 0.1;
      this.strokeSegments[0].set(ax, ay, -B, E.brushRadius);
      this.strokeSegments[1].set(bx, by, B, E.brushStrength);
      this.strokeCount = 1;
      this.strokeDir.set(1, 0.7, 0).normalize();
      this.strokeSpeed = E.brushSpeedRef;
      strokeThisFrame = true;
    }
    if (!strokeThisFrame) this.strokeSpeed = damp(this.strokeSpeed, 0, 1.2, dt);
    sim.strokeActive = strokeThisFrame;
    // scroll-driven pages hold their erosion: healing is suppressed while suspended
    if (heroFrame.enabled && heroFrame.healSuspended) sim.lastStrokeT = t;

    if (hit) {
      this.prevEntry.copy(hit.entry);
      this.prevExit.copy(hit.exit);
      this.prevEntryWorld.copy(this.hitEntry);
    }
    this.prevHit = !!hit;
    this.prevX = input.x;
    this.prevY = input.y;
    void this.resetDone;
  }
}
