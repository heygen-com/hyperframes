// Post-processing graph (TSL PostProcessing + pass()). Order:
//   scene (HDR float16, MRT output+velocity) -> TRAA -> haze (additive volumetric) -> DOF -> bloom
//   -> monochrome + grade (tonemap, black lift, contrast, exposure) -> vignette -> blue-noise grain
//   -> sRGB -> triangular dither. TRAA runs first so the grain is never temporally averaged away.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
const {
  rtt,
  Fn,
  pass,
  mrt,
  output,
  velocity,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
  texture,
  screenUV,
  screenCoordinate,
  screenSize,
  mix,
  luminance,
  smoothstep,
  length,
  max,
  clamp,
  agxToneMapping,
  acesFilmicToneMapping,
  neutralToneMapping,
  linearToneMapping,
  floor,
  step,
} = tsl;
import { traa } from "three/addons/tsl/display/TRAANode.js";
import { taau } from "three/addons/tsl/display/TAAUNode.js";
import { fsr1 } from "three/addons/tsl/display/FSR1Node.js";
import { sharpen } from "three/addons/tsl/display/SharpenNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { sRGBTransferOETF } from "three/src/nodes/display/ColorSpaceFunctions.js";
import type { PerformanceD, PostD } from "../dials/store";
import { hash31 } from "../tsl/noise";

type N = any;

export interface PostGraphOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGPURenderer;
  blueNoise: THREE.Texture;
  /** Optional additive haze node factory (gets the scene depth texture node and the viewZ node). */
  haze?: (depthNode: N, viewZNode: N) => N;
  /** Build the first graph with the live settings, avoiding a throwaway startup pipeline. */
  initial?: PostD;
  initialPerformance?: PerformanceD;
  initialHaze?: boolean;
}

