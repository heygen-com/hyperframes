import {
  createContext,
  setupQuad,
  createProgram,
  createTexture,
  uploadTexture,
  renderShader,
  WIDTH,
  HEIGHT,
  type AccentColors,
} from "./webgl.js";
import { getFragSource, type ShaderName } from "./shaders/registry.js";
import { initCapture, captureScene, captureIncomingScene } from "./capture.js";

declare const gsap: {
  timeline: (opts: Record<string, unknown>) => GsapTimeline;
};

interface GsapTimeline {
  paused: () => boolean;
  play: () => GsapTimeline;
  pause: () => GsapTimeline;
  call: (fn: () => void, args: null, position: number) => GsapTimeline;
  to: (
    target: Record<string, unknown>,
    vars: Record<string, unknown>,
    position: number,
  ) => GsapTimeline;
  set: (target: string, vars: Record<string, unknown>, position?: number) => GsapTimeline;
  from: (target: string, vars: Record<string, unknown>, position?: number) => GsapTimeline;
  fromTo: (
    target: string,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    position?: number,
  ) => GsapTimeline;
  [key: string]: unknown;
}

export interface TransitionConfig {
  time: number;
  shader: ShaderName;
  duration?: number;
  ease?: string;
}

export interface HyperShaderConfig {
  bgColor: string;
  accentColor?: string;
  scenes: string[];
  transitions: TransitionConfig[];
  timeline?: GsapTimeline;
  compositionId?: string;
}

interface TransState {
  active: boolean;
  prog: WebGLProgram | null;
  fromId: string;
  toId: string;
  progress: number;
}

// Defaults for transition duration/ease. Used by every fallback site in this
// file — meta-write, browser/render mode, and engine mode — so a transition
// without explicit `duration`/`ease` plays the same length and curve in
// preview, the engine's deterministic seek path, and the metadata the
// producer reads to plan compositing.
const DEFAULT_DURATION = 0.7;
const DEFAULT_EASE = "power2.inOut";

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length < 6) return [0.5, 0.5, 0.5];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0.5, 0.5, 0.5];
  return [r, g, b];
}

function deriveAccentColors(hex: string): AccentColors {
  const [r, g, b] = parseHex(hex);
  return {
    accent: [r, g, b],
    dark: [r * 0.35, g * 0.35, b * 0.35],
    bright: [Math.min(1, r * 1.5 + 0.2), Math.min(1, g * 1.5 + 0.2), Math.min(1, b * 1.5 + 0.2)],
  };
}

