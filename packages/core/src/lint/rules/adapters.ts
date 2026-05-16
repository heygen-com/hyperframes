import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr, stripJsComments } from "../utils";

const WEBGPU_USAGE_PATTERN =
  /\bnavigator\s*\.\s*gpu\b|\.getContext\s*\(\s*["']webgpu["']\s*\)|\bGPU(?:Buffer|Texture|ShaderStage|MapMode|ColorWrite|CanvasContext|Device|Adapter|Queue)\b|\b__hfTypegpuTime\b/i;
const WEBGPU_FRAME_FENCE_PATTERN =
  /\b__hfWebGpu\b|\b__hfRegisterWebGpuDevice\b|\b__hfRegisterWebGpuFrame\b|\b__hfWebGpuFrameReady\b|\b__hfWebGpuWaitForFrame\b/i;
const WEBGPU_MAIN_THREAD_SUBMIT_PATTERN =
  /\brequestDevice\s*\(|\bqueue\s*\.\s*submit\s*\(|\bdevice\s*\.\s*queue\s*\.\s*submit\s*\(/i;
const WEBGPU_WORKER_PATTERN = /\bnew\s+Worker\s*\(|\btransferControlToOffscreen\s*\(/i;

export const adapterRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // missing_lottie_script
  ({ tags, scripts }) => {
    const allScriptTexts = scripts.filter((s) => !/\bsrc\s*=/.test(s.attrs)).map((s) => s.content);
    const allScriptSrcs = scripts
      .map((s) => readAttr(`<script ${s.attrs}>`, "src") || "")
      .filter(Boolean);

    const hasLottieAttr = tags.some((t) => readAttr(t.raw, "data-lottie-src") !== null);
    const usesLottieApi = allScriptTexts.some((t) =>
      /lottie\.(loadAnimation|setSpeed|play|stop|destroy)\b/.test(t),
    );
    const hasLottieScript = allScriptSrcs.some((src) => /lottie/i.test(src));

    if (!(hasLottieAttr || usesLottieApi) || hasLottieScript) return [];
    return [
      {
        code: "missing_lottie_script",
        severity: "error",
        message:
          "Composition uses Lottie but no Lottie script is loaded. The animation will not render.",
        fixHint:
          'Add <script src="https://cdn.jsdelivr.net/npm/lottie-web@5/build/player/lottie.min.js"></script> before your Lottie code.',
      },
    ];
  },

  // missing_three_script
  ({ scripts }) => {
    const allScriptTexts = scripts.filter((s) => !/\bsrc\s*=/.test(s.attrs)).map((s) => s.content);
    const allScriptSrcs = scripts
      .map((s) => readAttr(`<script ${s.attrs}>`, "src") || "")
      .filter(Boolean);

    const usesThree = allScriptTexts.some((t) => /\bTHREE\./.test(t));
    const hasThreeScript = allScriptSrcs.some((src) => /three/i.test(src));

    if (!usesThree || hasThreeScript) return [];
    return [
      {
        code: "missing_three_script",
        severity: "error",
        message:
          "Composition uses Three.js but no Three.js script is loaded. The 3D scene will not render.",
        fixHint:
          'Add <script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script> before your Three.js code.',
      },
    ];
  },

  // webgpu_unsupported_worker_path
  ({ scripts, options }) => {
    const inlineScriptTexts = scripts
      .filter((s) => !/\bsrc\s*=/.test(s.attrs))
      .map((s) => stripJsComments(s.content));
    const externalScriptTexts = (options.externalScripts ?? []).map((script) =>
      stripJsComments(script.content),
    );
    const webGpuScriptTexts = [...inlineScriptTexts, ...externalScriptTexts];

    const usesWebGpu = webGpuScriptTexts.some((script) => WEBGPU_USAGE_PATTERN.test(script));
    const usesWorkerOrOffscreen = webGpuScriptTexts.some((script) =>
      WEBGPU_WORKER_PATTERN.test(script),
    );

    if (!usesWebGpu || !usesWorkerOrOffscreen) return [];
    return [
      {
        code: "webgpu_unsupported_worker_path",
        severity: "error",
        message:
          "Composition appears to use WebGPU with a Worker or OffscreenCanvas path. HyperFrames cannot observe GPU queue submissions inside worker contexts during render capture.",
        fixHint:
          "Submit WebGPU work on the main thread, or expose a main-thread window.__hfWebGpuWaitForFrame(time) hook that requests the worker frame and resolves after it is submitted.",
      },
    ];
  },

  // webgpu_missing_frame_fence
  ({ scripts, options }) => {
    const inlineScriptTexts = scripts
      .filter((s) => !/\bsrc\s*=/.test(s.attrs))
      .map((s) => stripJsComments(s.content));
    const externalScriptTexts = (options.externalScripts ?? []).map((script) =>
      stripJsComments(script.content),
    );
    const webGpuScriptTexts = [...inlineScriptTexts, ...externalScriptTexts];

    const usesWebGpu = webGpuScriptTexts.some((script) => WEBGPU_USAGE_PATTERN.test(script));
    const registersWebGpuFence = webGpuScriptTexts.some((script) =>
      WEBGPU_FRAME_FENCE_PATTERN.test(script),
    );
    const hasMainThreadSubmit = webGpuScriptTexts.some((script) =>
      WEBGPU_MAIN_THREAD_SUBMIT_PATTERN.test(script),
    );

    if (!usesWebGpu || registersWebGpuFence || hasMainThreadSubmit) return [];
    return [
      {
        code: "webgpu_missing_frame_fence",
        severity: "warning",
        message:
          "Composition uses WebGPU or TypeGPU but the linter cannot see a main-thread device request, queue submit, or WebGPU frame readiness hook. CLI capture may fail because no GPU submission is observable.",
        fixHint:
          "Submit WebGPU work on the main thread after navigator.gpu.requestAdapter().requestDevice(), register the device with window.__hfWebGpu.registerDevice(device), or call window.__hfWebGpu.registerFrame(device.queue.onSubmittedWorkDone()) after each submit.",
      },
    ];
  },
];