export function createPost(o: PostGraphOptions) {
  const u = {
    exposure: uniform(1.0),
    contrast: uniform(1.08),
    blackLift: uniform(0.02),
    monochrome: uniform(1.0),
    vignette: uniform(0.2),
    vignetteSoft: uniform(0.7),
    vignetteRadius: uniform(0.85),
    grain: uniform(0.03),
    grainSize: uniform(1),
    grainSeed: uniform(new THREE.Vector2()),
    grainShadow: uniform(0.8),
    bgGrain: uniform(0),
    bgGrainSize: uniform(2),
    bgGrainSeed: uniform(new THREE.Vector2()),
    dither: uniform(1.0),
    focus: uniform(12.4),
    focusRange: uniform(3.0),
    aperture: uniform(0.9),
    bloomStrength: uniform(0.15),
    bloomRadius: uniform(0.15),
    bloomThreshold: uniform(1.2),
    sceneFade: uniform(1.0),
    hazeIntensity: uniform(0.22),
    upscaleSharpness: uniform(0.2),
  };

  const post = new ((THREE as any).RenderPipeline ?? THREE.PostProcessing)(o.renderer);
  post.outputColorTransform = false;

  let currentMode = { aa: "", tonemap: "", dof: true, haze: false, upscaler: "", sharpen: false };
  let scenePass: any = null;
  let temporal: any = null;
  let lastRenderFrame = -1;
  let hazeRTT: any = null;
  let hazeScale = 1;
  let settingsVersion = -1;
  let disposableNodes: any[] = [];

  function build(mode: {
    aa: string;
    tonemap: string;
    dof: boolean;
    haze: boolean;
    upscaler: string;
    sharpen: boolean;
  }) {
    currentMode = { ...mode };
    const previousNodes = disposableNodes;
    const nextNodes: any[] = [];
    const own = (node: any) => {
      if (node && typeof node.dispose === "function") nextNodes.push(node);
      return node;
    };
    scenePass = own(pass(o.scene, o.camera, { type: THREE.HalfFloatType, samples: 0 } as any));
    scenePass.setMRT(mrt({ output, velocity }));
    const beauty = scenePass.getTextureNode("output");
    const depthTex = scenePass.getTextureNode("depth");
    const velTex = scenePass.getTextureNode("velocity");
    const viewZ = scenePass.getViewZNode();

    // TAAU reconstructs and anti-aliases the low-resolution MRT directly. FSR1 expects an
    // anti-aliased input, so retain TRAA ahead of it. An RTT makes the bilinear path an explicit
    // output-resolution pass; native is the original same-resolution pipeline.
    let color: N;
    temporal = null;
    if (mode.upscaler === "taau") color = temporal = own(taau(beauty, depthTex, velTex, o.camera));
    else {
      color =
        mode.aa === "traa" ? (temporal = own(traa(beauty, depthTex, velTex, o.camera))) : beauty;
      if (mode.upscaler === "fsr1")
        color = own(fsr1(color, float(2).sub(u.upscaleSharpness.mul(2)), true));
      else if (mode.upscaler === "bilinear") color = own(rtt(color));
    }
    if (mode.sharpen && (mode.upscaler === "taau" || mode.upscaler === "bilinear")) {
      color = own(sharpen(color, float(2).sub(u.upscaleSharpness.mul(2)), true));
    }

    hazeRTT = null;
    if (o.haze && mode.haze) {
      // the haze is a smooth volumetric term: it can be rendered at reduced resolution and upsampled
      hazeRTT = own(rtt(o.haze(depthTex, viewZ)));
      hazeRTT.setResolutionScale(hazeScale);
      color = color.add(hazeRTT.mul(u.hazeIntensity));
    }

    if (mode.dof) color = own(dof(color, viewZ, u.focus, u.focusRange, u.aperture));

    const bl = own(bloom(color, u.bloomStrength, u.bloomRadius, u.bloomThreshold));
    (bl as any).smoothWidth.value = 0.35;
    color = color.add(bl);

    const graded = Fn(() => {
      const hdr = vec3(color).mul(u.sceneFade).toVar();
      const luma = luminance(hdr);
      hdr.assign(mix(hdr, vec3(luma), u.monochrome));
      const tm =
        mode.tonemap === "aces"
          ? acesFilmicToneMapping(hdr, u.exposure)
          : mode.tonemap === "neutral"
            ? neutralToneMapping(hdr, u.exposure)
            : mode.tonemap === "linear"
              ? linearToneMapping(hdr, u.exposure)
              : agxToneMapping(hdr, u.exposure);
      const t = clamp(vec3(tm), 0.0, 1.0).toVar();
      const mid = float(0.18);
      t.assign(clamp(mid.add(t.sub(mid).mul(u.contrast)), 0.0, 1.0));
      const sCurve = t.mul(t).mul(float(3).sub(t.mul(2)));
      t.assign(mix(t, sCurve, clamp(u.contrast.sub(1.0).mul(1.5), 0.0, 0.6)));
      t.assign(t.mul(u.blackLift.oneMinus()).add(u.blackLift));
      const aspect = screenSize.x.div(screenSize.y);
      const dv = vec2(screenUV.x.sub(0.5).mul(aspect), screenUV.y.sub(0.5));
      const r = length(dv).div(u.vignetteRadius);
      const vig = smoothstep(float(1.0).sub(u.vignetteSoft), 1.0001, r).mul(u.vignette);
      t.assign(t.mul(vig.oneMinus()));
      const srgb = vec3(sRGBTransferOETF(t)).toVar();
      const px = floor(screenCoordinate.xy.div(u.grainSize));
      const bnUV = px.div(64.0).add(u.grainSeed);
      const n = texture(o.blueNoise, bnUV).r.sub(0.5);
      const n2 = texture(o.blueNoise, bnUV.add(vec2(0.37, 0.61))).r.sub(0.5);
      const tri = n.add(n2);
      const lum = luminance(srgb);
      const shadowW = mix(float(1.0), smoothstep(1.0, 0.05, lum), u.grainShadow);
      const grainAmt = u.grain.mul(shadowW).mul(smoothstep(0.0, 0.08, lum).mul(0.85).add(0.15));
      srgb.addAssign(vec3(tri.mul(grainAmt)));
      // background-only grain for recorded video: coarse blocks of white noise, several grey levels deep, so
      // the codec keeps a texture where the plain gradient would band (object pixels are left alone)
      const isBg = step(0.9999995, depthTex.r);
      const pb = floor(screenCoordinate.xy.div(max(u.bgGrainSize, 1.0)));
      const b1 = hash31(vec3(pb, u.bgGrainSeed.x.mul(97.0)));
      const b2 = hash31(vec3(pb.add(vec2(17.3, 5.1)), u.bgGrainSeed.y.mul(53.0)));
      srgb.addAssign(vec3(b1.add(b2).sub(1.0).mul(u.bgGrain).mul(isBg)));
      const dn = texture(o.blueNoise, screenCoordinate.xy.div(64.0).add(u.grainSeed.yx)).r.sub(0.5);
      const dn2 = texture(
        o.blueNoise,
        screenCoordinate.xy.div(64.0).add(vec2(0.5, 0.25)).add(u.grainSeed),
      ).r.sub(0.5);
      srgb.addAssign(vec3(dn.add(dn2).mul(u.dither).div(255.0)));
      return vec4(max(srgb, 0.0), 1.0);
    })();

    post.outputNode = graded;
    post.needsUpdate = true;
    disposableNodes = nextNodes;
    for (const node of previousNodes) node.dispose();
  }

  build({
    aa: o.initial?.aaMode ?? "traa",
    tonemap: o.initial?.tonemap ?? "agx",
    dof: o.initial?.dof.enabled ?? true,
    haze: !!o.haze && (o.initialHaze ?? true),
    upscaler: o.initialPerformance?.nativePostEffects ? o.initialPerformance.upscaler : "native",
    sharpen:
      !!o.initialPerformance?.nativePostEffects &&
      !!o.initialPerformance.upscaleSharpness &&
      (o.initialPerformance.upscaler === "taau" || o.initialPerformance.upscaler === "bilinear"),
  });

  function update(
    p: PostD,
    perf: PerformanceD,
    focusDistance: number,
    sceneFade: number,
    hazeIntensity: number,
    t: number,
    version: number,
  ) {
    const haze = !!o.haze && hazeIntensity !== 0;
    const upscaler = perf.nativePostEffects ? perf.upscaler : "native";
    const useSharpen =
      perf.nativePostEffects &&
      perf.upscaleSharpness > 0 &&
      (upscaler === "taau" || upscaler === "bilinear");
    if (version !== settingsVersion || haze !== currentMode.haze) {
      settingsVersion = version;
      if (
        p.aaMode !== currentMode.aa ||
        p.tonemap !== currentMode.tonemap ||
        p.dof.enabled !== currentMode.dof ||
        haze !== currentMode.haze ||
        upscaler !== currentMode.upscaler ||
        useSharpen !== currentMode.sharpen
      ) {
        build({
          aa: p.aaMode,
          tonemap: p.tonemap,
          dof: p.dof.enabled,
          haze,
          upscaler,
          sharpen: useSharpen,
        });
      }
      u.exposure.value = p.exposure;
      u.contrast.value = p.contrast;
      u.blackLift.value = p.blackLift;
      u.monochrome.value = p.monochrome;
      u.vignette.value = p.vignette.strength;
      u.vignetteSoft.value = p.vignette.softness;
      u.vignetteRadius.value = p.vignette.radius;
      u.grain.value = p.grain.strength;
      u.grainSize.value = p.grain.size;
      u.grainShadow.value = p.grain.shadowWeight;
      u.bgGrain.value = p.grain.backgroundStrength;
      u.bgGrainSize.value = p.grain.backgroundSize;
      u.dither.value = p.dither ? 1 : 0;
      u.focusRange.value = p.dof.range;
      u.aperture.value = p.dof.aperture;
      u.bloomStrength.value = p.bloom.intensity;
      u.bloomRadius.value = p.bloom.radius;
      u.bloomThreshold.value = p.bloom.threshold;
      u.upscaleSharpness.value = perf.upscaleSharpness;
    }
    const bs = p.grain.backgroundSpeed > 0 ? Math.floor(t * 24 * p.grain.backgroundSpeed) : 0;
    u.bgGrainSeed.value.set(((bs * 0.7548776662) % 1) + 0.1, ((bs * 0.5698402909) % 1) + 0.1);
    const gs = p.grain.speed > 0 ? Math.floor(t * 24 * p.grain.speed) : 0;
    u.grainSeed.value.set((gs * 0.7548776662) % 1, (gs * 0.5698402909) % 1);
    u.focus.value = focusDistance + p.dof.focusBias;
    u.sceneFade.value = sceneFade;
    u.hazeIntensity.value = hazeIntensity;
  }

  function setHazeResolution(scale: number) {
    if (scale === hazeScale) return;
    hazeScale = scale;
    if (hazeRTT) hazeRTT.setResolutionScale(scale);
  }

  function setSceneResolution(scale: number) {
    if (scenePass) scenePass.setResolutionScale(scale);
  }

  function setFrame(index: number) {
    if (temporal) {
      // Pinned three 0.185.1 TRAA/TAAU use a 31-entry jitter cycle and seed
      // history on resize. Tie jitter to composition time, discard stale seek history.
      temporal._jitterIndex = ((index % 31) + 31) % 31;
      if (index !== lastRenderFrame + 1) temporal._historyRenderTarget.setSize(1, 1);
    }
    lastRenderFrame = index;
  }

  function dispose() {
    for (const node of disposableNodes) node.dispose();
    disposableNodes = [];
    post.dispose();
  }

  return {
    post,
    uniforms: u,
    update,
    setHazeResolution,
    setSceneResolution,
    setFrame,
    dispose,
    get scenePass() {
      return scenePass;
    },
  };
}
