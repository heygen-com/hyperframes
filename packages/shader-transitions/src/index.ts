export { init, type HyperShaderConfig, type TransitionConfig } from "./hyper-shader.js";
export { isHtmlInCanvasCaptureSupported } from "./capture.js";
export { SHADER_NAMES, type ShaderName } from "./shaders/registry.js";
export {
  installPageSideCompositor,
  isPageSideCompositingSupported,
  PAGE_COMPOSITOR_BUILD_CANARY,
  PAGE_COMPOSITOR_CANVAS_ID,
} from "./engineModePageComposite.js";
