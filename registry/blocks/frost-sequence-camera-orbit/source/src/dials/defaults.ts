// Every tunable in this piece lives here as a DialKit config.
// Baking chosen values = editing the first element of each tuple.
import type { DialConfig } from "dialkit";
const sel = <T extends string>(def: T, options: readonly T[]) => ({
  type: "select" as const,
  options: options as unknown as string[],
  default: def,
});
/** `?lite=1` lowers every heavy default (used for headless technical checks on software WebGPU). */
export const LITE =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("lite");

export const presetsDefaults = {
  copyAllJson: { type: "action" as const, label: "Copy all params as JSON" },
} satisfies DialConfig;

export const SHAPES = ["torus", "sphere", "roundedBox", "pyramid", "icosahedron", "logo"] as const;
export type ShapeName = (typeof SHAPES)[number];

export const shapeDefaults = {
  shape: sel("torus", SHAPES),
  size: [1.0, 0.5, 1.6, 0.01],
  tubeRatio: [0.45, 0.2, 0.7, 0.005],
  deformAmplitude: [0.045, 0, 0.2, 0.001],
  deformFrequency: [1.1, 0.3, 4, 0.05],
  segments: [256, 64, 512, 8],
  seed: [7, 0, 999, 1],
  // world-space offset of the object (hero pages override this from their own panel)
  offsetX: [0, -5, 5, 0.01],
  offsetY: [0, -4, 4, 0.01],
  offsetZ: [0, -4, 4, 0.01],
  // extrusion of /public/logo.svg when shape = logo (fractions are relative to `logo.width`)
  logo: {
    _collapsed: true,
    width: [2.6, 0.8, 5, 0.05],
    depth: [0.22, 0.02, 1, 0.005],
    bevelThickness: [0.06, 0, 0.3, 0.002],
    bevelSize: [0.05, 0, 0.3, 0.002],
    bevelOffset: [0, -0.1, 0.1, 0.002],
    bevelSegments: [5, 1, 16, 1],
    cornerRadius: [0.03, 0, 0.15, 0.001],
    curveSegments: [24, 2, 64, 1],
    creaseAngle: [40, 0, 180, 1],
    sdfRes: [64, 32, 128, 8],
  },
} satisfies DialConfig;

export const iceDefaults = {
  ior: [1.36, 1.0, 2.0, 0.005],
  dispersion: [0, 0, 0.3, 0.005],
  thicknessScale: [1.0, 0.1, 3, 0.01],
  attenuationDistance: [0.9, 0.05, 5, 0.01],
  attenuationColor: "#cfd2d4",
  baseRoughness: [0.05, 0, 0.5, 0.005],
  frost: {
    scale: [1.6, 0.2, 6, 0.05],
    threshold: [0.5, 0, 1, 0.01],
    softness: [0.28, 0.01, 1, 0.01],
    roughness: [0.65, 0, 1, 0.01],
    diffuse: [0.55, 0, 1, 0.01],
    crystalBump: [0.12, 0, 1, 0.01],
    crystalScale: [28, 4, 80, 1],
  },
  cracks: {
    largeScale: [1.6, 0.3, 8, 0.05],
    warp: [0.45, 0, 1.5, 0.01],
    warpScale: [1.4, 0.2, 6, 0.05],
    coverage: [0.55, 0, 1, 0.01],
    regionScale: [0.8, 0.1, 4, 0.05],
    regionCoverage: [0.7, 0, 1, 0.01],
    veinScale: [5, 1, 20, 0.25],
    veinContrast: [0.7, 0, 1, 0.01],
    width: [0.004, 0.0005, 0.02, 0.0005],
    brightness: [0.4, 0, 3, 0.01],
    darkness: [0.5, 0, 1, 0.01],
    refraction: [0.02, 0, 0.1, 0.001],
    surfaceStrength: [0.35, 0, 1, 0.01],
    steps: [14, 4, 32, 1],
    fineCracks: true,
    fineScale: [5.5, 2, 20, 0.1],
    fineAmount: [0.45, 0, 1, 0.01],
    fineCoverage: [0.35, 0, 1, 0.01],
    fineNearLarge: [0.75, 0, 1, 0.01],
  },
  smudges: {
    amount: [0.6, 0, 1, 0.01],
    coverage: [0.55, 0, 1, 0.01],
    maskScale: [1.2, 0.1, 6, 0.05],
    anisotropy: [6, 1, 20, 0.5],
    roughness: [0.35, 0, 1, 0.01],
    whiteness: [0.08, 0, 0.5, 0.005],
    scale: [3.2, 0.5, 10, 0.1],
  },
  bumps: {
    microBump: [0.25, 0, 1, 0.005],
    microScale: [60, 10, 200, 1],
    microCoverage: [0.6, 0, 1, 0.01],
    rippleBump: [0.3, 0, 1, 0.01],
    rippleScale: [9, 2, 30, 0.5],
    maskScale: [1.5, 0.1, 6, 0.05],
  },
  // emissive glow of partially eroded (crumbling) ice along the view ray; the old value was 1 and blew out
  crumbleGlow: [0.15, 0, 2, 0.01],
  // how much the crumbly edge band around a cut whitens and opacifies the ice (0 = stays glassy)
  edgeWhiteness: [0.5, 0, 1, 0.01],
  clearcoat: [0.3, 0, 1, 0.01],
  clearcoatRoughness: [0.08, 0, 1, 0.005],
  envIntensity: [0.55, 0, 3, 0.01],
  specularIntensity: [1.0, 0, 2, 0.01],
  interiorScatter: [0.25, 0, 1, 0.01],
} satisfies DialConfig;

