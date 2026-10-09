/** Shared interaction state written by the DOM layer and read by the render loop. */
export const input = {
  x: 0,
  y: 0, // normalized -1..1 (y up)
  px: 0,
  py: 0, // pixels
  inside: false, // pointer inside the viewport
  lastMoveT: 0, // clock time of last movement
  moved: false,
  clicked: false,
  uiHidden: false,
  overUi: false,
};

export const sim = {
  strokeActive: false, // cursor currently over the object with movement
  overObject: false,
  lastStrokeT: -1e9,
  healing: false,
  resetRequestedAt: -1, // clock time when a reset fade started, -1 when none
  fade: 1, // powder fade multiplier (reset)
  sceneFade: 1, // scene exposure multiplier (shape crossfade)
  hoverAmount: 0, // smoothed 0..1 hover feel
  fps: 0,
  frameMs: 0,
  pixelRatio: 1, // effective DPR of the heavy scene pass
  outputPixelRatio: 1, // DPR of the final post-processing output
  sceneResolutionScale: 1,
  gpuFrames: 0,
  gpuRenderMs: 0,
  gpuComputeMs: 0,
  fieldActive: true,
  powderActive: true,
  computeMs: 0,
  counts: { active: 0, healing: 0, dormant: 0, total: 0 },
  erosion: { max: 0, over50: 0, over90: 0, refrost: 0 },
};

/**
 * Per-page override layer used by the hero variants. Nothing here is set on `/`, which keeps the
 * experiment page exactly as tuned. Hero pages write into it every frame from their own DialKit panel.
 */
export const heroFrame = {
  enabled: false,
  clickResets: true,
  /** false = the hero keeps the shared Camera folder + Shape offsets (the page looks exactly like `/`) */
  framing: true,
  /** camera framing (replaces the Camera folder values while enabled) */
  distance: 13.5,
  height: 1.2,
  lookAtX: 0,
  lookAtY: -0.15,
  fov: 27,
  baseYaw: 0,
  basePitch: 0,
  rotateYaw: 35,
  rotatePitch: 10,
  parallaxRange: 3,
  /** world-space offset of the object (so it can sit right / left / cropped) */
  objectX: 0,
  objectY: 0,
  objectZ: 0,
  /** optional backdrop override (light variants) */
  backdrop: null as null | {
    top: string;
    mid: string;
    bottom: string;
    centerX: number;
    centerY: number;
    radius: number;
    falloff: number;
  },
  /** optional shape override (logo variant) */
  shape: null as null | string,
  /** while true the field never heals (scroll-driven erosion holds its state) */
  healSuspended: false,
  /** cursor erosion on/off (some variants only erode via scripted triggers) */
  cursorErodes: true,
  /** show the stats HUD on hero pages (off by default, the page is the point) */
  hud: false,
  /** Optional final camera transform used by scroll-driven camera exports after the normal object rig. */
  cameraOverride: null as null | ((camera: import("three/webgpu").PerspectiveCamera) => void),
  cameraProgress: 0,
  /** extrusion parameters for the logo shape (hero 4); a change reloads the mark */
  logoParams: null as null | Record<string, number>,
};
