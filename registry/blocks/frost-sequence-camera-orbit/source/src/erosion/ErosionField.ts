// The erosion field: a 3D storage texture in object space (rgba16float: r = erosion 0..1, g = refrost).
// Cursor strokes splat capsules into it (compute), erosion crumbles along the crack network for a
// short while after a stroke, and after `healDelay` the field decays back to 0 with a frost-first refill.
// One canonical texture `tex` is read by every consumer; `scratch` receives the step, then is copied back.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
const {
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  uniformArray,
  instanceIndex,
  texture3D,
  textureStore,
  uvec3,
  ivec3,
  int,
  uint,
  If,
  Loop,
  max,
  min,
  length,
  dot,
  clamp,
  smoothstep,
  mix,
  abs,
  select,
  instancedArray,
  atomicAdd,
  atomicMax,
  atomicStore,
  atomicLoad,
} = tsl;
import type { ShapeSpec } from "../shape/sdf";
import { hash31, voronoiEdge, voronoiCell, gnoise, saturate } from "../tsl/noise";
import { D } from "../dials/store";
import { sim } from "../core/state";

type N = any;
export const MAX_SEGMENTS = 12;

export class ErosionField {
  /** FROST: floor (object units) for the erodable shell just outside the distance-field surface; set before construction. */
  static extraShell = 0;
  readonly res: number;
  readonly bound: number;
  readonly tex: THREE.Storage3DTexture;
  readonly scratch: THREE.Storage3DTexture;
  readonly crackTex: THREE.Storage3DTexture;
  /** Baked break cells: xyz = cell centre (object space), w = cell hash. The brush snaps to these. */
  readonly cellTex: THREE.Storage3DTexture;
  readonly u = {
    reconstruct: uniform(0),
    dt: uniform(0),
    time: uniform(0),
    heal: uniform(0),
    healRate: uniform(0.6),
    healGap: uniform(0.12),
    fallbackHeal: uniform(0.04),
    fallbackOn: uniform(0),
    refrostTime: uniform(4),
    cellRestore: uniform(30),
    growEdges: uniform(1),
    breakup: uniform(0.7),
    breakupScale: uniform(10),
    crumbleRate: uniform(1.6),
    crumbleCrackBias: uniform(2.5),
    crumbleUntil: uniform(-1),
    brushNoise: uniform(0.55),
    brushNoiseScale: uniform(9),
    brushSoftness: uniform(0.5),
    segCount: uniform(0),
    seed: uniform(0),
    crackScale: uniform(2.2),
    crackWarp: uniform(0.45),
    crackWarpScale: uniform(1.4),
    crackCoverage: uniform(0.55),
    breakScale: uniform(3),
    cellSnap: uniform(0.85),
  };
  readonly segments = uniformArray(
    Array.from({ length: MAX_SEGMENTS * 2 }, () => new THREE.Vector4()),
  );
  private stepNode: any;
  private copyNode: any;
  private cellClearNode: any;
  private flightClearNode: any;
  private clearNode: any;
  private fillNode: any;
  private healClearNode: any;
  private bakeNode: any;
  private statsNode: any;
  private statsClearNode: any;
  private statsBuf: any;
  private statsPending = false;
  /** Last readback: max erosion, voxels > 0.5, voxels > 0.9 (debug HUD). */
  readonly stats = { max: 0, over50: 0, over90: 0, refrost: 0 };
  /** clock time of the last stats readback that completed (for the idle-skip logic). */
  statsReadT = -1;
  private statsIssuedT = -1;
  private baked = false;
  skipBake = false;
  private texNode: any;
  private lastCrackSig = "";
  private settingsVersion = -1;

  /**
   * @param atomics shared atomic uint buffer (also holds the powder density grid + counters);
   *   the heal grid (one counter per field voxel) starts at `healOffset`.
   */
  readonly atomics: any;
  readonly healOffset: number;

  readonly cellOffset: number;