export const erosionDefaults = {
  resolution: sel("128", ["64", "96", "128", "192"] as const),
  brushRadius: [0.28, 0.05, 0.8, 0.005],
  brushSoftness: [0.5, 0, 1, 0.01],
  brushStrength: [2.2, 0.1, 8, 0.05],
  brushSpeedRef: [3.0, 0.2, 12, 0.1],
  brushNoise: [0.55, 0, 1, 0.01],
  brushNoiseScale: [9, 2, 30, 0.5],
  throughDepth: [1.0, 0, 1, 0.01],
  // ice breaks along cells: the brush is evaluated per break cell (flat facets) and mixed with the smooth capsule
  cellSnap: [0.85, 0, 1, 0.01],
  breakCellScale: [3.0, 0.5, 8, 0.1],
  crumbleRate: [1.6, 0, 6, 0.05],
  crumbleCrackBias: [2.5, 0, 6, 0.05],
  crumbleDuration: [0.5, 0, 2, 0.01],
  // the surface is gone where erosion exceeds cutThreshold (narrow stochastic transition, resolved by TRAA);
  // the crumbly edge band sits just below it, edgeWidth wide
  cutThreshold: [0.7, 0.3, 0.98, 0.01],
  cutSoftness: [0.04, 0.005, 0.3, 0.005],
  edgeWidth: [0.35, 0.05, 0.8, 0.01],
  // the cut surface seen through a hole: ray-march steps through the field, and extra frost on the fresh break
  interiorSteps: [24, 8, 64, 1],
  interiorFrost: [0, 0, 1, 0.01],
  edgeInset: [0.06, 0, 0.3, 0.005],
  edgeBump: [0.6, 0, 2, 0.01],
  edgeBumpScale: [55, 10, 160, 1],
} satisfies DialConfig;