export function init(config: HyperShaderConfig): GsapTimeline {
  const { bgColor, scenes, transitions } = config;

  if (scenes.length !== transitions.length + 1) {
    throw new Error(
      `[HyperShader] init(): expected scenes.length === transitions.length + 1, got scenes=${scenes.length}, transitions=${transitions.length}`,
    );
  }

  // Verify each scene id resolves to an element with the `.scene` class.
  // Capture and compositing later assume both — without this guard the
  // texture map gets stale ids and transitions silently no-op.
  if (typeof document !== "undefined") {
    const missing: string[] = [];
    const notScene: string[] = [];
    for (const id of scenes) {
      const el = document.getElementById(id);
      if (!el) {
        missing.push(id);
      } else if (!el.classList.contains("scene")) {
        notScene.push(id);
      }
    }
    if (missing.length > 0) {
      throw new Error(`[HyperShader] init(): scene ids not found in DOM: ${missing.join(", ")}`);
    }
    if (notScene.length > 0) {
      throw new Error(
        `[HyperShader] init(): elements found but missing .scene class: ${notScene.join(", ")}`,
      );
    }
  }

  // Locally redeclared (not imported) because @hyperframes/shader-transitions
  // ships as a standalone CDN bundle and must not depend on @hyperframes/engine.
  // Keep this in sync with HfTransitionMeta in packages/engine/src/types.ts.
  interface HfTransitionMeta {
    time: number;
    duration: number;
    shader: string;
    ease: string;
    fromScene: string;
    toScene: string;
  }
  type HfWindowWrite = { __hf?: { transitions?: HfTransitionMeta[] } };
  if (typeof window !== "undefined") {
    const hfWin = window as unknown as HfWindowWrite;
    if (hfWin.__hf) {
      hfWin.__hf.transitions = transitions.map((t: TransitionConfig, i: number) => ({
        time: t.time,
        duration: t.duration ?? DEFAULT_DURATION,
        shader: t.shader,
        ease: t.ease ?? DEFAULT_EASE,
        fromScene: scenes[i] ?? "",
        toScene: scenes[i + 1] ?? "",
      }));
    }
  }

  const accentColors: AccentColors = config.accentColor
    ? deriveAccentColors(config.accentColor)
    : { accent: [1, 0.6, 0.2], dark: [0.4, 0.15, 0], bright: [1, 0.85, 0.5] };

  const root = document.querySelector<HTMLElement>("[data-composition-id]");
  const compId = config.compositionId || root?.getAttribute("data-composition-id") || "main";

  // The Hyperframes engine injects a virtual-time shim (window.__HF_VIRTUAL_TIME__)
  // during render mode and composites every transition itself from the
  // window.__hf.transitions metadata above. Doing GL work or html2canvas captures
  // here would (a) waste cycles and (b) leave .scene elements stuck at opacity:0
  // because captureScene resolves asynchronously, after the engine has already
  // sampled the DOM. In that mode we only need to keep each scene's effective
  // opacity correct so queryElementStacking() reports the right visibility.
  const isEngineRenderMode =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __HF_VIRTUAL_TIME__?: unknown }).__HF_VIRTUAL_TIME__);

  if (isEngineRenderMode) {
    return initEngineMode(config, scenes, transitions, compId, root);
  }

  const state: TransState = {
    active: false,
    prog: null,
    fromId: "",
    toId: "",
    progress: 0,
  };

  let glCanvas = document.getElementById("gl-canvas") as HTMLCanvasElement | null;
  if (!glCanvas) {
    glCanvas = document.createElement("canvas");
    glCanvas.id = "gl-canvas";
    glCanvas.width = WIDTH;
    glCanvas.height = HEIGHT;
    glCanvas.style.cssText = `position:absolute;top:0;left:0;width:${WIDTH}px;height:${HEIGHT}px;z-index:100;pointer-events:none;display:none;`;
    (root || document.body).appendChild(glCanvas);
  }

  const gl = createContext(glCanvas);
  if (!gl) {
    console.warn("[HyperShader] WebGL unavailable — shader transitions disabled.");
    const fallback = config.timeline || gsap.timeline({ paused: true });
    registerTimeline(compId, fallback, config.timeline);
    return fallback;
  }

  const quadBuf = setupQuad(gl);

  const programs = new Map<string, WebGLProgram>();
  for (const t of transitions) {
    if (!programs.has(t.shader)) {
      try {
        programs.set(t.shader, createProgram(gl, getFragSource(t.shader)));
      } catch (e) {
        console.error(`[HyperShader] Failed to compile "${t.shader}":`, e);
      }
    }
  }

  const textures = new Map<string, WebGLTexture>();
  for (const id of scenes) {
    textures.set(id, createTexture(gl));
  }

  const tickShader = () => {
    if (state.active && state.prog) {
      const fromTex = textures.get(state.fromId);
      const toTex = textures.get(state.toId);
      if (fromTex && toTex) {
        renderShader(gl, quadBuf, state.prog, fromTex, toTex, state.progress, accentColors);
      }
    }
  };

  let tl: GsapTimeline;
  if (config.timeline) {
    tl = config.timeline;
    const duration = Number(root?.getAttribute("data-duration") || "40");
    tl.to({ t: 0 }, { t: 1, duration, ease: "none", onUpdate: tickShader }, 0);
  } else {
    tl = gsap.timeline({ paused: true, onUpdate: tickShader });
  }

  initCapture();
  glCanvas.style.display = "none";

  const canvasEl = glCanvas;

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const fromId = scenes[i];
    const toId = scenes[i + 1];
    if (!fromId || !toId) continue;

    const prog = programs.get(t.shader);
    if (!prog) continue;

    const dur = t.duration ?? DEFAULT_DURATION;
    const ease = t.ease ?? DEFAULT_EASE;
    const T = t.time;

    // Pause timeline during async capture to prevent the progress tween
    // from running ahead. Resume once textures are uploaded.
    tl.call(
      () => {
        const fromScene = document.getElementById(fromId);
        const toScene = document.getElementById(toId);
        if (!fromScene || !toScene) return;

        const wasPlaying = !tl.paused();
        if (wasPlaying) tl.pause();

        captureScene(fromScene, bgColor)
          .then((fromCanvas) => {
            const fromTex = textures.get(fromId);
            if (fromTex) uploadTexture(gl, fromTex, fromCanvas);
            return captureIncomingScene(toScene, bgColor);
          })
          .then((toCanvas) => {
            const toTex = textures.get(toId);
            if (toTex) uploadTexture(gl, toTex, toCanvas);

            document.querySelectorAll<HTMLElement>(".scene").forEach((s) => {
              s.style.opacity = "0";
            });
            canvasEl.style.display = "block";
            state.prog = prog;
            state.fromId = fromId;
            state.toId = toId;
            state.progress = 0;
            state.active = true;

            if (wasPlaying) tl.play();
          })
          .catch((e) => {
            console.warn("[HyperShader] Capture failed, falling back to hard cut:", e);
            document.querySelectorAll<HTMLElement>(".scene").forEach((s) => {
              s.style.opacity = "0";
            });
            const scene = document.getElementById(toId);
            if (scene) scene.style.opacity = "1";
            if (wasPlaying) tl.play();
          });
      },
      null,
      T,
    );

    const proxy = { p: 0 };
    tl.to(
      proxy,
      {
        p: 1,
        duration: dur,
        ease,
        onUpdate: () => {
          state.progress = proxy.p;
        },
      },
      T,
    );

    tl.call(
      () => {
        state.active = false;
        canvasEl.style.display = "none";
        const scene = document.getElementById(toId);
        if (scene) scene.style.opacity = "1";
      },
      null,
      T + dur,
    );
  }

  registerTimeline(compId, tl, config.timeline);
  return tl;
}

