import { CrackPlanes } from "./ice/CrackPlanes";
import { RW } from "./rewrite";
import { createMeshEntry } from "./ice/MeshEntry";
import { createGlassMatcap } from "./ice/GlassMatcap";
// World: owns the scene graph, the object, the simulation modules and the render loop.
// A thin host component mounts it elsewhere. Everything tunable reads from the DialKit store `D`.
import * as THREE from "three/webgpu";
import { D } from "./dials/store";
import type { ShapeName } from "./dials/defaults";
import { clock } from "./core/clock";
import { input, sim, heroFrame } from "./core/state";
import { damp } from "./core/ease";
import { rng } from "./core/seed";
import { createBackdrop } from "./scene/Backdrop";
import { createEnvironment } from "./scene/Environment";
import { Lights } from "./scene/Lights";
import { Rig } from "./scene/Rig";
import { makeShape, type ShapeSpec, type LogoSDF } from "./shape/sdf";
import { buildGeometry } from "./shape/geometry";
import { createPost } from "./post/Post";
import { createIceMaterial, type IceMaterialBundle } from "./ice/IceMaterial";
import { ErosionField } from "./erosion/ErosionField";
import { Powder } from "./powder/Powder";
import { Interaction } from "./core/interaction";
import { DebugViews } from "./scene/DebugViews";
import { tsl } from "./tsl/t";
import { AdaptiveResolution } from "./core/AdaptiveResolution";

export interface WorldKey {
  logoId: number;
  shape: string;
  seed: number;
  particleCount: string;
  resolution: string;
  densityGrid: string;
  size: number;
  tubeRatio: number;
  segments: number;
  variants: number;
  faceted: boolean;
  sprites: boolean;
  spriteBlend: boolean;
  strays: number;
  clumps: number;
  dispersion: boolean;
  voronoiCells: string;
  turbulence: string;
}
export const worldKeyOf = (): WorldKey => ({
  logoId: currentLogoId,
  shape: heroFrame.enabled && heroFrame.shape ? heroFrame.shape : D.shape.shape,
  seed: D.shape.seed,
  particleCount: D.powder.particleCount,
  resolution: D.erosion.resolution,
  densityGrid: D.powder.densityGrid,
  size: D.shape.size,
  tubeRatio: D.shape.tubeRatio,
  segments: D.shape.segments,
  variants: D.powder.grainVariants,
  faceted: D.powder.facetedGrains,
  sprites: D.powder.sprites.enabled,
  spriteBlend: D.powder.sprites.seeThrough > 0,
  strays: D.powder.strayCount,
  clumps: D.powder.clumpCount,
  dispersion: true,
  voronoiCells: D.performance.voronoiCells,
  turbulence: D.performance.turbulence,
});
export const keyString = (k: WorldKey) => JSON.stringify(k);
export let currentLogoId = 0;
export const bumpLogoId = () => {
  currentLogoId++;
};

/** Undocumented URL flags for bisecting problems: ?nobake ?nopowder ?noerosion ?noice ?nopost */
export const FLAGS = new Set(
  typeof location !== "undefined" ? [...new URLSearchParams(location.search).keys()] : [],
);
/** hash buckets for break-cell restore counters (cells are identified by their baked hash) */
export const CELL_BUCKETS = 65536;
const PARTICLE_COUNTS: Record<string, number> = {
  "100k": 100_000,
  "250k": 250_000,
  "500k": 500_000,
  "1M": 1_000_000,
  "2M": 2_000_000,
};