export const powderDefaults = {
  particleCount: sel("1M", ["100k", "250k", "500k", "1M", "2M"] as const),
  // fraction of the eroded volume that becomes visible powder (the rest simply vanishes)
  amount: [0.3, 0.02, 1, 0.01],
  grainSizeMultiplier: [1.0, 0.2, 4, 0.05],
  // where the interior sample points sit: fraction placed within `nearSurfaceDepth` of the surface
  nearSurfaceFraction: [0.6, 0, 1, 0.01],
  nearSurfaceDepth: [0.2, 0.05, 0.5, 0.01],
  grainSizes: {
    // four classes, tiny -> large; the ratios are normalised, the leftover ~1% is large fragments
    tinyDustRatio: [0.7, 0, 1, 0.01],
    smallGrainRatio: [0.22, 0, 1, 0.01],
    mediumClumpRatio: [0.07, 0, 1, 0.01],
    tinyDustSize: [0.0055, 0.001, 0.03, 0.0005],
    smallGrainSize: [0.011, 0.002, 0.05, 0.0005],
    mediumClumpSize: [0.022, 0.005, 0.1, 0.001],
    largeFragmentSize: [0.05, 0.01, 0.2, 0.001],
    sizeJitter: [0.45, 0, 1, 0.01],
  },
  grainVariants: [5, 1, 6, 1],
  // flat-shaded low-poly splinters instead of smooth blobs (each face catches the key light separately)
  facetedGrains: false,
  // grains never render below this many pixels (sub-pixel dust flickers under TRAA)
  minPixelSize: [1.5, 0, 4, 0.05],
  ejectSpeed: [1.1, 0, 4, 0.01],
  // grains released after the cursor stopped (crumble) still get at least this kick, units/s
  minEjectSpeed: [1.0, 0, 4, 0.01],
  ejectSpread: [0.5, 0, 3, 0.01],
  ejectTurbulence: [0.8, 0, 4, 0.01],
  backwardRatio: [0.25, 0, 1, 0.01],
  clumpSpeedJitter: [0.5, 0, 1, 0.01],
  drag: [1.4, 0, 8, 0.01],
  gravity: [0.12, 0, 2, 0.005],
  turbulence: [0.9, 0, 4, 0.01],
  turbulenceScale: [1.8, 0.2, 8, 0.05],
  turbulenceDecay: [0.6, 0.05, 4, 0.01],
  clumpCohesion: [2.4, 0, 10, 0.05],
  clumpCount: [24000, 500, 100000, 500],
  settleTime: [3.2, 0.3, 12, 0.05],
  settledDrift: [0.012, 0, 0.1, 0.001],
  tumble: [2.5, 0, 12, 0.05],
  baseTone: "#dcdcdc",
  wrap: [0.45, 0, 1, 0.01],
  // ice-shard look of the grains: the backdrop shows through their centres, rims stay bright (Fresnel),
  // real specular / clearcoat from the lights, and per-grain sparkle
  fragments: {
    translucency: [0.6, 0, 1, 0.01],
    throughTint: "#aeb6bb",
    fresnelPower: [3, 0.5, 8, 0.1],
    roughness: [0.32, 0, 1, 0.01],
    clearcoat: [0.6, 0, 1, 0.01],
    specular: [1.0, 0, 3, 0.01],
    sparkle: [0.6, 0, 3, 0.01],
    sparkleFraction: [0.35, 0, 1, 0.01],
    sparkleSpread: [0.5, 0, 1.5, 0.01],
  },
  // repulsion from the object: an acceleration away from the surface (full strength inside, smooth
  // falloff over repelRange outside), added to the other forces so grains drift out organically
  // shard sprites: every grain is a camera-facing quad textured from the shard atlas (16 photographed-looking
  // ice shards: silhouette, bevel normal map, frost structure, thickness). Off = the low-poly mesh grains.
  sprites: {
    enabled: true,
    sizeScale: [1.4, 0.3, 4, 0.05],
    // random tilt off the camera plane (degrees): 0 = flat billboards, more = thinner, more varied shards
    tilt: [30, 0, 70, 1],
    normalStrength: [1, 0, 2.5, 0.05],
    // how much the atlas' frost structure drives the look (0 = every shard clear glass)
    frostFromAtlas: [1, 0, 1, 0.01],
    frostBoost: [0.35, 0, 1.5, 0.01],
    frostRoughness: [0.7, 0, 1, 0.01],
    // key light caught by the thin bevelled rim
    edgeLight: [0.6, 0, 3, 0.01],
    alphaCut: [0.2, 0.05, 0.6, 0.01],
    // real transparency: how much the clear parts of a shard show what is behind them (rebuilds the powder)
    seeThrough: [0, 0, 1, 0.01],
  },
  repelFromObject: false,
  repelStrength: [6, 0, 30, 0.1],
  repelRange: [0.35, 0.02, 2, 0.01],
  // plus a push straight away from the object's centre, so grains never settle in concave pockets of
  // the shape (the surface-normal push alone balances out inside a pocket); range in object radii
  repelRadial: [12, 0, 60, 0.5],
  repelRadialRange: [1.6, 1, 4, 0.05],
  // hard cap on grain speed (units/s): repulsion and ejection can never fling a grain off-screen
  maxSpeed: [8, 1, 40, 0.1],
  // a grain farther than this from the object (world units, far off screen) is brought back to its rest
  lostRadius: [30, 5, 100, 1],
  densityShadowStrength: [0.75, 0, 2, 0.01],
  densityAOStrength: [0.55, 0, 2, 0.01],
  densityGrid: sel("64", ["32", "48", "64"] as const),
  densityExtent: [4.2, 2, 10, 0.1],
  hazeIntensity: [0.22, 0, 1.5, 0.005],
  hazeSteps: [28, 8, 64, 1],
  inheritRotation: true,
  inheritTime: [220, 0, 1500, 10],
  strayCount: [40, 0, 200, 1],
  straySpeed: [0.06, 0, 0.5, 0.005],
  fragmentShadowMap: true,
} satisfies DialConfig;