  readonly flightOffset: number;
  constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly shape: ShapeSpec,
    res: number,
    seed: number,
    atomics: any,
    healOffset: number,
    cellOffset: number,
    flightOffset: number,
  ) {
    this.cellOffset = cellOffset;
    this.flightOffset = flightOffset;
    // assigned explicitly (not as parameter properties): buildComputes() below reads them, and the
    // TS->JS transform may order parameter-property assignment after field initialisation
    this.atomics = atomics;
    this.healOffset = healOffset;
    if (!Number.isInteger(healOffset))
      throw new Error("ErosionField: healOffset must be an integer");
    this.res = res;
    this.bound = shape.bound;
    this.u.seed.value = seed;
    const make = () => {
      const t = new THREE.Storage3DTexture(res, res, res);
      t.type = THREE.HalfFloatType;
      t.format = THREE.RGBAFormat;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      return t;
    };
    this.tex = make();
    this.scratch = make();
    this.crackTex = make();
    this.cellTex = make();
    this.texNode = texture3D(this.tex);
    this.buildComputes();
  }

  /** Object-space position -> field uvw. */
  uvw(p: N) {
    return vec3(p)
      .div(this.bound * 2)
      .add(0.5);
  }
  /** Sample the field (trilinear) at an object-space position. Returns vec4 (r erosion, g refrost). */
  sample(pObject: N) {
    return this.texNode.sample(this.uvw(pObject)).level(0);
  }
  /** Baked crack helper texture: xyz = domain-warp vector (unit-less, -1..1), w = crack proximity 0..1. */
  sampleCrack(pObject: N) {
    return texture3D(this.crackTex).sample(this.uvw(pObject)).level(0);
  }
  /** Warped crack-domain coordinate for an object-space point (shared by bake + material). */
  static warpDomain(p: N, warp: N, scale: N, warpAmount: N) {
    return vec3(p).mul(scale).add(vec3(warp).mul(warpAmount));
  }

  private buildComputes() {
    const res = this.res,
      total = res * res * res,
      bound = this.bound;
    const u = this.u;
    const voxel = (bound * 2) / res;
    const shell = Math.max(voxel * 1.5, ErosionField.extraShell);
    const idx = instanceIndex;
    const coord = () => {
      const x = idx.mod(uint(res));
      const y = idx.div(uint(res)).mod(uint(res));
      const z = idx.div(uint(res * res));
      return uvec3(x, y, z);
    };
    const toObject = (c: N) =>
      vec3(c)
        .add(0.5)
        .div(res)
        .sub(0.5)
        .mul(bound * 2);

    const readTex = texture3D(this.tex);
    const readScratch = texture3D(this.scratch);
    const crack = texture3D(this.crackTex);
    const cells = texture3D(this.cellTex);

    // --- step: crumble propagation + heal + stroke splats -> scratch
    this.stepNode = Fn(() => {
      const c = coord();
      // NOTE: values used inside loops/branches AND afterwards must be pinned with toVar() up front,
      // otherwise TSL assigns them at first use (inside the branch) and later reads are uninitialised.
      const p = toObject(c).toVar();
      const sd = this.shape.sdfNode(p).toVar();
      const cur = readTex.load(ivec3(c)).level(0).toVar();
      const e = cur.r.toVar();
      const refrost = cur.g.toVar();
      const mark = cur.b.toVar(); // 1 = healed by a landed grain (propagation may spread from here only)
      const hit = max(0.0, cur.a.sub(u.dt.div(0.2))).toVar(); // brush-hit age: 1 the frame the brush touches this voxel, 0 after 0.2 s
      const crackP = crack.load(ivec3(c)).level(0).w;
      // breakup: every refill / cleanup / refrost timer runs at a locally varied rate, so a break cell (whose
      // voxels all carry the same erosion value) no longer crosses the look thresholds all at once
      const bn = gnoise(p.mul(u.breakupScale).add(u.seed.mul(1.7).add(11.0)))
        .mul(0.5)
        .add(0.5);
      const rateMul = mix(float(1), float(0.15).add(saturate(bn).mul(1.7)), u.breakup).toVar();

      // crumble propagation: erosion spreads toward the max of the 6 neighbours, biased by crack proximity
      If(u.time.lessThan(u.crumbleUntil), () => {
        const nb = float(0).toVar();
        const offs = [
          ivec3(1, 0, 0),
          ivec3(-1, 0, 0),
          ivec3(0, 1, 0),
          ivec3(0, -1, 0),
          ivec3(0, 0, 1),
          ivec3(0, 0, -1),
        ];
        for (const o of offs) {
          const cc = clamp(ivec3(c).add(o), ivec3(0), ivec3(res - 1));
          nb.assign(max(nb, readTex.load(cc).level(0).r));
        }
        const inside = smoothstep(0.02, -0.02, sd);
        const rate = u.crumbleRate.mul(float(1).add(crackP.mul(u.crumbleCrackBias))).mul(inside);
        const target = nb.mul(0.92).sub(0.06);
        If(target.greaterThan(e), () => {
          e.assign(min(target, e.add(target.sub(e).mul(saturate(rate.mul(u.dt))))));
        });
      });

      // stroke splats: soft capsules with a ragged noise boundary
      // break cell of this voxel: ice breaks along cell faces, so the brush is evaluated at the cell centre
      // (every voxel of a cell gets the same erosion -> flat facets) and mixed with the smooth capsule
      const cell = cells.load(ivec3(c)).level(0).toVar();
      Loop({ start: int(0), end: int(u.segCount), type: "int", condition: "<" }, ({ i }: any) => {
        const a4 = this.segments.element(i.mul(2));
        const b4 = this.segments.element(i.mul(2).add(1));
        const a = a4.xyz,
          b = b4.xyz,
          radius = a4.w,
          strength = b4.w;
        const ab = b.sub(a);
        const capsuleDist = (q: N) => {
          const tt = clamp(dot(q.sub(a), ab).div(max(dot(ab, ab), 1e-6)), 0.0, 1.0);
          return length(q.sub(a.add(ab.mul(tt))));
        };
        const n = gnoise(p.mul(u.brushNoiseScale).add(u.seed))
          .mul(0.5)
          .add(gnoise(p.mul(u.brushNoiseScale.mul(2.7)).add(u.seed.add(3.1))).mul(0.25));
        const r = radius.mul(float(1).add(n.mul(u.brushNoise)));
        const inner = r.mul(float(1).sub(u.brushSoftness));
        const wSmooth = smoothstep(r, inner, capsuleDist(p));
        const rCell = radius.mul(float(1).add(cell.w.sub(0.5).mul(u.brushNoise).mul(0.6)));
        const wCell = smoothstep(
          rCell,
          rCell.mul(float(1).sub(u.brushSoftness)),
          capsuleDist(cell.xyz),
        );
        const w = mix(wSmooth, wCell, u.cellSnap);
        e.assign(min(1.0, e.add(w.mul(strength).mul(u.dt))));
        If(w.greaterThan(0.02), () => {
          hit.assign(1.0);
        });
      });

      // healing is driven by the returning grains: a grain that lands deposits into the heal grid and
      // the voxel refills (as frost first); voxels without a grain follow their healed neighbours
      const healIdx = uint(this.healOffset).add(idx);
      const deposits = float(atomicLoad(this.atomics.element(healIdx))).toVar();
      // Ordinary healing waits for its cell; reconstruction deposits restore locally on arrival.
      const cellId0 = uint(clamp(cell.w.mul(65535.0), 0.0, 65535.0));
      const cellReady0 = atomicLoad(
        this.atomics.element(uint(this.flightOffset).add(cellId0)),
      ).equal(uint(0));
      If(deposits.greaterThan(0.5).and(cellReady0.or(u.reconstruct.greaterThan(0.5))), () => {
        atomicStore(this.atomics.element(healIdx), uint(0));
        refrost.assign(min(1.0, refrost.add(e.mul(2.5))));
        e.assign(0.0);
        mark.assign(1.0);
      });
      // break-cell restore: the last grain of the cell to land triggers it (cellHits, one frame), then the
      // whole cell refills at `cellRestore` (mark = 2 marks a restoring voxel). Nothing else may refill a
      // voxel whose cell still has grains in flight (cellReady), so the object never rebuilds ahead of them.
      const cellId = uint(clamp(cell.w.mul(65535.0), 0.0, 65535.0));
      const cellHits = float(atomicLoad(this.atomics.element(uint(this.cellOffset).add(cellId))));
      const inFlight = atomicLoad(this.atomics.element(uint(this.flightOffset).add(cellId)));
      const cellReady = inFlight.equal(uint(0));
      If(cellHits.greaterThan(0.5).and(e.greaterThan(0.0)), () => {
        mark.assign(2.0);
      });
      If(
        mark
          .greaterThan(1.5)
          .and(e.greaterThan(0.0))
          .and(cellReady)
          .and(u.reconstruct.lessThan(0.5)),
        () => {
          // grow back from what is already solid (hole floor, walls, landed grains) instead of popping in at once
          const canGrow = float(1).toVar();
          If(u.growEdges.greaterThan(0.5), () => {
            canGrow.assign(0.0);
            const offs2 = [
              ivec3(1, 0, 0),
              ivec3(-1, 0, 0),
              ivec3(0, 1, 0),
              ivec3(0, -1, 0),
              ivec3(0, 0, 1),
              ivec3(0, 0, -1),
            ];
            for (const o of offs2) {
              const cc = clamp(ivec3(c).add(o), ivec3(0), ivec3(res - 1));
              If(readTex.load(cc).level(0).r.lessThan(0.5), () => {
                canGrow.assign(1.0);
              });
            }
          });
          If(canGrow.greaterThan(0.5), () => {
            const before = e;
            const after = max(0.0, e.sub(u.cellRestore.mul(rateMul).mul(u.dt)));
            refrost.assign(min(1.0, refrost.add(before.sub(after).mul(2.5))));
            e.assign(after);
          });
        },
      );
      If(u.heal.greaterThan(0.5).and(cellReady.or(u.reconstruct.greaterThan(0.5))), () => {
        // voxels without a grain of their own follow neighbours that a grain has already rebuilt
        const nbMin = float(8).toVar();
        const nbMark = float(0).toVar();
        const offs = [
          ivec3(1, 0, 0),
          ivec3(-1, 0, 0),
          ivec3(0, 1, 0),
          ivec3(0, -1, 0),
          ivec3(0, 0, 1),
          ivec3(0, 0, -1),
        ];
        for (const o of offs) {
          const cc = clamp(ivec3(c).add(o), ivec3(0), ivec3(res - 1));
          const nv = readTex.load(cc).level(0);
          If(nv.b.greaterThan(0.5), () => {
            nbMin.assign(min(nbMin, nv.r));
            nbMark.assign(1.0);
          });
        }
        // Spatial front from deposited material; an additive gap per voxel left permanent holes.
        const reconstruct = u.reconstruct.greaterThan(0.5);
        const target = select(
          reconstruct,
          select(nbMin.lessThan(0.05), float(0), float(1)),
          nbMin.add(u.healGap),
        );
        If(nbMark.greaterThan(0.5).and(target.lessThan(e)), () => {
          const rate = select(
            reconstruct,
            max(u.cellRestore.mul(u.fallbackHeal), u.healRate),
            u.healRate,
          );
          const after = max(target, e.sub(rate.mul(rateMul).mul(u.dt)));
          refrost.assign(min(1.0, refrost.add(e.sub(after).mul(3.0))));
          e.assign(after);
          If(after.lessThanEqual(target.add(0.001)), () => {
            mark.assign(1.0);
          });
        });
        // fallback cleanup only after the whole wave has landed (never ahead of the grains)
        If(u.fallbackOn.greaterThan(0.5).and(reconstruct.not()), () => {
          const after2 = max(0.0, e.sub(u.fallbackHeal.mul(rateMul).mul(u.dt)));
          refrost.assign(min(1.0, refrost.add(e.sub(after2).mul(3.0))));
          e.assign(after2);
        });
      });
      // anything that eroded this frame is no longer "rebuilt"
      If(e.greaterThan(cur.r.add(0.0005)), () => {
        mark.assign(0.0);
      });
      refrost.assign(max(0.0, refrost.sub(u.dt.mul(rateMul).div(max(u.refrostTime, 0.01)))));
      // keep the field zero outside the shape so the surface sampling never reads garbage
      e.assign(select(sd.greaterThan(shell), 0.0, e));
      textureStore(this.scratch, c, vec4(e, refrost, mark, hit)).toWriteOnly();
    })().compute(total, [64]);

    // --- clear the break-cell restore triggers (after the step consumed them); the in-flight counters only
    // clear on reset
    this.cellClearNode = Fn(() => {
      atomicStore(this.atomics.element(uint(this.cellOffset).add(instanceIndex)), uint(0));
    })().compute(65536, [64]);
    this.flightClearNode = Fn(() => {
      atomicStore(this.atomics.element(uint(this.flightOffset).add(instanceIndex)), uint(0));
    })().compute(65536, [64]);

    // --- copy scratch -> tex
    this.copyNode = Fn(() => {
      const c = coord();
      const v = readScratch.load(ivec3(c)).level(0);
      textureStore(this.tex, c, v).toWriteOnly();
    })().compute(total, [64]);

    // --- stats reduction (debug HUD): max erosion + voxel counts above thresholds
    this.statsBuf = instancedArray(4, "uint").toAtomic();
    this.statsClearNode = Fn(() => {
      Loop(4, ({ i: k }: any) => {
        atomicStore(this.statsBuf.element(k), uint(0));
      });
    })().compute(1, [1]);
    this.statsNode = Fn(() => {
      const c = coord();
      const v = readTex.load(ivec3(c)).level(0);
      const e = v.r;
      atomicMax(this.statsBuf.element(0), uint(e.mul(65535.0)));
      atomicMax(this.statsBuf.element(3), uint(v.g.mul(65535.0)));
      If(e.greaterThan(0.5), () => {
        atomicAdd(this.statsBuf.element(1), uint(1));
      });
      If(e.greaterThan(0.9), () => {
        atomicAdd(this.statsBuf.element(2), uint(1));
      });
    })().compute(total, [64]);

    // --- clear both
    this.clearNode = Fn(() => {
      const c = coord();
      textureStore(this.tex, c, vec4(0.0)).toWriteOnly();
    })().compute(total, [64]);

    // --- FROST: the whole shape fully eroded (a shape that is not there yet: the grains heal it in), and the
    // heal-grid counters cleared (both used when the distance field is retargeted to another shape)
    this.fillNode = Fn(() => {
      const c = coord();
      const sd = this.shape.sdfNode(toObject(c));
      textureStore(
        this.tex,
        c,
        vec4(select(sd.greaterThan(shell), 0.0, 1.0), 0.0, 0.0, 0.0),
      ).toWriteOnly();
    })().compute(total, [64]);
    this.healClearNode = Fn(() => {
      atomicStore(this.atomics.element(uint(this.healOffset).add(instanceIndex)), uint(0));
    })().compute(total, [64]);

    // --- bake the crack helper: a low-frequency domain-warp vector (so cell boundaries curve instead of
    // reading as flat polygons) and the proximity to the nearest (warped, partially covered) boundary
    this.bakeNode = Fn(() => {
      const c = coord();
      const p = toObject(c).toVar();
      const wq = p.mul(u.crackWarpScale).add(u.seed.mul(0.11));
      const warp = vec3(
        gnoise(wq)
          .mul(0.6)
          .add(gnoise(wq.mul(2.1).add(vec3(7.3, 1.9, 4.4))).mul(0.4)),
        gnoise(wq.add(vec3(13.7, 5.1, 9.9)))
          .mul(0.6)
          .add(gnoise(wq.mul(2.1).add(vec3(2.2, 8.8, 6.1))).mul(0.4)),
        gnoise(wq.add(vec3(3.3, 17.1, 12.5)))
          .mul(0.6)
          .add(gnoise(wq.mul(2.1).add(vec3(9.7, 4.4, 1.1))).mul(0.4)),
      );
      const q = ErosionField.warpDomain(p, warp, u.crackScale, u.crackWarp);
      const ve = voronoiEdge(q, u.seed, u.crackCoverage);
      const dEdge = ve.w.div(u.crackScale); // approx object-space distance
      const prox = smoothstep(voxel * 2.5, 0.0, dEdge);
      const h = hash31(vec3(c)).mul(0.15);
      textureStore(this.crackTex, c, vec4(warp, saturate(prox.add(h.mul(prox))))).toWriteOnly();
      // break cells (a separate, finer Voronoi in the same warped domain): centre back in object space
      const bq = ErosionField.warpDomain(p, warp, u.breakScale, u.crackWarp);
      const bc = voronoiCell(bq, u.seed.add(3.0));
      const centreObj = bc.xyz.sub(warp.mul(u.crackWarp)).div(u.breakScale);
      textureStore(this.cellTex, c, vec4(centreObj, hash31(bc.xyz.add(u.seed)))).toWriteOnly();
    })().compute(total, [64]);
    void abs;
    void mix;
  }

  clear(renderer: THREE.WebGPURenderer) {
    renderer.compute(this.clearNode);
    renderer.compute(this.cellClearNode);
    renderer.compute(this.flightClearNode);
  }

  /**
   * FROST: the shape behind `this.shape.sdfNode` changed (the live distance-field texture was overwritten):
   * re-bake the crack / break-cell helpers for it, reset the heal grid and every cell counter, and start the
   * field either solid (`fill` false) or fully eroded (`fill` true, healed in by the returning grains).
   */
  rebake(renderer: THREE.WebGPURenderer, fill: boolean) {
    const u = this.u,
      E = D.erosion,
      C = D.ice.cracks;
    u.crackScale.value = C.largeScale;
    u.crackWarp.value = C.warp;
    u.crackWarpScale.value = C.warpScale;
    u.crackCoverage.value = C.coverage;
    u.breakScale.value = E.breakCellScale;
    // Helpers depend on the shared bound and crack parameters, never the shape.
    const sig = `${C.largeScale}|${C.warp}|${C.warpScale}|${C.coverage}|${E.breakCellScale}`;
    if ((!this.baked || sig !== this.lastCrackSig) && !this.skipBake)
      renderer.compute(this.bakeNode);
    this.lastCrackSig = sig;
    this.baked = true;
    u.reconstruct.value = fill ? 1 : 0;
    renderer.compute(fill ? this.fillNode : this.clearNode);
    renderer.compute(this.cellClearNode);
    renderer.compute(this.flightClearNode);
    renderer.compute(this.healClearNode);
    this.crumbleUntil = -1;
    u.crumbleUntil.value = -1;
  }

  /** Debug: reduce the field and read the result back asynchronously (throttled by the caller). */
  readStats(renderer: THREE.WebGPURenderer, t = 0) {
    if (this.statsPending) return;
    this.statsPending = true;
    this.statsIssuedT = t;
    renderer.compute(this.statsClearNode);
    renderer.compute(this.statsNode);
    renderer
      .getArrayBufferAsync(this.statsBuf.value)
      .then((buf: ArrayBuffer) => {
        const a = new Uint32Array(buf);
        this.stats.max = a[0] / 65535;
        this.stats.over50 = a[1];
        this.stats.over90 = a[2];
        this.stats.refrost = a[3] / 65535;
        this.statsReadT = this.statsIssuedT;
        this.statsPending = false;
      })
      .catch(() => {
        this.statsPending = false;
      });
  }

  /** True while a stroke, the crumble window, or (refrost) healing can still change the field. */
  crumbleUntil = -1;

  /**
   * Advance the field. `segments` holds MAX_SEGMENTS capsules as (ax,ay,az,radius),(bx,by,bz,strength).
   * With `run` false only the bookkeeping happens (the GPU passes are skipped: the field is static).
   */
  step(
    renderer: THREE.WebGPURenderer,
    t: number,
    dt: number,
    segments: THREE.Vector4[],
    segCount: number,
    run = true,
  ) {
    const E = D.erosion,
      H = D.healing;
    const u = this.u;
    u.dt.value = Math.min(dt, 1 / 30);
    u.time.value = t;
    if (D.version !== this.settingsVersion) {
      this.settingsVersion = D.version;
      const C = D.ice.cracks;
      const crackSig = `${C.largeScale}|${C.warp}|${C.warpScale}|${C.coverage}|${E.breakCellScale}`;
      if (!this.baked || crackSig !== this.lastCrackSig) {
        u.crackScale.value = C.largeScale;
        u.crackWarp.value = C.warp;
        u.crackWarpScale.value = C.warpScale;
        u.crackCoverage.value = C.coverage;
        u.breakScale.value = E.breakCellScale;
        if (!this.skipBake) renderer.compute(this.bakeNode);
        if (!this.baked) renderer.compute(this.clearNode);
        this.baked = true;
        this.lastCrackSig = crackSig;
      }
      u.healRate.value = H.healRate;
      u.healGap.value = H.healGap;
      u.fallbackHeal.value = H.fallbackHeal;
      u.refrostTime.value = H.refrostTime;
      u.cellRestore.value = H.cellRestore;
      u.growEdges.value = H.growFromEdges ? 1 : 0;
      u.breakup.value = H.breakup;
      u.breakupScale.value = H.breakupScale;
      u.crumbleRate.value = E.crumbleRate;
      u.crumbleCrackBias.value = E.crumbleCrackBias;
      u.brushNoise.value = E.brushNoise;
      u.brushNoiseScale.value = E.brushNoiseScale;
      u.cellSnap.value = E.cellSnap;
      // FROST: softness 0 makes the capsule falloff smoothstep(r, r, d) — undefined in WGSL and evaluating to 1 everywhere
      // here, which eroded the whole shape in one frame; keep a sliver of softness
      u.brushSoftness.value = Math.max(E.brushSoftness, 0.02);
    }
    if (segCount > 0) {
      sim.lastStrokeT = t;
      u.crumbleUntil.value = t + E.crumbleDuration;
      this.crumbleUntil = t + E.crumbleDuration;
    }
    const healing = t - sim.lastStrokeT > H.healDelay;
    sim.healing = healing;
    u.heal.value = healing ? 1 : 0;
    // the timer-based cleanup may only start once every grain of the wave has had time to land
    u.fallbackOn.value =
      t - sim.lastStrokeT >
      H.healDelay + H.waveTime + H.waveJitter + Math.max(H.returnDuration, H.returnAfter) + 1.0
        ? 1
        : 0;
    u.segCount.value = segCount;
    if (segCount > 0) {
      const arr = this.segments.array as THREE.Vector4[];
      for (let i = 0; i < segCount * 2; i++) arr[i].copy(segments[i]);
    }
    if (!run || u.reconstruct.value > 0.5) return; // AssemblyField owns arrival-driven coverage.
    renderer.compute(this.stepNode);
    renderer.compute(this.cellClearNode);
    renderer.compute(this.copyNode);
  }

  /** Commit the assembly pass before both the ice and powder read the same field. */
  commitAssembly(renderer: THREE.WebGPURenderer) {
    renderer.compute(this.copyNode);
  }

  dispose() {
    this.tex.dispose();
    this.scratch.dispose();
    this.crackTex.dispose();
    this.cellTex.dispose();
  }
}
