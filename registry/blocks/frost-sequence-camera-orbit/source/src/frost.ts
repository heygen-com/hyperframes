import { LogoRig, type LogoRigOptions } from "./rig/LogoRig";
export { setRendererProfile } from "./rewrite";
import { RW, rwMetrics } from "./rewrite";
import { voxelizeGPU } from "./shape/gpuSdf";
// Frost — the ice-logo effect as a HyperFrames block driver.
//
// Sequence (all motion on the object group; the camera never moves):
//   the extruded SVG mark ▸ turns and comes closer while a diagonal slice starts a break front that crosses the
//   whole shape ▸ the shards fly back and heal into headline 1 (extruded, bevelled, facing the camera) ▸
//   headline 1 turns away and breaks ▸ the shards heal into headline 2 ▸ headline 2 comes in close, breaks,
//   and the shards fade out to an empty frame.
//
// Everything under src/ except this file, assets.ts, cache.ts, dials/store.ts and shape/text.ts is the
// experiment's own source; the edits are marked `FROST:` in place (README.md lists them). The reveal uses the
// experiment's own healing: every grain carries a home inside the shape and rebuilds the ice where it lands.
// A headline is a second shape whose distance field is swapped into the live field texture, starts fully
// eroded, and hands its interior positions to the shards already in flight.
//
// Determinism: the frame at time t is "the state after round(t * 60) fixed 1/60 s steps from a fresh world,
// with every scheduled event fired in the step its time rounds to". Forward seeks step to t; backward seeks
// reset and replay; a real seek re-renders the last 12 steps so TRAA history is converged.
import * as THREE from "three/webgpu";
import { World } from "./World";
import { MATERIAL_FEATURES, featureId } from "./ice/features";
import approvedPreset from "../presets/approved-material.json";
import sourceMaterial from "../presets/source-hero4-material.json";
import { parseTrack, applyCameraAt, type CameraTrack } from "./motion/track";
import { objectFrameAt } from "./motion/objectFrame";
export { parseTrack, cameraAt } from "./motion/track";
import { deformGeometry, resolveDeformation, type Deformation } from "./shape/deform";
import { resolveTextMeshDetail } from "./shape/textRefine";
import { resolveLogoMeshDetail } from "./shape/logoRefine";
export { validateDeformationScale } from "./shape/deform";
import { RETURN_GROUP_DEFAULTS } from "./powder/returnGroups";
import { makePoseAt, SETTLE } from "./core/motion";
import { DEFAULT_SCHEDULE, durationOf, FADE_DURATION } from "./core/schedule";
export { resolveSchedule, durationOf } from "./core/schedule";
import { D } from "./dials/store";
import { clock } from "./core/clock";
import { sim, heroFrame, input } from "./core/state";
import { rng } from "./core/seed";
import { makeShape, sampleInterior, type LogoSDF } from "./shape/sdf";
import {
  loadLogoShapes,
  extrudeShapes,
  voxelize,
  halfExtents,
  makeLogoSDF,
  type LogoParams,
} from "./shape/logo";
import { loadTypeface, textShapes, lineWidth } from "./shape/text";
import { setIceFrameIndex } from "./ice/IceMaterial";
import { ErosionField } from "./erosion/ErosionField";
import { assetUrl } from "./assets";
import { BUILD_VERSION, readBuild, writeBuild, packGeometry, unpackGeometry } from "./cache";

export const SIM_STEP = 1 / 60;
export const DURATION = durationOf(DEFAULT_SCHEDULE);
export const REVIEW_BUILD = "frost-ice-textured-r1-reference-optics";
/** Frames re-rendered (not just simulated) before a jump target so TRAA history is converged there. */
const WARMUP_RENDERS = 12;

export interface Schedule {
  logoBreak: number;
  form1: number;
  break1: number;
  form2: number;
  break2: number;
  fadeOut: number;
}
export interface Pose {
  turnYaw: number;
  turnPitch: number;
  approach: number;
  turnYaw2: number;
  turnPitch2: number;
  retreat: number;
  zoomIn: number;
  finalYaw: number;
  finalPitch: number;
  driftYaw: number;
  driftSway: number;
  idleYaw: number;
}
export interface Shards {
  amount: number;
  formSpread: number;
  formFill: number;
  sliceRadius: number;
  sliceStrength: number;
  shatterRadius: number;
  shatterStrength: number;
  breakDuration: number;
  strayDust: number;
  followObject: number;
  finalEjectBoost: number;
}

export interface FrostOptions {
  rig?: LogoRigOptions;
  cameraMode?: "original" | "authored";
  cameraTrack?: CameraTrack;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** two headlines, each as lines */
  headlines: [string[], string[]];
  /** headline extrusion: block width (world units), line height (em), depth / bevel / corner as fractions of the font size */
  text: {
    width: number;
    lineHeight: number;
    depth: number;
    bevel: number;
    corner: number;
    weight: 400 | 600 | 700;
    letterSpacing: number;
    meshDetail?: number;
  };
  schedule: Schedule;
  deformation?: Deformation;
  pose: Pose;
  shards: Shards;
  /** the experiment's own tunables (Erosion / Ice / Powder / Healing / Lighting / Post folders), id -> value; see TUNABLES */
  tune: Record<string, number | string | boolean>;
  quality: "full" | "lite";
  upscaler: "fsr1" | "taau" | "bilinear" | "native";
  renderScale: number;
  previewPixelRatio?: number;
  shapeResolution?: "128" | "256" | "384";
  erosionResolution: "64" | "96" | "128" | "192";
  particleCount: "100k" | "250k" | "500k" | "1M";
  logoUrl: string;
  logoMeshDetail?: number;
  fontUrl: string;
  onProgress?: (msg: string) => void;
}

