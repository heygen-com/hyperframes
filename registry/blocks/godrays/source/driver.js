// Drives the page's Shaders-library canvas (shaders@4.0.0, WebGPU) from HyperFrames time, with no clock of its own.
import {
  shaderRendererGPU,
  createGpuUniformsMap,
  rootPassthrough,
  resolveBoundingBox,
} from "shaders/core";
import SHADERS from "shader-defs";

const canvas = document.querySelector("canvas[data-shader]");
const def = SHADERS[canvas.dataset.shader];
const renderer = shaderRendererGPU();
let chain = Promise.resolve();

// The library's clock only accumulates the deltas it is given, so each frame steps it to the time asked for. Read
// the clock rather than tracking it: initialize() already drew one frame and moved it by 16 ms.
function renderAt(t) {
  chain = chain.then(() =>
    renderer.renderSyntheticFrame(t - renderer.__testing.getFrameDiagnostics().globalElapsedTime),
  );
  return chain;
}

const ready = (async () => {
  if (!def) throw new Error(`shaders: no shader named "${canvas.dataset.shader}" in this bundle`);
  await renderer.initialize({ canvas, observeElement: false, colorSpace: "srgb" });
  const reason = renderer.getFailureReason();
  if (reason) throw new Error(`shaders: WebGPU unavailable (${reason})`);
  // Synchronous from here to stopAnimation, so the library's own loop draws no frame in between.
  renderer.registerNode("root", rootPassthrough.fragment, null, null, {}, rootPassthrough);
  const props = JSON.parse(canvas.dataset.shaderProps || "{}");
  const values = Object.fromEntries(
    Object.entries(def.props).map(([name, prop]) => [
      name,
      name in props ? props[name] : prop.default,
    ]),
  );
  const at = {
    blendMode: "normal",
    renderOrder: 1,
    id: "fx",
    boundingBox: resolveBoundingBox(undefined),
  };
  renderer.registerNode(
    "fx",
    def.fragment,
    "root",
    at,
    createGpuUniformsMap(def, values, "fx"),
    def,
  );
  renderer.stopAnimation();
  await renderAt(window.__hfTypegpuTime ?? 0);
})();

window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady.shaders = ready;
ready.catch((err) => console.error(String(err)));

window.addEventListener("hf-seek", (e) => {
  const done = ready.then(() => renderAt(e.detail.time));
  if (typeof e.detail.waitUntil === "function") e.detail.waitUntil(done);
});
