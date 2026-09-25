import modelViewerRuntime from "@google/model-viewer/dist/model-viewer-umd.min.js?raw";
import basisTranscoderSource from "three/examples/jsm/libs/basis/basis_transcoder.js?raw";
import basisTranscoderWasm from "three/examples/jsm/libs/basis/basis_transcoder.wasm?inline";
import dracoDecoderSource from "three/examples/jsm/libs/draco/draco_decoder.js?raw";
import dracoDecoderWasm from "three/examples/jsm/libs/draco/draco_decoder.wasm?inline";
import dracoWasmWrapperSource from "three/examples/jsm/libs/draco/draco_wasm_wrapper.js?raw";
import meshoptDecoderModule from "three/examples/jsm/libs/meshopt_decoder.module.js?raw";

const KTX2_ROOT = "https://hyperframes.invalid/web-capture-ktx2/";
const DRACO_ROOT = "https://hyperframes.invalid/web-capture-draco/";

function escapeScriptEnd(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function trustedJson(value: string): string {
  return escapeScriptEnd(JSON.stringify(value));
}

function classicMeshoptDecoder(): string {
  const classic = meshoptDecoderModule.replace(
    /export\s*\{\s*MeshoptDecoder\s*\};?\s*$/,
    "self.MeshoptDecoder = MeshoptDecoder;",
  );
  if (classic === meshoptDecoderModule) {
    throw new Error("Pinned Meshopt decoder no longer has the expected module export");
  }
  return classic;
}

export function trustedWebCapture3dRuntimeSource(): string {
  const meshoptUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(classicMeshoptDecoder())}`;
  return [
    "(() => {",
    `  const ktx2Root = ${trustedJson(KTX2_ROOT)};`,
    `  const dracoRoot = ${trustedJson(DRACO_ROOT)};`,
    `  const basisSource = ${trustedJson(basisTranscoderSource)};`,
    `  const basisWasm = ${trustedJson(basisTranscoderWasm)};`,
    `  const dracoDecoderSource = ${trustedJson(dracoDecoderSource)};`,
    `  const dracoWasmWrapperSource = ${trustedJson(dracoWasmWrapperSource)};`,
    `  const dracoDecoderWasm = ${trustedJson(dracoDecoderWasm)};`,
    "  const nativeFetch = self.fetch.bind(self);",
    "  self.fetch = (input, init) => {",
    "    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;",
    "    if (url === ktx2Root + 'basis_transcoder.js') return Promise.resolve(new Response(basisSource, { headers: { 'content-type': 'text/javascript' } }));",
    "    if (url === ktx2Root + 'basis_transcoder.wasm') return nativeFetch(basisWasm, init);",
    "    if (url === dracoRoot + 'draco_decoder.js') return Promise.resolve(new Response(dracoDecoderSource, { headers: { 'content-type': 'text/javascript' } }));",
    "    if (url === dracoRoot + 'draco_wasm_wrapper.js') return Promise.resolve(new Response(dracoWasmWrapperSource, { headers: { 'content-type': 'text/javascript' } }));",
    "    if (url === dracoRoot + 'draco_decoder.wasm') return nativeFetch(dracoDecoderWasm, init);",
    "    return nativeFetch(input, init);",
    "  };",
    "})();",
    escapeScriptEnd(modelViewerRuntime),
    "(() => {",
    "const configure = () => {",
    "  const Viewer = self.ModelViewerElement && self.ModelViewerElement.ModelViewerElement;",
    "  if (!Viewer) throw new Error('Trusted 3D runtime did not register');",
    `  Viewer.ktx2TranscoderLocation = ${trustedJson(KTX2_ROOT)};`,
    `  Viewer.meshoptDecoderLocation = ${trustedJson(meshoptUrl)};`,
    `  Viewer.dracoDecoderLocation = ${trustedJson(DRACO_ROOT)};`,
    "  for (const element of document.querySelectorAll('model-viewer[data-hf-model-src]')) {",
    "    element.src = element.getAttribute('data-hf-model-src');",
    "    element.removeAttribute('data-hf-model-src');",
    "  }",
    "};",
    "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', configure, { once: true });",
    "else configure();",
    "})();",
  ].join("\n");
}