/** Exposed tunables: the DialKit path in the store and whether a change alters the simulation's history. */
export const TUNABLES: Record<string, { path: string[]; replay: boolean }> = {
  // shards in flight
  turbulenceScale: { path: ["powder", "turbulenceScale"], replay: true },
  clumpCohesion: { path: ["powder", "clumpCohesion"], replay: true },
  repelStrength: { path: ["powder", "repelStrength"], replay: true },
  repelRange: { path: ["powder", "repelRange"], replay: true },
  repelRadial: { path: ["powder", "repelRadial"], replay: true },
  repelRadialRange: { path: ["powder", "repelRadialRange"], replay: true },
  wrap: { path: ["powder", "wrap"], replay: false },
  turbulenceDecay: { path: ["powder", "turbulenceDecay"], replay: true },
  settledDrift: { path: ["powder", "settledDrift"], replay: true },
  tumble: { path: ["powder", "tumble"], replay: false },
  // return
  assemblyFrontDuration: { path: ["healing", "assemblyFrontDuration"], replay: true },
  assemblyOriginX: { path: ["healing", "assemblyOriginX"], replay: true },
  assemblyOriginY: { path: ["healing", "assemblyOriginY"], replay: true },
  assemblyAngle: { path: ["healing", "assemblyAngle"], replay: true },
  assemblySpread: { path: ["healing", "assemblySpread"], replay: true },
  assemblyFrontNoise: { path: ["healing", "assemblyFrontNoise"], replay: true },
  assemblySpeedVariation: { path: ["healing", "assemblySpeedVariation"], replay: true },
  assemblyBend: { path: ["healing", "assemblyBend"], replay: true },
  assemblySwirl: { path: ["healing", "assemblySwirl"], replay: true },
  assemblyLandingVariation: { path: ["healing", "assemblyLandingVariation"], replay: true },
  returnNoiseAmount: { path: ["healing", "returnNoiseAmount"], replay: true },
  returnGroupStagger: { path: ["healing", "returnGroupStagger"], replay: true },
  returnGroupScale: { path: ["healing", "returnGroupScale"], replay: true },
  returnGroupSeed: { path: ["healing", "returnGroupSeed"], replay: true },
  formJitter: { path: ["healing", "waveJitter"], replay: true },
  waveReach: { path: ["healing", "waveReach"], replay: true },
  alignToSurface: { path: ["healing", "alignToSurface"], replay: false },
  alignCurve: { path: ["healing", "alignCurve"], replay: false },
  // lighting
  rimAzimuth: { path: ["lighting", "rimAzimuth"], replay: false },
  rimAngle: { path: ["lighting", "rimAngle"], replay: false },
  rimSize: { path: ["lighting", "rimSize"], replay: false },
  fillReflectionStrength: { path: ["lighting", "fillReflectionStrength"], replay: false },
  accentCoolIntensity: { path: ["lighting", "accentCool", "intensity"], replay: false },
  accentCoolReflection: { path: ["lighting", "accentCool", "reflection"], replay: false },
  accentCoolElevation: { path: ["lighting", "accentCool", "elevation"], replay: false },
  accentCoolAzimuth: { path: ["lighting", "accentCool", "azimuth"], replay: false },
  accentCoolSize: { path: ["lighting", "accentCool", "size"], replay: false },
  accentCoolColor: { path: ["lighting", "accentCool", "color"], replay: false },
  accentWarmIntensity: { path: ["lighting", "accentWarm", "intensity"], replay: false },
  accentWarmReflection: { path: ["lighting", "accentWarm", "reflection"], replay: false },
  accentWarmElevation: { path: ["lighting", "accentWarm", "elevation"], replay: false },
  accentWarmAzimuth: { path: ["lighting", "accentWarm", "azimuth"], replay: false },
  accentWarmSize: { path: ["lighting", "accentWarm", "size"], replay: false },
  accentWarmColor: { path: ["lighting", "accentWarm", "color"], replay: false },
  keyColor: { path: ["lighting", "key", "color"], replay: false },
  keyIntensity: { path: ["lighting", "key", "intensity"], replay: false },
  keyElevation: { path: ["lighting", "key", "elevation"], replay: false },
  keyAzimuth: { path: ["lighting", "key", "azimuth"], replay: false },
  keySize: { path: ["lighting", "key", "size"], replay: false },
  fill: { path: ["lighting", "fill"], replay: false },
  fillColor: { path: ["lighting", "fillColor"], replay: false },
  fillGroundColor: { path: ["lighting", "fillGroundColor"], replay: false },
  rim: { path: ["lighting", "rim"], replay: false },
  rimColor: { path: ["lighting", "rimColor"], replay: false },
  rimElevation: { path: ["lighting", "rimElevation"], replay: false },
  swayAmplitude: { path: ["lighting", "sway", "amplitude"], replay: false },
  swayPeriod: { path: ["lighting", "sway", "period"], replay: false },
  envSoftbox: { path: ["lighting", "envSoftbox"], replay: false },
  envRim: { path: ["lighting", "envRim"], replay: false },
  envFill: { path: ["lighting", "envFill"], replay: false },
  backdropTop: { path: ["lighting", "backdrop", "top"], replay: false },
  backdropMid: { path: ["lighting", "backdrop", "mid"], replay: false },
  backdropBottom: { path: ["lighting", "backdrop", "bottom"], replay: false },
  backdropCenterX: { path: ["lighting", "backdrop", "centerX"], replay: false },
  backdropCenterY: { path: ["lighting", "backdrop", "centerY"], replay: false },
  backdropRadius: { path: ["lighting", "backdrop", "radius"], replay: false },
  backdropFalloff: { path: ["lighting", "backdrop", "falloff"], replay: false },
  backdropNoise: { path: ["lighting", "backdrop", "noise"], replay: false },
  // ice material
  ...Object.fromEntries(
    Object.keys(MATERIAL_FEATURES).map((name) => [
      featureId(name),
      { path: ["ice", "features", name], replay: false },
    ]),
  ),
  materialBacklight: { path: ["ice", "backlight"], replay: false },
  materialInclusionAmount: { path: ["ice", "inclusionAmount"], replay: false },
  materialInclusionScale: { path: ["ice", "inclusionScale"], replay: false },
  materialBaseColor: { path: ["ice", "baseColor"], replay: false },
  materialInteriorFrost: { path: ["erosion", "interiorFrost"], replay: false },
  materialGrainAmount: { path: ["erosion", "edgeBump"], replay: false },
  materialGrainScale: { path: ["erosion", "edgeBumpScale"], replay: false },
  ior: { path: ["ice", "ior"], replay: false },
  dispersion: { path: ["ice", "dispersion"], replay: false },
  thicknessScale: { path: ["ice", "thicknessScale"], replay: false },
  attenuationDistance: { path: ["ice", "attenuationDistance"], replay: false },
  attenuationColor: { path: ["ice", "attenuationColor"], replay: false },
  baseRoughness: { path: ["ice", "baseRoughness"], replay: false },
  crumbleGlow: { path: ["ice", "crumbleGlow"], replay: false },
  edgeWhiteness: { path: ["ice", "edgeWhiteness"], replay: false },
  clearcoat: { path: ["ice", "clearcoat"], replay: false },
  clearcoatRoughness: { path: ["ice", "clearcoatRoughness"], replay: false },
  envIntensity: { path: ["ice", "envIntensity"], replay: false },
  specularIntensity: { path: ["ice", "specularIntensity"], replay: false },
  interiorScatter: { path: ["ice", "interiorScatter"], replay: false },
  frostScale: { path: ["ice", "frost", "scale"], replay: false },
  frostThreshold: { path: ["ice", "frost", "threshold"], replay: false },
  frostSoftness: { path: ["ice", "frost", "softness"], replay: false },
  frostRoughness: { path: ["ice", "frost", "roughness"], replay: false },
  frostDiffuse: { path: ["ice", "frost", "diffuse"], replay: false },
  crystalBump: { path: ["ice", "frost", "crystalBump"], replay: false },
  crystalScale: { path: ["ice", "frost", "crystalScale"], replay: false },
  crackLargeScale: { path: ["ice", "cracks", "largeScale"], replay: false },
  crackWarp: { path: ["ice", "cracks", "warp"], replay: false },
  crackWarpScale: { path: ["ice", "cracks", "warpScale"], replay: false },
  crackCoverage: { path: ["ice", "cracks", "coverage"], replay: false },
  crackRegionScale: { path: ["ice", "cracks", "regionScale"], replay: false },
  crackRegionCoverage: { path: ["ice", "cracks", "regionCoverage"], replay: false },
  veinScale: { path: ["ice", "cracks", "veinScale"], replay: false },
  veinContrast: { path: ["ice", "cracks", "veinContrast"], replay: false },
  crackWidth: { path: ["ice", "cracks", "width"], replay: false },
  crackBrightness: { path: ["ice", "cracks", "brightness"], replay: false },
  crackDarkness: { path: ["ice", "cracks", "darkness"], replay: false },
  crackRefraction: { path: ["ice", "cracks", "refraction"], replay: false },
  crackSurfaceStrength: { path: ["ice", "cracks", "surfaceStrength"], replay: false },
  fineScale: { path: ["ice", "cracks", "fineScale"], replay: false },
  fineAmount: { path: ["ice", "cracks", "fineAmount"], replay: false },
  fineCoverage: { path: ["ice", "cracks", "fineCoverage"], replay: false },
  smudgeAmount: { path: ["ice", "smudges", "amount"], replay: false },
  smudgeCoverage: { path: ["ice", "smudges", "coverage"], replay: false },
  smudgeMaskScale: { path: ["ice", "smudges", "maskScale"], replay: false },
  smudgeAnisotropy: { path: ["ice", "smudges", "anisotropy"], replay: false },
  smudgeRoughness: { path: ["ice", "smudges", "roughness"], replay: false },
  smudgeWhiteness: { path: ["ice", "smudges", "whiteness"], replay: false },
  smudgeScale: { path: ["ice", "smudges", "scale"], replay: false },
  microBump: { path: ["ice", "bumps", "microBump"], replay: false },
  microScale: { path: ["ice", "bumps", "microScale"], replay: false },
  microCoverage: { path: ["ice", "bumps", "microCoverage"], replay: false },
  rippleBump: { path: ["ice", "bumps", "rippleBump"], replay: false },
  rippleScale: { path: ["ice", "bumps", "rippleScale"], replay: false },
  bumpMaskScale: { path: ["ice", "bumps", "maskScale"], replay: false },
  // shard look
  baseTone: { path: ["powder", "baseTone"], replay: false },
  fragTranslucency: { path: ["powder", "fragments", "translucency"], replay: false },
  fragThroughTint: { path: ["powder", "fragments", "throughTint"], replay: false },
  fragFresnelPower: { path: ["powder", "fragments", "fresnelPower"], replay: false },
  fragRoughness: { path: ["powder", "fragments", "roughness"], replay: false },
  fragClearcoat: { path: ["powder", "fragments", "clearcoat"], replay: false },
  fragSpecular: { path: ["powder", "fragments", "specular"], replay: false },
  sparkle: { path: ["powder", "fragments", "sparkle"], replay: false },
  sparkleFraction: { path: ["powder", "fragments", "sparkleFraction"], replay: false },
  spriteTilt: { path: ["powder", "sprites", "tilt"], replay: false },
  spriteNormal: { path: ["powder", "sprites", "normalStrength"], replay: false },
  spriteFrost: { path: ["powder", "sprites", "frostFromAtlas"], replay: false },
  spriteFrostBoost: { path: ["powder", "sprites", "frostBoost"], replay: false },
  spriteFrostRoughness: { path: ["powder", "sprites", "frostRoughness"], replay: false },
  spriteEdgeLight: { path: ["powder", "sprites", "edgeLight"], replay: false },
  spriteAlphaCut: { path: ["powder", "sprites", "alphaCut"], replay: false },
  spriteSeeThrough: { path: ["powder", "sprites", "seeThrough"], replay: false },
  // post
  bloomThreshold: { path: ["post", "bloom", "threshold"], replay: false },
  bloomIntensity: { path: ["post", "bloom", "intensity"], replay: false },
  bloomRadius: { path: ["post", "bloom", "radius"], replay: false },
  monochrome: { path: ["post", "monochrome"], replay: false },
  tonemap: { path: ["post", "tonemap"], replay: false },
  exposure: { path: ["post", "exposure"], replay: false },
  contrast: { path: ["post", "contrast"], replay: false },
  blackLift: { path: ["post", "blackLift"], replay: false },
  vignetteStrength: { path: ["post", "vignette", "strength"], replay: false },
  vignetteSoftness: { path: ["post", "vignette", "softness"], replay: false },
  vignetteRadius: { path: ["post", "vignette", "radius"], replay: false },
  grainStrength: { path: ["post", "grain", "strength"], replay: false },
  cutThreshold: { path: ["erosion", "cutThreshold"], replay: false },
  cutSoftness: { path: ["erosion", "cutSoftness"], replay: false },
  edgeWidth: { path: ["erosion", "edgeWidth"], replay: false },
  edgeInset: { path: ["erosion", "edgeInset"], replay: false },
  brushSoftness: { path: ["erosion", "brushSoftness"], replay: true },
  brushNoise: { path: ["erosion", "brushNoise"], replay: true },
  crumbleRate: { path: ["erosion", "crumbleRate"], replay: true },
  crumbleCrackBias: { path: ["erosion", "crumbleCrackBias"], replay: true },
  crumbleDuration: { path: ["erosion", "crumbleDuration"], replay: true },
  ejectSpeed: { path: ["powder", "ejectSpeed"], replay: true },
  ejectSpread: { path: ["powder", "ejectSpread"], replay: true },
  ejectTurbulence: { path: ["powder", "ejectTurbulence"], replay: true },
  drag: { path: ["powder", "drag"], replay: true },
  gravity: { path: ["powder", "gravity"], replay: true },
  turbulence: { path: ["powder", "turbulence"], replay: true },
  settleTime: { path: ["powder", "settleTime"], replay: true },
  maxSpeed: { path: ["powder", "maxSpeed"], replay: true },
  minPixelSize: { path: ["powder", "minPixelSize"], replay: false },
  grainSizeMultiplier: { path: ["powder", "grainSizeMultiplier"], replay: false },
  spriteSize: { path: ["powder", "sprites", "sizeScale"], replay: false },
  returnSpring: { path: ["healing", "returnSpring"], replay: true },
  returnDamping: { path: ["healing", "returnDamping"], replay: true },
  returnRamp: { path: ["healing", "returnRamp"], replay: true },
  returnMaxSpeed: { path: ["healing", "returnMaxSpeed"], replay: true },
  healRate: { path: ["healing", "healRate"], replay: true },
  cellRestore: { path: ["healing", "cellRestore"], replay: true },
  landedFade: { path: ["healing", "landedFade"], replay: true },
  refrostTime: { path: ["healing", "refrostTime"], replay: true },
};