export const healingDefaults = {
  healDelay: [3.5, 0, 12, 0.1],
  // a grain also turns back on its own this long after it left (0 = only when the cursor is idle),
  // so pieces keep cycling while you keep breaking
  returnAfter: [3.0, 0, 20, 0.1],
  // grains fly home in a wave: the ones closest to the object first, the far plume last, spread over
  // waveTime (a grain waveReach units away waits the full waveTime)
  waveTime: [2.0, 0, 8, 0.05],
  waveReach: [3.0, 0.2, 10, 0.1],
  waveJitter: [0.6, 0, 3, 0.05],
  // return motion: 'spring' = a damped spring toward the rest that ramps in while the grain is still
  // flying out (continuous decelerate / turn / accelerate back); 'path' = the eased curved path
  returnMode: sel("spring", ["spring", "path"] as const),
  returnSpring: [6, 0.5, 40, 0.1],
  returnDamping: [0.9, 0.2, 2, 0.01],
  returnRamp: [0.6, 0, 3, 0.05],
  // share of the powder drag that still acts during the spring return (absorbs ballistic speed)
  returnDrag: [0.25, 0, 1, 0.01],
  // speed cap on the way home (world units / s): keeps far grains visible instead of crossing the screen in a frame
  returnMaxSpeed: [12, 1, 60, 0.5],
  landRadius: [0.03, 0.005, 0.2, 0.005],
  returnDuration: [2.4, 0.2, 8, 0.05],
  returnCurve: [0.35, 0, 1.5, 0.01],
  // a landing grain restores its whole break cell (the facet it broke out of) at this rate (1/s; 30 = instant)
  cellRestore: [30, 0, 60, 0.5],
  // a break cell refills only once all its grains are home; allow this many still in flight
  cellStragglers: [0, 0, 20, 1],
  // the refilling cell grows back from what is already solid (hole floor, walls, landed shards) at `cellRestore`,
  // one voxel layer at a time, instead of the whole facet popping in
  growFromEdges: true,
  // per-voxel timing variation of every refill, cleanup and refrost timer (0 = a break cell changes look all
  // at once, 1 = it dissolves in small patches); breakupScale sets the patch size (higher = smaller)
  breakup: [0.7, 0, 1, 0.01],
  breakupScale: [10, 1, 40, 0.5],
  // returning shards turn to lie flat on the surface they land on (0 = keep facing the camera)
  alignToSurface: [1, 0, 1, 0.01],
  // distance from home over which a shard turns (world units)
  alignDistance: [0.6, 0.05, 3, 0.01],
  // FROST: shape of the alignment over the flight home (1 = linear, < 1 early, > 1 late)
  alignCurve: [1, 0.2, 4, 0.05],
  // a landed shard lies on the surface until its voxel is solid again, then fades over this many seconds
  landedFade: [0.25, 0, 2, 0.01],
  // shrink a shard over the last part of its flight (0 = it arrives at full size)
  landShrink: [0, 0, 0.3, 0.005],
  // plus a small sphere of voxels around its rest position (in voxels); 0 = cells only
  depositRadius: [0.5, 0, 3, 0.25],
  // optional: hidden material comes back as extra dust materialising this far from the surface (0 = off;
  // it never rebuilds anything by itself, only the grains that flew out do)
  ghostReturnDistance: [0, 0, 1.5, 0.01],
  ghostFlightFraction: [0.45, 0.1, 1, 0.01],
  // voxels without a grain follow their healed neighbours at this rate, staying `healGap` behind
  healRate: [0.6, 0.02, 3, 0.01],
  healGap: [0.04, 0, 0.5, 0.01],
  // cleanup rate for voxels no grain came back to; starts only after the wave has fully landed
  fallbackHeal: [0.15, 0, 0.5, 0.005],
  refrostTime: [4.0, 0.2, 12, 0.1],
  refrostStrength: [0.3, 0, 1, 0.01],
  resetFade: [400, 50, 2000, 10],
} satisfies DialConfig;