export class World {
  /** FROST: the composition's continuous motion lives on this outer group; objectGroup (the experiment's) is its child
   *  and only carries the facing offset that makes a freshly formed shape face the camera. */
  readonly motionGroup = new THREE.Group();
  readonly objectGroup = new THREE.Group();
  readonly backdrop = createBackdrop();
  readonly env = createEnvironment();
  readonly lights = new Lights();
  rig = new Rig();
  readonly post;
  shape!: ShapeSpec;
  mesh!: THREE.Mesh;
  meshEntry?: ReturnType<typeof createMeshEntry>;
  glassMatcap?: THREE.Texture;
  materialPlanes?: CrackPlanes;
  ice!: IceMaterialBundle;
  erosion!: ErosionField;
  powder!: Powder;
  interaction!: Interaction;
  debugViews!: DebugViews;
  private pixelRatio = 0;
  private frozenByDial = false;
  private statsTimer = 0;
  buildCount = 0;
  private timersPending = false;
  private fieldMaybeNonZero = true;
  private lastActivityT = 0;

  /**
   * Idle-skip bookkeeping. The field only changes during a stroke, the crumble window, or while
   * healing/refrost still has something to decay; the powder only needs work while grains are out.
   */
  private idleState(t: number) {
    const stroke = this.interaction.strokeCount > 0;
    if (stroke) {
      this.fieldMaybeNonZero = true;
      this.lastActivityT = t;
    }
    const st = this.erosion.stats;
    // a readback taken after the last stroke that shows an empty field proves it is static again
    if (
      this.fieldMaybeNonZero &&
      this.erosion.statsReadT > sim.lastStrokeT + 0.6 &&
      st.max < 0.002 &&
      st.refrost < 0.002
    )
      this.fieldMaybeNonZero = false;
    const healingNow = sim.healing && this.fieldMaybeNonZero;
    const refrostNow = this.fieldMaybeNonZero && st.refrost > 0.002;
    const fieldActive =
      !D.performance.idleSkip ||
      stroke ||
      t < this.erosion.crumbleUntil ||
      healingNow ||
      refrostNow;
    const powderActive =
      !D.performance.idleSkip ||
      fieldActive ||
      sim.counts.active > 0 ||
      t - this.lastActivityT < 1.5 ||
      sim.resetRequestedAt >= 0;
    sim.fieldActive = fieldActive;
    sim.powderActive = powderActive;
    return { fieldActive, powderActive };
  }
  private envSig = "";
  private backdropSig = "";
  private frameTimes = new Float64Array(30);
  private frameTimeSum = 0;
  private frameTimeCount = 0;
  private frameTimeIndex = 0;
  private lastFrameStart = 0;
  private gpuPending = false;
  private gpuTimerLast = -Infinity;
  private readonly renderSize = new THREE.Vector2();
  private readonly adaptiveResolution = new AdaptiveResolution();
  /** ?offscreen=1 renders into a render target, not the canvas (presenting kills headless SwiftShader devices). */
  private offscreenRT: THREE.RenderTarget | null = FLAGS.has("offscreen")
    ? new THREE.RenderTarget(16, 16, {
        depthBuffer: false,
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
      })
    : null;

  constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    readonly blueNoise: THREE.Texture,
    public logo?: { sdf: LogoSDF; geometry: THREE.BufferGeometry },
    readonly fractureDetail?: THREE.Texture,
  ) {
    this.motionGroup.add(this.objectGroup);
    scene.add(this.motionGroup, this.lights.group, camera);
    scene.backgroundNode = this.backdrop.node;
    scene.environment = this.env.texture;
    this.build();
    this.post = createPost({
      scene,
      camera,
      renderer,
      blueNoise,
      haze: (depthNode, viewZ) => this.powder.hazeNode(depthNode, viewZ, camera),
      initial: D.post,
      initialPerformance: D.performance,
      initialHaze: D.powder.hazeIntensity !== 0,
    });
  }

  /** (Re)build the shape-dependent parts: geometry, ice material, erosion field, powder. */
  build() {
    this.buildCount++;
    const key = worldKeyOf();
    const rand = rng(key.seed + 1);
    const wanted = heroFrame.enabled && heroFrame.shape ? heroFrame.shape : D.shape.shape;
    const shapeName = (wanted === "logo" && !this.logo ? "torus" : wanted) as ShapeName;
    this.shape = makeShape(shapeName, key.size, key.tubeRatio, this.logo?.sdf);
    const geometry = buildGeometry(this.shape, key.segments, this.logo?.geometry);
    // one shared atomic uint buffer: [powder density G^3 | 16 counters | erosion heal grid R^3]
    const G = parseInt(key.densityGrid, 10),
      R = parseInt(key.resolution, 10);
    const countersOffset = G * G * G,
      healOffset = countersOffset + 16,
      cellOffset = healOffset + R * R * R,
      flightOffset = cellOffset + CELL_BUCKETS;
    const atomics = tsl.instancedArray(flightOffset + CELL_BUCKETS, "uint").toAtomic();
    this.erosion = new ErosionField(
      this.renderer,
      this.shape,
      R,
      key.seed,
      atomics,
      healOffset,
      cellOffset,
      flightOffset,
    );
    if (RW.materials) {
      this.materialPlanes = new CrackPlanes(this.renderer, this.shape.bound, key.seed);
      (this.erosion as any).materialPlanes = this.materialPlanes;
    }
    this.erosion.skipBake = FLAGS.has("nobake");
    if (RW.mesh) this.meshEntry = createMeshEntry(geometry, this.camera);
    if (RW.matcap) {
      this.env.update(D.lighting);
      this.glassMatcap = createGlassMatcap(this.env.texture);
    }
    this.ice = createIceMaterial({
      meshEntry: this.meshEntry,
      glassMatcap: this.glassMatcap,
      shape: this.shape,
      erosion: this.erosion,
      seed: key.seed,
      blueNoise: this.blueNoise,
      environment: this.env.texture,
      fractureDetail: this.fractureDetail,
      backdrop: this.backdrop.uniforms,
      dispersion: key.dispersion,
      voronoiCells: key.voronoiCells as "27" | "8",
    });
    if (FLAGS.has("noice")) {
      const m = new THREE.MeshStandardNodeMaterial();
      m.roughness = 0.3;
      m.color.set("#bbbbbb");
      (this.ice as any).material = m;
    }
    if (this.meshEntry) this.meshEntry.material.positionNode = this.ice.material.positionNode;
    this.mesh = new THREE.Mesh(geometry, this.ice.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.objectGroup.add(this.mesh);
    this.powder = new Powder({
      enabled: !FLAGS.has("nopowder"),
      renderer: this.renderer,
      scene: this.scene,
      shape: this.shape,
      erosion: this.erosion,
      seed: key.seed,
      rand,
      count: PARTICLE_COUNTS[key.particleCount] ?? 1_000_000,
      variants: key.variants,
      strays: key.strays,
      densityRes: G,
      clumpCount: key.clumps,
      objectGroup: this.objectGroup,
      turbulence: key.turbulence as "full" | "fast",
      atomics,
      countersOffset,
      healOffset,
      cellOffset,
      flightOffset,
      fieldRes: R,
      backdrop: this.backdrop.uniforms,
      fractureDetail: this.fractureDetail,
      iceUniforms: this.ice.uniforms,
      iceFeatures: this.ice.features,
      environment: this.env.texture,
    });
    this.interaction = new Interaction(
      this.shape,
      this.objectGroup,
      this.camera,
      this.erosion,
      this.powder,
    );
    this.debugViews = new DebugViews(this.camera, this.erosion, this.powder);
    this.scene.add(this.debugViews.group);
  }

  disposeBuilt() {
    this.materialPlanes?.dispose();
    this.materialPlanes = undefined;
    this.meshEntry?.dispose();
    this.meshEntry = undefined;
    this.glassMatcap?.dispose();
    this.glassMatcap = undefined;
    this.debugViews.dispose();
    this.scene.remove(this.debugViews.group);
    this.objectGroup.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.ice.material.dispose();
    this.erosion.dispose();
    this.powder.dispose();
  }

  rebuild() {
    this.disposeBuilt();
    this.build();
    this.post.post.needsUpdate = true;
  }

  private updateEnvironment() {
    const L = D.lighting;
    const sig = JSON.stringify([
      L.envSoftbox,
      L.envRim,
      L.envFill,
      L.key,
      L.fill,
      L.fillColor,
      L.fillGroundColor,
      L.fillReflectionStrength,
      L.rimColor,
      L.rimElevation,
      L.rimAzimuth,
      L.rimSize,
      L.accentCool,
      L.accentWarm,
    ]);
    if (sig !== this.envSig) {
      this.envSig = sig;
      this.env.update(L);
    }
    this.scene.environmentIntensity = D.ice.envIntensity;
  }

  private updateBackdrop(t: number) {
    const b = D.lighting.backdrop;
    const h = heroFrame.enabled ? heroFrame.backdrop : null;
    const u = this.backdrop.uniforms;
    const top = h?.top ?? b.top,
      mid = h?.mid ?? b.mid,
      bottom = h?.bottom ?? b.bottom;
    const centerX = h?.centerX ?? b.centerX,
      centerY = h?.centerY ?? b.centerY,
      radius = h?.radius ?? b.radius,
      falloff = h?.falloff ?? b.falloff;
    const sig = `${top}|${mid}|${bottom}|${centerX}|${centerY}|${radius}|${falloff}|${b.noise}`;
    if (sig !== this.backdropSig) {
      this.backdropSig = sig;
      u.uTop.value.set(top);
      u.uMid.value.set(mid);
      u.uBottom.value.set(bottom);
      u.uCenter.value.set(centerX, centerY);
      u.uRadius.value = radius;
      u.uFalloff.value = falloff;
      u.uNoise.value = b.noise;
    }
    u.uTime.value = t;
  }

  /** FROST: called after the camera is final for this frame and before the post graph renders. */
  onBeforeRender: ((t: number) => void) | null = null;
  /** Called after the rig places the object group, before its world matrix is used (the object motion). */
  onBeforeSimulation: ((t: number, dt: number) => void) | null = null;
  onObjectTransform: ((t: number) => void) | null = null;
  /** Authored camera evaluates after the current target matrix, before interaction and render. */
  onCameraTransform: ((t: number) => void) | null = null;

  /**
   * One frame: input -> rig -> simulation compute -> post render. The composition supplies the clock (t, dt),
   * not performance.now(), so each step is pure; `render` false advances without drawing (fast-forward after a seek).
   */
  frame(t: number, dt: number, render = true) {
    clock.t = t;
    clock.dt = dt;
    clock.frame++;
    const start = t * 1000;
    const elapsed = 1000 / D.performance.targetFps;
    const splitOutput =
      !FLAGS.has("nopost") &&
      D.performance.nativePostEffects &&
      D.performance.upscaler !== "native";
    const resolution = this.adaptiveResolution.updateScene(
      t,
      elapsed,
      window.devicePixelRatio || 1,
      D.post.pixelRatioCap,
      D.performance.adaptiveResolution && D.performance.dynamicSceneResolution,
      D.performance.targetFps,
      D.performance.minPixelRatio,
      D.performance.sceneResolutionScale,
      D.performance.minSceneResolutionScale,
      splitOutput,
    );
    sim.pixelRatio = resolution.sourceRatio;
    sim.outputPixelRatio = resolution.outputRatio;
    sim.sceneResolutionScale = resolution.sceneScale;
    if (
      resolution.outputRatio !== this.pixelRatio ||
      this.renderer.getPixelRatio() !== resolution.outputRatio
    ) {
      this.pixelRatio = resolution.outputRatio;
      this.renderer.setPixelRatio(resolution.outputRatio);
      const sz = this.renderer.getSize(this.renderSize);
      this.renderer.setSize(sz.x, sz.y, false);
    }

    if (!this.onCameraTransform) this.rig.update(this.camera, this.objectGroup, t, dt);
    if (heroFrame.enabled && heroFrame.framing)
      this.motionGroup.position.set(heroFrame.objectX, heroFrame.objectY, heroFrame.objectZ);
    else this.motionGroup.position.set(D.shape.offsetX, D.shape.offsetY, D.shape.offsetZ);
    this.objectGroup.position.set(0, 0, 0);
    if (this.onObjectTransform) this.onObjectTransform(t);
    this.motionGroup.updateMatrixWorld(true);
    this.onCameraTransform?.(t);
    this.updateEnvironment();
    this.updateBackdrop(t);
    sim.hoverAmount = damp(sim.hoverAmount, sim.overObject ? 1 : 0, 0.4 / 3, dt);
    this.lights.update(t, sim.hoverAmount);

    this.interaction.update(t, dt);
    this.onBeforeSimulation?.(t, dt);
    this.debugViews.update(this.interaction);
    if (!FLAGS.has("noice")) {
      this.ice.update(t, dt, this.lights.key, this.objectGroup);
      this.ice.uniforms.hover.value = sim.hoverAmount;
    }

    const c0 = performance.now();
    const idle = this.idleState(t);
    if (dt > 0) {
      if (!FLAGS.has("noerosion"))
        this.erosion.step(
          this.renderer,
          t,
          dt,
          this.interaction.strokeSegments,
          this.interaction.strokeCount,
          idle.fieldActive,
        );
    }
    // Uniform-only updates at dt=0 keep paused workbench edits live.
    if (!FLAGS.has("nopowder"))
      this.powder.step(this.renderer, t, dt, this.interaction, this.lights.key, idle);
    sim.computeMs = performance.now() - c0;
    const wantStats = D.debug.stats || D.performance.idleSkip;
    if (wantStats) {
      this.statsTimer += Math.max(dt, 1 / 120);
      const interval = this.fieldMaybeNonZero ? 0.25 : 0.4;
      if (this.statsTimer > interval || this.offscreenRT) {
        this.statsTimer = 0;
        this.erosion.readStats(this.renderer, t);
        sim.erosion = this.erosion.stats;
      }
    }

    this.camera.updateMatrixWorld();
    if (this.onBeforeRender) this.onBeforeRender(t);
    // Sprite size belongs to the low-resolution scene pass, not the native-resolution final output.
    this.powder.updateCamera(
      this.camera,
      this.renderer.getSize(this.renderSize).y * resolution.sourceRatio,
    );
    const focus = this.camera.position.distanceTo(this.rig.lookAt);
    this.post.update(
      D.post,
      D.performance,
      focus,
      sim.sceneFade,
      D.powder.hazeIntensity,
      t,
      D.version,
    );
    this.materialPlanes?.update();
    this.post.setSceneResolution(resolution.sceneScale);
    this.meshEntry?.update(this.mesh, resolution.sceneScale);
    (this.mesh.material as any).wireframe = D.debug.wireframe;
    if (this.offscreenRT) {
      const sz = this.renderer.getSize(this.renderSize);
      const pr = this.renderer.getPixelRatio();
      const w = Math.max(1, Math.floor(sz.x * pr)),
        h = Math.max(1, Math.floor(sz.y * pr));
      if (this.offscreenRT.width !== w || this.offscreenRT.height !== h)
        this.offscreenRT.setSize(w, h);
      this.renderer.setRenderTarget(this.offscreenRT);
    }
    this.post.setHazeResolution(
      D.performance.hazeResolution === "quarter"
        ? 0.25
        : D.performance.hazeResolution === "half"
          ? 0.5
          : 1,
    );
    // HyperFrames drives explicit frames outside Three's animation loop. Advance
    // the node frame so FRAME-scoped passes cannot reuse the previous image.
    if (render) {
      (this.renderer as any)._nodes.nodeFrame.update();
      this.post.setFrame(Math.round(t * 60));
      if (FLAGS.has("nopost")) this.renderer.render(this.scene, this.camera);
      else this.post.post.render();
    }
    if (this.offscreenRT) this.renderer.setRenderTarget(null);
    if (D.performance.gpuTimers && !this.timersPending && t - this.gpuTimerLast >= 0.25) {
      const r: any = this.renderer;
      if (r.backend?.trackTimestamp) {
        this.timersPending = true;
        this.gpuTimerLast = t;
        Promise.all([r.resolveTimestampsAsync("render"), r.resolveTimestampsAsync("compute")])
          .then(() => {
            sim.gpuRenderMs = r.info.render.timestamp || 0;
            sim.gpuComputeMs = r.info.compute.timestamp || 0;
            this.timersPending = false;
          })
          .catch(() => {
            this.timersPending = false;
          });
      }
    }
    if (this.offscreenRT && !this.gpuPending) {
      const q = (this.renderer as any).backend?.device?.queue;
      if (q?.onSubmittedWorkDone) {
        this.gpuPending = true;
        q.onSubmittedWorkDone()
          .then(() => {
            sim.gpuFrames++;
            this.gpuPending = false;
          })
          .catch(() => {
            this.gpuPending = false;
          });
      }
    }
    void input;
  }

  /**
   * FROST: return every stateful part of the simulation to its t = 0 state so a backward seek can replay
   * the timeline deterministically (field cleared, grains dormant, rig and interaction fresh).
   */
  resetSim() {
    this.erosion.clear(this.renderer);
    this.erosion.crumbleUntil = -1;
    this.erosion.u.crumbleUntil.value = -1;
    this.powder.reset(this.renderer);
    this.interaction = new Interaction(
      this.shape,
      this.objectGroup,
      this.camera,
      this.erosion,
      this.powder,
    );
    this.rig = new Rig();
    this.mesh.visible = true;
    sim.strokeActive = false;
    sim.overObject = false;
    sim.lastStrokeT = -1e9;
    sim.healing = false;
    sim.resetRequestedAt = -1;
    sim.fade = 1;
    sim.sceneFade = 1;
    sim.hoverAmount = 0;
    sim.fieldActive = true;
    sim.powderActive = true;
    this.fieldMaybeNonZero = true;
    this.lastActivityT = 0;
    this.statsTimer = 0;
    clock.t = 0;
    clock.dt = 1 / 60;
    clock.frame = 0;
    clock.paused = false;
  }

  /** Debug helper: generated WGSL for the object's material. */
  async dumpShader() {
    const r: any = this.renderer;
    return r.debug.getShaderAsync(this.scene, this.camera, this.mesh);
  }

  /** Headless check helper: read the offscreen frame back, return luma stats + a PNG data URL. */
  async readback() {
    if (!this.offscreenRT) return null;
    const rt = this.offscreenRT,
      w = rt.width,
      h = rt.height;
    const data = (await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
    const stride =
      data.length >= Math.ceil((w * 4) / 256) * 256 * h ? Math.ceil((w * 4) / 256) * 256 : w * 4;
    let sum = 0,
      mx = 0;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const si = y * stride + x * 4,
          di = (y * w + x) * 4; // WebGPU readback rows are top-down
        img.data[di] = data[si];
        img.data[di + 1] = data[si + 1];
        img.data[di + 2] = data[si + 2];
        img.data[di + 3] = 255;
        const l = 0.2126 * data[si] + 0.7152 * data[si + 1] + 0.0722 * data[si + 2];
        sum += l;
        if (l > mx) mx = l;
      }
    ctx.putImageData(img, 0, 0);
    return { mean: sum / (w * h), max: mx, png: cv.toDataURL("image/png"), w, h };
  }

  dispose() {
    this.disposeBuilt();
    this.post.dispose();
    this.scene.remove(this.motionGroup, this.lights.group);
    this.scene.backgroundNode = null;
    this.scene.environment = null;
    this.env.texture.dispose();
    this.fractureDetail?.dispose();
  }
}