function registerTimeline(
  compId: string,
  tl: GsapTimeline,
  provided: GsapTimeline | undefined,
): void {
  if (!provided) {
    const w = window as unknown as { __timelines: Record<string, unknown> };
    w.__timelines = w.__timelines || {};
    w.__timelines[compId] = tl;
  }
}

// Engine-mode initialization: skip every GL/canvas/html2canvas branch and only
// schedule deterministic opacity flips so the producer can read each scene's
// effective opacity at any seek time. tl.set() (zero-duration tweens) is used
// instead of tl.call() because tl.call only fires in the direction of motion —
// the engine's warmup loop seeks forward through transition start times and
// then the main render loop seeks back to t=0, which would leave callback-set
// state stuck. tl.set tweens revert correctly on backward seeks.
function initEngineMode(
  config: HyperShaderConfig,
  scenes: string[],
  transitions: TransitionConfig[],
  compId: string,
  root: HTMLElement | null,
): GsapTimeline {
  const tl: GsapTimeline = config.timeline || gsap.timeline({ paused: true });

  // Match the user-facing branch: when the user supplies a timeline, we
  // anchor a no-op duration tween at 0 so the timeline length covers the
  // composition. Without it a brand-new injected timeline would be empty.
  if (config.timeline) {
    const duration = Number(root?.getAttribute("data-duration") || "40");
    tl.to({ t: 0 }, { t: 1, duration, ease: "none" }, 0);
  }

  // Initial state: every non-first scene starts hidden. CSS defaults
  // .scene to opacity:1, so without this every scene would composite at
  // t=0 and the engine's queryElementStacking() would report all of them
  // visible — manifesting as ghosting/overlap in the very first frame
  // before the first transition fires. tl.set() at position 0 ensures
  // the initial state is part of the timeline's seek graph, so reverse
  // seeks from inside a later transition correctly restore it.
  for (let i = 1; i < scenes.length; i++) {
    const sceneId = scenes[i];
    if (sceneId) {
      tl.set(`#${sceneId}`, { opacity: 0 }, 0);
    }
  }

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const fromId = scenes[i];
    const toId = scenes[i + 1];
    if (!fromId || !toId) continue;

    const dur = t.duration ?? DEFAULT_DURATION;
    const T = t.time;

    // During the transition both scenes need to be visible so the engine
    // can composite each side; afterwards the outgoing scene must drop out
    // so it stops contributing to the normal-frame layer composite.
    tl.set(`#${toId}`, { opacity: 1 }, T);
    tl.set(`#${fromId}`, { opacity: 0 }, T + dur);
  }

  registerTimeline(compId, tl, config.timeline);
  return tl;
}