export const lightingDefaults = {
  key: {
    color: "#ffffff",
    intensity: [3.2, 0, 12, 0.05],
    elevation: [62, 10, 89, 0.5],
    azimuth: [18, -90, 90, 0.5],
    size: [1.0, 0.2, 3, 0.01],
    hoverBoost: [0.06, 0, 0.3, 0.005],
  },
  fill: [0.18, 0, 1.5, 0.005],
  fillColor: "#ffffff",
  fillGroundColor: "#262626",
  rim: [0.9, 0, 5, 0.01],
  rimColor: "#ffffff",
  rimElevation: [55, 0, 89, 0.5],
  shadow: {
    intensity: [1.0, 0, 1, 0.01],
    softness: [6, 0, 24, 0.25],
    samples: [12, 1, 32, 1],
    mapSize: sel("2048", ["1024", "2048", "4096"] as const),
    bias: [-0.0006, -0.005, 0.005, 0.0001],
  },
  sway: { amplitude: [0.03, 0, 0.15, 0.001], period: [12, 2, 40, 0.5] },
  backdrop: {
    top: "#2a2a2a",
    mid: "#050505",
    bottom: "#030303",
    centerX: [0.5, 0, 1, 0.005],
    centerY: [1.02, 0.5, 1.5, 0.005],
    radius: [0.55, 0.1, 1.5, 0.005],
    falloff: [1.6, 0.5, 4, 0.01],
    noise: [1.0, 0, 3, 0.05],
  },
  envSoftbox: [1.0, 0, 3, 0.01],
  envRim: [0.5, 0, 3, 0.01],
  envFill: [0.12, 0, 1, 0.005],
} satisfies DialConfig;

export const cameraDefaults = {
  fov: [30, 15, 60, 0.5],
  distance: [13.5, 4, 24, 0.05],
  height: [1.2, -3, 6, 0.01],
  lookAtY: [-0.15, -2, 2, 0.01],
  parallaxRange: [3, 0, 10, 0.1],
  parallaxSmoothing: [0.8, 0.05, 3, 0.01],
  rotateYaw: [35, 0, 90, 0.5],
  rotatePitch: [10, 0, 45, 0.5],
  rotationLag: [1.2, 0.05, 4, 0.01],
  baseYaw: [0, -180, 180, 0.5],
  basePitch: [0, -90, 90, 0.5],
  idleDelay: [4, 0, 15, 0.1],
  idleAmplitude: [4, 0, 15, 0.1],
  idlePeriod: [24, 4, 80, 0.5],
} satisfies DialConfig;

