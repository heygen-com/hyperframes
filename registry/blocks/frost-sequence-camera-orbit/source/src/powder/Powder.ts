// Interior powder: ~1M particles filling the object's volume, simulated in WebGPU compute, rendered as
// directly instanced grains (dormant/ghost vertices collapse), shaded by a density grid
// (self-shadow + AO) and topped with a volumetric haze pass over the same grid.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
const {
  refract,
  log,
  output,
  attribute,
  positionView,
  reflect,
  vec2,
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  instancedArray,
  storage,
  instanceIndex,
  If,
  Loop,
  int,
  uint,
  uvec3,
  ivec3,
  atomicAdd,
  atomicSub,
  atomicLoad,
  atomicStore,
  max,
  min,
  abs,
  dot,
  length,
  normalize,
  exp,
  mix,
  smoothstep,
  clamp,
  select,
  floor,
  fract,
  sin,
  cos,
  sqrt,
  texture3D,
  textureStore,
  positionLocal,
  normalLocal,
  transformNormalToView,
  varying,
  cameraPosition,
  screenUV,
  mat3,
  mat4,
  pow,
  Break,
  Continue,
  cross,
  step,
  negate,
  uv,
  texture,
  uniformArray,
  cameraViewMatrix,
} = tsl;
import type { ShapeSpec } from "../shape/sdf";
import { sampleInterior, sdfNormalNode } from "../shape/sdf";
import { buildGrainVariants } from "../shape/geometry";
import { SHARD_ATLAS_URL, SHARD_GRID, SHARD_CELLS } from "./shardAtlas";
import type { ErosionField } from "../erosion/ErosionField";
import { AssemblyField, assemblyReach } from "../erosion/AssemblyField";
import {
  assemblyFrontPhase,
  returnGroupPhase,
  returnReserve,
  RETURN_GROUP_DEFAULTS,
} from "./returnGroups";
import type { Interaction } from "../core/interaction";
import { curlNoise, vnoise3, hash11, hash31, hashSeed, rotateAxis, saturate } from "../tsl/noise";
import { D } from "../dials/store";
import { backdropColorAt, type BackdropUniforms } from "../scene/Backdrop";
import { iceSurface, iceSmudgeDirections } from "../ice/SharedSurface";
import { iceEnvironment } from "../ice/EnvironmentSampling";
import { iceDetail, iceFrost, iceInclusions } from "../ice/SurfaceDetail";
import { ICE_VARIANT } from "../ice/variant";
import { sim } from "../core/state";

type N = any;

/** Shard sprite atlas (generated from the Higgsfield shard sheet): loaded once, shared by every rebuild. */
let shardAtlas: THREE.Texture | null = null;
function getShardAtlas(): THREE.Texture {
  if (!shardAtlas) {
    const t = new THREE.TextureLoader().load(SHARD_ATLAS_URL);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    shardAtlas = t;
  }
  return shardAtlas;
}
// GHOST = eroded but gated out by `amount`: never rendered, still heals its voxel when the wave arrives
// WAITING = landed, but its break cell still has grains in flight: it sits at rest (invisible) until the
// cell refills, and only leaves again if the brush cuts its voxel
const DORMANT = 0,
  ACTIVE = 1,
  HEALING = 2,
  STRAY = 3,
  GHOST = 4,
  WAITING = 5;

export interface PowderOptions {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  shape: ShapeSpec;
  erosion: ErosionField;
  seed: number;
  rand: () => number;
  count: number;
  variants: number;
  strays: number;
  densityRes: number;
  clumpCount: number;
  objectGroup: THREE.Object3D;
  enabled?: boolean;
  /** 'fast' swaps the 6-sample finite-difference curl for a one-sample swirl. */
  turbulence?: "full" | "fast";
  /** shared atomic uint buffer: [density G^3 | 16 counters | heal grid]. */
  atomics: any;
  countersOffset: number;
  healOffset: number;
  cellOffset: number;
  flightOffset: number;
  fieldRes: number;
  /** backdrop gradient uniforms (the translucent grains show the backdrop through their centres). */
  backdrop: BackdropUniforms;
  fractureDetail?: THREE.Texture;
  iceUniforms: Record<string, any>;
  iceFeatures: Record<string, any>;
  environment: THREE.Texture;
}

export class Powder {
  readonly total: number;
  /** FROST: grains that belong to the shape (the rest are strays) and the initial rest buffer (thresholds, strays). */
  readonly count: number;
  readonly restInit: Float32Array;
  readonly meshes: THREE.Mesh[] = [];
  readonly group = new THREE.Group();
  readonly densityTex: THREE.Storage3DTexture;
  private assembly?: AssemblyField;
  assemblyEnabled = true;
  beforeIntegrate?: () => void;
  beforeAssembly?: () => void;
  private buffers: Record<string, any> = {};
  private nodes: Record<string, any> = {};
  private material!: THREE.MeshStandardNodeMaterial;
  private prevModel = new THREE.Matrix4();
  private readonly inversePrevModel = new THREE.Matrix4();
  private statsTimer = 0;
  private densityDirty = true;
  private fragmentShadowMap = true;
  private settingsVersion = -1;
  readonly u = {
    rigEnabled: uniform(0),
    rigStrength: uniform(1),
    surfaceFrost: uniform(1),
    surfaceDetail: uniform(1),
    dt: uniform(0),
    time: uniform(0),
    model: uniform(new THREE.Matrix4()),
    previousModel: uniform(new THREE.Matrix4()),
    modelDelta: uniform(new THREE.Matrix4()),
    normalMat: uniform(new THREE.Matrix3()),
    strokeDir: uniform(new THREE.Vector3(1, 0, 0)),
    strokeSpeed: uniform(0),
    heal: uniform(0),
    ejectSpeed: uniform(1.1),
    ejectSpread: uniform(0.5),
    ejectTurb: uniform(0.8),
    backwardRatio: uniform(0.25),
    clumpJitter: uniform(0.5),
    drag: uniform(1.4),
    gravity: uniform(0.12),
    turbulence: uniform(0.9),
    turbScale: uniform(1.8),
    turbDecay: uniform(0.6),
    cohesion: uniform(2.4),
    settleTime: uniform(3.2),
    settledDrift: uniform(0.012),
    tumble: uniform(2.5),
    returnDuration: uniform(2.4),
    returnCurve: uniform(0.35),
    inherit: uniform(1),
    inheritTime: uniform(0.22),
    straySpeed: uniform(0.06),
    fade: uniform(1),
    sizeMul: uniform(1),
    amount: uniform(0.3),
    dustScale: uniform(0.0055),
    grainScale: uniform(0.011),
    clumpScale: uniform(0.022),
    fragmentScale: uniform(0.05),
    sizeJitter: uniform(0.45),
    densityExtent: uniform(4.2),
    densityScale: uniform(0.03),
    shadowStrength: uniform(0.75),
    aoStrength: uniform(0.55),
    lightDir: uniform(new THREE.Vector3(0, 1, 0)),
    tone: uniform(new THREE.Color("#dcdcdc")),
    wrap: uniform(0.45),
    keyIntensity: uniform(3.2),
    keyColor: uniform(new THREE.Color("#ffffff")),
    colorByState: uniform(0),
    colorBySize: uniform(0),
    colorByAge: uniform(0),
    camPos: uniform(new THREE.Vector3()),
    invProj: uniform(new THREE.Matrix4()),
    camWorld: uniform(new THREE.Matrix4()),
    hazeSteps: uniform(28),
    strayBase: uniform(1),
    holeRadius: uniform(0.55),
    bound: uniform(1.5),
    fieldActive: uniform(1),
    hazeOn: uniform(1),
    waveTime: uniform(2),
    waveJitter: uniform(0.6),
    minEject: uniform(1),
    minPixel: uniform(1.5),
    pixelWorld: uniform(0.001),
    ghostDist: uniform(0),
    ghostFrac: uniform(0.45),
    waveReach: uniform(3),
    depositRadius: uniform(2),
    returnMode: uniform(1),
    springK: uniform(6),
    springDamp: uniform(0.9),
    springRamp: uniform(0.6),
    landRadius: uniform(0.03),
    returnAfter: uniform(3),
    maxSpeed: uniform(8),
    returnDrag: uniform(0.25),
    returnMaxSpeed: uniform(12),
    lostRadius: uniform(30),
    stragglers: uniform(0),
    spriteSee: uniform(0),
    frontDuration: uniform(3.2),
    frontX: uniform(-0.65),
    frontY: uniform(0.55),
    frontAngle: uniform(-35),
    frontSpread: uniform(0.65),
    frontNoise: uniform(0.35),
    speedVariation: uniform(0.65),
    pathBend: uniform(1.2),
    pathSwirl: uniform(1.1),
    landingVariation: uniform(0.8),
    groupNoise: uniform(2),
    assemblyEnd: uniform(0),
    groupStagger: uniform(0),
    groupScale: uniform(0.65),
    groupSeed: uniform(7),
    alignAmt: uniform(1),
    alignDist: uniform(0.6),
    alignCurve: uniform(1),
    landedFade: uniform(0.25),
    landShrink: uniform(0),
    translucency: uniform(0.6),
    throughTint: uniform(new THREE.Color("#aeb6bb")),
    fresnelPower: uniform(3),
    fragRough: uniform(0.32),
    fragClearcoat: uniform(0.6),
    fragSpecular: uniform(1),
    sparkle: uniform(0.6),
    sparkleFraction: uniform(0.35),
    sparkleSpread: uniform(0.5),
    lightDirView: uniform(new THREE.Vector3(0, 1, 0)),
    spriteSize: uniform(1.4),
    spriteTilt: uniform(0.5),
    spriteNormal: uniform(1),
    spriteFrost: uniform(1),
    spriteFrostBoost: uniform(0.35),
    spriteFrostRough: uniform(0.7),
    spriteEdge: uniform(0.6),
    spriteCut: uniform(0.2),
    repel: uniform(0),
    repelStrength: uniform(6),
    repelRange: uniform(0.35),
    repelRadial: uniform(12),
    repelRadialRange: uniform(1.6),
    modelInv: uniform(new THREE.Matrix4()),
  };