export interface FrostInstance {
  ready: Promise<void>;
  renderAt(t: number): void;
  redraw(): void;
  invalidate(): void;
  waitForGpu(): Promise<void>;
  poseAt(t: number): { yaw: number; pitch: number; z: number };
  /**
   * Apply new option values in place. 'live': the current frame was updated (re-simulated from 0 when the
   * change alters history); 'rebuild': the change needs a full rebuild (shapes, quality, resolution).
   */
  applyOptions(
    next: Pick<
      FrostOptions,
      "schedule" | "pose" | "shards" | "tune" | "cameraMode" | "cameraTrack"
    >,
    structuralKey: string,
  ): "live" | "rebuild";
  readonly structuralKey: string;
  readonly world: World | null;
  /** index of the shape currently in the live field: 0 mark, 1 headline 1, 2 headline 2 */
  readonly shape: number;
  dispose(): void;
}

/** Approved authored appearance, also used when a direct runtime caller supplies partial tunables. */
export const APPEARANCE_DEFAULTS: Readonly<Record<string, number | string | boolean>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(TUNABLES)
        .filter(
          ([id, spec]) =>
            id.startsWith("material") ||
            ["ice", "lighting", "post"].includes(spec.path[0]) ||
            ["baseTone", "wrap", "sparkle", "sparkleFraction"].includes(id) ||
            id.startsWith("frag") ||
            id.startsWith("sprite"),
        )
        .map(([id]) => [id, (approvedPreset as Record<string, number | string | boolean>)[id]]),
    ),
  );