export const postDefaults = {
  dof: {
    enabled: true,
    focusBias: [0, -3, 3, 0.01],
    aperture: [0.9, 0, 4, 0.01],
    range: [3.0, 0.2, 12, 0.05],
  },
  bloom: {
    threshold: [1.2, 0, 3, 0.01],
    intensity: [0.15, 0, 1.5, 0.005],
    radius: [0.15, 0, 1, 0.005],
  },
  monochrome: [1.0, 0, 1, 0.01],
  tonemap: sel("agx", ["agx", "aces", "neutral", "linear"] as const),
  exposure: [1.0, 0.1, 4, 0.01],
  contrast: [1.08, 0.6, 1.6, 0.005],
  blackLift: [0.02, 0, 0.1, 0.001],
  vignette: {
    strength: [0.2, 0, 1, 0.005],
    softness: [0.7, 0.1, 1.5, 0.005],
    radius: [0.85, 0.2, 1.6, 0.005],
  },
  grain: {
    strength: [0.03, 0, 0.15, 0.001],
    size: [1, 1, 4, 1],
    speed: [1, 0, 3, 0.05],
    shadowWeight: [0.8, 0, 1, 0.01],
    // background-only grain against banding in recorded video: amplitude (0.04 = about 10 grey levels), block
    // size in device pixels (use 3+ when the recording is downscaled), 0 speed = static (survives encoding best)
    backgroundStrength: [0, 0, 0.25, 0.001],
    backgroundSize: [2, 1, 8, 1],
    backgroundSpeed: [0, 0, 3, 0.05],
  },
  dither: true,
  aaMode: sel("traa", ["traa", "none"] as const),
  pixelRatioCap: [2, 0.5, 2, 0.25],
} satisfies DialConfig;

/** V2: real fragmentation. The object is pre-fractured into rigid chunks that fly out and come back. */
export const fractureDefaults = {
  chunks: [600, 40, 3000, 10],
  seed: [3, 0, 999, 1],
  // a chunk breaks off when the brush passes within brushRadius (+ this share of the chunk's size)
  hitPadding: [0.5, 0, 2, 0.05],
  eject: {
    speed: [2.6, 0, 10, 0.05],
    spread: [0.7, 0, 4, 0.05],
    spin: [5, 0, 20, 0.1],
    jitter: [0.45, 0, 1, 0.01],
    backwardRatio: [0.2, 0, 1, 0.01],
  },
  motion: {
    drag: [1.3, 0, 8, 0.01],
    angularDrag: [1.6, 0, 8, 0.01],
    gravity: [0.3, 0, 3, 0.01],
    turbulence: [1.2, 0, 6, 0.05],
    turbulenceScale: [1.4, 0.2, 6, 0.05],
    maxSpeed: [10, 1, 40, 0.1],
  },
  return: {
    // a chunk turns back this long after it broke off (jittered), or sooner when the cursor is idle
    returnAfter: [1.4, 0, 20, 0.05],
    returnJitter: [0.9, 0, 5, 0.05],
    idleDelay: [0.6, 0, 10, 0.05],
    spring: [14, 0.5, 60, 0.1],
    damping: [1.0, 0.2, 2, 0.01],
    ramp: [0.5, 0, 3, 0.05],
    rotationRate: [6, 0.5, 30, 0.1],
    snapDistance: [0.015, 0.002, 0.2, 0.001],
  },
  caps: {
    // inner (fracture) faces: fresh break = frosted, crumbly
    frost: [0.85, 0, 1, 0.01],
    roughness: [0.8, 0, 1, 0.01],
    grain: [0.5, 0, 2, 0.01],
    darken: [0.15, 0, 1, 0.01],
  },
} satisfies DialConfig;

