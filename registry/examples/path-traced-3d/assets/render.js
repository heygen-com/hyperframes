// Draws the scene for HyperFrames, rasterized for quick previews or path traced for export.
//
// - Setup is one `window.__hf.buildReady` promise; the first seek waits for it.
// - Each `hf-seek` registers its frame with `event.detail.waitUntil`, so a frame is captured
//   only once every sample for it is done.
// - Every new time starts a fresh accumulation with the same noise, so a time gives the same
//   pixels whatever was drawn before it. Seeking again to the time on screen does no work.
import * as THREE from "./vendor/three-path-tracer.min.js";
import { createScene } from "./scene.js";

const READY_KEY = "path-traced-3d";
const root = document.querySelector("[data-composition-id]");
const canvas = document.getElementById("pt-canvas");
const width = Number(root.dataset.width);
const height = Number(root.dataset.height);

const variables = window.__hyperframes?.getVariables?.() ?? {};
const mode = variables.renderer === "path" ? "path" : "raster";
const samples = Math.max(1, Math.round(Number(variables.samples) || 64));
const bounces = Math.max(1, Math.round(Number(variables.bounces) || 4));

// While HyperFrames renders, the clock stands still and requestAnimationFrame callbacks wait
// until the first seek, and that seek waits for setup. So nothing here waits on a frame, the
// clock or a timer of its own, and nothing starts a render loop: setup and seeks only await
// the libraries' own promises, and every frame is drawn from the seek time alone.

// three-gpu-pathtracer 0.0.24 reports shader compilation only as the `isCompiling` flag. The
// promise behind that flag is three's `renderer.compileAsync`, so await it directly rather than
// polling the flag. It only decides when drawing may start, never what is drawn.
function tracerCompiled() {
  const compiling = tracer._pathTracer._compilePromise;
  // Waiting on nothing here would spin renderSample() forever; fail loudly if a tracer upgrade
  // moves the promise.
  if (!compiling)
    throw new Error("path-traced-3d: tracer is compiling but exposes no compile promise");
  return compiling;
}

// Math.random decides two things the tracer bakes in: three's object uuids, which set the order
// lights, meshes and textures are sorted in, and the tracer's noise textures, built when it is
// constructed. With a fixed seed around both, every page (every render worker, every reload)
// draws the same grain. Only synchronous construction is covered: anything created later, such
// as a model loaded during setup, must be built under the seed too.
function withSeededRandom(seed, build) {
  const nativeRandom = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return build();
  } finally {
    Math.random = nativeRandom;
  }
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const { scene, camera, poseAt } = withSeededRandom(1, () =>
  createScene(THREE, { aspect: width / height }),
);
let tracer = null;
let shownTime = null;
const pixel = new Uint8Array(4);

// gl.finish() can return before a software GPU has run the queued work; reading one pixel back
// cannot, so the frame (and the first, slowest shader run) is really done when this returns.
function waitForGpu() {
  const gl = renderer.getContext();
  renderer.setRenderTarget(null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

// Sampling is driven by an explicit count, never by time: the tracer's own delay and fade
// settings read a clock that does not move during a render.
async function trace(target) {
  // Objects moved, so rebuild the tracer's copy of the scene; this also restarts accumulation.
  tracer.setScene(scene, camera);
  while (tracer.samples < target) {
    tracer.renderSample();
    // The first call after a shader change starts a compile and draws nothing; wait for it.
    if (tracer.isCompiling) await tracerCompiled();
  }
}

// The first image a renderer draws differs from later ones (shader warm-up, first uploads), so
// setup draws one throwaway frame and leaves nothing marked as shown.
async function setup() {
  poseAt(0);
  if (mode === "raster") {
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    waitForGpu();
    return;
  }
  tracer = withSeededRandom(2, () => new THREE.WebGLPathTracer(renderer));
  // No delay, fade or low-resolution stand-in: those depend on elapsed time.
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.minSamples = 1;
  tracer.dynamicLowRes = false;
  tracer.rasterizeScene = false;
  tracer.stableNoise = true;
  tracer.bounces = bounces;
  tracer.filterGlossyFactor = 0.5;
  await trace(samples);
  waitForGpu();
}

async function draw(time) {
  if (time === shownTime) return;
  shownTime = null;
  poseAt(time);
  if (mode === "path") await trace(samples);
  else renderer.render(scene, camera);
  waitForGpu();
  shownTime = time;
}

const ready = setup();
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady[READY_KEY] = ready;

let queue = ready;
window.addEventListener("hf-seek", (event) => {
  const { time } = event.detail;
  queue = queue
    .catch(() => {})
    .then(() => ready)
    .then(() => draw(time));
  event.detail.waitUntil(queue);
});