/** hero 07 auto-sweep path (object space, fractions of the bound) */
const SLICE_FROM: [number, number, number] = [-1, 0.3, 0],
  SLICE_TO: [number, number, number] = [1, -0.3, 0];

/** everything that changes the built shapes, the world, or the render pipeline */
export function structuralKeyOf(
  o: Pick<
    FrostOptions,
    | "headlines"
    | "text"
    | "quality"
    | "upscaler"
    | "renderScale"
    | "erosionResolution"
    | "shapeResolution"
    | "particleCount"
    | "logoUrl"
    | "deformation"
    | "logoMeshDetail"
  > & {
    shards: { strayDust: number; amount: number };
    tune: Record<string, number | string | boolean>;
  },
) {
  // dispersion and sprite see-through are compiled into the materials when non-zero (World key)
  return JSON.stringify([
    o.headlines,
    { ...o.text, meshDetail: resolveTextMeshDetail(o.text.meshDetail) },
    resolveDeformation(o.deformation),
    o.quality,
    o.upscaler,
    o.renderScale,
    o.shapeResolution ?? "256",
    o.erosionResolution,
    o.particleCount,
    o.logoUrl,
    resolveLogoMeshDetail(o.logoMeshDetail),
    o.shards.strayDust,
    Number(o.tune.spriteSeeThrough ?? APPEARANCE_DEFAULTS.spriteSeeThrough) > 0,
  ]);
}