export const performanceDefaults = {
  // Dynamic resolution now scales the expensive scene/MRT pass. When nativePostEffects is on the
  // final grade, vignette, grain and dither stay at the output DPR and only the 3D work is upscaled.
  adaptiveResolution: true,
  targetFps: [60, 30, 120, 1],
  minPixelRatio: [0.75, 0.5, 2, 0.05],
  sceneResolutionScale: [1, 0.5, 1, 0.05],
  dynamicSceneResolution: true,
  minSceneResolutionScale: [0.35, 0.25, 1, 0.05],
  upscaler: sel("taau", ["taau", "fsr1", "bilinear", "native"] as const),
  upscaleSharpness: [0.2, 0, 1, 0.05],
  nativePostEffects: true,
  idleSkip: false, // skip field / particle / haze / density work while nothing is happening (lossless)
  adaptiveSteps: false, // crack raymarch: fewer steps where the ice is thin (same step length as the thickest chord)
  voronoiCells: sel("27", ["27", "8"] as const), // 8 = jittered-lattice Voronoi, ~3x cheaper cracks, occasional phantom sheet
  hazeResolution: sel("full", ["full", "half", "quarter"] as const),
  turbulence: sel("full", ["full", "fast"] as const), // fast = swirl from one noise sample instead of a 6-sample curl
  gpuTimers: true,
} satisfies DialConfig;

export const debugDefaults = {
  _collapsed: true,
  showErosionSlice: false,
  erosionSliceZ: [0.5, 0, 1, 0.01],
  showDensityGrid: false,
  showHitPoints: false,
  colorByState: false,
  colorBySize: false,
  colorByAge: false,
  wireframe: false,
  freeze: false,
  stepOnce: { type: "action" as const, label: "Step one frame" },
  stats: true,
  forceStroke: false,
} satisfies DialConfig;

// ---------------------------------------------------------------------------------------------
// Baked overrides: paste a "Copy all params as JSON" export into ./baked.json and every default
// above is overridden at boot (tuple[0] / select default / plain value). Nothing persists otherwise.
import baked from "./baked.json";
function applyBaked(cfg: any, values: any) {
  if (!values || typeof values !== "object") return;
  for (const [k, v] of Object.entries(values)) {
    if (!Object.hasOwn(cfg, k) || k.startsWith("_")) continue;
    const c = cfg[k];
    if (Array.isArray(c)) {
      if (typeof v === "number") c[0] = v;
    } else if (c && typeof c === "object" && "type" in c) {
      if ((c as any).type !== "action") (c as any).default = v;
    } else if (c && typeof c === "object") applyBaked(c, v);
    else cfg[k] = v;
  }
}
/** Apply the baked values stored under `key` (e.g. a hero panel) to a DialKit config, in place. */
export function withBaked<T>(key: string, cfg: T): T {
  applyBaked(cfg, (baked as any)[key]);
  return cfg;
}
export const BAKED_FOLDERS: Record<string, any> = {
  shape: shapeDefaults,
  ice: iceDefaults,
  erosion: erosionDefaults,
  powder: powderDefaults,
  healing: healingDefaults,
  fracture: fractureDefaults,
  lighting: lightingDefaults,
  camera: cameraDefaults,
  post: postDefaults,
  performance: performanceDefaults,
  debug: debugDefaults,
};
for (const [folder, cfg] of Object.entries(BAKED_FOLDERS)) applyBaked(cfg, (baked as any)[folder]);
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("idleskip"))
  (performanceDefaults as any).idleSkip = true;
if (LITE) fractureDefaults.chunks[0] = 120;
if (LITE) {
  // headless / software-GPU checks: shrink everything heavy after the baked values are applied
  shapeDefaults.segments[0] = 96;
  iceDefaults.cracks.steps[0] = 6;
  (iceDefaults.cracks as any).fineCracks = false;
  iceDefaults.dispersion[0] = 0;
  erosionDefaults.resolution.default = "64";
  powderDefaults.particleCount.default = "100k";
  powderDefaults.densityGrid.default = "32";
  powderDefaults.hazeSteps[0] = 8;
}