  constructor(readonly o: PowderOptions) {
    const { count, strays, rand, shape } = o;
    this.total = count + strays;
    const N = this.total;
    const P = D.powder;
    // ---- CPU init
    const samples = sampleInterior(shape, count, P.nearSurfaceFraction, P.nearSurfaceDepth, rand);
    const pos = new Float32Array(N * 4),
      vel = new Float32Array(N * 4),
      rest = new Float32Array(N * 4),
      meta = new Float32Array(N * 4),
      heal = new Float32Array(N * 4);
    const ratios = [
      P.grainSizes.tinyDustRatio,
      P.grainSizes.smallGrainRatio,
      P.grainSizes.mediumClumpRatio,
      0.01,
    ];
    const rs = ratios.reduce((a, b) => a + b, 0);
    const cum = [
      ratios[0] / rs,
      (ratios[0] + ratios[1]) / rs,
      (ratios[0] + ratios[1] + ratios[2]) / rs,
    ];
    // clump leaders via spatial cells
    const cellSize = Math.cbrt((8 * shape.bound ** 3) / Math.max(100, o.clumpCount));
    const halfCells = Math.ceil(shape.bound / cellSize) + 1;
    const gridSide = halfCells * 2 + 1;
    const leaders = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const i3 = i * 3,
        i4 = i * 4;
      const x = samples.positions[i3],
        y = samples.positions[i3 + 1],
        z = samples.positions[i3 + 2];
      const depth = samples.depths[i];
      const r = rand();
      let cls = r < cum[0] ? 0 : r < cum[1] ? 1 : r < cum[2] ? 2 : 3;
      if (cls === 3 && depth > 0.2) cls = 2;
      const cx = Math.floor(x / cellSize) + halfCells,
        cy = Math.floor(y / cellSize) + halfCells,
        cz = Math.floor(z / cellSize) + halfCells;
      const key = cx + cy * gridSide + cz * gridSide * gridSide;
      let leader = leaders.get(key);
      if (leader === undefined) {
        leader = i;
        leaders.set(key, i);
      }
      rest[i4] = x;
      rest[i4 + 1] = y;
      rest[i4 + 2] = z;
      rest[i4 + 3] = 0.35 + rand() * 0.4;
      pos[i4] = x;
      pos[i4 + 1] = y;
      pos[i4 + 2] = z;
      meta[i4] = DORMANT;
      meta[i4 + 1] = rand();
      meta[i4 + 2] = cls;
      meta[i4 + 3] = leader;
    }
    // strays: at rest in / around the hole
    for (let s = 0; s < strays; s++) {
      const i = count + s;
      const a = rand() * Math.PI * 2;
      const rr =
        shape.name === "torus"
          ? (shape.size - shape.size * shape.tubeRatio) * (0.15 + rand() * 0.75)
          : shape.bound * (1.05 + rand() * 0.35);
      const x = Math.cos(a) * rr,
        y = Math.sin(a) * rr,
        z = (rand() - 0.5) * shape.thickness * 1.2;
      const i4 = i * 4;
      rest[i4] = x;
      rest[i4 + 1] = y;
      rest[i4 + 2] = z;
      rest[i4 + 3] = 2;
      pos[i4] = x;
      pos[i4 + 1] = y;
      pos[i4 + 2] = z;
      pos[i4 + 3] = 0.01;
      vel[i4 + 3] = rand() * 10;
      meta[i4] = STRAY;
      meta[i4 + 1] = rand();
      meta[i4 + 2] = rand() < 0.8 ? 0 : 1;
      meta[i4 + 3] = i;
    }
    this.count = count;
    this.restInit = rest.slice();
    const B = this.buffers;
    B.pos = instancedArray(pos, "vec4");
    B.vel = instancedArray(vel, "vec4");
    B.rest = instancedArray(rest, "vec4");
    B.meta = instancedArray(meta, "vec4");
    B.heal = instancedArray(heal, "vec4");
    B.leaders = instancedArray(N, "vec4");
    const V = o.variants;
    const G = o.densityRes;
    B.atomics = o.atomics; // density voxels at 0, counters at countersOffset, heal grid at healOffset
    this.densityTex = new THREE.Storage3DTexture(G, G, G);
    this.densityTex.type = THREE.HalfFloatType;
    this.densityTex.format = THREE.RGBAFormat;
    this.densityTex.minFilter = this.densityTex.magFilter = THREE.LinearFilter;
    this.densityTex.wrapS =
      this.densityTex.wrapT =
      this.densityTex.wrapR =
        THREE.ClampToEdgeWrapping;
    this.u.bound.value = shape.bound;
    this.u.holeRadius.value =
      shape.name === "torus" ? shape.size - shape.size * shape.tubeRatio : shape.bound;
    if (o.enabled !== false) {
      this.buildCompute();
      this.assembly = new AssemblyField(o.erosion, count, B, this.u);
      this.buildMeshes();
      o.scene.add(this.group);
    }
    this.prevModel.copy(o.objectGroup.matrixWorld);
  }

  // --------------------------------------------------------------------------------------------
  private buildCompute() {
    const { count, shape, erosion, variants: V } = this.o;
    const N = this.total,
      u = this.u,
      B = this.buffers;
    const G = this.o.densityRes;
    const i = instanceIndex;
    void count;

    const CO = this.o.countersOffset,
      HO = this.o.healOffset,
      CLO = this.o.cellOffset,
      FLO = this.o.flightOffset,
      FR = this.o.fieldRes; // FR: erosion field resolution (R is the rest buffer element below)
    const cellTexNode = texture3D(erosion.cellTex);
    const counter = (v: N) => B.atomics.element(uint(CO).add(uint(v)));
    const densityAt = (idx: N) => B.atomics.element(idx);
    const healAt = (idx: N) => B.atomics.element(uint(HO).add(idx));
    const classScale = (cls: N) =>
      select(
        cls.lessThan(0.5),
        u.dustScale,
        select(
          cls.lessThan(1.5),
          u.grainScale,
          select(cls.lessThan(2.5), u.clumpScale, u.fragmentScale),
        ),
      );
    const classWeight = (cls: N) =>
      select(
        cls.lessThan(0.5),
        uint(1),
        select(cls.lessThan(1.5), uint(2), select(cls.lessThan(2.5), uint(5), uint(12))),
      );
    // Read a frozen step: live neighbor reads race other workgroups writing their state.
    this.nodes.snapshotLeaders = Fn(() => {
      B.leaders.element(i).assign(vec4(B.pos.element(i).xyz, B.meta.element(i).x));
    })().compute(N, [64]);
    const expoInOut = (x: N) => {
      const xc = clamp(x, 0.0, 1.0);
      return select(
        xc.lessThan(0.5),
        pow(2.0, xc.mul(20.0).sub(10.0)).div(2.0),
        float(2)
          .sub(pow(2.0, xc.mul(-20.0).add(10.0)))
          .div(2.0),
      );
    };

    this.nodes.resetCounters = Fn(() => {
      Loop(8, ({ i: k }: any) => {
        atomicStore(counter(k), uint(0));
      });
    })().compute(1, [1]);

    const curl =
      this.o.turbulence === "fast"
        ? (q: N) => cross(vnoise3(q), vnoise3(q.add(vec3(31.7, 11.3, 57.9)))).mul(1.6)
        : (q: N) => curlNoise(q);

    // normalize() of a zero vector is NaN on the GPU and a NaN grain is lost for good (the logo SDF is flat
    // outside its grid, so its gradient is zero there): every direction is normalised safely
    const safeNormalize = (v: N) => v.div(max(length(v), 1e-6));
    // one update kernel, instantiated twice: all particles, and (idle) the strays only
    const buildUpdate = (indexNode: N, dispatchCount: number) =>
      Fn(() => {
        const i = indexNode;
        const P = B.pos.element(i),
          Vv = B.vel.element(i),
          R = B.rest.element(i),
          M = B.meta.element(i),
          H = B.heal.element(i);
        // every value shared between the state branches is pinned to a variable here (TSL assigns
        // unpinned nodes at first use, which may be inside another branch -> uninitialised reads)
        const state = M.x.toVar();
        const seed = M.y.toVar(),
          cls = M.z.toVar(),
          leader = M.w.toVar();
        const pos = P.xyz.toVar();
        const size = P.w.toVar();
        const vel = Vv.xyz.toVar();
        const age = Vv.w.toVar();
        const rest = R.xyz.toVar();
        const threshold = R.w.toVar();
        const h1 = hashSeed(seed, 1).toVar(),
          h2 = hashSeed(seed, 2).toVar(),
          h3 = hashSeed(seed, 3).toVar();
        const baseSize = classScale(cls)
          .mul(float(1).sub(u.sizeJitter.mul(0.5)).add(u.sizeJitter.mul(h1)))
          .mul(u.sizeMul)
          .toVar();
        const restWorld = u.model.mul(vec4(rest, 1.0)).xyz.toVar();
        const restNormalWorld = safeNormalize(
          u.normalMat.mul(sdfNormalNode(shape, rest, 0.004)),
        ).toVar();
        const centreWorld = u.model.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz.toVar();

        const erSample = erosion.sample(rest).toVar();
        const erRest = erSample.r.toVar();
        const hitRecent = erSample.a.greaterThan(0.01); // the brush is cutting this grain's rest voxel right now
        const gate = hash11(seed.mul(211.7).add(5.0)).lessThan(u.amount);
        const healScheduled = H.w.greaterThan(0.5);
        // deposit into the heal grid around the rest voxel (the field refills there next frame); the radius
        // lets one returning grain stand in for the material that vanished on breakup (powder.amount < 1)
        // break cell of the rest voxel (nearest voxel, like the erosion step reads it)
        const cellIdOf = () => {
          const gc = ivec3(floor(erosion.uvw(rest).mul(float(FR))));
          const cellHash = cellTexNode.load(clamp(gc, ivec3(0), ivec3(FR - 1))).level(0).w;
          return uint(clamp(cellHash.mul(65535.0), 0.0, 65535.0));
        };
        // leaving: one more grain of this cell in flight
        const leave = () => {
          atomicAdd(B.atomics.element(uint(FLO).add(cellIdOf())), uint(1));
        };
        // arriving: one fewer; the last one home (allowing `cellStragglers`) triggers the cell restore
        const arrive = (trigger: N) => {
          const cellId = cellIdOf().toVar();
          const before = atomicSub(B.atomics.element(uint(FLO).add(cellId)), uint(1)).toVar();
          If(trigger.and(before.lessThanEqual(uint(1).add(uint(u.stragglers)))), () => {
            atomicAdd(B.atomics.element(uint(CLO).add(cellId)), uint(1));
          });
        };
        const deposit = () => {
          // the small voxel sphere around the rest (the cell itself refills once all its grains are home)
          const gp = rest
            .add(this.o.erosion.bound)
            .div(this.o.erosion.bound * 2)
            .mul(float(FR));
          const gi = ivec3(floor(gp)).toVar();
          const rf = u.depositRadius.toVar();
          const r = int(rf.ceil()).toVar();
          const rng = { start: r.negate(), end: r, condition: "<=" };
          Loop(rng, rng, rng, ({ i: dx, j: dy, k: dz }: any) => {
            const cc = gi.add(ivec3(dx, dy, dz));
            const inSphere = float(dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz))).lessThanEqual(
              rf.mul(rf).add(0.01),
            );
            If(
              inSphere
                .and(cc.x.greaterThanEqual(0))
                .and(cc.y.greaterThanEqual(0))
                .and(cc.z.greaterThanEqual(0))
                .and(cc.x.lessThan(FR))
                .and(cc.y.lessThan(FR))
                .and(cc.z.lessThan(FR)),
              () => {
                const hidx = uint(cc.x)
                  .add(uint(cc.y).mul(uint(FR)))
                  .add(uint(cc.z).mul(uint(FR * FR)));
                atomicAdd(healAt(hidx), uint(1));
              },
            );
          });
        };
        // return order: grains nearest the object first, the far plume last (ghost dust spreads evenly)
        const scheduleTime = () => {
          const distance = length(pos.sub(restWorld));
          const wave = clamp(distance.div(u.waveReach), 0.0, 1.0).mul(u.waveTime);
          const regional = erosion.u.reconstruct
            .greaterThan(0.5)
            .and(u.groupNoise.greaterThan(0.5));
          const jitter = select(regional, h3.mul(u.waveJitter).mul(0.04), h3.mul(u.waveJitter));
          const base = wave.add(jitter);
          const growing = u.groupNoise.greaterThan(1.5);
          const delay = float(0).toVar();
          If(
            erosion.u.reconstruct.greaterThan(0.5).and(u.groupStagger.greaterThan(0).or(growing)),
            () => {
              const reserve = select(
                u.returnMode.greaterThan(0.5),
                returnReserve(distance, length(vel), u),
                u.returnDuration.add(0.2),
              );
              const available = max(0, u.assemblyEnd.sub(u.time).sub(base).sub(reserve));
              // Scale the whole front to the available window, rather than clipping
              // all late regions to the same departure time.
              delay.assign(
                min(select(growing, u.frontDuration, u.groupStagger), available).mul(
                  select(
                    u.rigEnabled.greaterThan(0.5),
                    assemblyFrontPhase(rest, u),
                    max(0, threshold.sub(2)),
                  ),
                ),
              );
            },
          );
          return u.time.add(wave).add(jitter).add(delay);
        };
        const ghostScheduleTime = () => u.time.add(h1.mul(u.waveTime)).add(h3.mul(u.waveJitter));

        // leave the surface: velocity along the stroke (a share backwards), spread along the normal, turbulence
        const eject = () => {
          const pw = restWorld;
          const nw = restNormalWorld;
          const leaderSeed = B.meta.element(uint(leader)).y;
          const clumpRand = float(1)
            .sub(u.clumpJitter.mul(0.5))
            .add(u.clumpJitter.mul(hash11(leaderSeed.mul(77.7))));
          const backward = select(
            hash11(leaderSeed.mul(31.3).add(1.0)).lessThan(u.backwardRatio),
            float(-1),
            float(1),
          );
          const spd = max(u.strokeSpeed, u.minEject);
          const dir = u.strokeDir.mul(backward);
          const turb = curl(pw.mul(u.turbScale).add(u.time.mul(0.2)));
          const v0 = dir
            .mul(spd.mul(u.ejectSpeed).mul(clumpRand))
            .add(nw.mul(u.ejectSpread).mul(float(0.5).add(h2)).mul(spd.mul(0.4)))
            .add(turb.mul(u.ejectTurb).mul(spd.mul(0.25)).mul(h3.add(0.5)));
          const fragScale = select(cls.greaterThan(2.5), float(0.35), float(1.0));
          vel.assign(v0.mul(fragScale));
          pos.assign(pw.add(nw.mul(0.002)));
          age.assign(0.0);
          size.assign(baseSize);
          state.assign(ACTIVE);
          H.w.assign(0.0);
          leave();
        };
        If(state.lessThan(0.5), () => {
          // DORMANT: sample the erosion field at rest (skipped while the field is static). The state
          // chain below must stay intact, so the idle gate is nested rather than part of the condition.
          If(u.fieldActive.greaterThan(0.5), () => {
            If(erRest.greaterThan(threshold), () => {
              If(gate, () => {
                eject();
              }).Else(() => {
                state.assign(GHOST);
                H.w.assign(0.0);
              });
            });
          });
        })
          .ElseIf(state.lessThan(1.5), () => {
            // ACTIVE
            age.addAssign(u.dt);
            const settle = smoothstep(u.settleTime.mul(0.45), u.settleTime, age);
            const turb = curl(pos.mul(u.turbScale).add(u.time.mul(0.15)))
              .mul(u.turbulence)
              .mul(exp(age.mul(u.turbDecay).negate()));
            const leaderP = B.leaders.element(uint(leader));
            const leaderState = leaderP.w;
            const coh = select(
              leaderState.greaterThan(0.5).and(leaderState.lessThan(1.5)),
              leaderP.xyz.sub(pos).mul(u.cohesion).mul(float(1).sub(settle)),
              vec3(0),
            );
            // optional repulsion from the object: full strength inside the surface, smooth falloff outside
            const repelF = vec3(0).toVar();
            If(u.repel.greaterThan(0.5), () => {
              const pObj = u.modelInv.mul(vec4(pos, 1.0)).xyz.toVar();
              const dObj = shape.sdfNode(pObj).toVar();
              If(dObj.lessThan(u.repelRange), () => {
                const wgt = saturate(float(1).sub(dObj.div(u.repelRange)));
                const nW = safeNormalize(u.normalMat.mul(sdfNormalNode(shape, pObj, 0.004)));
                repelF.assign(nW.mul(u.repelStrength).mul(wgt.mul(wgt)));
              });
              // radial push from the object's centre: the only direction that always leads out of a pocket
              const toOut = pos.sub(centreWorld);
              const rn = length(toOut).div(u.bound.mul(u.repelRadialRange));
              If(rn.lessThan(1.0), () => {
                const w2 = float(1).sub(rn.mul(rn));
                const dirOut = safeNormalize(
                  toOut.add(vec3(h1.sub(0.5), h2.sub(0.5), h3.sub(0.5)).mul(0.05)),
                );
                repelF.addAssign(dirOut.mul(u.repelRadial).mul(w2.mul(w2)));
              });
            });
            vel.addAssign(
              turb
                .add(coh)
                .add(repelF)
                .add(vec3(0, u.gravity.negate(), 0))
                .mul(u.dt),
            );
            vel.mulAssign(exp(u.drag.mul(u.dt).negate()));
            vel.mulAssign(float(1).sub(settle.mul(min(1.0, u.dt.mul(3.0)))));
            pos.addAssign(vel.mul(u.dt));
            pos.addAssign(
              curl(pos.mul(0.9).add(u.time.mul(0.05)))
                .mul(u.settledDrift)
                .mul(settle)
                .mul(u.dt),
            );
            If(u.inherit.greaterThan(0.5).and(age.lessThan(u.inheritTime)), () => {
              const follow = float(1).sub(
                smoothstep(u.inheritTime.mul(0.75), max(u.inheritTime, 0.001), age),
              );
              pos.assign(mix(pos, u.modelDelta.mul(vec4(pos, 1.0)).xyz, follow));
              vel.assign(mix(vel, mat3(u.modelDelta).mul(vel), follow));
            });
            // hard speed cap: nothing ever flings a grain off-screen
            const spdNow = length(vel);
            If(spdNow.greaterThan(u.maxSpeed), () => {
              vel.mulAssign(u.maxSpeed.div(spdNow));
            });
            // healing: scheduled when the cursor is idle, or on the grain's own timer (returnAfter)
            const ownTimer = u.returnAfter.greaterThan(0.001).and(age.greaterThan(u.returnAfter));
            If(u.heal.greaterThan(0.5).or(ownTimer), () => {
              If(healScheduled.not(), () => {
                H.w.assign(scheduleTime());
              });
              If(H.w.greaterThan(0.5).and(u.time.greaterThanEqual(H.w)), () => {
                state.assign(HEALING);
                // FROST: the flight start lives in H.w; `age` keeps counting so the tumble phase never jumps
                H.xyz.assign(pos);
                H.w.assign(u.time);
              });
            }).Else(() => {
              H.w.assign(0.0);
            });
          })
          .ElseIf(state.lessThan(2.5), () => {
            // HEALING
            const isGhost = H.w.lessThan(-0.5);
            // FROST: flight start from H.w (ghosts keep the experiment's age-based start); age keeps counting
            const t0 = select(isGhost, age, H.w).toVar();
            If(isGhost.not(), () => {
              age.addAssign(u.dt);
            });
            const start = H.xyz;
            const target = restWorld;
            const nw = restNormalWorld;
            If(u.returnMode.greaterThan(0.5), () => {
              // spring return: a damped spring toward the rest that ramps in over `springRamp`, so the grain
              // decelerates, turns and comes back in one continuous motion; lands when it reaches the rest
              const tt = u.time.sub(t0);
              const ramp = smoothstep(0.0, max(u.springRamp, 0.001), tt);
              // Ease inherited frame motion into the spring instead of dropping it at return start.
              const follow = u.inherit
                .mul(float(1).sub(ramp))
                .mul(
                  float(1).sub(smoothstep(u.inheritTime.mul(0.75), max(u.inheritTime, 0.001), age)),
                );
              pos.assign(mix(pos, u.modelDelta.mul(vec4(pos, 1.0)).xyz, follow));
              vel.assign(mix(vel, mat3(u.modelDelta).mul(vel), follow));
              const d = target.sub(pos);
              const dist = length(d).toVar();
              const organic = select(
                erosion.u.reconstruct.greaterThan(0.5).and(u.groupNoise.greaterThan(1.5)),
                float(1),
                float(0),
              );
              const speedFactor = mix(
                float(1),
                mix(float(0.55), float(1.8), h1),
                u.speedVariation.mul(organic),
              );
              const k = u.springK.mul(u.rigStrength).mul(speedFactor.mul(speedFactor)).mul(ramp);
              const c = sqrt(u.springK.mul(u.rigStrength))
                .mul(speedFactor)
                .mul(2.0)
                .mul(u.springDamp)
                .mul(ramp);
              // A moving guide creates different approach angles. It collapses onto
              // the true home near contact and after a bounded time, so arcs settle.
              const flightDistance = length(target.sub(start));
              const homeFraction = clamp(dist.div(max(flightDistance, 0.05)), 0, 1);
              const guideLife = float(1).sub(smoothstep(0.5, 2.4, tt.mul(speedFactor)));
              const side = safeNormalize(cross(nw, vec3(h2, h3, h1).sub(0.5)).add(0.001));
              const other = cross(nw, side);
              const twist = tt.mul(u.pathSwirl).mul(h2.mul(2).sub(1)).add(h3.mul(6.283185));
              const arc = side
                .mul(cos(twist))
                .add(other.mul(sin(twist)))
                .add(nw.mul(h2.sub(0.5)));
              const guide = arc
                .mul(min(flightDistance, 3))
                .mul(u.pathBend)
                .mul(0.5)
                .mul(homeFraction.mul(0.3).add(sin(homeFraction.mul(Math.PI)).mul(0.7)))
                .mul(guideLife)
                .mul(organic);
              const previousTarget = u.previousModel.mul(vec4(rest, 1.0)).xyz;
              const targetVelocity = target.sub(previousTarget).div(max(u.dt, 1e-5));
              const acc = d
                .add(guide)
                .mul(k)
                .sub(vel.sub(targetVelocity).mul(c))
                .add(vec3(0, u.gravity.negate().mul(float(1).sub(ramp)), 0));
              vel.addAssign(acc.mul(u.dt));
              vel.mulAssign(exp(u.drag.mul(u.returnDrag).mul(u.dt).negate()));
              const spdBack = length(vel);
              const speedLimit = u.returnMaxSpeed.mul(speedFactor);
              If(spdBack.greaterThan(speedLimit), () => {
                vel.mulAssign(speedLimit.div(spdBack));
              });
              // never overshoot the rest in one step
              const step = vel.mul(u.dt);
              const stepLen = length(step);
              pos.addAssign(select(stepLen.greaterThan(dist), d, step));
              size.assign(
                baseSize
                  .mul(
                    select(
                      u.landShrink.greaterThan(0.001),
                      saturate(dist.div(max(u.landShrink, 0.001))),
                      float(1),
                    ),
                  )
                  .mul(select(isGhost, smoothstep(0.0, 0.25, tt), float(1))),
              );
              const landed = dist.lessThan(u.landRadius);
              If(landed, () => {
                If(isGhost.not(), () => {
                  arrive(hitRecent.not().and(erosion.u.reconstruct.lessThan(0.5)));
                  If(hitRecent.not().and(erosion.u.reconstruct.lessThan(0.5)), () => {
                    deposit();
                  });
                });
                state.assign(select(isGhost, float(DORMANT), float(WAITING)));
                pos.assign(target);
                vel.assign(vec3(0));
                H.w.assign(0.0);
                size.assign(
                  select(isGhost.or(erosion.u.reconstruct.greaterThan(0.5)), float(0), baseSize),
                );
              });
            }).Else(() => {
              // path return: eased curved flight, shrinking into the surface; deposits at 85% of the flight
              const uu = clamp(u.time.sub(t0).div(max(u.returnDuration, 0.05)), 0.0, 1.0).toVar();
              const uuPrev = clamp(
                u.time.sub(u.dt).sub(t0).div(max(u.returnDuration, 0.05)),
                0.0,
                1.0,
              );
              const e = expoInOut(uu);
              const mid = mix(start, target, 0.5)
                .add(
                  nw
                    .mul(u.returnCurve)
                    .mul(length(target.sub(start)))
                    .mul(0.5),
                )
                .add(vec3(h2, h3, h1).sub(0.5).mul(u.returnCurve).mul(0.4));
              const a = mix(start, mid, e),
                b = mix(mid, target, e);
              pos.assign(mix(a, b, e));
              const fadeIn = select(
                isGhost,
                smoothstep(float(1).sub(u.ghostFrac), float(1).sub(u.ghostFrac).add(0.08), uu),
                float(1),
              );
              size.assign(baseSize.mul(float(1).sub(smoothstep(0.82, 1.0, uu))).mul(fadeIn));
              If(uuPrev.lessThan(0.85).and(uu.greaterThanEqual(0.85)).and(isGhost.not()), () => {
                arrive(hitRecent.not().and(erosion.u.reconstruct.lessThan(0.5)));
                If(hitRecent.not().and(erosion.u.reconstruct.lessThan(0.5)), () => {
                  deposit();
                });
              });
              If(uu.greaterThanEqual(1.0), () => {
                state.assign(select(isGhost, float(DORMANT), float(WAITING)));
                pos.assign(target);
                H.w.assign(0.0);
              });
            });
            // The same spatial contact controls both return modes. Once home, disarm this
            // shard until the next breakup even if a neighbouring owner is still approaching.
            If(erosion.u.reconstruct.greaterThan(0.5).and(isGhost.not()), () => {
              const variation = select(u.groupNoise.greaterThan(1.5), u.landingVariation, float(0));
              const reach = float(assemblyReach(erosion.bound)).mul(
                mix(float(1), mix(float(0.35), float(1.65), h2), variation),
              );
              const contactFade = smoothstep(
                u.landRadius,
                max(u.landRadius.add(0.001), reach),
                length(target.sub(pos)),
              );
              size.assign(
                baseSize.mul(
                  pow(contactFade, mix(float(1), mix(float(0.45), float(2.2), h3), variation)),
                ),
              );
              If(state.greaterThan(4.5), () => {
                R.w.assign(2.0);
              });
            });
            // a stroke elsewhere never touches a grain in flight: only the brush passing over its own rest voxel
            // matters, and that is handled on landing (no deposit, and it leaves the surface again next frame)
          })
          .ElseIf(state.lessThan(3.5), () => {
            // STRAY: slow orbit in / around the hole, object space -> world
            const ang = u.time.mul(u.straySpeed).mul(float(0.5).add(h1)).add(seed.mul(6.2831));
            const r = length(rest.xy);
            const zz = rest.z.add(sin(u.time.mul(0.3).add(seed.mul(12.0))).mul(0.05));
            const local = vec3(cos(ang).mul(r), sin(ang).mul(r), zz);
            pos.assign(u.model.mul(vec4(local, 1.0)).xyz);
            size.assign(classScale(cls).mul(0.9).mul(u.sizeMul));
            age.assign(age.add(u.dt));
          })
          .ElseIf(state.lessThan(4.5), () => {
            // GHOST: vanished on breakup. It never rebuilds anything (only grains that flew out do); on the
            // wave it just becomes dormant again, or optionally shows up as extra dust flying in.
            If(u.heal.greaterThan(0.5), () => {
              If(healScheduled.not(), () => {
                H.w.assign(
                  ghostScheduleTime().add(u.returnDuration.mul(float(1).sub(u.ghostFrac))),
                );
              });
              If(H.w.greaterThan(0.5).and(u.time.greaterThanEqual(H.w)), () => {
                If(u.ghostDist.greaterThan(0.001), () => {
                  const nw = restNormalWorld;
                  const tangent = safeNormalize(
                    cross(nw, vec3(h1.sub(0.5), h2.sub(0.5), h3.sub(0.5)).add(0.001)),
                  );
                  const startPos = restWorld
                    .add(nw.mul(u.ghostDist).mul(float(0.4).add(h1.mul(0.6))))
                    .add(tangent.mul(u.ghostDist).mul(h2.sub(0.5)).mul(0.8));
                  H.xyz.assign(startPos);
                  H.w.assign(-1.0); // -1: ghost-origin return (fades in, no deposit)
                  pos.assign(startPos);
                  age.assign(u.time.sub(u.returnDuration.mul(float(1).sub(u.ghostFrac))));
                  size.assign(0.0);
                  state.assign(HEALING);
                }).Else(() => {
                  state.assign(DORMANT);
                  H.w.assign(0.0);
                });
              });
            }).Else(() => {
              H.w.assign(0.0);
            });
          })
          .Else(() => {
            // WAITING: home, lying on the surface until its voxel is solid again (the cell waits for its other
            // grains), then it fades over `landedFade`. Cut again by the brush -> leaves again.
            pos.assign(restWorld);
            If(erosion.u.reconstruct.greaterThan(0.5), () => {
              state.assign(DORMANT);
              H.w.assign(0);
              size.assign(0);
            })
              .ElseIf(erRest.lessThan(threshold), () => {
                If(H.w.lessThan(0.5), () => {
                  H.w.assign(u.time);
                });
                const f = saturate(u.time.sub(H.w).div(max(u.landedFade, 0.01)));
                size.assign(baseSize.mul(float(1).sub(f)));
                If(f.greaterThanEqual(1.0), () => {
                  state.assign(DORMANT);
                  H.w.assign(0.0);
                  size.assign(0.0);
                });
              })
              .Else(() => {
                size.assign(baseSize);
                H.w.assign(0.0);
                If(hitRecent.and(u.fieldActive.greaterThan(0.5)), () => {
                  eject();
                });
              });
          });

        // lost-grain guard: a grain that is not a finite number any more, or has drifted far off screen, is put
        // back near its rest so the state machine can land it (nothing is ever lost for good)
        If(state.greaterThan(0.5).and(state.lessThan(2.5)), () => {
          const finite = abs(pos.x)
            .lessThan(1e30)
            .and(abs(pos.y).lessThan(1e30))
            .and(abs(pos.z).lessThan(1e30))
            .and(abs(vel.x).lessThan(1e30))
            .and(abs(vel.y).lessThan(1e30))
            .and(abs(vel.z).lessThan(1e30));
          const far = length(pos.sub(centreWorld)).greaterThan(u.lostRadius);
          If(finite.not().or(far), () => {
            pos.assign(restWorld.add(restNormalWorld.mul(0.05)));
            vel.assign(vec3(0.0));
          });
        });
        P.xyz.assign(pos);
        P.w.assign(size);
        Vv.xyz.assign(vel);
        Vv.w.assign(age);
        M.x.assign(state);

        // Active-particle statistics and density accumulation (ghosts are never drawn)
        If(state.greaterThan(0.5).and(state.lessThan(3.5)).or(state.greaterThan(4.5)), () => {
          const variant = uint(floor(seed.mul(1000.0))).mod(uint(V));
          atomicAdd(counter(variant), uint(1));
          const gp = pos.add(u.densityExtent).div(u.densityExtent.mul(2.0)).mul(float(G));
          const gi = ivec3(floor(gp));
          If(
            gi.x
              .greaterThanEqual(0)
              .and(gi.y.greaterThanEqual(0))
              .and(gi.z.greaterThanEqual(0))
              .and(gi.x.lessThan(G))
              .and(gi.y.lessThan(G))
              .and(gi.z.lessThan(G)),
            () => {
              const idx = uint(gi.x)
                .add(uint(gi.y).mul(uint(G)))
                .add(uint(gi.z).mul(uint(G * G)));
              atomicAdd(densityAt(idx), classWeight(cls));
            },
          );
        });
      })().compute(dispatchCount, [64]);
    this.nodes.update = buildUpdate(instanceIndex, N);
    this.nodes.updateStrays =
      this.o.strays > 0 ? buildUpdate(instanceIndex.add(uint(count)), this.o.strays) : null;

    // density resolve: density, light transmittance, ao -> 3D texture; then clear the atomic grid
    const gCoord = () => uvec3(i.mod(uint(G)), i.div(uint(G)).mod(uint(G)), i.div(uint(G * G)));
    const loadD = (c: N) => {
      const cc = clamp(ivec3(c), ivec3(0), ivec3(G - 1));
      const idx = uint(cc.x)
        .add(uint(cc.y).mul(uint(G)))
        .add(uint(cc.z).mul(uint(G * G)));
      return float(atomicLoad(densityAt(idx))).mul(u.densityScale);
    };
    this.nodes.resolve = Fn(() => {
      const c = gCoord();
      const d = loadD(ivec3(c)).toVar();
      const dens = float(1).sub(exp(d.negate()));
      // transmittance toward the key light (6 steps in grid space)
      const Lg = u.lightDir.mul(float(G)).div(u.densityExtent.mul(2.0)).toVar();
      const acc = float(0).toVar();
      const q = vec3(c).add(0.5).toVar();
      Loop(6, () => {
        q.addAssign(Lg.mul(0.9));
        acc.addAssign(loadD(ivec3(floor(q))));
      });
      const T = exp(acc.mul(0.9).negate());
      // local density for ao
      const nb = loadD(ivec3(c).add(ivec3(1, 0, 0)))
        .add(loadD(ivec3(c).add(ivec3(-1, 0, 0))))
        .add(loadD(ivec3(c).add(ivec3(0, 1, 0))))
        .add(loadD(ivec3(c).add(ivec3(0, -1, 0))))
        .add(loadD(ivec3(c).add(ivec3(0, 0, 1))))
        .add(loadD(ivec3(c).add(ivec3(0, 0, -1))));
      const ao = float(1).sub(exp(nb.div(6.0).add(d).mul(1.2).negate()));
      textureStore(this.densityTex, c, vec4(dens, T, ao, 1.0)).toWriteOnly();
    })().compute(G * G * G, [64]);
    this.nodes.clearDensity = Fn(() => {
      atomicStore(densityAt(i), uint(0));
    })().compute(G * G * G, [64]);

    // FROST: after a retarget every grain that is out (active, healing or waiting) is in flight toward a cell of
    // the new shape: count them so the last one home still triggers that cell's restore
    // - a grain still in flight (active / healing) is counted toward its new cell;
    // - a landed (waiting) grain is home already: it goes dormant at its new home (it can never arrive again);
    // - dormant and ghost grains sit inside the new, fully eroded shape: their threshold is raised so the filled
    //   field does not eject them (restoreThresholds() re-arms them for the next break)
    this.nodes.retargetCount = Fn(() => {
      const M = B.meta.element(i),
        R = B.rest.element(i),
        P = B.pos.element(i);
      const state = M.x.toVar();
      If(state.greaterThan(4.5), () => {
        M.x.assign(DORMANT);
        P.w.assign(0.0);
        B.heal.element(i).assign(vec4(0.0));
        state.assign(DORMANT);
      });
      If(state.greaterThan(0.5).and(state.lessThan(2.5)), () => {
        // While returning, the ejection threshold is unused. Pack the stable group
        // phase above 2 here, avoiding a ninth storage binding on default WebGPU.
        // restoreThresholds() reinstates the original value before the next breakup.
        If(
          erosion.u.reconstruct
            .greaterThan(0.5)
            .and(u.groupStagger.greaterThan(0).or(u.groupNoise.greaterThan(1.5))),
          () => {
            R.w.assign(
              float(2).add(
                select(
                  u.groupNoise.greaterThan(1.5),
                  assemblyFrontPhase(R.xyz, u),
                  returnGroupPhase(R.xyz, u.groupScale, u.groupSeed, u.groupNoise),
                ),
              ),
            );
          },
        );
        const gc = ivec3(floor(erosion.uvw(R.xyz).mul(float(FR))));
        const cellHash = cellTexNode.load(clamp(gc, ivec3(0), ivec3(FR - 1))).level(0).w;
        atomicAdd(
          B.atomics.element(uint(FLO).add(uint(clamp(cellHash.mul(65535.0), 0.0, 65535.0)))),
          uint(1),
        );
      }).ElseIf(state.lessThan(0.5).or(state.greaterThan(3.5).and(state.lessThan(4.5))), () => {
        R.w.assign(2.0);
      });
    })().compute(N, [64]);

    this.nodes.reset = Fn(() => {
      const M = B.meta.element(i),
        Vv = B.vel.element(i),
        P = B.pos.element(i),
        R = B.rest.element(i);
      If(M.x.lessThan(2.5).or(M.x.greaterThan(3.5)), () => {
        M.x.assign(DORMANT);
        Vv.assign(vec4(0.0));
        P.assign(vec4(R.xyz, 0.0));
        B.heal.element(i).assign(vec4(0.0));
      });
    })().compute(N, [64]);
    void count;
    void shape;
  }

  // --------------------------------------------------------------------------------------------
  private buildMeshes() {
    const { variants: V, rand } = this.o;
    const N = this.total,
      u = this.u,
      B = this.buffers;
    const SP = D.powder.sprites;
    const sprite = !!SP.enabled;
    // sprite grains: one camera-facing quad per grain, textured from the shard atlas (silhouette, normal,
    // frost structure, thickness); mesh grains: the low-poly variants
    const geos = sprite
      ? Array.from({ length: V }, () => new THREE.PlaneGeometry(2, 2))
      : buildGrainVariants(V, rand, D.powder.facetedGrains);
    const atlasTex = sprite ? getShardAtlas() : null;
    const cellsArr = sprite
      ? uniformArray(SHARD_CELLS.map((c) => new THREE.Vector2(c[0], c[1])))
      : null;
    const posRO = storage(B.pos.value, "vec4", N).toReadOnly();
    const velRO = storage(B.vel.value, "vec4", N).toReadOnly();
    const metaRO = storage(B.meta.value, "vec4", N).toReadOnly();
    const restRO = storage(B.rest.value, "vec4", N).toReadOnly();
    const healRO = storage(B.heal.value, "vec4", N).toReadOnly();
    const dens = texture3D(this.densityTex);

    for (let v = 0; v < V; v++) {
      const geo = new THREE.InstancedBufferGeometry().copy(
        geos[v] as any,
      ) as THREE.InstancedBufferGeometry;
      // Draw a stable partition of the particle buffer. Dormant/ghost grains
      // collapse in the vertex shader, so visibility never depends on the
      // compute-generated compact list or indirect argument buffer.
      geo.instanceCount = Math.max(0, Math.ceil((N - v) / V));
      const mat = new THREE.MeshPhysicalNodeMaterial();
      mat.metalness = 0;
      mat.side = THREE.DoubleSide;
      mat.forceSinglePass = true;
      const pIdx = instanceIndex.mul(uint(V)).add(uint(v));
      const P = posRO.element(pIdx),
        Vv = velRO.element(pIdx),
        M = metaRO.element(pIdx);
      const seed = M.y,
        cls = M.z,
        state = M.x,
        age = Vv.w;
      const axis = normalize(
        vec3(hashSeed(seed, 11), hashSeed(seed, 12), hashSeed(seed, 13)).sub(0.5),
      );
      const spin = hashSeed(seed, 14)
        .mul(6.2831)
        .add(age.mul(u.tumble).mul(float(0.4).add(hashSeed(seed, 15))));
      const camDist = length(P.xyz.sub(cameraPosition));
      const drawable = state.greaterThan(0.5).and(state.lessThan(3.5)).or(state.greaterThan(4.5));
      const size = select(
        drawable.and(P.w.greaterThan(1e-5)),
        max(P.w, camDist.mul(u.pixelWorld).mul(u.minPixel)),
        float(0),
      ).mul(u.fade);
      // density shading (varying: sample at the grain centre)
      const guv = P.xyz.add(u.densityExtent).div(u.densityExtent.mul(2.0));
      const dSample = varying(dens.sample(guv).level(0));
      const shadow = mix(float(1), dSample.g, u.shadowStrength);
      const ao = float(1).sub(dSample.b.mul(u.aoStrength));
      let vSeed: N;
      const I = this.o.iceUniforms,
        features = this.o.iceFeatures;
      const surfaceFeatures = {
        ...features,
        // The solid's diagnostic bump switch preserves the existing shard finish.
        surfaceBumps: float(1),
        frost: features.frost.mul(features.shardFrost),
        crystals: features.crystals.mul(features.shardNormals),
        grain: features.grain.mul(features.shardNormals),
        micro: features.micro.mul(features.shardNormals),
        ripples: features.ripples.mul(features.shardNormals),
      };
      const homeGradient = sdfNormalNode(this.o.shape, restRO.element(pIdx).xyz, 0.02);
      const homeInfo = varying(
        vec4(select(length(homeGradient).greaterThan(0.001), homeGradient, vec3(0, 0, 1)), size),
      );
      const homeNormal = homeInfo.xyz;
      const patch = varying(restRO.element(pIdx).xyz.add(attribute("position", "vec3").mul(size)));
      const objectSeed = vec3(this.o.seed * 0.731, this.o.seed * 0.137, this.o.seed * 0.529);
      const surface = iceSurface(
        patch,
        homeNormal,
        objectSeed,
        iceSmudgeDirections(this.o.seed),
        this.o.erosion,
        I,
        surfaceFeatures,
      );
      const inheritedFrost = surface.frost;
      const inheritedDetail =
        ICE_VARIANT === "photographic"
          ? iceInclusions(
              this.o.fractureDetail,
              patch,
              homeNormal,
              homeNormal.negate(),
              homeInfo.w,
              I.inclusionScale,
              I.inclusionAmount,
            ).mul(u.surfaceDetail)
          : float(0);
      const viewDir = normalize(positionView.negate());
      let nView: N,
        wrapL: N,
        frost: N = float(0),
        thick: N = float(1);
      if (sprite) {
        // --- quad in view space: in-plane spin (tumble) + a random tilt off the camera plane, mirrored at random
        const cellIdx = int(floor(hashSeed(seed, 31).mul(SHARD_GRID * SHARD_GRID)));
        const ext = cellsArr.element(cellIdx);
        const flipX = select(hashSeed(seed, 32).lessThan(0.5), float(-1), float(1));
        const flipY = select(hashSeed(seed, 33).lessThan(0.5), float(-1), float(1));
        const tiltAng = hashSeed(seed, 34).mul(u.spriteTilt);
        const phi = hashSeed(seed, 35).mul(6.2831);
        const tiltAxis = vec3(cos(phi), sin(phi), 0.0);
        const rot = (q: N) => rotateAxis(rotateAxis(q, vec3(0, 0, 1), spin), tiltAxis, tiltAng);
        // camera-facing basis (view space); the mirror is folded into the signs
        const bR0 = rot(vec3(flipX, 0.0, 0.0)),
          bF0 = rot(vec3(0.0, 0.0, 1.0));
        // on the way home the shard turns to lie on the surface it lands on: the basis blends toward the
        // tangent frame of the SDF normal at its rest point (a landed, WAITING shard is fully aligned)
        const R4 = restRO.element(pIdx);
        const restW = u.model.mul(vec4(R4.xyz, 1.0)).xyz;
        const nRestW0 = u.normalMat.mul(sdfNormalNode(this.o.shape, R4.xyz, 0.004));
        const nRestW = nRestW0.div(max(length(nRestW0), 1e-6));
        const nRestV0 = normalize(
          mat3(cameraViewMatrix)
            .mul(nRestW)
            .add(vec3(0.0, 0.0, 1e-4)),
        );
        const nRestV = select(nRestV0.z.lessThan(0.0), nRestV0.negate(), nRestV0); // the side the camera sees
        const healingNow = state.greaterThan(1.5).and(state.lessThan(2.5));
        const waitingNow = state.greaterThan(4.5);
        const distHome = length(restW.sub(P.xyz));
        // FROST: a returning shard turns to lie on the surface over its whole flight home (fraction of the start
        // distance covered, shaped by alignCurve), instead of snapping within alignDist of the surface
        const H4 = healRO.element(pIdx);
        const startDist = max(length(restW.sub(H4.xyz)), 0.05);
        const homeFrac = saturate(float(1).sub(distHome.div(startDist)));
        const align = select(
          waitingNow,
          float(1),
          select(healingNow, pow(homeFrac, u.alignCurve), float(0)),
        ).mul(u.alignAmt);
        const bRt = normalize(bR0.sub(nRestV.mul(dot(bR0, nRestV))).add(vec3(1e-4, 0.0, 0.0)));
        const bF1 = normalize(mix(bF0, nRestV, align));
        const bR1a = normalize(mix(bR0, bRt, align));
        const bR1 = normalize(bR1a.sub(bF1.mul(dot(bR1a, bF1))));
        const bU1 = cross(bF1, bR1).mul(flipX.mul(flipY));
        const offV = bR1
          .mul(positionLocal.x.mul(ext.x).mul(flipX))
          .add(bU1.mul(positionLocal.y.mul(ext.y).mul(flipY)))
          .mul(size)
          .mul(u.spriteSize);
        mat.positionNode = P.xyz.add(mat3(u.camWorld).mul(offV));
        const bR = varying(bR1);
        const bU = varying(bU1);
        const bF = varying(bF1);
        // One location instead of four scalar varyings. Leave room for the
        // physical lighting and motion-vector outputs on 16-location GPUs.
        const atlasInfo = varying(vec4(float(cellIdx), flipX, flipY, seed));
        const vCell = atlasInfo.x,
          vFx = atlasInfo.y,
          vFy = atlasInfo.z;
        vSeed = atlasInfo.w;
        // --- atlas fetch
        const uvL = uv();
        const uS = mix(uvL.x, float(1).sub(uvL.x), step(vFx, 0.0));
        const vS = mix(uvL.y, float(1).sub(uvL.y), step(vFy, 0.0));
        const ci = int(vCell.add(0.5));
        const cx = float(ci.mod(int(SHARD_GRID))),
          cy = float(ci.div(int(SHARD_GRID)));
        const extF = cellsArr.element(ci);
        const auv = vec2(
          cx.add(0.5).add(uS.sub(0.5).mul(extF.x)),
          cy.add(0.5).add(vS.sub(0.5).mul(extF.y)),
        ).div(SHARD_GRID);
        const smp = texture(atlasTex, auv);
        const nxy = smp.rg.mul(2.0).sub(1.0).mul(u.spriteNormal);
        const nz = sqrt(saturate(float(1).sub(dot(nxy, nxy))));
        nView = normalize(bR.mul(nxy.x).add(bU.mul(nxy.y)).add(bF.mul(nz)));
        // Rotate the inherited surface perturbation into the shard's facet frame.
        const detailNormal = surface.nSurface.sub(homeNormal);
        nView = normalize(
          nView.add(bR.mul(detailNormal.x)).add(bU.mul(detailNormal.y)).add(bF.mul(detailNormal.z)),
        );
        mat.normalNode = nView;
        mat.maskNode = smp.a.greaterThan(u.spriteCut);
        frost = clamp(
          inheritedFrost
            .mul(I.frostDiffuse)
            .add(surface.smudge.mul(I.smudgeWhite))
            .add(inheritedDetail.mul(0.65)),
          0,
          0.65,
        );
        thick = saturate(smp.a.sub(0.35).div(0.65));
        if (SP.seeThrough > 0) {
          // real see-through: the clear parts of a shard blend over whatever is behind them (ice included)
          mat.transparent = true;
          mat.depthWrite = false;
          const fresS = pow(saturate(float(1).sub(saturate(dot(nView, viewDir)))), u.fresnelPower);
          // Thin-sheet optical coverage, not opaque white atlas paint.
          const opticalCover = mix(float(0.42), float(0.85), frost)
            .add(fresS.mul(0.45))
            .add(float(1).sub(thick).mul(0.18));
          mat.opacityNode = mix(
            float(1),
            saturate(opticalCover),
            u.spriteSee.mul(features.transmission).mul(features.shardTransmission),
          );
        }
        wrapL = saturate(dot(nView, u.lightDirView).add(u.wrap).div(float(1).add(u.wrap)));
      } else {
        vSeed = varying(seed);
        const local = rotateAxis(positionLocal.mul(size), axis, spin);
        mat.positionNode = P.xyz.add(local);
        const nLocal = rotateAxis(normalLocal, axis, spin);
        mat.normalNode = transformNormalToView(nLocal);
        nView = normalize(transformNormalToView(nLocal));
        wrapL = saturate(dot(normalize(nLocal), u.lightDir).add(u.wrap).div(float(1).add(u.wrap)));
      }
      if (!sprite)
        frost = clamp(
          inheritedFrost
            .mul(I.frostDiffuse)
            .add(surface.smudge.mul(I.smudgeWhite))
            .add(inheritedDetail.mul(0.65)),
          0,
          0.65,
        );
      const f0 = pow(I.ior.sub(1).div(I.ior.add(1)), 2);
      const fres = f0.add(
        float(1)
          .sub(f0)
          .mul(pow(saturate(float(1).sub(saturate(dot(nView, viewDir)))), 5)),
      );
      const surfaceDensity =
        ICE_VARIANT === "photographic"
          ? iceDetail(this.o.fractureDetail, patch, homeNormal, I.inclusionScale).mul(
              surfaceFeatures.frost,
            )
          : float(0);
      const roughness = clamp(surface.roughness.add(surfaceDensity.mul(0.22)), 0.015, 0.8);
      mat.roughnessNode = roughness;
      mat.iorNode = I.ior;
      mat.clearcoatNode = I.clearcoat.mul(features.clearcoat).mul(features.shardReflections);
      mat.clearcoatRoughnessNode = I.clearcoatRough;
      mat.specularIntensityNode = I.specularIntensity
        .mul(features.reflections)
        .mul(features.shardReflections);
      const reflectionOn = features.reflections.mul(features.shardReflections);
      const transmissionOn = features.transmission.mul(features.shardTransmission);
      const viewToWorld = (q: N) => normalize(mat3(u.camWorld).mul(q));
      const env = (q: N) => iceEnvironment(this.o.environment, I.envStrength, q, roughness);
      const ray = viewDir.negate();
      const transmittedRay = refract(ray, nView, float(1).div(max(I.ior, 1.001)));
      // Detached pieces are thin volumes: use atlas thickness and world size,
      // rather than tracing the intact object's SDF after they have left it.
      const opticalDepth = max(homeInfo.w.mul(thick).mul(I.thicknessScale), 0.001);
      const attenuation = exp(
        log(max(I.attColor, vec3(0.001)))
          .mul(opticalDepth.div(max(I.attDist, 0.01)))
          .mul(features.absorption),
      );
      const refractedUV = clamp(
        screenUV.add(transmittedRay.xy.sub(ray.xy).mul(opticalDepth).mul(0.08)),
        0,
        1,
      );
      const plate = backdropColorAt(this.o.backdrop, refractedUV)
        .add(env(viewToWorld(transmittedRay)).mul(I.backlight))
        .mul(attenuation);
      const reflected = env(viewToWorld(reflect(ray, nView)))
        .mul(fres)
        .mul(reflectionOn)
        .mul(I.specularIntensity);
      const cover = max(frost, float(1).sub(transmissionOn));
      const scatter = I.keyColor
        .mul(
          surface.surfCrack
            .mul(I.crackBright)
            .mul(0.3)
            .add(inheritedDetail.mul(I.backlight).mul(0.8)),
        )
        .mul(features.scatter);
      mat.colorNode = I.baseColor;
      mat.emissiveNode = I.keyColor
        .mul(cover.mul(I.interiorScatter).mul(0.3))
        .mul(features.scatter);
      mat.outputNode = Fn(() => {
        const clear = reflected.add(plate.mul(float(1).sub(fres.mul(reflectionOn))));
        const radiance = clear.mul(float(1).sub(cover)).add(output.rgb.mul(cover)).add(scatter);
        // Preserve physical radiance through the thin-sheet blend.
        const a = max(output.a, 0.001);
        const background = backdropColorAt(this.o.backdrop, screenUV);
        return vec4(max(radiance.sub(background.mul(float(1).sub(a))), vec3(0)).div(a), output.a);
      })();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
      if (v === 0) this.material = mat;
    }
  }

  /** Additive volumetric haze over the density grid (evaluated in the post graph). */
  hazeNode(depthNode: N, viewZ: N, _camera: THREE.PerspectiveCamera): N {
    const u = this.u;
    const dens = texture3D(this.densityTex);
    return Fn(() => {
      // screenUV is y-down on the WebGPU post quad: NDC y must be negated or the march mirrors vertically
      const ndc0 = screenUV.mul(2.0).sub(1.0);
      const ndc = vec2(ndc0.x, ndc0.y.negate());
      const clip = u.invProj.mul(vec4(ndc.x, ndc.y, 1.0, 1.0));
      const vView = clip.xyz.div(clip.w);
      const dirView = normalize(vView);
      const dir = normalize(mat3(u.camWorld).mul(dirView));
      const ro = u.camPos;
      // ray-box
      const ext = u.densityExtent;
      const inv = vec3(1).div(dir);
      const t0 = ext.negate().sub(ro).mul(inv),
        t1 = ext.sub(ro).mul(inv);
      const tmin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
      const tmax = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
      // scene depth along the ray
      const zRatio = float(1).div(max(dirView.z.negate(), 1e-4));
      const tScene = viewZ.negate().mul(zRatio);
      const tEnd = min(tmax, tScene);
      const acc = float(0).toVar();
      If(tEnd.greaterThan(max(tmin, 0.0)).and(u.hazeOn.greaterThan(0.5)), () => {
        const tStart = max(tmin, 0.0);
        const steps = max(u.hazeSteps, 4.0);
        const dtt = tEnd.sub(tStart).div(steps);
        const jitter = hash31(vec3(screenUV.mul(1234.0), u.time)).mul(dtt);
        const tt = tStart.add(jitter).toVar();
        Loop({ start: int(0), end: int(steps), type: "int", condition: "<" }, () => {
          const pw = ro.add(dir.mul(tt));
          const guv = pw.add(ext).div(ext.mul(2.0));
          const s = dens.sample(guv).level(0);
          acc.addAssign(s.r.mul(s.g).mul(dtt));
          tt.addAssign(dtt);
        });
      });
      const col = u.tone.mul(u.keyColor).mul(u.keyIntensity).mul(acc).mul(0.35);
      return vec4(col, 0.0);
    })();
    void depthNode;
  }

  // --------------------------------------------------------------------------------------------
  step(
    renderer: THREE.WebGPURenderer,
    t: number,
    dt: number,
    inter: Interaction,
    key: THREE.DirectionalLight,
    idle: { fieldActive: boolean; powderActive: boolean },
  ) {
    const P = D.powder,
      H = D.healing,
      u = this.u;
    u.fieldActive.value = idle.fieldActive ? 1 : 0;
    u.hazeOn.value = idle.powderActive ? 1 : 0;
    u.dt.value = Math.min(dt, 1 / 30);
    u.time.value = t;
    const model = this.o.objectGroup.matrixWorld;
    u.model.value.copy(model);
    u.previousModel.value.copy(this.prevModel);
    u.normalMat.value.getNormalMatrix(model);
    u.modelDelta.value.copy(model).multiply(this.inversePrevModel.copy(this.prevModel).invert());
    this.prevModel.copy(model);
    u.strokeDir.value.copy(inter.strokeDir);
    u.strokeSpeed.value = inter.strokeSpeed;
    u.heal.value = sim.healing ? 1 : 0;
    u.fade.value = sim.fade;
    u.lightDir.value.copy(key.position).sub(key.target.position).normalize();
    u.modelInv.value.copy(model).invert();
    if (D.version !== this.settingsVersion) {
      this.settingsVersion = D.version;
      u.ejectSpeed.value = P.ejectSpeed;
      u.ejectSpread.value = P.ejectSpread;
      u.ejectTurb.value = P.ejectTurbulence;
      u.backwardRatio.value = P.backwardRatio;
      u.clumpJitter.value = P.clumpSpeedJitter;
      u.drag.value = P.drag;
      u.gravity.value = P.gravity;
      u.turbulence.value = P.turbulence;
      u.turbScale.value = P.turbulenceScale;
      u.turbDecay.value = P.turbulenceDecay;
      u.cohesion.value = P.clumpCohesion;
      u.settleTime.value = P.settleTime;
      u.settledDrift.value = P.settledDrift;
      u.tumble.value = P.tumble;
      u.returnDuration.value = H.returnDuration;
      u.returnCurve.value = H.returnCurve;
      u.inherit.value = P.inheritRotation ? 1 : 0;
      u.inheritTime.value = P.inheritTime / 1000;
      u.straySpeed.value = P.straySpeed;
      u.dustScale.value = P.grainSizes.tinyDustSize;
      u.grainScale.value = P.grainSizes.smallGrainSize;
      u.clumpScale.value = P.grainSizes.mediumClumpSize;
      u.fragmentScale.value = P.grainSizes.largeFragmentSize;
      u.sizeJitter.value = P.grainSizes.sizeJitter;
      u.sizeMul.value = P.grainSizeMultiplier;
      u.amount.value = P.amount;
      u.minEject.value = P.minEjectSpeed;
      u.minPixel.value = P.minPixelSize;
      u.waveTime.value = H.waveTime;
      u.waveJitter.value = H.waveJitter;
      u.ghostDist.value = H.ghostReturnDistance;
      u.ghostFrac.value = H.ghostFlightFraction;
      u.waveReach.value = H.waveReach;
      u.depositRadius.value = H.depositRadius;
      u.returnMode.value = H.returnMode === "spring" ? 1 : 0;
      u.springK.value = H.returnSpring;
      u.springDamp.value = H.returnDamping;
      u.springRamp.value = H.returnRamp;
      u.landRadius.value = H.landRadius;
      u.returnAfter.value = H.returnAfter;
      u.maxSpeed.value = P.maxSpeed;
      u.returnDrag.value = H.returnDrag;
      u.returnMaxSpeed.value = H.returnMaxSpeed;
      u.lostRadius.value = P.lostRadius;
      u.stragglers.value = H.cellStragglers;
      u.spriteSee.value = P.sprites.seeThrough;
      u.alignAmt.value = H.alignToSurface;
      u.alignDist.value = H.alignDistance;
      u.alignCurve.value = (H as any).alignCurve ?? 1;
      u.landedFade.value = H.landedFade;
      u.landShrink.value = H.landShrink;
      u.densityExtent.value = P.densityExtent;
      u.shadowStrength.value = P.densityShadowStrength;
      u.aoStrength.value = P.densityAOStrength;
      u.densityScale.value = 0.02 * (this.o.densityRes / 64) ** 3 * (1_000_000 / this.total) ** 0.5;
      u.tone.value.set(P.baseTone);
      u.wrap.value = P.wrap;
      u.keyIntensity.value = D.lighting.key.intensity;
      u.keyColor.value.set(D.lighting.key.color);
      const F = P.fragments;
      u.translucency.value = F.translucency;
      u.throughTint.value.set(F.throughTint);
      u.fresnelPower.value = F.fresnelPower;
      u.fragRough.value = F.roughness;
      u.fragClearcoat.value = F.clearcoat;
      u.fragSpecular.value = F.specular;
      u.sparkle.value = F.sparkle;
      u.sparkleFraction.value = F.sparkleFraction;
      u.sparkleSpread.value = F.sparkleSpread;
      const SPu = P.sprites;
      u.spriteSize.value = SPu.sizeScale;
      u.spriteTilt.value = THREE.MathUtils.degToRad(SPu.tilt);
      u.spriteNormal.value = SPu.normalStrength;
      u.spriteFrost.value = SPu.frostFromAtlas;
      u.spriteFrostBoost.value = SPu.frostBoost;
      u.spriteFrostRough.value = SPu.frostRoughness;
      u.spriteEdge.value = SPu.edgeLight;
      u.spriteCut.value = SPu.alphaCut;
      // Material-panel switches change shading only; saved strengths and simulation survive.
      const features = D.ice.features;
      u.surfaceFrost.value = Number(features.shardFrost && features.frost);
      u.surfaceDetail.value = Number(features.shardFrost && features.scatter);
      if (!features.shardNormals) u.spriteNormal.value = 0;
      if (!features.shardFrost) {
        u.spriteFrost.value = 0;
        u.spriteFrostBoost.value = 0;
      }
      if (!features.shardTransmission) {
        u.translucency.value = 0;
        u.spriteSee.value = 0;
      }
      if (!features.shardReflections) {
        u.fragSpecular.value = 0;
        u.fragClearcoat.value = 0;
      }
      if (!features.shardSparkle) u.sparkle.value = 0;
      if (!features.shardEdges) u.spriteEdge.value = 0;
      u.repel.value = P.repelFromObject ? 1 : 0;
      u.repelStrength.value = P.repelStrength;
      u.repelRange.value = P.repelRange;
      u.repelRadial.value = P.repelRadial;
      u.repelRadialRange.value = P.repelRadialRange;
      u.colorByState.value = D.debug.colorByState ? 1 : 0;
      u.colorBySize.value = D.debug.colorBySize ? 1 : 0;
      u.colorByAge.value = D.debug.colorByAge ? 1 : 0;
      u.hazeSteps.value = P.hazeSteps;
      if (P.fragmentShadowMap !== this.fragmentShadowMap) {
        this.fragmentShadowMap = P.fragmentShadowMap;
        for (const m of this.meshes) m.castShadow = P.fragmentShadowMap;
      }
    }

    this.beforeIntegrate?.();
    if (dt <= 0) return;
    renderer.compute(this.nodes.resetCounters);
    if (idle.powderActive || idle.fieldActive || !this.nodes.updateStrays) {
      renderer.compute(this.nodes.snapshotLeaders);
      renderer.compute(this.nodes.update);
      renderer.compute(this.nodes.resolve);
      renderer.compute(this.nodes.clearDensity);
      this.densityDirty = true;
    } else {
      // Nothing can move except the strays: update their positions and density counters only.
      renderer.compute(this.nodes.updateStrays);
      if (this.densityDirty) {
        renderer.compute(this.nodes.resolve);
        renderer.compute(this.nodes.clearDensity);
        this.densityDirty = false;
      }
    }

    this.beforeAssembly?.();
    if (this.assemblyEnabled && this.o.erosion.u.reconstruct.value > 0.5 && idle.fieldActive)
      this.assembly?.update(renderer);

    // stats (async readback, throttled)
    this.statsTimer += dt;
    if (this.statsTimer > 0.5 && (D.debug.stats || D.performance.idleSkip)) {
      this.statsTimer = 0;
      const CO = this.o.countersOffset;
      renderer
        .getArrayBufferAsync(this.buffers.atomics.value, null, CO * 4, 16 * 4)
        .then((buf: ArrayBuffer) => {
          const c = new Uint32Array(buf);
          let active = 0;
          for (let v = 0; v < this.o.variants; v++) active += c[v];
          sim.counts.total = this.total;
          sim.counts.active = Math.max(0, active - this.o.strays);
          sim.counts.dormant = Math.max(0, this.total - active);
        })
        .catch(() => {});
    }
  }

  /** Update camera uniforms used by the haze raymarch (call before post render). */
  updateCamera(camera: THREE.PerspectiveCamera, viewportHeightPx: number) {
    this.u.pixelWorld.value =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, viewportHeightPx);
    this.u.lightDirView.value
      .copy(this.u.lightDir.value)
      .transformDirection(camera.matrixWorldInverse);
    this.u.camPos.value.copy(camera.position);
    this.u.invProj.value.copy(camera.projectionMatrixInverse);
    this.u.camWorld.value.copy(camera.matrixWorld);
  }

  reset(renderer: THREE.WebGPURenderer) {
    renderer.compute(this.nodes.reset);
  }

  /** FROST: the object frame jumped on purpose (facing offset at a retarget): no inherited motion for that frame. */
  syncModel() {
    this.prevModel.copy(this.o.objectGroup.matrixWorld);
  }

  /**
   * FROST: give every grain a new home (object space, N x vec4, thresholds and strays preserved by the caller).
   * Call after the erosion field was re-baked for the new shape: the in-flight counters are rebuilt from it.
   */
  retarget(renderer: THREE.WebGPURenderer, rest: Float32Array) {
    const attr = this.buffers.rest.value;
    (attr.array as Float32Array).set(rest);
    this.upload(renderer, attr);
    this.u.groupNoise.value = Number(D.healing.returnNoiseAmount ?? 2);
    this.u.frontDuration.value = Number(
      D.healing.assemblyFrontDuration ?? RETURN_GROUP_DEFAULTS.assemblyFrontDuration,
    );
    this.u.frontX.value = Number(
      D.healing.assemblyOriginX ?? RETURN_GROUP_DEFAULTS.assemblyOriginX,
    );
    this.u.frontY.value = Number(
      D.healing.assemblyOriginY ?? RETURN_GROUP_DEFAULTS.assemblyOriginY,
    );
    this.u.frontAngle.value = Number(
      D.healing.assemblyAngle ?? RETURN_GROUP_DEFAULTS.assemblyAngle,
    );
    this.u.frontSpread.value = Number(
      D.healing.assemblySpread ?? RETURN_GROUP_DEFAULTS.assemblySpread,
    );
    this.u.frontNoise.value = Number(
      D.healing.assemblyFrontNoise ?? RETURN_GROUP_DEFAULTS.assemblyFrontNoise,
    );
    this.u.speedVariation.value = Number(
      D.healing.assemblySpeedVariation ?? RETURN_GROUP_DEFAULTS.assemblySpeedVariation,
    );
    this.u.pathBend.value = Number(D.healing.assemblyBend ?? RETURN_GROUP_DEFAULTS.assemblyBend);
    this.u.pathSwirl.value = Number(D.healing.assemblySwirl ?? RETURN_GROUP_DEFAULTS.assemblySwirl);
    this.u.landingVariation.value = Number(
      D.healing.assemblyLandingVariation ?? RETURN_GROUP_DEFAULTS.assemblyLandingVariation,
    );

    this.u.groupStagger.value =
      D.healing.returnGroupStagger ?? RETURN_GROUP_DEFAULTS.returnGroupStagger;
    this.u.groupScale.value = D.healing.returnGroupScale ?? RETURN_GROUP_DEFAULTS.returnGroupScale;
    this.u.groupSeed.value = D.healing.returnGroupSeed ?? RETURN_GROUP_DEFAULTS.returnGroupSeed;
    renderer.compute(this.nodes.retargetCount);
    if (this.o.erosion.u.reconstruct.value > 0.5) this.assembly?.prepare(renderer);
  }

  prepareAssembly(renderer: THREE.WebGPURenderer) {
    this.assembly?.prepare(renderer);
  }

  /** FROST: every grain may leave again (the thresholds retarget() raised come back from the initial buffer). */
  restoreThresholds(renderer: THREE.WebGPURenderer) {
    const attr = this.buffers.rest.value,
      a = attr.array as Float32Array;
    for (let i = 3; i < a.length; i += 4) a[i] = this.restInit[i];
    this.upload(renderer, attr);
  }

  private upload(renderer: THREE.WebGPURenderer, attr: any) {
    attr.needsUpdate = true;
    // the storage binding is updated lazily by three; the compute below must already see the new homes
    const backend: any = (renderer as any).backend;
    const gpu = backend?.get?.(attr);
    if (gpu?.buffer && backend.device)
      backend.device.queue.writeBuffer(
        gpu.buffer,
        0,
        attr.array.buffer,
        attr.array.byteOffset,
        attr.array.byteLength,
      );
  }

  dispose() {
    this.o.scene.remove(this.group);
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.densityTex.dispose();
    this.assembly?.dispose();
    for (const k of Object.keys(this.buffers)) {
      const b = this.buffers[k];
      if (b?.value?.dispose) b.value.dispose?.();
    }
  }
}
void abs;
void sqrt;
void fract;
void Break;
void Continue;
void cross;
void step;
void negate;
void mat4;
void cameraPosition;
void int;