export function create(o: FrostOptions): FrostInstance {
  o = {
    ...o,
    logoMeshDetail: resolveLogoMeshDetail(o.logoMeshDetail),
    text: { ...o.text, meshDetail: resolveTextMeshDetail(o.text.meshDetail) },
  };
  let world: World | null = null;
  let renderer: THREE.WebGPURenderer | null = null;
  let disposed = false;
  let simIndex = -1;
  let renderedIndex = -1;
  let lastTime = 0;
  let pendingGpu: Promise<void> | null = null;
  let requestedIndex = 0;
  let seekError: unknown = null;
  const log = (m: string) => {
    rwMetrics.stages.push([m, performance.now() - rwMetrics.start]);
    o.onProgress?.(m);
  };
  let S = o.schedule,
    P = o.pose,
    SH = o.shards;
  let cameraTrack = parseTrack(o.cameraTrack);
  const authored = () => o.cameraMode === "authored" && cameraTrack.keys.length > 0;
  const stationary = () => authored() && cameraTrack.objectMotion === "stationary";
  function syncCamera() {
    if (!world) return;
    world.onCameraTransform = authored()
      ? (t) => {
          if (world)
            applyCameraAt(
              world.camera,
              cameraTrack,
              t,
              world.objectGroup.matrixWorld,
              world.rig.lookAt,
            );
        }
      : null;
    if (!authored()) {
      world.camera.zoom = 1;
      world.camera.updateProjectionMatrix();
    }
  }
  const structuralKey = structuralKeyOf(o);

  // shapes: [logo, headline 1, headline 2] — geometries for the mesh, distance fields sharing one bound, and
  // the live field texture the GPU reads (its data is overwritten on every retarget)
  const geos: THREE.BufferGeometry[] = [];
  const sdfs: LogoSDF[] = [];
  /** every grain's home inside each shape (N x vec4: xyz + the grain's own threshold), computed once */
  const restSets: Float32Array[] = [];
  let live: LogoSDF | null = null;
  let current = -1;
  let logoRig: LogoRig | null = null;

  // ---------------------------------------------------------------------------------------------
  const setPath = (path: string[], value: number | string | boolean) => {
    let t: any = D;
    for (let i = 0; i < path.length - 1; i++) t = t[path[i]];
    t[path[path.length - 1]] = value;
  };
  function applyTune(tune: Record<string, number | string | boolean>) {
    for (const [id, v] of Object.entries({
      ...APPEARANCE_DEFAULTS,
      ...RETURN_GROUP_DEFAULTS,
      ...tune,
    })) {
      const spec = TUNABLES[id];
      if (spec && (typeof v === "string" || typeof v === "boolean" || Number.isFinite(v)))
        setPath(spec.path, v);
    }
  }

  // hero 07 / baked hero4 override layer (variants.tsx CameraJourney + baked.json hero4), minus the camera export
  function configure() {
    heroFrame.enabled = true;
    heroFrame.clickResets = true;
    heroFrame.shape = "logo";
    heroFrame.cursorErodes = true;
    heroFrame.hud = false;
    heroFrame.framing = true;
    // the object sits on the look-at point (hero4 raised it above a DOM headline; there is no DOM here)
    Object.assign(heroFrame, {
      distance: 13.45,
      height: 1.2,
      lookAtX: 0,
      lookAtY: 0.05,
      fov: 29.5,
      objectX: 0,
      objectY: 0.05,
      objectZ: 0,
      baseYaw: 0,
      basePitch: 0,
      rotateYaw: 40,
      rotatePitch: 45,
      parallaxRange: 15,
    });
    heroFrame.cameraOverride = null;
    D.shape.deformAmplitude = 0; // geometric deformation is baked before SDF creation, never applied twice
    D.camera.idleAmplitude = 0; // the composition owns the object's rotation
    const Pf = D.performance;
    Pf.adaptiveResolution = false;
    Pf.dynamicSceneResolution = false;
    Pf.sceneResolutionScale = Math.max(0.25, Math.min(1, o.renderScale));
    Pf.minSceneResolutionScale = Pf.sceneResolutionScale;
    Pf.upscaler = o.upscaler;
    Pf.nativePostEffects = true;
    Pf.upscaleSharpness = 1;
    Pf.minPixelRatio = o.previewPixelRatio ?? 2;
    D.post.pixelRatioCap = o.previewPixelRatio ?? 2;
    Pf.idleSkip = false;
    Pf.gpuTimers = false;
    D.debug.stats = false;
    D.debug.freeze = false;
    D.debug.forceStroke = false;
    D.shape.logo.sdfRes = [128, 256, 384].includes(Number(o.shapeResolution))
      ? Number(o.shapeResolution)
      : 256;
    D.erosion.resolution = o.erosionResolution;
    D.powder.particleCount = o.particleCount;
    D.powder.amount = SH.amount;
    D.powder.lostRadius = 80; // a shard 30 units out was snapped home mid-flight; the break throws them further than that
    D.powder.strayCount = Math.round(SH.strayDust); // the experiment's ambient dust ring stays where the object was; off by default
    // shards keep following the object group's motion (rotation and approach) for this long after they leave: the
    // experiment used 0.4 s, which made the cloud stop turning while the mark kept turning
    D.powder.inheritRotation = true;
    D.powder.inheritTime = SH.followObject * 1000;
    D.ice = { ...structuredClone(sourceMaterial.ice), features: { ...MATERIAL_FEATURES } };
    D.lighting = structuredClone(sourceMaterial.lighting);
    D.post = structuredClone(sourceMaterial.post);
    D.post.pixelRatioCap = o.previewPixelRatio ?? 2;
    D.post.grain.backgroundStrength = 0;
    D.powder.hazeIntensity = 0;
    D.ice.cracks.steps = 18;
    D.erosion.interiorSteps = 48;
    Pf.adaptiveSteps = sourceMaterial.performance.adaptiveSteps;
    applyTune(o.tune);
    if (o.quality === "lite") {
      // defaults.ts: `if (LITE) { ... }` — headless / software-GPU checks: shrink everything heavy after the tuned values
      D.shape.segments = 96;
      D.ice.cracks.steps = 6;
      D.ice.cracks.fineCracks = false; // Lite reduces cost without overriding the explicit dispersion control.
      D.erosion.resolution = "64";
      D.powder.particleCount = "100k";
      D.powder.densityGrid = "32";
      D.powder.hazeSteps = 8;
    }
    healOff();
  }
  /** shards stay out: nothing schedules a return (hero 07 baked: healDelay 0 / returnAfter 3 would pull them back at once) */
  function healOff() {
    D.healing.healDelay = 1e9;
    D.healing.returnAfter = 0;
    D.healing.waveTime = 0;
    D.version++;
  }
  /** shards fly home in a wave (nearest first), the field fills in behind them */
  function healOn() {
    D.healing.healDelay = 0;
    D.healing.returnAfter = 0;
    D.healing.waveTime = SH.formSpread;
    D.healing.fallbackHeal = SH.formFill;
    D.version++;
  }

  // ---------------------------------------------------------------------------------------------
  const ready = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (disposed) return;
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) throw new Error("Frost: navigator.gpu is unavailable (WebGPU required)");
    const adapter = await nav.gpu.requestAdapter().catch(() => null);
    if (!adapter) throw new Error("Frost: no WebGPU adapter");
    log("webgpu adapter");
    configure();

    const r = new THREE.WebGPURenderer({
      canvas: o.canvas,
      antialias: false,
      forceWebGL: false,
      powerPreference: "high-performance",
      trackTimestamp: false,
    } as any);
    await r.init();
    if ((r as any).backend?.isWebGLBackend)
      throw new Error("Frost: WebGPU backend unavailable, WebGL fallback is not supported");
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = D.lighting.shadow.intensity > 0; // baked 0: no shadow pass, no visible difference
    r.shadowMap.type = THREE.VSMShadowMap;
    r.setPixelRatio(1);
    r.setSize(o.width, o.height, false);
    renderer = r;
    log("renderer");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, o.width / o.height, 0.5, 80);
    camera.position.set(0, 1.2, 13.5);

    const logoParams = D.shape.logo as unknown as LogoParams;
    const Pd = D.powder;
    const count =
      { "100k": 100_000, "250k": 250_000, "500k": 500_000, "1M": 1_000_000 }[
        Pd.particleCount as string
      ] ?? 100_000;
    const deformation = resolveDeformation(o.deformation);
    const logoOnly = !!o.rig && !o.rig.sequence;
    const cacheKey = JSON.stringify([
      BUILD_VERSION,
      logoOnly,
      deformation,
      o.headlines,
      o.text,
      o.logoUrl,
      o.logoMeshDetail,
      logoParams,
      count,
      Pd.nearSurfaceFraction,
      Pd.nearSurfaceDepth,
      D.shape.seed,
      D.shape.size,
    ]);
    const blueNoise = await new THREE.TextureLoader()
      .loadAsync(assetUrl("textures/bluenoise64.png"))
      .then((tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = tex.magFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.NoColorSpace;
        return tex;
      });
    const fractureDetail = await new THREE.TextureLoader()
      .loadAsync(
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/assets/frost-sequence-camera-orbit/textures/ice-inclusions-generated.png",
      )
      .then((tex) => {
        tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.colorSpace = THREE.NoColorSpace;
        return tex;
      });
    let bound = 0;
    const cached = new URLSearchParams(location.search).has("fresh")
      ? null
      : await readBuild(cacheKey).catch(() => null);
    if (
      cached &&
      cached.geometries.length === (logoOnly ? 1 : 3) &&
      cached.sdfs.length === (logoOnly ? 1 : 3) &&
      cached.rests.length === (logoOnly ? 0 : 2)
    ) {
      for (const g of cached.geometries) geos.push(unpackGeometry(g));
      for (const s of cached.sdfs)
        sdfs.push(makeLogoSDF(s.data, s.res, s.bound, s.thickness, s.sampleBound));
      bound = cached.sdfs[0].bound;
      log("shapes (cached)");
    } else {
      const fontUrl = o.fontUrl.replace(
        /Geist-[A-Za-z]+\.ttf$/,
        `Geist-${o.text.weight === 400 ? "Regular" : o.text.weight === 600 ? "SemiBold" : "Bold"}.ttf`,
      );
      const [logoShapes, font] = await Promise.all([
        loadLogoShapes(o.logoUrl, logoParams),
        logoOnly ? Promise.resolve(null) : loadTypeface(fontUrl),
      ]);
      if (disposed) return;
      if (!logoShapes.length) throw new Error("Frost: the logo SVG produced no shapes");
      log("assets");
      // geometries: the mark exactly as the experiment builds it; the headlines through the same extrusion with
      // depth / bevel / corner relative to the font size and far fewer curve samples (glyph outlines are curves)
      geos.push(extrudeShapes(logoShapes, logoParams, logoParams.width));
      const textParams: LogoParams = {
        ...logoParams,
        depth: o.text.depth,
        bevelThickness: o.text.bevel,
        bevelSize: o.text.bevel * 0.8,
        bevelOffset: 0,
        cornerRadius: o.text.corner,
        curveSegments: 10,
        bevelSegments: 4,
      };
      for (const lines of logoOnly ? [] : o.headlines) {
        const clean = lines.map((l) => l.trim()).filter(Boolean);
        if (!clean.length) clean.push(" ");
        const widest = Math.max(
          0.001,
          ...clean.map((l) => lineWidth(font, l, o.text.letterSpacing)),
        );
        const size = o.text.width / widest;
        geos.push(
          extrudeShapes(
            textShapes(font, clean, size, o.text.lineHeight, o.text.letterSpacing),
            textParams,
            size,
          ),
        );
      }
      // Bake once before voxelization: render mesh, erosion SDF and all shard homes share this surface.
      for (let i = 0; i < geos.length; i++) {
        const source = geos[i];
        log(i === 0 ? "logo geometry" : `text mesh ${i}/2 · detail ${o.text.meshDetail}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (disposed) return;
        geos[i] = deformGeometry(
          source,
          deformation,
          logoParams.creaseAngle,
          i === 0 ? undefined : o.text.meshDetail,
          i === 0 ? o.logoMeshDetail : undefined,
        );
        if (i > 0)
          log(`text mesh ${i}/2 · ${geos[i].getAttribute("position").count / 3} triangles`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (geos[i] !== source) source.dispose();
      }
      for (const g of geos) {
        const h = halfExtents(g);
        bound = Math.max(bound, h.x, h.y, h.z);
      }
      bound *= 1.15;
      for (const g of geos) {
        const h = halfExtents(g);
        const sampleBound = Math.max(h.x, h.y, h.z) * 1.15;
        sdfs.push(
          RW.gpu
            ? await voxelizeGPU(r, g, bound, logoParams.sdfRes, sampleBound)
            : voxelize(g, bound, logoParams.sdfRes, sampleBound),
        );
        await new Promise((res) => setTimeout(res, 0));
      }
      if (disposed) return;
      log("shapes");
    }
    // the live field is its own copy: retargeting overwrites it, never the per-shape sources
    live = makeLogoSDF(
      sdfs[0].data.slice(),
      sdfs[0].res,
      bound,
      sdfs[0].thickness,
      sdfs[0].sampleDomain.value,
    );
    // the erodable shell just outside the surface must cover the distance field's own error at any field resolution
    ErosionField.extraShell = ((2 * bound) / logoParams.sdfRes) * 2.0;

    // mesh geometries the way World.build makes them (a scaled clone)
    const size = D.shape.size;
    const rawGeos = geos.slice();
    for (let i = 0; i < geos.length; i++) {
      const g = geos[i].clone();
      g.scale(size, size, size);
      geos[i] = g;
    }

    world = new World(
      r,
      scene,
      camera,
      blueNoise,
      { sdf: live, geometry: geos[0] },
      fractureDetail,
    );
    world.onObjectTransform = (t) => {
      if (!world) return;
      if (logoRig) {
        logoRig.pose(t);
        return;
      }
      const frame = objectFrameAt(t, S, P, current, stationary());
      world.motionGroup.quaternion.copy(frame.rotation);
      world.motionGroup.position.copy(frame.position);
      world.objectGroup.quaternion.copy(frame.facing);
    };
    current = 0;
    syncCamera();
    // grain homes per shape: the mark keeps the ones the powder was built with; a headline is sampled inside its
    // own box with the same class layout (thresholds and strays untouched)
    const pw = world.powder;
    restSets.push(pw.restInit.slice());
    if (cached && cached.rests.length === 2) {
      for (const cr of cached.rests) {
        const rest = pw.restInit.slice();
        rest.set(cr.subarray(0, pw.count * 4));
        restSets.push(rest);
      }
    } else {
      for (let k = 1; k < geos.length; k++) {
        const spec = makeShape("logo", D.shape.size, D.shape.tubeRatio, sdfs[k]);
        const h = halfExtents(rawGeos[k]);
        const samples = sampleInterior(
          spec,
          pw.count,
          Pd.nearSurfaceFraction,
          Pd.nearSurfaceDepth,
          rng(D.shape.seed + 101 + k),
          [(h.x + 0.05) * size, (h.y + 0.05) * size, (h.z + 0.05) * size],
        );
        const rest = pw.restInit.slice();
        for (let i = 0; i < pw.count; i++) {
          rest[i * 4] = samples.positions[i * 3];
          rest[i * 4 + 1] = samples.positions[i * 3 + 1];
          rest[i * 4 + 2] = samples.positions[i * 3 + 2];
        }
        restSets.push(rest);
        await new Promise((res) => setTimeout(res, 0));
      }
      if (!new URLSearchParams(location.search).has("fresh"))
        writeBuild(cacheKey, {
          geometries: rawGeos.map(packGeometry),
          sdfs: sdfs.map((s) => ({
            data: s.data,
            res: s.res,
            bound: s.bound,
            thickness: s.thickness,
            sampleBound: s.sampleDomain.value,
          })),
          rests: restSets.slice(1).map((r) => r.slice(0, pw.count * 4)),
        }).catch(() => {});
    }
    if (o.rig) logoRig = new LogoRig(world, { ...o.rig, retarget: (k) => retarget(k, true) });
    (window as any).__fb = { world, renderer: r, D, sim, clock };
    log("world");
  })();

  // ---------------------------------------------------------------------------------------------
  // object motion: ONE continuous path. yaw(t) = constant drift + idle sway + a smooth turn step per break
  // with matched velocity and acceleration at the boundaries; pitch and depth rise through the
  // break and ease back during formation. The continuous drift runs underneath. A headline faces the camera by construction: its object
  // frame carries the inverse of this rotation at the moment its formation settles (see retarget), so the
  // group can keep turning and the text still lands square to the camera.
  let poseAt = makePoseAt(S, P);
  function rebuildKeys() {
    poseAt = makePoseAt(S, P);
  }
  /** rotation of the motion group at time t */
  const rotationAt = (t: number) => {
    const p = poseAt(t);
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(p.pitch), THREE.MathUtils.degToRad(p.yaw), 0, "YXZ"),
    );
  };
  /** facing offset for shape k: the inverse of the group rotation when its formation has settled */
  const facingOffset = new THREE.Quaternion();
  function offsetFor(k: number) {
    if (k === 0 || stationary()) return new THREE.Quaternion();
    const t = k === 1 ? S.form1 + SETTLE : S.form2 + SETTLE;
    return rotationAt(t).invert();
  }

  // ---------------------------------------------------------------------------------------------
  // shape retargeting: the live field texture takes shape k's distances, the mesh takes its geometry, the field
  // is re-baked and starts fully eroded (a headline) or solid (the mark), and every grain gets a home inside it
  function retarget(k: number, fill: boolean) {
    if (!world || !renderer || !live) return;
    const src = sdfs[k];
    if (k !== current) {
      live.data.set(src.data);
      live.sampleDomain.value = src.sampleDomain.value;
      if (live.sampleBoundNode) live.sampleBoundNode.value = src.sampleDomain.value;
      live.texture.needsUpdate = true;
      live.thickness = src.thickness;
      world.shape = makeShape("logo", D.shape.size, D.shape.tubeRatio, live);
      world.mesh.geometry = geos[k];
      current = k;
    }
    // the new shape faces the camera once its formation settles, whatever the group is doing: apply the inverse
    // rotation now (nothing is visible), and make sure the jump is not read as one frame of object motion
    facingOffset.copy(o.rig ? new THREE.Quaternion() : offsetFor(k));
    world.objectGroup.quaternion.copy(facingOffset);
    world.motionGroup.updateMatrixWorld(true);
    world.powder.syncModel();
    world.erosion.rebake(renderer, fill);
    world.powder.retarget(renderer, restSets[k]);
  }
  /** the diagonal slice through the shape (hero 07 auto sweep) */
  function slice(final = false) {
    if (!world || !renderer) return;
    healOff();
    world.erosion.u.reconstruct.value = 0;
    D.powder.repelFromObject = true; // the shape is solid: shards are pushed out of it while it breaks
    // the last break clears the frame: shards leave faster and the speed cap goes up with them
    const boost = final ? SH.finalEjectBoost : 1;
    D.powder.ejectSpeed = Number(o.tune.ejectSpeed) * boost;
    D.powder.maxSpeed = Number(o.tune.maxSpeed) * boost;
    D.powder.minEjectSpeed = 0.66 * boost;
    D.version++;
    world.powder.restoreThresholds(renderer);
    world.interaction.sweep({
      from: SLICE_FROM,
      to: SLICE_TO,
      duration: 0.7,
      radius: SH.sliceRadius,
      strength: SH.sliceStrength,
    });
  }
  /** the break continues from the slice: parallel slices march outward on alternating sides, one after another,
   *  spaced so they overlap, spread over `breakDuration` */
  function shatter() {
    if (!world) return;
    const B = world.shape.bound;
    const dx = SLICE_TO[0] - SLICE_FROM[0],
      dy = SLICE_TO[1] - SLICE_FROM[1],
      len = Math.hypot(dx, dy);
    const nx = -dy / len,
      ny = dx / len;
    const spacing = Math.max(0.15, SH.shatterRadius * 1.7) / B; // in bound fractions
    const perSide = Math.max(1, Math.ceil(1.25 / spacing));
    const interval = SH.breakDuration / (perSide * 2);
    let i = 0;
    for (let k = 1; k <= perSide; k++) {
      for (const side of [1, -1]) {
        const off = side * k * spacing;
        world.interaction.sweep({
          from: [SLICE_FROM[0] + nx * off, SLICE_FROM[1] + ny * off, 0],
          to: [SLICE_TO[0] + nx * off, SLICE_TO[1] + ny * off, 0],
          duration: 0.5,
          delay: i * interval,
          radius: SH.shatterRadius,
          strength: SH.shatterStrength,
        });
        i++;
      }
    }
  }
  /** whatever the front missed: the field is set fully eroded and the last dormant grains leave too */
  function finishShatter() {
    if (!world || !renderer) return;
    renderer.compute((world.erosion as any).fillNode);
    // nothing is left to repel from: with it on, the invisible shape's pockets and hole trap shards
    D.powder.repelFromObject = false;
    D.version++;
  }
  function form(k: number) {
    if (!world) return;
    world.powder.u.assemblyEnd.value = (k === 1 ? S.break1 : S.break2) - 0.65;
    retarget(k, true);
    sim.lastStrokeT = clock.t; // the fallback fill-in waits for the wave to land (ErosionField.step)
    healOn();
  }
  function startFade() {
    if (!world) return;
    healOff();
    world.mesh.visible = false;
    D.healing.resetFade = FADE_DURATION * 1000;
    sim.resetRequestedAt = clock.t;
  }

  function reset() {
    if (!world) return;
    renderedIndex = -1;
    D.powder.repelFromObject = true;
    world.resetSim();
    world.interaction.clearScripted();
    facingOffset.identity();
    retarget(0, false);
    // A sequence may have left another shape's rest positions in the buffer.
    // Reset positions after restoring the logo homes, including invisible grains.
    if (o.rig?.sequence && renderer) world.powder.reset(renderer);
    healOff();
    D.healing.resetFade = 50;
    input.inside = false;
    input.x = 0;
    input.y = 0;
    input.lastMoveT = 0;
    input.moved = false;
    logoRig?.reset();
    simIndex = 0;
  }

  /** One fixed step ending at `st`, firing every event scheduled inside (prev, st]. */
  function step(index: number, render: boolean) {
    if (!world) return;
    const st = index * SIM_STEP;
    if (logoRig) {
      setIceFrameIndex(index);
      world.frame(st, SIM_STEP, render);
      return;
    }
    clock.t = st;
    // integer-exact: an event fires in the step whose index its time rounds to (no float-boundary misses)
    const at = (time: number) => Math.round(time / SIM_STEP) === index;
    for (const b of [S.logoBreak, S.break1, S.break2]) {
      if (at(b)) slice(b === S.break2);
      if (at(b + 0.3)) shatter();
      if (at(b + 0.3 + SH.breakDuration + 0.5)) finishShatter();
    }
    if (at(S.form1)) form(1);
    if (at(S.form2)) form(2);
    if (at(S.fadeOut)) startFade();
    setIceFrameIndex(index);
    world.frame(st, SIM_STEP, render);
  }

  async function drainSeeks() {
    // Small batches bound main-thread work and GPU queue depth. New slider requests
    // replace obsolete targets at a batch boundary; fixed simulation steps stay exact.
    let activeTarget = -1,
      firstRender = 0;
    while (!disposed && world && renderer) {
      const target = requestedIndex;
      if (simIndex < 0 || target < simIndex) reset();
      if (target !== activeTarget) {
        firstRender = target - simIndex > 60 ? target - WARMUP_RENDERS : target;
        activeTarget = target;
      }
      const end = Math.min(target, simIndex + 8);
      if (target === simIndex && renderedIndex !== target) {
        setIceFrameIndex(target);
        // Warm the post-processing history for a cold, paused first frame too.
        // This keeps direct seeks to zero consistent with playback and capture.
        const passes = o.rig && target === 0 && renderedIndex < 0 ? WARMUP_RENDERS : 1;
        for (let pass = 0; pass < passes; pass++) world.frame(target * SIM_STEP, 0, true);
        renderedIndex = target;
      }
      while (simIndex < end) {
        simIndex++;
        const render = simIndex === target || simIndex > firstRender;
        step(simIndex, render);
        if (render) renderedIndex = simIndex;
      }
      const queue = (renderer as any).backend?.device?.queue;
      if (queue?.onSubmittedWorkDone) await queue.onSubmittedWorkDone();
      if (disposed) return;
      if (simIndex === requestedIndex && renderedIndex === requestedIndex) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  function renderAt(t: number) {
    if (disposed) return;
    lastTime = Number.isFinite(t) ? Math.max(0, Math.min(o.rig?.duration ?? durationOf(S), t)) : 0;
    requestedIndex = Math.round(lastTime / SIM_STEP);
    if (!world || !renderer || pendingGpu) return;
    seekError = null;
    pendingGpu = Promise.resolve()
      .then(drainSeeks)
      .catch((error) => {
        seekError = error;
        console.error("Frost seek failed", error);
      })
      .finally(() => {
        pendingGpu = null;
      });
  }

  /** Material-only changes redraw without advancing the simulation. */
  function redraw() {
    renderedIndex = -1;
    renderAt(lastTime);
  }

  function applyOptions(
    next: Pick<
      FrostOptions,
      "schedule" | "pose" | "shards" | "tune" | "cameraMode" | "cameraTrack"
    >,
    key: string,
  ): "live" | "rebuild" {
    if (key !== structuralKey) return "rebuild";
    let replay = false;
    const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(next.schedule, S) || !same(next.pose, P)) replay = true;
    const wasStationary = stationary();
    cameraTrack = parseTrack(next.cameraTrack);
    o.cameraTrack = cameraTrack;
    o.cameraMode = next.cameraMode;
    if (wasStationary !== stationary()) replay = true;
    syncCamera();
    if (!same(next.shards, SH)) replay = true;
    for (const [id, v] of Object.entries(next.tune)) {
      if (o.tune[id] !== v) {
        const spec = TUNABLES[id];
        if (spec) {
          setPath(spec.path, v);
          if (spec.replay) replay = true;
        }
      }
    }
    o.schedule = S = next.schedule;
    o.pose = P = next.pose;
    o.shards = SH = next.shards;
    o.tune = { ...next.tune };
    D.powder.amount = SH.amount;
    D.powder.inheritTime = SH.followObject * 1000;
    D.version++;
    rebuildKeys();
    if (!world) return "live";
    if (replay) {
      simIndex = -1;
      renderedIndex = -1;
      renderAt(lastTime);
    } else redraw();
    return "live";
  }

  async function waitForGpu() {
    await ready;
    while (pendingGpu) await pendingGpu;
    if (seekError) throw seekError;
  }

  function dispose() {
    disposed = true;
    world?.dispose();
    world = null;
    logoRig?.dispose();
    for (const s of sdfs) s.texture.dispose();
    live?.texture.dispose();
    live = null;
    for (const g of geos) g.dispose();
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    heroFrame.enabled = false;
    heroFrame.shape = null;
    heroFrame.cameraOverride = null;
    delete (window as any).__fb;
  }

  return {
    ready,
    renderAt,
    redraw,
    invalidate: () => {
      simIndex = -1;
      renderedIndex = -1;
    },
    waitForGpu,
    poseAt: (t: number) => poseAt(t),
    applyOptions,
    structuralKey,
    get world() {
      return world;
    },
    get shape() {
      return current;
    },
    dispose,
  };
}
