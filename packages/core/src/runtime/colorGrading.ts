import {
  HF_COLOR_GRADING_ADJUST_KEYS,
  HF_COLOR_GRADING_ANIMATABLE_PROPERTIES,
  HF_COLOR_GRADING_ATTR,
  HF_COLOR_GRADING_CANVAS_ID_PREFIX,
  HF_COLOR_GRADING_DETAIL_KEYS,
  HF_COLOR_GRADING_EFFECT_KEYS,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  normalizeHfColorGradingWithVariables,
  type HfColorGradingAdjustKey,
  type HfColorGradingAnimatablePath,
  type HfColorGradingDetailKey,
  type HfColorGradingEffectKey,
  type HfColorGradingTarget,
  type NormalizedHfColorGrading,
  COLOR_GRADING_SOURCE_HIDDEN_ATTR,
  COLOR_GRADING_AUTHORED_OPACITY_ATTR,
} from "../colorGrading";
import {
  DEFAULT_MAX_CUBE_LUT_SIZE,
  packCubeLutToRgba8,
  parseCubeLut,
  type CubeLut3D,
  type CubeLutVec3,
} from "../colorLuts";
import { copyMediaVisualStyles } from "../inline-scripts/parityContract";
import { readVariablesForElement } from "./variableScope";
import { swallow } from "./diagnostics";

type ColorGradingMediaElement = HTMLVideoElement | HTMLImageElement;

type EntrySource = "attribute" | "live";

interface VideoFrameCallbackMetadata {
  mediaTime: number;
  presentedFrames: number;
  expectedDisplayTime: number;
  width: number;
  height: number;
}

type VideoFrameCallback = (now: number, metadata: VideoFrameCallbackMetadata) => void;

interface VideoFrameCallbackHost {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

type FloatUniformBinding<K extends string> = readonly [key: K, location: WebGLUniformLocation];

interface ProgramInfo {
  program: WebGLProgram;
  texture: WebGLTexture;
  lutTexture: WebGLTexture;
  quad: WebGLBuffer;
  position: number;
  source: WebGLUniformLocation | null;
  blurSource: WebGLUniformLocation | null;
  bloomSource: WebGLUniformLocation | null;
  kuwaharaSource: WebGLUniformLocation | null;
  lut: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  uvScale: WebGLUniformLocation | null;
  uvOffset: WebGLUniformLocation | null;
  blurReady: WebGLUniformLocation | null;
  bloomReady: WebGLUniformLocation | null;
  kuwaharaReady: WebGLUniformLocation | null;
  lutEnabled: WebGLUniformLocation | null;
  lutSize: WebGLUniformLocation | null;
  lutTextureSize: WebGLUniformLocation | null;
  lutDomainMin: WebGLUniformLocation | null;
  lutDomainMax: WebGLUniformLocation | null;
  lutIntensity: WebGLUniformLocation | null;
  adjustUniforms: readonly FloatUniformBinding<HfColorGradingAdjustKey>[];
  detailUniforms: readonly FloatUniformBinding<HfColorGradingDetailKey>[];
  effectUniforms: readonly FloatUniformBinding<HfColorGradingEffectKey>[];
  grainSeed: WebGLUniformLocation | null;
  effectTime: WebGLUniformLocation | null;
  paletteSize: WebGLUniformLocation | null;
  palette0: WebGLUniformLocation | null;
  palette1: WebGLUniformLocation | null;
  palette2: WebGLUniformLocation | null;
  palette3: WebGLUniformLocation | null;
  palette4: WebGLUniformLocation | null;
  palette5: WebGLUniformLocation | null;
  intensity: WebGLUniformLocation | null;
  compareEnabled: WebGLUniformLocation | null;
  comparePosition: WebGLUniformLocation | null;
  compareSoftness: WebGLUniformLocation | null;
  compareLineWidth: WebGLUniformLocation | null;
}

interface BlurProgramInfo {
  program: WebGLProgram;
  quad: WebGLBuffer;
  position: number;
  source: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  direction: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
  bloomPass: WebGLUniformLocation | null;
  threshold: WebGLUniformLocation | null;
}

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  type: number;
  width: number;
  height: number;
}

interface EffectTargets {
  blurProgram: BlurProgramInfo;
  scratch: RenderTarget;
  blur: RenderTarget;
  bloom: RenderTarget | null;
}

interface KuwaharaHorizontalProgramInfo {
  program: WebGLProgram;
  quad: WebGLBuffer;
  position: number;
  source: WebGLUniformLocation | null;
  blurSource: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
  uvScale: WebGLUniformLocation | null;
  uvOffset: WebGLUniformLocation | null;
  blurReady: WebGLUniformLocation | null;
  blur: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
}

interface KuwaharaResolveProgramInfo {
  program: WebGLProgram;
  quad: WebGLBuffer;
  position: number;
  moments: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
  sharpness: WebGLUniformLocation | null;
  saturation: WebGLUniformLocation | null;
}

interface KuwaharaTargets {
  horizontalProgram: KuwaharaHorizontalProgramInfo;
  resolveProgram: KuwaharaResolveProgramInfo;
  moments: RenderTarget;
  output: RenderTarget;
}

interface RuntimeColorGradingCompareState {
  enabled: boolean;
  position: number;
  softness: number;
  lineWidth: number;
}

interface EffectRenderState {
  gl: WebGLRenderingContext;
  program: ProgramInfo;
  effectTargets: EffectTargets | null;
  kuwaharaTargets: KuwaharaTargets | null;
  effectError: string | null;
}

interface ColorGradingRenderer extends EffectRenderState {
  canvas: HTMLCanvasElement;
}

interface ColorGradingEntry extends ColorGradingRenderer {
  element: ColorGradingMediaElement;
  grading: NormalizedHfColorGrading;
  compare: RuntimeColorGradingCompareState;
  lut: RuntimeLutTexture | null;
  lutLoadingSrc: string | null;
  lutError: string | null;
  drawError: string | null;
  source: EntrySource;
  animationFrame: number | null;
  videoFrameHandle: number | null;
  resizeObserver: ResizeObserver | null;
  cleanup: Array<() => void>;
  touchedParent: HTMLElement | null;
  parentInlinePosition: string | null;
  sourceHidden: boolean;
  sourceInlineOpacity: string | null;
  sourceInlineOpacityPriority: string;
  sourceOpacityForCanvas: string;
  sourceVisibleForCanvas: boolean;
  hasDrawn: boolean;
  contextLost: boolean;
  grainSeed: number;
  destroyed: boolean;
}

interface ColorGradingPreviewRenderer extends ColorGradingRenderer {
  lut: RuntimeLutTexture | null;
}

export interface RuntimeColorGradingPreviewCandidate {
  id: string;
  grading: unknown;
}

export interface RuntimeColorGradingPreviewBatch {
  width: number;
  height: number;
  images: Array<{ id: string; dataUrl: string | null; error?: string }>;
}

export interface RuntimeColorGradingApi {
  refresh: () => number;
  redraw: () => number;
  redrawAnimated: () => number;
  waitForActiveLuts: () => Promise<number>;
  setGrading: (
    target: HfColorGradingTarget | string | null | undefined,
    rawGrading: unknown,
  ) => boolean;
  setCompare: (
    target: HfColorGradingTarget | string | null | undefined,
    rawCompare: unknown,
  ) => boolean;
  setSourceVisibility: (target: Element, visible: boolean) => boolean;
  getStatus: (
    target: HfColorGradingTarget | string | null | undefined,
  ) => RuntimeColorGradingStatus;
  renderPreviews: (
    target: HfColorGradingTarget | string | null | undefined,
    candidates: readonly RuntimeColorGradingPreviewCandidate[],
    options?: { maxDimension?: number; useMediaTime?: boolean },
  ) => Promise<RuntimeColorGradingPreviewBatch | null>;
  startPreviewPlayback: (
    target: HfColorGradingTarget | string | null | undefined,
  ) => (() => void) | null;
  destroy: () => void;
}

export type RuntimeColorGradingStatus =
  | { state: "missing"; message: string }
  | { state: "inactive"; message: string }
  | { state: "pending"; message: string }
  | { state: "active"; message: string }
  | { state: "unavailable"; message: string };

type WindowWithColorGrading = Window & {
  __player?: {
    getTime?: () => number;
  };
  __hf?: {
    colorGrading?: RuntimeColorGradingApi;
  };
  __hyperframes?: {
    getVariables?: () => Partial<Record<string, unknown>>;
  };
  __hfVariables?: Record<string, unknown>;
  __hfVariablesByComp?: Record<string, Record<string, unknown>>;
};

interface RuntimeLutTexture {
  src: string;
  size: number;
  domainMin: CubeLutVec3;
  domainMax: CubeLutVec3;
  textureWidth: number;
  textureHeight: number;
}

type LutCacheEntry =
  | { state: "pending"; promise: Promise<CubeLut3D> }
  | { state: "ready"; lut: CubeLut3D }
  | { state: "error"; message: string };

const LUT_CACHE = new Map<string, LutCacheEntry>();
const COLOR_GRADING_CANVAS_ATTR = "data-hf-color-grading-canvas";
const COLOR_GRADING_CANVAS_CLASS = "__hf_color_grading_canvas__";

/** Captures authored media opacity before animation or grading can mutate it. */
export function installAuthoredOpacityCapture(): void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  const stamp = (el: Element): void => {
    if (!(el instanceof HTMLElement)) return;
    if (el.hasAttribute(COLOR_GRADING_AUTHORED_OPACITY_ATTR)) return;
    el.setAttribute(COLOR_GRADING_AUTHORED_OPACITY_ATTR, el.style.opacity);
  };
  const scan = (node: Node): void => {
    if (!(node instanceof Element)) return;
    if (node.matches("video, img")) stamp(node);
    for (const el of node.querySelectorAll("video, img")) stamp(el);
  };
  scan(root);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) scan(node);
    }
  }).observe(root, {
    childList: true,
    subtree: true,
  });
}

// Map insertion order gives us simple FIFO eviction for authoring sessions that cycle LUTs.
const MAX_LUT_CACHE_ENTRIES = 16;
const MAX_IDLE_COLOR_GRADING_RENDERERS = 4;
const DEFAULT_COMPARE: RuntimeColorGradingCompareState = {
  enabled: false,
  position: 0.5,
  softness: 0,
  lineWidth: 2,
};
const DEFAULT_EFFECT_PALETTE = ["#000000", "#ffffff"] as const;
const DEFAULT_ART_PALETTE = ["#1a1a1a", "#f5f5dc"] as const;

function readColorGradingAttribute(element: Element): NormalizedHfColorGrading | null {
  const raw = element.getAttribute(HF_COLOR_GRADING_ATTR);
  if (raw == null) return null;
  return normalizeHfColorGradingWithVariables(raw, readVariablesForElement(element));
}

const VERTEX_SHADER = [
  "attribute vec2 a_pos;",
  "varying vec2 v_uv;",
  "void main(){",
  "  v_uv = a_pos * 0.5 + 0.5;",
  "  gl_Position = vec4(a_pos, 0.0, 1.0);",
  "}",
].join("\n");

const FRAGMENT_SHADER = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "varying vec2 v_uv;",
  "uniform sampler2D u_source;",
  "uniform sampler2D u_blurSource;",
  "uniform sampler2D u_bloomSource;",
  "uniform sampler2D u_kuwaharaSource;",
  "uniform sampler2D u_lut;",
  "uniform vec2 u_resolution;",
  "uniform vec2 u_uvScale;",
  "uniform vec2 u_uvOffset;",
  "uniform float u_blurReady;",
  "uniform float u_bloomReady;",
  "uniform float u_kuwaharaReady;",
  "uniform float u_lutEnabled;",
  "uniform float u_lutSize;",
  "uniform vec2 u_lutTextureSize;",
  "uniform vec3 u_lutDomainMin;",
  "uniform vec3 u_lutDomainMax;",
  "uniform float u_lutIntensity;",
  "uniform float u_exposure;",
  "uniform float u_contrast;",
  "uniform float u_highlights;",
  "uniform float u_shadows;",
  "uniform float u_whites;",
  "uniform float u_blacks;",
  "uniform float u_temperature;",
  "uniform float u_tint;",
  "uniform float u_vibrance;",
  "uniform float u_saturation;",
  "uniform float u_vignette;",
  "uniform float u_vignetteMidpoint;",
  "uniform float u_vignetteRoundness;",
  "uniform float u_vignetteFeather;",
  "uniform float u_grain;",
  "uniform float u_grainSize;",
  "uniform float u_grainRoughness;",
  "uniform float u_grainSeed;",
  "uniform float u_effectTime;",
  "uniform float u_blur;",
  "uniform float u_bloom;",
  "uniform float u_kuwahara;",
  "uniform float u_pixelate;",
  "uniform float u_chromaBleed;",
  "uniform float u_tapeDamage;",
  "uniform float u_tapeTracking;",
  "uniform float u_tapeNoise;",
  "uniform float u_tapeSpeed;",
  "uniform float u_filmArtifacts;",
  "uniform float u_halftone;",
  "uniform float u_halftoneSize;",
  "uniform float u_twoInkPrint;",
  "uniform float u_twoInkPrintSize;",
  "uniform float u_ascii;",
  "uniform float u_asciiSize;",
  "uniform float u_asciiInvert;",
  "uniform float u_asciiStyle;",
  "uniform float u_asciiColor;",
  "uniform float u_asciiRotation;",
  "uniform float u_dither;",
  "uniform float u_ditherSize;",
  "uniform float u_monoScreen;",
  "uniform float u_monoScreenSize;",
  "uniform float u_monoScreenAngle;",
  "uniform float u_monoScreenSpread;",
  "uniform float u_monoScreenShape;",
  "uniform float u_monoScreenInvert;",
  "uniform float u_scanlines;",
  "uniform float u_scanlineCount;",
  "uniform float u_scanlineSoftness;",
  "uniform float u_chromaticAberration;",
  "uniform float u_chromaticAngle;",
  "uniform float u_crtCurvature;",
  "uniform float u_digitalGlitch;",
  "uniform float u_digitalGlitchColorSplit;",
  "uniform float u_digitalGlitchLineTear;",
  "uniform float u_digitalGlitchPixelate;",
  "uniform float u_digitalGlitchBlockAmount;",
  "uniform float u_digitalGlitchBlockDisplacement;",
  "uniform float u_digitalGlitchBlockOpacity;",
  "uniform float u_digitalGlitchSpeed;",
  "uniform float u_engraving;",
  "uniform float u_engravingSpacing;",
  "uniform float u_engravingMinThickness;",
  "uniform float u_engravingMaxThickness;",
  "uniform float u_engravingAngle;",
  "uniform float u_engravingContrast;",
  "uniform float u_engravingSharpness;",
  "uniform float u_engravingWave;",
  "uniform float u_engravingWaveFrequency;",
  "uniform float u_crosshatch;",
  "uniform float u_crosshatchSpacing;",
  "uniform float u_crosshatchThickness;",
  "uniform float u_crosshatchAngle;",
  "uniform float u_crosshatchContrast;",
  "uniform float u_crosshatchEdges;",
  "uniform float u_crosshatchLineWeight;",
  "uniform float u_crosshatchWave;",
  "uniform float u_crosshatchWaveFrequency;",
  "uniform float u_paletteSize;",
  "uniform vec3 u_palette0;",
  "uniform vec3 u_palette1;",
  "uniform vec3 u_palette2;",
  "uniform vec3 u_palette3;",
  "uniform vec3 u_palette4;",
  "uniform vec3 u_palette5;",
  "uniform float u_intensity;",
  "uniform float u_compareEnabled;",
  "uniform float u_comparePosition;",
  "uniform float u_compareSoftness;",
  "uniform float u_compareLineWidth;",
  "const float PI = 3.14159265359;",
  "float lumaOf(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }",
  "float bt601Luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }",
  "float grainHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }",
  "float digitalHash(vec2 p){",
  "  vec2 q = mod(floor(p), 251.0);",
  "  float x = mod(q.x * q.x * 157.0 + q.x * 89.0, 251.0);",
  "  float y = mod(q.y * q.y * 113.0 + q.y * 47.0, 251.0);",
  "  float xy = mod(q.x * q.y * 71.0, 251.0);",
  "  return mod(x + y + xy + 19.0, 251.0) / 251.0;",
  "}",
  "float colorSaturation(vec3 c){ return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }",
  "vec2 clampUv(vec2 uv){ return clamp(uv, vec2(0.0), vec2(1.0)); }",
  "vec2 applyCrtWarp(vec2 uv){",
  "  vec2 centered = uv * 2.0 - 1.0;",
  "  float curvature = clamp(u_crtCurvature, 0.0, 1.0) * 0.5;",
  "  float dist = dot(centered, centered);",
  "  centered *= 1.0 + curvature * dist;",
  "  return centered * 0.5 + 0.5;",
  "}",
  "vec4 sampleSource(vec2 uv){ return texture2D(u_source, clampUv(uv)); }",
  "vec4 sampleBlur(vec2 uv){ return texture2D(u_blurSource, clampUv(uv)); }",
  "vec3 sampleBloom(vec2 uv){ return texture2D(u_bloomSource, clampUv(uv)).rgb; }",
  "vec3 sampleKuwahara(vec2 uv){",
  "  vec2 displayUv = uv * u_uvScale + u_uvOffset;",
  "  return texture2D(u_kuwaharaSource, clampUv(displayUv)).rgb;",
  "}",
  "vec4 samplePrepared(vec2 uv){",
  "  vec4 base = sampleSource(uv);",
  "  float blur = clamp(u_blur, 0.0, 1.0);",
  "  if (blur > 0.0 && u_blurReady > 0.5) base = mix(base, sampleBlur(uv), blur);",
  "  float kuwahara = clamp(u_kuwahara, 0.0, 1.0);",
  "  if (kuwahara > 0.0 && u_kuwaharaReady > 0.5) {",
  "    base.rgb = mix(base.rgb, sampleKuwahara(uv), kuwahara);",
  "  }",
  "  return base;",
  "}",
  "float tapeTrackingBand(float y, float center, float width){",
  "  float offset = fract(y - center + 0.5) - 0.5;",
  "  float triangle = max(0.0, 1.0 - abs(offset) / max(width, 0.0001));",
  "  return triangle * triangle * (3.0 - 2.0 * triangle);",
  "}",
  "vec4 sampleMedia(vec2 uv){",
  "  float pixel = clamp(u_pixelate, 0.0, 1.0);",
  "  vec2 sampleUv = uv;",
  "  if (pixel > 0.0) {",
  "    float blockSize = mix(1.0, 48.0, pixel);",
  "    vec2 cells = max(u_resolution / blockSize, vec2(1.0));",
  "    sampleUv = (floor(clamp(uv, vec2(0.0), vec2(0.999999)) * cells) + 0.5) / cells;",
  "  }",
  "  float tapeDamage = clamp(u_tapeDamage, 0.0, 1.0);",
  "  float tapeTracking = clamp(u_tapeTracking, 0.0, 1.0);",
  "  float tapeNoise = clamp(u_tapeNoise, 0.0, 1.0);",
  "  float tapeTime = u_effectTime * mix(0.0, 2.0, clamp(u_tapeSpeed, 0.0, 1.0));",
  "  float tapeFrame = floor(tapeTime * 60.0);",
  "  float tapeLine = floor(sampleUv.y * u_resolution.y * 0.5);",
  "  float lineJitter = (digitalHash(vec2(tapeLine, floor(tapeFrame * 0.5))) - 0.5) * 1.8 * tapeNoise;",
  "  float slowWobble = sin(sampleUv.y * 32.0 + tapeTime * 2.6) * 0.55;",
  "  float headSwitch = smoothstep(0.88, 1.0, sampleUv.y) * sin(sampleUv.y * 240.0 + tapeTime * 8.0) * 4.0;",
  "  float trackingShift = tapeTrackingBand(sampleUv.y, fract(0.08 + tapeTime * 0.083), 0.035);",
  "  trackingShift -= tapeTrackingBand(sampleUv.y, fract(0.28 + tapeTime * 0.061), 0.03) * 0.8;",
  "  trackingShift += tapeTrackingBand(sampleUv.y, fract(0.5 + tapeTime * 0.047), 0.04) * 0.75;",
  "  trackingShift -= tapeTrackingBand(sampleUv.y, fract(0.72 + tapeTime * 0.037), 0.028) * 0.65;",
  "  trackingShift += tapeTrackingBand(sampleUv.y, fract(0.89 + tapeTime * 0.029), 0.032) * 0.55;",
  "  trackingShift *= tapeTracking * 48.0;",
  "  float tapeShift = (lineJitter + slowWobble + headSwitch + trackingShift) * tapeDamage;",
  "  float texelX = 1.0 / max(u_resolution.x * max(u_uvScale.x, 0.00001), 1.0);",
  "  vec2 tapeUv = sampleUv + vec2(tapeShift * texelX, 0.0);",
  "  vec4 base = samplePrepared(tapeUv);",
  "  if (tapeDamage > 0.0) {",
  "    vec2 lumaStep = vec2(texelX * mix(1.0, 3.5, tapeDamage), 0.0);",
  "    vec3 leftTape = samplePrepared(tapeUv - lumaStep).rgb;",
  "    vec3 rightTape = samplePrepared(tapeUv + lumaStep).rgb;",
  "    float tapeLuma = (bt601Luma(leftTape) + bt601Luma(base.rgb) * 2.0 + bt601Luma(rightTape)) * 0.25;",
  "    vec3 centerChroma = base.rgb - vec3(bt601Luma(base.rgb));",
  "    vec3 tapeColor = vec3(tapeLuma) + centerChroma;",
  "    vec3 ghost = samplePrepared(tapeUv - vec2(texelX * 12.0, 0.0)).rgb;",
  "    tapeColor = mix(tapeColor, ghost, 0.045 * tapeDamage);",
  "    float fineNoise = digitalHash(floor(gl_FragCoord.xy) + vec2(tapeFrame * 17.0, tapeFrame * 3.0)) - 0.5;",
  "    float band = digitalHash(vec2(floor(sampleUv.y * 92.0), floor(tapeFrame / 3.0)));",
  "    float dropout = smoothstep(0.985, 1.0, band) * (digitalHash(vec2(floor(sampleUv.x * 18.0), tapeLine)) - 0.5);",
  "    tapeColor += (fineNoise * 0.035 + dropout * 0.12) * tapeDamage * tapeNoise;",
  "    base.rgb = mix(base.rgb, clamp(tapeColor, 0.0, 1.0), tapeDamage);",
  "  }",
  "  float chromaBleed = clamp(u_chromaBleed, 0.0, 1.0);",
  "  if (chromaBleed > 0.0) {",
  "    float radius = mix(1.0, 4.0, chromaBleed);",
  "    vec2 stepUv = vec2(texelX * radius, 0.0);",
  "    vec3 c0 = base.rgb;",
  "    vec3 c1 = samplePrepared(tapeUv - stepUv).rgb;",
  "    vec3 c2 = samplePrepared(tapeUv + stepUv).rgb;",
  "    vec3 c3 = samplePrepared(tapeUv - stepUv * 2.0).rgb;",
  "    vec3 c4 = samplePrepared(tapeUv + stepUv * 2.0).rgb;",
  "    float centerLuma = lumaOf(base.rgb);",
  "    vec3 blurredChroma = ((c0 - vec3(lumaOf(c0))) * 6.0 + (c1 - vec3(lumaOf(c1))) * 4.0 + (c2 - vec3(lumaOf(c2))) * 4.0 + (c3 - vec3(lumaOf(c3))) + (c4 - vec3(lumaOf(c4)))) / 16.0;",
  "    base.rgb = mix(base.rgb, clamp(vec3(centerLuma) + blurredChroma, 0.0, 1.0), chromaBleed);",
  "  }",
  "  return base;",
  "}",
  "vec4 sampleChromaticMedia(vec2 uv, vec4 center){",
  "  float amount = clamp(u_chromaticAberration, 0.0, 1.0);",
  "  if (amount <= 0.0) return center;",
  "  float angle = clamp(u_chromaticAngle, 0.0, 1.0) * PI * 2.0;",
  "  vec2 offset = vec2(cos(angle), sin(angle)) * amount * 0.02;",
  "  vec4 positive = sampleMedia(uv + offset);",
  "  vec4 negative = sampleMedia(uv - offset);",
  "  vec3 split = vec3(positive.r, center.g, negative.b);",
  "  return vec4(split, center.a);",
  "}",
  "vec3 sampleDigitalSplit(vec2 uv, vec2 block, float time, float amount){",
  "  float split = amount * 0.06;",
  "  float direction = digitalHash(block * 0.4 + vec2(floor(time * 3.7), floor(time * 5.3)));",
  "  vec2 axis = direction > 0.66 ? vec2(1.0, 0.0) : direction > 0.33 ? vec2(0.0, 1.0) : vec2(0.7071);",
  "  vec4 center = sampleMedia(uv);",
  "  return vec3(sampleMedia(uv + axis * split).r, center.g, sampleMedia(uv - axis * split).b);",
  "}",
  "vec3 applyDigitalGlitch(vec2 uv, vec3 source){",
  "  float amount = clamp(u_digitalGlitch, 0.0, 1.0);",
  "  if (amount <= 0.0) return source;",
  "  float colorSplit = clamp(u_digitalGlitchColorSplit, 0.0, 1.0) * 2.0;",
  "  float lineTear = clamp(u_digitalGlitchLineTear, 0.0, 1.0) * 2.0;",
  "  float pixelate = clamp(u_digitalGlitchPixelate, 0.0, 1.0) * 2.0;",
  "  float blockAmount = clamp(u_digitalGlitchBlockAmount, 0.0, 1.0);",
  "  float blockDisplacement = clamp(u_digitalGlitchBlockDisplacement, 0.0, 1.0) * 2.0;",
  "  float blockOpacity = clamp(u_digitalGlitchBlockOpacity, 0.0, 1.0);",
  "  float speed = clamp(u_digitalGlitchSpeed, 0.0, 1.0) * 2.0;",
  "  float time = u_effectTime * speed;",
  "  float blockCount = 8.0 + blockAmount * 60.0;",
  "  vec2 block = floor(uv * blockCount);",
  "  float randomA = digitalHash(block + vec2(floor(time * 7.3), floor(time * 11.1)));",
  "  float randomB = digitalHash(block * 0.7 + vec2(17.3 + floor(time * 6.6), 29.1));",
  "  float randomC = digitalHash(block + vec2(floor(time * 5.7) * 13.0, 41.0));",
  "  float randomD = digitalHash(block * 1.3 + vec2(7.0, floor(time * 3.2) * 7.0));",
  "  vec2 displaced = uv;",
  "  if (blockDisplacement > 0.0 && blockOpacity > 0.0) {",
  "    float threshold = 1.0 - blockDisplacement * 0.4;",
  "    if (randomA > threshold) {",
  "      displaced += vec2((randomB - 0.5) * blockDisplacement * 0.5, (randomC - 0.5) * blockDisplacement * 0.3);",
  "    }",
  "    if (randomD > 0.92 && blockDisplacement > 0.5) {",
  "      displaced.x += (digitalHash(vec2(block.y, floor(time * 8.0))) - 0.5) * blockDisplacement;",
  "    }",
  "    displaced = mix(uv, displaced, blockOpacity);",
  "  }",
  "  if (lineTear > 0.0) {",
  "    float row = floor(uv.y * (50.0 + lineTear * 150.0));",
  "    float tearA = digitalHash(vec2(row * 7.3 + floor(time * 12.0 + row * 0.1) * 3.7, 13.0));",
  "    float tearB = digitalHash(vec2(row * 13.7 + floor(time * 8.3) * 5.1, 31.0));",
  "    if (tearA > 1.0 - lineTear * 0.5) displaced.x += (tearB - 0.5) * lineTear * 0.4;",
  "    if (tearB > 0.95 && lineTear > 0.3) displaced.x += (tearA - 0.5) * lineTear * 0.8;",
  "  }",
  "  if (pixelate > 0.0) {",
  "    float pixelRandom = digitalHash(block * 0.5 + vec2(floor(time * 4.9), 53.0));",
  "    if (pixelRandom > 1.0 - pixelate * 0.35) {",
  "      float cells = 4.0 + (1.0 - pixelRandom) * pixelate * 40.0;",
  "      displaced = (floor(clampUv(displaced) * cells) + 0.5) / cells;",
  "    }",
  "  }",
  "  displaced = clampUv(displaced);",
  "  vec3 glitch = sampleDigitalSplit(displaced, block, time, colorSplit);",
  "  if (blockDisplacement > 0.2 && blockOpacity > 0.0) {",
  "    float corruption = digitalHash(block * 1.1 + vec2(floor(time * 11.9), 67.0));",
  "    vec3 changed = glitch;",
  "    if (corruption > 0.9) changed = 1.0 - glitch;",
  "    else if (corruption > 0.85) changed = corruption > 0.875 ? glitch.gbr : glitch.brg;",
  "    else if (corruption > 0.8) {",
  "      float channel = digitalHash(block + vec2(73.0));",
  "      if (channel > 0.66) changed.r = min(changed.r * 2.0, 1.0);",
  "      else if (channel > 0.33) changed.g = min(changed.g * 2.0, 1.0);",
  "      else changed.b = min(changed.b * 2.0, 1.0);",
  "    }",
  "    glitch = mix(glitch, changed, blockOpacity);",
  "  }",
  "  if (blockOpacity > 0.0) {",
  "    float flash = digitalHash(block * 0.8 + vec2(floor(time * 14.7), 83.0));",
  "    vec3 flashed = flash > 0.97 ? min(glitch * 1.8, vec3(1.0)) : flash > 0.94 ? glitch * 0.3 : glitch;",
  "    glitch = mix(glitch, flashed, blockOpacity * 0.6);",
  "  }",
  "  if (lineTear > 0.1) {",
  "    float interference = pow(sin(uv.y * (300.0 + randomA * 200.0) + time * 30.0) * 0.5 + 0.5, 6.0);",
  "    glitch -= interference * 0.08 * lineTear;",
  "  }",
  "  return mix(source, clamp(glitch, 0.0, 1.0), amount);",
  "}",
  "float dustMask(vec2 uv, float frameBucket){",
  "  vec2 grid = vec2(128.0, 72.0);",
  "  vec2 cell = floor(uv * grid);",
  "  vec2 local = fract(uv * grid) - 0.5;",
  "  float chance = grainHash(cell + frameBucket * 19.13);",
  "  float radius = mix(0.05, 0.34, grainHash(cell + 7.1));",
  "  return step(0.9975, chance) * (1.0 - smoothstep(radius, radius + 0.08, length(local)));",
  "}",
  "float screenDot(vec2 p, float ink, float angle, float sharpness){",
  "  float c = cos(angle);",
  "  float s = sin(angle);",
  "  vec2 q = mat2(c, -s, s, c) * p;",
  "  vec2 d = fract(q) - 0.5;",
  "  float radius = sqrt(clamp(ink, 0.0, 1.0)) * 0.68;",
  "  float edge = mix(0.16, 0.025, sharpness);",
  "  return 1.0 - smoothstep(radius - edge, radius + edge, length(d));",
  "}",
  "vec3 paletteColor(float index);",
  "float monoScreenMask(vec2 local, float radius, float shape, float softness){",
  "  vec2 centered = local - 0.5;",
  "  float distanceToInk = length(centered);",
  "  if (shape > 0.5 && shape < 1.5) distanceToInk = max(abs(centered.x), abs(centered.y));",
  "  if (shape > 1.5 && shape < 2.5) distanceToInk = abs(centered.x) + abs(centered.y);",
  "  if (shape > 2.5 && shape < 3.5) distanceToInk = max(abs(centered.x) * 0.86 + centered.y * 0.5, -centered.y);",
  "  if (shape > 3.5) distanceToInk = abs(centered.y);",
  "  float shapeRadius = shape > 3.5 ? radius * 0.45 : radius;",
  "  return 1.0 - smoothstep(shapeRadius, shapeRadius + softness, distanceToInk);",
  "}",
  "vec3 applyMonoScreen(vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  float invert = step(0.5, u_monoScreenInvert);",
  "  float coverage = mix(1.0 - lumaOf(source), lumaOf(source), invert);",
  "  coverage = pow(clamp(coverage, 0.0, 1.0), mix(1.7, 0.58, clamp(u_monoScreenSpread, 0.0, 1.0)));",
  "  float scale = max(min(u_resolution.x, u_resolution.y) / 540.0, 0.25);",
  "  float cellPx = mix(4.0, 18.0, clamp(u_monoScreenSize, 0.0, 1.0)) * scale;",
  "  float angle = clamp(u_monoScreenAngle, 0.0, 1.0) * PI * 0.5;",
  "  float cosine = cos(angle);",
  "  float sine = sin(angle);",
  "  vec2 point = mat2(cosine, -sine, sine, cosine) * gl_FragCoord.xy / max(cellPx, 1.0);",
  "  float radius = sqrt(coverage) * 0.68;",
  "  float inkMask = monoScreenMask(fract(point), radius, floor(u_monoScreenShape + 0.5), 0.035);",
  "  vec3 ink = paletteColor(0.0);",
  "  vec3 paper = paletteColor(max(u_paletteSize - 1.0, 1.0));",
  "  return mix(source, mix(paper, ink, inkMask), amount);",
  "}",
  "vec3 applyEngraving(vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  float spacing = mix(3.0, 20.0, clamp(u_engravingSpacing, 0.0, 1.0));",
  "  float minThickness = mix(0.0, 2.0, clamp(u_engravingMinThickness, 0.0, 1.0));",
  "  float maxThickness = mix(1.0, 8.0, clamp(u_engravingMaxThickness, 0.0, 1.0));",
  "  float angle = clamp(u_engravingAngle, 0.0, 1.0) * PI;",
  "  vec2 alongAxis = vec2(cos(angle), sin(angle));",
  "  vec2 acrossAxis = vec2(-alongAxis.y, alongAxis.x);",
  "  float along = dot(gl_FragCoord.xy, alongAxis);",
  "  float across = dot(gl_FragCoord.xy, acrossAxis);",
  "  float frequency = mix(1.0, 10.0, clamp(u_engravingWaveFrequency, 0.0, 1.0));",
  "  float wave = sin(along * frequency * 0.01);",
  "  across += wave * clamp(u_engravingWave, 0.0, 1.0) * 3.0;",
  "  float lineIndex = floor(across / max(spacing, 1.0));",
  "  float lineDistance = abs(fract(across / max(spacing, 1.0)) - 0.5) * spacing;",
  "  float contrast = mix(0.5, 2.0, clamp(u_engravingContrast, 0.0, 1.0));",
  "  float darkness = 1.0 - pow(clamp(lumaOf(source), 0.0, 1.0), contrast);",
  "  float variation = mix(0.88, 1.12, digitalHash(vec2(lineIndex, 73.0)));",
  "  float thickness = mix(minThickness, maxThickness, darkness) * variation;",
  "  float edge = mix(1.0, 0.3, clamp(u_engravingSharpness, 0.0, 1.0));",
  "  float inkMask = 1.0 - smoothstep(max(thickness * 0.5 - edge, 0.0), thickness * 0.5 + edge, lineDistance);",
  "  inkMask *= smoothstep(0.015, 0.12, darkness);",
  "  vec3 ink = paletteColor(0.0);",
  "  vec3 paper = paletteColor(max(u_paletteSize - 1.0, 1.0));",
  "  return mix(source, mix(paper, ink, inkMask), amount);",
  "}",
  "float crosshatchLine(vec2 pixel, float angle, float spacing, float thickness, float seed){",
  "  vec2 alongAxis = vec2(cos(angle), sin(angle));",
  "  vec2 acrossAxis = vec2(-alongAxis.y, alongAxis.x);",
  "  float along = dot(pixel, alongAxis);",
  "  float across = dot(pixel, acrossAxis);",
  "  float frequency = mix(1.0, 10.0, clamp(u_crosshatchWaveFrequency, 0.0, 1.0));",
  "  across += sin(along * frequency * 0.02 + u_effectTime + seed) * clamp(u_crosshatchWave, 0.0, 1.0) * 5.0;",
  "  float lineIndex = floor(across / max(spacing, 1.0));",
  "  float distanceToLine = abs(fract(across / max(spacing, 1.0)) - 0.5) * spacing;",
  "  float variation = mix(1.0, 0.5 + digitalHash(vec2(lineIndex, seed)), clamp(u_crosshatchLineWeight, 0.0, 1.0));",
  "  float halfWidth = thickness * variation * 0.5;",
  "  return 1.0 - smoothstep(max(halfWidth - 0.5, 0.0), halfWidth + 0.5, distanceToLine);",
  "}",
  "float crosshatchEdge(vec2 uv){",
  "  vec2 texel = 1.0 / max(u_resolution * u_uvScale, vec2(1.0));",
  "  float tl = lumaOf(sampleMedia(uv + texel * vec2(-1.0, -1.0)).rgb);",
  "  float tc = lumaOf(sampleMedia(uv + texel * vec2( 0.0, -1.0)).rgb);",
  "  float tr = lumaOf(sampleMedia(uv + texel * vec2( 1.0, -1.0)).rgb);",
  "  float ml = lumaOf(sampleMedia(uv + texel * vec2(-1.0,  0.0)).rgb);",
  "  float mr = lumaOf(sampleMedia(uv + texel * vec2( 1.0,  0.0)).rgb);",
  "  float bl = lumaOf(sampleMedia(uv + texel * vec2(-1.0,  1.0)).rgb);",
  "  float bc = lumaOf(sampleMedia(uv + texel * vec2( 0.0,  1.0)).rgb);",
  "  float br = lumaOf(sampleMedia(uv + texel * vec2( 1.0,  1.0)).rgb);",
  "  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;",
  "  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;",
  "  return length(vec2(gx, gy));",
  "}",
  "vec3 applyCrosshatch(vec2 uv, vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  float spacing = mix(5.0, 30.0, clamp(u_crosshatchSpacing, 0.0, 1.0));",
  "  float thickness = mix(1.0, 5.0, clamp(u_crosshatchThickness, 0.0, 1.0));",
  "  float baseAngle = -clamp(u_crosshatchAngle, 0.0, 1.0) * PI;",
  "  float contrast = mix(0.5, 2.0, clamp(u_crosshatchContrast, 0.0, 1.0));",
  "  float darkness = 1.0 - pow(clamp(lumaOf(source), 0.0, 1.0), contrast);",
  "  vec3 ink = paletteColor(0.0);",
  "  vec3 paper = paletteColor(max(u_paletteSize - 1.0, 1.0));",
  "  vec3 result = paper;",
  "  float layer = crosshatchLine(gl_FragCoord.xy, baseAngle, spacing, thickness, 1.0) * smoothstep(0.2, 0.4, darkness);",
  "  result = mix(result, ink, layer);",
  "  layer = crosshatchLine(gl_FragCoord.xy, baseAngle + PI * 0.5, spacing * 0.95, thickness * 0.9, 2.0) * smoothstep(0.4, 0.6, darkness);",
  "  result = mix(result, ink, layer);",
  "  layer = crosshatchLine(gl_FragCoord.xy, baseAngle + PI * 0.25, spacing * 0.9, thickness * 0.8, 3.0) * smoothstep(0.6, 0.8, darkness);",
  "  result = mix(result, ink, layer);",
  "  layer = crosshatchLine(gl_FragCoord.xy, baseAngle - PI * 0.25, spacing * 0.85, thickness * 0.7, 4.0) * smoothstep(0.75, 0.9, darkness);",
  "  result = mix(result, ink, layer);",
  "  result = mix(result, ink, smoothstep(0.9, 1.0, darkness) * 0.8);",
  "  float edgeStrength = mix(0.0, 2.0, clamp(u_crosshatchEdges, 0.0, 1.0));",
  "  float edge = smoothstep(0.1, 0.3, crosshatchEdge(uv)) * edgeStrength;",
  "  result = mix(result, ink, clamp(edge, 0.0, 1.0));",
  "  return mix(source, result, amount);",
  "}",
  "vec3 applyHalftone(vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  vec3 cmy = 1.0 - source;",
  "  float k = min(cmy.r, min(cmy.g, cmy.b));",
  "  vec3 inks = max(cmy - vec3(k * 0.72), 0.0);",
  "  float scale = min(u_resolution.x, u_resolution.y) / 540.0;",
  "  float cellPx = mix(5.0, 14.0, clamp(u_halftoneSize, 0.0, 1.0)) * max(scale, 0.25);",
  "  vec2 p = gl_FragCoord.xy / max(cellPx, 1.0);",
  "  float cyan = screenDot(p, inks.r, 0.261799, 0.78);",
  "  float magenta = screenDot(p, inks.g, 1.308997, 0.78);",
  "  float yellow = screenDot(p, inks.b, 0.0, 0.78);",
  "  float blackInk = screenDot(p, k, 0.785398, 0.82);",
  "  vec3 printColor = vec3(0.975, 0.962, 0.925);",
  "  printColor *= mix(vec3(1.0), vec3(0.05, 0.79, 0.86), cyan);",
  "  printColor *= mix(vec3(1.0), vec3(0.91, 0.08, 0.48), magenta);",
  "  printColor *= mix(vec3(1.0), vec3(0.98, 0.83, 0.08), yellow);",
  "  printColor *= mix(vec3(1.0), vec3(0.035), blackInk * 0.92);",
  "  return mix(source, printColor, amount);",
  "}",
  "vec3 applyTwoInkPrint(vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  float sourceLuma = lumaOf(source);",
  "  float darkness = 1.0 - sourceLuma;",
  "  float warmBias = clamp(source.r - (source.g + source.b) * 0.5, -0.35, 0.35);",
  "  float coolBias = clamp((source.g + source.b) * 0.5 - source.r, -0.35, 0.35);",
  "  float redTone = smoothstep(0.08, 0.72, darkness) * (1.0 - 0.68 * smoothstep(0.66, 1.0, darkness));",
  "  float tealTone = smoothstep(0.30, 0.92, darkness);",
  "  float redCoverage = clamp(redTone + warmBias * 1.35 - coolBias * 0.35, 0.0, 1.0);",
  "  float tealCoverage = clamp(tealTone + coolBias * 1.1 - warmBias * 0.45, 0.0, 1.0);",
  "  float scale = min(u_resolution.x, u_resolution.y) / 540.0;",
  "  float cellPx = mix(4.5, 12.0, clamp(u_twoInkPrintSize, 0.0, 1.0)) * max(scale, 0.25);",
  "  vec2 p = gl_FragCoord.xy / max(cellPx, 1.0);",
  "  float redDot = screenDot(p, redCoverage, 0.261799, 0.84);",
  "  float tealDot = screenDot(p + vec2(0.12, -0.08), tealCoverage, 1.308997, 0.84);",
  "  float paperNoise = grainHash(floor(gl_FragCoord.xy * 0.5)) - 0.5;",
  "  vec3 paper = vec3(0.955, 0.910, 0.795) + paperNoise * 0.018;",
  "  vec3 vermilion = vec3(0.88, 0.13, 0.075);",
  "  vec3 teal = vec3(0.035, 0.285, 0.355);",
  "  vec3 overprint = vec3(0.045, 0.055, 0.052);",
  "  vec3 printColor = paper * (1.0 - redDot) * (1.0 - tealDot);",
  "  printColor += vermilion * redDot * (1.0 - tealDot);",
  "  printColor += teal * (1.0 - redDot) * tealDot;",
  "  printColor += overprint * redDot * tealDot;",
  "  return mix(source, clamp(printColor, 0.0, 1.0), amount);",
  "}",
  "vec3 paletteColor(float index){",
  "  if (index < 0.5) return u_palette0;",
  "  if (index < 1.5) return u_palette1;",
  "  if (index < 2.5) return u_palette2;",
  "  if (index < 3.5) return u_palette3;",
  "  if (index < 4.5) return u_palette4;",
  "  return u_palette5;",
  "}",
  "float bayer4(vec2 point){",
  "  vec2 cell = mod(floor(point), 4.0);",
  "  if (cell.y < 0.5) {",
  "    if (cell.x < 0.5) return 0.5 / 16.0;",
  "    if (cell.x < 1.5) return 8.5 / 16.0;",
  "    if (cell.x < 2.5) return 2.5 / 16.0;",
  "    return 10.5 / 16.0;",
  "  }",
  "  if (cell.y < 1.5) {",
  "    if (cell.x < 0.5) return 12.5 / 16.0;",
  "    if (cell.x < 1.5) return 4.5 / 16.0;",
  "    if (cell.x < 2.5) return 14.5 / 16.0;",
  "    return 6.5 / 16.0;",
  "  }",
  "  if (cell.y < 2.5) {",
  "    if (cell.x < 0.5) return 3.5 / 16.0;",
  "    if (cell.x < 1.5) return 11.5 / 16.0;",
  "    if (cell.x < 2.5) return 1.5 / 16.0;",
  "    return 9.5 / 16.0;",
  "  }",
  "  if (cell.x < 0.5) return 15.5 / 16.0;",
  "  if (cell.x < 1.5) return 7.5 / 16.0;",
  "  if (cell.x < 2.5) return 13.5 / 16.0;",
  "  return 5.5 / 16.0;",
  "}",
  "float standardAsciiSample(float brightness, vec2 grid){",
  "  if (brightness < 0.1) return 0.0;",
  "  if (brightness < 0.2) return grid.x == 2.0 && grid.y == 5.0 ? 1.0 : 0.0;",
  "  if (brightness < 0.3) return grid.x == 2.0 && (grid.y == 2.0 || grid.y == 4.0) ? 1.0 : 0.0;",
  "  if (brightness < 0.4) return (grid.y == 2.0 || grid.y == 4.0) && grid.x >= 1.0 && grid.x <= 3.0 ? 1.0 : 0.0;",
  "  if (brightness < 0.5) {",
  "    bool cross = (grid.x == 2.0 && grid.y >= 2.0 && grid.y <= 4.0) || (grid.y == 3.0 && grid.x >= 1.0 && grid.x <= 3.0);",
  "    bool diagonals = (grid.x == 1.0 || grid.x == 3.0) && (grid.y == 2.0 || grid.y == 4.0);",
  "    return cross || diagonals ? 1.0 : 0.0;",
  "  }",
  "  if (brightness < 0.6) {",
  "    bool ring = ((grid.y == 2.0 || grid.y == 4.0) && grid.x >= 1.0 && grid.x <= 3.0) || ((grid.x == 1.0 || grid.x == 3.0) && grid.y == 3.0);",
  "    return ring ? 1.0 : 0.0;",
  "  }",
  "  bool outline = ((grid.y == 1.0 || grid.y == 5.0) && grid.x >= 1.0 && grid.x <= 3.0) || ((grid.x == 0.0 || grid.x == 4.0) && grid.y >= 2.0 && grid.y <= 4.0) || ((grid.x == 1.0 || grid.x == 3.0) && grid.y >= 1.0 && grid.y <= 5.0);",
  "  if (brightness < 0.7) return outline ? 1.0 : 0.0;",
  "  if (brightness < 0.8) {",
  "    bool slash = abs(grid.x - 2.0) == abs(grid.y - 3.0) && grid.x >= 1.0 && grid.x <= 3.0;",
  "    return outline || slash ? 1.0 : 0.0;",
  "  }",
  "  if (brightness < 0.9) {",
  "    bool loops = ((grid.y == 1.0 || grid.y == 3.0 || grid.y == 5.0) && grid.x >= 1.0 && grid.x <= 3.0) || ((grid.x == 1.0 || grid.x == 3.0) && (grid.y == 2.0 || grid.y == 4.0));",
  "    return loops ? 1.0 : 0.0;",
  "  }",
  "  return 1.0;",
  "}",
  "float asciiStyleSample(float style, float brightness, vec2 uv){",
  "  vec2 grid = floor(uv * vec2(5.0, 7.0));",
  "  if (style < 0.5) return standardAsciiSample(brightness, grid);",
  "  if (style < 1.5) {",
  "    float checker = mod(grid.x + grid.y, 2.0);",
  "    float ruled = mod(grid.x, 2.0) == 0.0 || mod(grid.y, 2.0) == 0.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.125) return 0.0;",
  "    if (brightness < 0.25) return checker == 0.0 ? 0.5 : 0.0;",
  "    if (brightness < 0.375) return ruled * 0.6;",
  "    if (brightness < 0.5) return checker == 0.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.625) return ruled > 0.5 ? 1.0 : 0.3;",
  "    if (brightness < 0.75) return checker == 0.0 ? 1.0 : 0.7;",
  "    if (brightness < 0.875) return ruled > 0.5 ? 1.0 : 0.85;",
  "    return 1.0;",
  "  }",
  "  if (style < 2.5) {",
  "    if (brightness < 0.14) return 0.0;",
  "    if (brightness < 0.28) return grid.x == 2.0 && grid.y == 1.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.42) return grid.x == 2.0 && grid.y == 5.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.56) return grid.y == 3.0 && grid.x >= 1.0 && grid.x <= 3.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.7) return (grid.x == 2.0 && grid.y >= 2.0 && grid.y <= 4.0) || (grid.y == 3.0 && grid.x >= 1.0 && grid.x <= 3.0) ? 1.0 : 0.0;",
  "    if (brightness < 0.84) return abs(grid.x - 2.0) == abs(grid.y - 3.0) && grid.y >= 2.0 && grid.y <= 4.0 ? 1.0 : 0.0;",
  "    return grid.x == 1.0 || grid.x == 3.0 || grid.y == 2.0 || grid.y == 4.0 ? 1.0 : 0.0;",
  "  }",
  "  if (style < 3.5) return grid.y >= 6.0 - brightness * 7.0 ? 1.0 : 0.0;",
  "  if (style < 4.5) {",
  "    vec2 dots = floor(uv * vec2(2.0, 4.0));",
  "    if (brightness < 0.125) return 0.0;",
  "    if (brightness < 0.25) return dots.y == 3.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.375) return dots.y >= 2.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.5) return dots.y >= 1.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.625) return dots.y >= 1.0 || dots.x == 1.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.75) return 1.0;",
  "    if (brightness < 0.875) return mod(grid.x + grid.y, 2.0) < 1.5 ? 1.0 : 0.7;",
  "    return 1.0;",
  "  }",
  "  if (style < 5.5) {",
  "    if (brightness < 0.125) return 0.0;",
  "    if (brightness < 0.25) return grid.x == 2.0 && grid.y == 3.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.375) return grid.y == 3.0 && grid.x >= 1.0 && grid.x <= 3.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.5) return grid.x + grid.y == 5.0 || grid.x + grid.y == 6.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.625) return grid.x == 2.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.75) return abs(grid.x - grid.y / 1.4) < 0.7 && grid.x >= 1.0 && grid.x <= 3.0 ? 1.0 : 0.0;",
  "    if (brightness < 0.875) return grid.x == 2.0 || grid.y == 3.0 ? 1.0 : 0.0;",
  "    return grid.x == 1.0 || grid.x == 3.0 || grid.y == 2.0 || grid.y == 4.0 ? 1.0 : 0.0;",
  "  }",
  "  if (style < 6.5) {",
  "    bool top = grid.y == 0.0 && grid.x >= 1.0 && grid.x <= 3.0;",
  "    bool topLeft = grid.x == 1.0 && grid.y <= 3.0;",
  "    bool topRight = grid.x == 3.0 && grid.y <= 3.0;",
  "    bool middle = grid.y == 3.0 && grid.x >= 1.0 && grid.x <= 3.0;",
  "    bool bottomLeft = grid.x == 1.0 && grid.y >= 3.0;",
  "    bool bottomRight = grid.x == 3.0 && grid.y >= 3.0;",
  "    bool bottom = grid.y == 6.0 && grid.x >= 1.0 && grid.x <= 3.0;",
  "    if (brightness < 0.1) return 0.0;",
  "    if (brightness < 0.2) return topRight || bottomRight ? 1.0 : 0.0;",
  "    if (brightness < 0.3) return top || topRight || middle || bottomLeft || bottom ? 1.0 : 0.0;",
  "    if (brightness < 0.4) return top || topRight || middle || bottomRight || bottom ? 1.0 : 0.0;",
  "    if (brightness < 0.5) return topLeft || middle || topRight || bottomRight ? 1.0 : 0.0;",
  "    if (brightness < 0.6) return top || topLeft || middle || bottomRight || bottom ? 1.0 : 0.0;",
  "    if (brightness < 0.7) return top || topLeft || middle || bottomLeft || bottomRight || bottom ? 1.0 : 0.0;",
  "    if (brightness < 0.8) return top || topRight || bottomRight ? 1.0 : 0.0;",
  "    if (brightness < 0.9) return top || topLeft || topRight || middle || bottomLeft || bottomRight || bottom ? 1.0 : 0.0;",
  "    return top || topLeft || topRight || middle || bottomRight || bottom ? 1.0 : 0.0;",
  "  }",
  "  float slash = grid.x - grid.y;",
  "  float backslash = grid.x + grid.y;",
  "  if (brightness < 0.16) return 0.0;",
  "  if (brightness < 0.33) return mod(slash, 3.0) < 0.5 ? 1.0 : 0.0;",
  "  if (brightness < 0.5) return mod(slash, 2.0) < 0.5 ? 1.0 : 0.0;",
  "  bool diagonalA = mod(slash, 2.0) < 0.5;",
  "  bool diagonalB = mod(backslash, 2.0) < 0.5;",
  "  if (brightness < 0.66) return diagonalA || diagonalB ? 1.0 : 0.0;",
  "  if (brightness < 0.83) return mod(slash, 1.5) < 0.5 || mod(backslash, 1.5) < 0.5 ? 1.0 : 0.2;",
  "  return mod(slash, 1.0) < 0.6 || mod(backslash, 1.0) < 0.6 ? 1.0 : 0.5;",
  "}",
  "vec3 sampleLut(float r, float g, float b){",
  "  float size = max(u_lutSize, 2.0);",
  "  float x = (r + b * size + 0.5) / max(u_lutTextureSize.x, 1.0);",
  "  float y = (g + 0.5) / max(u_lutTextureSize.y, 1.0);",
  "  return texture2D(u_lut, vec2(x, y)).rgb;",
  "}",
  "vec3 applyLut(vec3 color){",
  "  if (u_lutEnabled < 0.5) return color;",
  "  float size = max(u_lutSize, 2.0);",
  "  vec3 span = max(u_lutDomainMax - u_lutDomainMin, vec3(0.00001));",
  "  vec3 scaled = clamp((color - u_lutDomainMin) / span, 0.0, 1.0) * (size - 1.0);",
  "  vec3 lo = floor(scaled);",
  "  vec3 hi = min(lo + 1.0, vec3(size - 1.0));",
  "  vec3 f = scaled - lo;",
  "  vec3 c000 = sampleLut(lo.r, lo.g, lo.b);",
  "  vec3 c100 = sampleLut(hi.r, lo.g, lo.b);",
  "  vec3 c010 = sampleLut(lo.r, hi.g, lo.b);",
  "  vec3 c110 = sampleLut(hi.r, hi.g, lo.b);",
  "  vec3 c001 = sampleLut(lo.r, lo.g, hi.b);",
  "  vec3 c101 = sampleLut(hi.r, lo.g, hi.b);",
  "  vec3 c011 = sampleLut(lo.r, hi.g, hi.b);",
  "  vec3 c111 = sampleLut(hi.r, hi.g, hi.b);",
  "  vec3 c00 = mix(c000, c100, f.r);",
  "  vec3 c10 = mix(c010, c110, f.r);",
  "  vec3 c01 = mix(c001, c101, f.r);",
  "  vec3 c11 = mix(c011, c111, f.r);",
  "  vec3 c0 = mix(c00, c10, f.g);",
  "  vec3 c1 = mix(c01, c11, f.g);",
  "  vec3 lutColor = mix(c0, c1, f.b);",
  "  return mix(color, lutColor, clamp(u_lutIntensity, 0.0, 1.0));",
  "}",
  "vec3 applyPrimaryGrade(vec3 color){",
  "  color *= pow(2.0, u_exposure);",
  "  float y = lumaOf(color);",
  "  float shadowMask = 1.0 - smoothstep(0.0, 0.65, y);",
  "  float highlightMask = smoothstep(0.35, 1.0, y);",
  "  color += u_shadows * 0.35 * shadowMask;",
  "  color += u_highlights * 0.35 * highlightMask;",
  "  float blackPoint = clamp(u_blacks * 0.18, -0.18, 0.18);",
  "  float whitePoint = clamp(1.0 - u_whites * 0.18, 0.82, 1.18);",
  "  color = (color - blackPoint) / max(whitePoint - blackPoint, 0.2);",
  "  color.r += u_temperature * 0.08 + u_tint * 0.04;",
  "  color.b -= u_temperature * 0.08 - u_tint * 0.04;",
  "  color.g -= u_tint * 0.08;",
  "  color = (color - 0.5) * max(0.0, 1.0 + u_contrast) + 0.5;",
  "  float satLuma = lumaOf(color);",
  "  float currentSat = clamp(colorSaturation(color), 0.0, 1.0);",
  "  float skinLike = smoothstep(0.02, 0.18, color.r - color.g) * smoothstep(0.0, 0.16, color.g - color.b) * smoothstep(0.18, 0.82, satLuma);",
  "  float vibranceWeight = (1.0 - currentSat * 0.72) * mix(1.0, 0.55, skinLike);",
  "  color = mix(vec3(satLuma), color, max(0.0, 1.0 + u_vibrance * vibranceWeight));",
  "  color = mix(vec3(satLuma), color, max(0.0, 1.0 + u_saturation));",
  "  return clamp(applyLut(clamp(color, 0.0, 1.0)), 0.0, 1.0);",
  "}",
  "vec3 applyDither(vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  float scale = max(min(u_resolution.x, u_resolution.y) / 540.0, 0.25);",
  "  float pixelSize = mix(1.0, 5.0, clamp(u_ditherSize, 0.0, 1.0)) * scale;",
  "  vec2 block = floor(gl_FragCoord.xy / max(pixelSize, 1.0));",
  "  float levels = clamp(u_paletteSize, 2.0, 6.0);",
  "  float index = floor(clamp(lumaOf(source) * (levels - 1.0) + bayer4(block), 0.0, levels - 1.0));",
  "  return mix(source, paletteColor(index), amount);",
  "}",
  "vec2 asciiEdgeDirection(vec2 uv, vec2 stepUv){",
  "  float topLeft = bt601Luma(sampleMedia(uv + vec2(-stepUv.x, -stepUv.y)).rgb);",
  "  float top = bt601Luma(sampleMedia(uv + vec2(0.0, -stepUv.y)).rgb);",
  "  float topRight = bt601Luma(sampleMedia(uv + vec2(stepUv.x, -stepUv.y)).rgb);",
  "  float left = bt601Luma(sampleMedia(uv + vec2(-stepUv.x, 0.0)).rgb);",
  "  float right = bt601Luma(sampleMedia(uv + vec2(stepUv.x, 0.0)).rgb);",
  "  float bottomLeft = bt601Luma(sampleMedia(uv + vec2(-stepUv.x, stepUv.y)).rgb);",
  "  float bottom = bt601Luma(sampleMedia(uv + vec2(0.0, stepUv.y)).rgb);",
  "  float bottomRight = bt601Luma(sampleMedia(uv + stepUv).rgb);",
  "  float x = -topLeft - 2.0 * left - bottomLeft + topRight + 2.0 * right + bottomRight;",
  "  float y = -topLeft - 2.0 * top - topRight + bottomLeft + 2.0 * bottom + bottomRight;",
  "  return vec2(x, y);",
  "}",
  "vec2 rotateAsciiUv(vec2 uv, float angle){",
  "  float cosine = cos(angle);",
  "  float sine = sin(angle);",
  "  vec2 centered = uv - 0.5;",
  "  return vec2(centered.x * cosine - centered.y * sine, centered.x * sine + centered.y * cosine) + 0.5;",
  "}",
  "vec3 applyAscii(vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  float scale = max(min(u_resolution.x, u_resolution.y) / 540.0, 0.25);",
  "  float cellHeight = mix(4.0, 80.0, clamp(u_asciiSize, 0.0, 1.0)) * scale;",
  "  vec2 cellSize = vec2(cellHeight);",
  "  vec2 cell = floor(gl_FragCoord.xy / cellSize);",
  "  vec2 cellVuv = (cell + 0.5) * cellSize / max(u_resolution, vec2(1.0));",
  "  vec2 cellUv = (cellVuv - u_uvOffset) / u_uvScale;",
  "  cellUv = applyCrtWarp(cellUv);",
  "  vec3 cellColor = applyPrimaryGrade(sampleMedia(cellUv).rgb);",
  "  float brightness = bt601Luma(cellColor);",
  "  float invert = step(0.5, u_asciiInvert);",
  "  brightness = mix(brightness, 1.0 - brightness, invert);",
  "  vec2 glyphUv = fract(gl_FragCoord.xy / cellSize);",
  "  float rotation = clamp(u_asciiRotation, 0.0, 1.0);",
  "  if (rotation > 0.0) {",
  "    vec2 cellStepUv = cellSize / max(u_resolution * u_uvScale, vec2(1.0));",
  "    vec2 edge = asciiEdgeDirection(cellUv, cellStepUv);",
  "    if (length(edge) > 0.1) glyphUv = mix(glyphUv, rotateAsciiUv(glyphUv, atan(edge.y, edge.x)), rotation);",
  "  }",
  "  float ink = asciiStyleSample(floor(u_asciiStyle + 0.5), brightness, glyphUv);",
  "  vec3 background = paletteColor(0.0);",
  "  vec3 inkColor = mix(paletteColor(max(u_paletteSize - 1.0, 1.0)), cellColor, clamp(u_asciiColor, 0.0, 1.0));",
  "  vec3 asciiColor = mix(background, inkColor, ink);",
  "  return mix(source, asciiColor, amount);",
  "}",
  "vec3 applyScanlines(vec3 source, float amount){",
  "  if (amount <= 0.0) return source;",
  "  float count = mix(50.0, 500.0, clamp(u_scanlineCount, 0.0, 1.0));",
  "  float softness = clamp(u_scanlineSoftness, 0.0, 1.0);",
  "  float wave = 0.5 + 0.5 * sin(v_uv.y * count * PI);",
  "  float line = mix(1.0 - wave, pow(1.0 - wave, 2.2), softness);",
  "  return source * (1.0 - line * amount);",
  "}",
  "void main(){",
  "  vec2 uv = (v_uv - u_uvOffset) / u_uvScale;",
  "  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {",
  "    gl_FragColor = vec4(0.0);",
  "    return;",
  "  }",
  "  vec4 originalSample = sampleSource(uv);",
  "  uv = applyCrtWarp(uv);",
  "  vec2 displayEdge = smoothstep(vec2(0.0), vec2(0.006), uv) * (1.0 - smoothstep(vec2(0.994), vec2(1.0), uv));",
  "  float displayMask = displayEdge.x * displayEdge.y;",
  "  vec4 sampleColor = sampleMedia(uv);",
  "  sampleColor = sampleChromaticMedia(uv, sampleColor);",
  "  sampleColor.rgb = applyDigitalGlitch(uv, sampleColor.rgb);",
  "  vec3 original = originalSample.rgb;",
  "  vec3 color = mix(sampleColor.rgb, applyPrimaryGrade(sampleColor.rgb), u_intensity);",
  "  float grainAmount = clamp(u_grain, 0.0, 1.0);",
  "  if (grainAmount > 0.0) {",
  "    float grainPixelSize = mix(1.0, 6.0, clamp(u_grainSize, 0.0, 1.0));",
  "    vec2 grainCoord = floor(gl_FragCoord.xy / grainPixelSize) + vec2(u_grainSeed, u_grainSeed * 1.37);",
  "    float grainBase = grainHash(grainCoord) - grainHash(grainCoord + vec2(19.19, 73.31));",
  "    float grainFine = grainHash(gl_FragCoord.xy + vec2(u_grainSeed * 2.11, u_grainSeed * 0.71)) - 0.5;",
  "    float grain = mix(grainBase * 0.7, grainBase + grainFine * 0.35, clamp(u_grainRoughness, 0.0, 1.0));",
  "    float grainLuma = lumaOf(color);",
  "    float grainMask = smoothstep(0.02, 0.55, grainLuma) * (1.0 - smoothstep(0.88, 1.0, grainLuma));",
  "    color += grain * grainAmount * mix(0.025, 0.08, grainMask);",
  "  }",
  "  float filmArtifacts = clamp(u_filmArtifacts, 0.0, 1.0);",
  "  if (filmArtifacts > 0.0) {",
  "    float filmFrame = floor(u_grainSeed);",
  "    float dust = dustMask(v_uv, floor(filmFrame / 3.0));",
  "    float dustTone = grainHash(vec2(floor(filmFrame / 3.0), 8.0));",
  "    color = mix(color, vec3(dustTone > 0.5 ? 0.95 : 0.02), dust * 0.72 * filmArtifacts);",
  "    float scratchBucket = floor(filmFrame / 12.0);",
  "    float scratchX = grainHash(vec2(scratchBucket, 4.2));",
  "    float scratchLife = step(0.78, grainHash(vec2(scratchBucket, 8.4)));",
  "    float scratch = (1.0 - smoothstep(0.0, 1.4 / max(u_resolution.x, 1.0), abs(v_uv.x - scratchX))) * scratchLife;",
  "    color = mix(color, vec3(0.94, 0.88, 0.76), scratch * 0.28 * filmArtifacts);",
  "  }",
  "  color = applyMonoScreen(clamp(color, 0.0, 1.0), clamp(u_monoScreen, 0.0, 1.0));",
  "  color = applyEngraving(clamp(color, 0.0, 1.0), clamp(u_engraving, 0.0, 1.0));",
  "  color = applyCrosshatch(uv, clamp(color, 0.0, 1.0), clamp(u_crosshatch, 0.0, 1.0));",
  "  color = applyHalftone(clamp(color, 0.0, 1.0), clamp(u_halftone, 0.0, 1.0));",
  "  color = applyTwoInkPrint(clamp(color, 0.0, 1.0), clamp(u_twoInkPrint, 0.0, 1.0));",
  "  color = applyDither(clamp(color, 0.0, 1.0), clamp(u_dither, 0.0, 1.0));",
  "  color = applyAscii(clamp(color, 0.0, 1.0), clamp(u_ascii, 0.0, 1.0));",
  "  if (u_bloomReady > 0.5 && u_bloom > 0.0) color += sampleBloom(uv) * u_bloom;",
  "  color = applyScanlines(clamp(color, 0.0, 1.0), clamp(u_scanlines, 0.0, 1.0));",
  "  vec2 vignetteAspect = u_resolution.x > u_resolution.y",
  "    ? vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0)",
  "    : vec2(1.0, u_resolution.y / max(u_resolution.x, 1.0));",
  "  vec2 vignetteUv = abs((v_uv - vec2(0.5)) * 2.0) * vignetteAspect;",
  "  float vignettePower = mix(8.0, 1.8, clamp(u_vignetteRoundness * 0.5 + 0.5, 0.0, 1.0));",
  "  float vignetteDistance = pow(pow(vignetteUv.x, vignettePower) + pow(vignetteUv.y, vignettePower), 1.0 / vignettePower);",
  "  float vignetteMidpoint = mix(0.22, 1.08, clamp(u_vignetteMidpoint, 0.0, 1.0));",
  "  float vignetteFeather = mix(0.08, 0.72, clamp(u_vignetteFeather, 0.0, 1.0));",
  "  float vignetteMask = smoothstep(vignetteMidpoint, vignetteMidpoint + vignetteFeather, vignetteDistance);",
  "  color *= 1.0 - vignetteMask * clamp(u_vignette, 0.0, 1.0) * 0.75;",
  "  float warpActive = step(0.0001, u_crtCurvature);",
  "  color *= mix(1.0, displayMask, warpActive);",
  "  vec3 graded = clamp(color, 0.0, 1.0);",
  "  if (u_compareEnabled > 0.5) {",
  "    float pos = clamp(u_comparePosition, 0.0, 1.0);",
  "    float softness = max(u_compareSoftness, 0.00001);",
  "    float afterMask = smoothstep(pos - softness, pos + softness, v_uv.x);",
  "    vec3 splitColor = mix(original, graded, afterMask);",
  "    float lineMask = 0.0;",
  "    if (u_compareLineWidth > 0.0) {",
  "      float lineWidth = max(u_compareLineWidth / max(u_resolution.x, 1.0), 0.00001);",
  "      lineMask = 1.0 - smoothstep(lineWidth, lineWidth * 1.8, abs(v_uv.x - pos));",
  "    }",
  "    gl_FragColor = vec4(mix(splitColor, vec3(1.0), lineMask * 0.82), sampleColor.a);",
  "    return;",
  "  }",
  "  gl_FragColor = vec4(graded, sampleColor.a);",
  "}",
].join("\n");

const BLUR_FRAGMENT_SHADER = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "varying vec2 v_uv;",
  "uniform sampler2D u_source;",
  "uniform vec2 u_resolution;",
  "uniform vec2 u_direction;",
  "uniform float u_radius;",
  "uniform float u_bloomPass;",
  "uniform float u_threshold;",
  "vec4 readSource(vec2 uv){",
  "  vec4 color = texture2D(u_source, clamp(uv, vec2(0.0), vec2(1.0)));",
  "  if (u_bloomPass > 0.5) {",
  "    float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));",
  "    if (u_threshold >= 0.0 && luminance <= u_threshold) color.rgb = vec3(0.0);",
  "    return vec4(color.rgb, 1.0);",
  "  }",
  "  color.rgb *= color.a;",
  "  return color;",
  "}",
  "void main(){",
  "  if (u_bloomPass > 0.5) {",
  "    vec2 stepUv = u_direction * max(u_radius, 0.0) / max(u_resolution, vec2(1.0)) * 0.5;",
  "    vec4 bloom = readSource(v_uv) * 0.227027;",
  "    bloom += readSource(v_uv + stepUv) * 0.1945946;",
  "    bloom += readSource(v_uv - stepUv) * 0.1945946;",
  "    bloom += readSource(v_uv + stepUv * 2.0) * 0.1216216;",
  "    bloom += readSource(v_uv - stepUv * 2.0) * 0.1216216;",
  "    bloom += readSource(v_uv + stepUv * 3.0) * 0.054054;",
  "    bloom += readSource(v_uv - stepUv * 3.0) * 0.054054;",
  "    bloom += readSource(v_uv + stepUv * 4.0) * 0.016216;",
  "    bloom += readSource(v_uv - stepUv * 4.0) * 0.016216;",
  "    gl_FragColor = bloom;",
  "    return;",
  "  }",
  "  vec2 stepUv = u_direction * max(u_radius, 0.0) / max(u_resolution, vec2(1.0)) / 12.0;",
  "  vec4 color = readSource(v_uv) * 0.08077993;",
  "  color += readSource(v_uv + stepUv * 1.0) * 0.07918038;",
  "  color += readSource(v_uv - stepUv * 1.0) * 0.07918038;",
  "  color += readSource(v_uv + stepUv * 2.0) * 0.07456928;",
  "  color += readSource(v_uv - stepUv * 2.0) * 0.07456928;",
  "  color += readSource(v_uv + stepUv * 3.0) * 0.06747307;",
  "  color += readSource(v_uv - stepUv * 3.0) * 0.06747307;",
  "  color += readSource(v_uv + stepUv * 4.0) * 0.05865827;",
  "  color += readSource(v_uv - stepUv * 4.0) * 0.05865827;",
  "  color += readSource(v_uv + stepUv * 5.0) * 0.04899551;",
  "  color += readSource(v_uv - stepUv * 5.0) * 0.04899551;",
  "  color += readSource(v_uv + stepUv * 6.0) * 0.03931982;",
  "  color += readSource(v_uv - stepUv * 6.0) * 0.03931982;",
  "  color += readSource(v_uv + stepUv * 7.0) * 0.03031761;",
  "  color += readSource(v_uv - stepUv * 7.0) * 0.03031761;",
  "  color += readSource(v_uv + stepUv * 8.0) * 0.02245983;",
  "  color += readSource(v_uv - stepUv * 8.0) * 0.02245983;",
  "  color += readSource(v_uv + stepUv * 9.0) * 0.01598624;",
  "  color += readSource(v_uv - stepUv * 9.0) * 0.01598624;",
  "  color += readSource(v_uv + stepUv * 10.0) * 0.01093238;",
  "  color += readSource(v_uv - stepUv * 10.0) * 0.01093238;",
  "  color += readSource(v_uv + stepUv * 11.0) * 0.00718308;",
  "  color += readSource(v_uv - stepUv * 11.0) * 0.00718308;",
  "  color += readSource(v_uv + stepUv * 12.0) * 0.00453456;",
  "  color += readSource(v_uv - stepUv * 12.0) * 0.00453456;",
  "  if (color.a > 0.0001) color.rgb /= color.a;",
  "  gl_FragColor = color;",
  "}",
].join("\n");

const KUWAHARA_HORIZONTAL_FRAGMENT_SHADER = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "varying vec2 v_uv;",
  "uniform sampler2D u_source;",
  "uniform sampler2D u_blurSource;",
  "uniform vec2 u_texel;",
  "uniform vec2 u_uvScale;",
  "uniform vec2 u_uvOffset;",
  "uniform float u_blurReady;",
  "uniform float u_blur;",
  "uniform float u_kuwaharaRadius;",
  "vec3 readPrepared(vec2 displayUv){",
  "  vec2 uv = (displayUv - u_uvOffset) / u_uvScale;",
  "  vec3 color = texture2D(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb;",
  "  if (u_blurReady > 0.5 && u_blur > 0.0) {",
  "    vec3 blurred = texture2D(u_blurSource, clamp(uv, vec2(0.0), vec2(1.0))).rgb;",
  "    color = mix(color, blurred, clamp(u_blur, 0.0, 1.0));",
  "  }",
  "  return color;",
  "}",
  "void main(){",
  "  float radius = floor(mix(2.0, 16.0, clamp(u_kuwaharaRadius, 0.0, 1.0)) + 0.5);",
  "  vec3 sum = vec3(0.0);",
  "  float sumSquares = 0.0;",
  "  float count = 0.0;",
  "  for (int offset = 0; offset <= 16; offset++) {",
  "    if (float(offset) > radius) continue;",
  "    vec3 color = readPrepared(v_uv + vec2(float(offset), 0.0) * u_texel);",
  "    sum += color;",
  "    sumSquares += dot(color, color) / 3.0;",
  "    count += 1.0;",
  "  }",
  "  gl_FragColor = vec4(sum / count, sumSquares / count);",
  "}",
].join("\n");

const KUWAHARA_RESOLVE_FRAGMENT_SHADER = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "varying vec2 v_uv;",
  "uniform sampler2D u_kuwaharaMoments;",
  "uniform vec2 u_texel;",
  "uniform float u_kuwaharaRadius;",
  "uniform float u_kuwaharaSharpness;",
  "uniform float u_kuwaharaSaturation;",
  "void main(){",
  "  float radius = floor(mix(2.0, 16.0, clamp(u_kuwaharaRadius, 0.0, 1.0)) + 0.5);",
  "  vec2 origins[4];",
  "  origins[0] = vec2(-radius, -radius);",
  "  origins[1] = vec2(0.0, -radius);",
  "  origins[2] = vec2(-radius, 0.0);",
  "  origins[3] = vec2(0.0, 0.0);",
  "  vec3 means[4];",
  "  float variances[4];",
  "  float minVariance = 1.0;",
  "  for (int quadrant = 0; quadrant < 4; quadrant++) {",
  "    vec4 moment = vec4(0.0);",
  "    float count = 0.0;",
  "    for (int offset = 0; offset <= 16; offset++) {",
  "      if (float(offset) > radius) continue;",
  "      vec2 sampleOffset = origins[quadrant] + vec2(0.0, float(offset));",
  "      moment += texture2D(u_kuwaharaMoments, clamp(v_uv + sampleOffset * u_texel, vec2(0.0), vec2(1.0)));",
  "      count += 1.0;",
  "    }",
  "    moment /= count;",
  "    vec3 mean = moment.rgb;",
  "    float meanSquare = moment.a * 3.0;",
  "    float variance = max(meanSquare - dot(mean, mean), 0.0);",
  "    means[quadrant] = mean;",
  "    variances[quadrant] = variance;",
  "    minVariance = min(minVariance, variance);",
  "  }",
  "  float exponent = 1.0 + clamp(u_kuwaharaSharpness, 0.0, 1.0) * 8.0;",
  "  vec3 result = vec3(0.0);",
  "  float totalWeight = 0.0;",
  "  for (int quadrant = 0; quadrant < 4; quadrant++) {",
  "    float weight = pow((minVariance + 0.0001) / (variances[quadrant] + 0.0001), exponent);",
  "    result += means[quadrant] * weight;",
  "    totalWeight += weight;",
  "  }",
  "  result /= max(totalWeight, 0.0001);",
  "  float luma = dot(result, vec3(0.2126, 0.7152, 0.0722));",
  "  float saturation = clamp(u_kuwaharaSaturation, 0.0, 1.0) * 2.0;",
  "  gl_FragColor = vec4(clamp(mix(vec3(luma), result, saturation), 0.0, 1.0), 1.0);",
  "}",
].join("\n");

function isColorGradingMediaElement(value: Element): value is ColorGradingMediaElement {
  return value instanceof HTMLVideoElement || value instanceof HTMLImageElement;
}

function isVisibleForColorGrading(element: ColorGradingMediaElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function compileShader(
  gl: WebGLRenderingContext,
  source: string,
  type: number,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    swallow("runtime.colorGrading.compileShader", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  fragmentSource = FRAGMENT_SHADER,
): WebGLProgram | null {
  const vertex = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER);
  const fragment = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    swallow("runtime.colorGrading.linkProgram", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createTexture(
  gl: WebGLRenderingContext,
  filter: number = gl.LINEAR,
  type: number = gl.UNSIGNED_BYTE,
): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, type, null);
  return texture;
}

function createBlurProgramInfo(
  gl: WebGLRenderingContext,
  quad: WebGLBuffer,
): BlurProgramInfo | null {
  const program = createProgram(gl, BLUR_FRAGMENT_SHADER);
  if (!program) return null;
  return {
    program,
    quad,
    position: gl.getAttribLocation(program, "a_pos"),
    source: gl.getUniformLocation(program, "u_source"),
    resolution: gl.getUniformLocation(program, "u_resolution"),
    direction: gl.getUniformLocation(program, "u_direction"),
    radius: gl.getUniformLocation(program, "u_radius"),
    bloomPass: gl.getUniformLocation(program, "u_bloomPass"),
    threshold: gl.getUniformLocation(program, "u_threshold"),
  };
}

function createKuwaharaHorizontalProgramInfo(
  gl: WebGLRenderingContext,
  quad: WebGLBuffer,
): KuwaharaHorizontalProgramInfo | null {
  const program = createProgram(gl, KUWAHARA_HORIZONTAL_FRAGMENT_SHADER);
  if (!program) return null;
  return {
    program,
    quad,
    position: gl.getAttribLocation(program, "a_pos"),
    source: gl.getUniformLocation(program, "u_source"),
    blurSource: gl.getUniformLocation(program, "u_blurSource"),
    texel: gl.getUniformLocation(program, "u_texel"),
    uvScale: gl.getUniformLocation(program, "u_uvScale"),
    uvOffset: gl.getUniformLocation(program, "u_uvOffset"),
    blurReady: gl.getUniformLocation(program, "u_blurReady"),
    blur: gl.getUniformLocation(program, "u_blur"),
    radius: gl.getUniformLocation(program, "u_kuwaharaRadius"),
  };
}

function createKuwaharaResolveProgramInfo(
  gl: WebGLRenderingContext,
  quad: WebGLBuffer,
): KuwaharaResolveProgramInfo | null {
  const program = createProgram(gl, KUWAHARA_RESOLVE_FRAGMENT_SHADER);
  if (!program) return null;
  return {
    program,
    quad,
    position: gl.getAttribLocation(program, "a_pos"),
    moments: gl.getUniformLocation(program, "u_kuwaharaMoments"),
    texel: gl.getUniformLocation(program, "u_texel"),
    radius: gl.getUniformLocation(program, "u_kuwaharaRadius"),
    sharpness: gl.getUniformLocation(program, "u_kuwaharaSharpness"),
    saturation: gl.getUniformLocation(program, "u_kuwaharaSaturation"),
  };
}

function createRenderTarget(
  gl: WebGLRenderingContext,
  type: number = gl.UNSIGNED_BYTE,
  filter: number = gl.LINEAR,
): RenderTarget | null {
  const texture = createTexture(gl, filter, type);
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) {
    if (texture) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    return null;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    return null;
  }
  return { texture, framebuffer, type, width: 1, height: 1 };
}

function resizeRenderTarget(
  gl: WebGLRenderingContext,
  target: RenderTarget,
  width: number,
  height: number,
): void {
  if (target.width === width && target.height === height) return;
  target.width = width;
  target.height = height;
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, target.type, null);
}

function createFloatUniformBindings<K extends string>(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  keys: readonly K[],
): readonly FloatUniformBinding<K>[] {
  const bindings: FloatUniformBinding<K>[] = [];
  for (const key of keys) {
    const location = gl.getUniformLocation(program, `u_${key}`);
    if (location !== null) bindings.push([key, location]);
  }
  return bindings;
}

function createProgramInfo(canvas: HTMLCanvasElement): {
  gl: WebGLRenderingContext;
  program: ProgramInfo;
} | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
  });
  if (!gl) return null;
  const program = createProgram(gl);
  const texture = createTexture(gl);
  const lutTexture = createTexture(gl, gl.NEAREST);
  if (!program || !texture || !lutTexture) {
    if (program) gl.deleteProgram(program);
    if (texture) gl.deleteTexture(texture);
    if (lutTexture) gl.deleteTexture(lutTexture);
    return null;
  }
  const quad = gl.createBuffer();
  if (!quad) {
    gl.deleteProgram(program);
    gl.deleteTexture(texture);
    gl.deleteTexture(lutTexture);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  return {
    gl,
    program: {
      program,
      texture,
      lutTexture,
      quad,
      position: gl.getAttribLocation(program, "a_pos"),
      source: gl.getUniformLocation(program, "u_source"),
      blurSource: gl.getUniformLocation(program, "u_blurSource"),
      bloomSource: gl.getUniformLocation(program, "u_bloomSource"),
      kuwaharaSource: gl.getUniformLocation(program, "u_kuwaharaSource"),
      lut: gl.getUniformLocation(program, "u_lut"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      uvScale: gl.getUniformLocation(program, "u_uvScale"),
      uvOffset: gl.getUniformLocation(program, "u_uvOffset"),
      blurReady: gl.getUniformLocation(program, "u_blurReady"),
      bloomReady: gl.getUniformLocation(program, "u_bloomReady"),
      kuwaharaReady: gl.getUniformLocation(program, "u_kuwaharaReady"),
      lutEnabled: gl.getUniformLocation(program, "u_lutEnabled"),
      lutSize: gl.getUniformLocation(program, "u_lutSize"),
      lutTextureSize: gl.getUniformLocation(program, "u_lutTextureSize"),
      lutDomainMin: gl.getUniformLocation(program, "u_lutDomainMin"),
      lutDomainMax: gl.getUniformLocation(program, "u_lutDomainMax"),
      lutIntensity: gl.getUniformLocation(program, "u_lutIntensity"),
      adjustUniforms: createFloatUniformBindings(gl, program, HF_COLOR_GRADING_ADJUST_KEYS),
      detailUniforms: createFloatUniformBindings(gl, program, HF_COLOR_GRADING_DETAIL_KEYS),
      effectUniforms: createFloatUniformBindings(gl, program, HF_COLOR_GRADING_EFFECT_KEYS),
      grainSeed: gl.getUniformLocation(program, "u_grainSeed"),
      effectTime: gl.getUniformLocation(program, "u_effectTime"),
      paletteSize: gl.getUniformLocation(program, "u_paletteSize"),
      palette0: gl.getUniformLocation(program, "u_palette0"),
      palette1: gl.getUniformLocation(program, "u_palette1"),
      palette2: gl.getUniformLocation(program, "u_palette2"),
      palette3: gl.getUniformLocation(program, "u_palette3"),
      palette4: gl.getUniformLocation(program, "u_palette4"),
      palette5: gl.getUniformLocation(program, "u_palette5"),
      intensity: gl.getUniformLocation(program, "u_intensity"),
      compareEnabled: gl.getUniformLocation(program, "u_compareEnabled"),
      comparePosition: gl.getUniformLocation(program, "u_comparePosition"),
      compareSoftness: gl.getUniformLocation(program, "u_compareSoftness"),
      compareLineWidth: gl.getUniformLocation(program, "u_compareLineWidth"),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCompare(raw: unknown): RuntimeColorGradingCompareState {
  if (!isRecord(raw)) return { ...DEFAULT_COMPARE };
  const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
  };
  return {
    enabled: raw.enabled === true,
    position: clampNumber(raw.position, DEFAULT_COMPARE.position, 0, 1),
    softness: clampNumber(raw.softness, DEFAULT_COMPARE.softness, 0, 0.25),
    lineWidth: clampNumber(raw.lineWidth, DEFAULT_COMPARE.lineWidth, 0, 12),
  };
}

function resolveLutUrl(src: string): { href: string } | { error: string } {
  try {
    const url = new URL(src, document.baseURI);
    if (url.protocol === "data:") return { href: url.href };
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "LUT must be project-local or a data URL" };
    }
    if (url.origin !== window.location.origin) {
      return { error: "Remote LUT URLs are not supported" };
    }
    return { href: url.href };
  } catch {
    return { error: "Invalid LUT URL" };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "LUT failed to load";
}

function hashStringSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 10000;
}

function seedForElement(element: ColorGradingMediaElement): number {
  const key =
    element.id ||
    element.currentSrc ||
    element.getAttribute("src") ||
    `${element.tagName}:${Array.prototype.indexOf.call(element.parentNode?.children ?? [], element)}`;
  return hashStringSeed(key);
}

function getCubeLut(src: string): LutCacheEntry {
  const resolved = resolveLutUrl(src);
  if ("error" in resolved) return { state: "error", message: resolved.error };
  const cached = LUT_CACHE.get(resolved.href);
  if (cached) return cached;

  const promise = fetch(resolved.href, { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load LUT (${response.status})`);
      return response.text();
    })
    .then((text) => parseCubeLut(text, { maxSize: DEFAULT_MAX_CUBE_LUT_SIZE }));

  const pending: LutCacheEntry = { state: "pending", promise };
  while (LUT_CACHE.size >= MAX_LUT_CACHE_ENTRIES) {
    const oldest = LUT_CACHE.keys().next().value;
    if (!oldest) break;
    LUT_CACHE.delete(oldest);
  }
  LUT_CACHE.set(resolved.href, pending);
  promise.then(
    (lut) => {
      if (LUT_CACHE.get(resolved.href) === pending) {
        LUT_CACHE.set(resolved.href, { state: "ready", lut });
      }
    },
    (err) => {
      if (LUT_CACHE.get(resolved.href) === pending) {
        LUT_CACHE.set(resolved.href, { state: "error", message: errorMessage(err) });
      }
    },
  );
  return pending;
}

function uploadEntryLut(
  entry: ColorGradingEntry,
  src: string,
  lut: CubeLut3D,
): RuntimeLutTexture | null {
  if (entry.lut?.src === src) return entry.lut;
  const packed = packCubeLutToRgba8(lut);
  const { gl, program } = entry;
  try {
    uploadLutTexture(gl, program.lutTexture, packed);
    entry.lut = {
      src,
      size: lut.size,
      domainMin: lut.domainMin,
      domainMax: lut.domainMax,
      textureWidth: packed.width,
      textureHeight: packed.height,
    };
    entry.lutError = null;
    entry.lutLoadingSrc = null;
    return entry.lut;
  } catch (err) {
    entry.lut = null;
    entry.lutError = errorMessage(err);
    entry.lutLoadingSrc = null;
    swallow("runtime.colorGrading.uploadLut", err);
    return null;
  }
}

async function loadCubeLut(src: string): Promise<CubeLut3D> {
  const cached = getCubeLut(src);
  if (cached.state === "ready") return cached.lut;
  if (cached.state === "pending") return cached.promise;
  throw new Error(cached.message);
}

function uploadLutTexture(
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  packed: ReturnType<typeof packCubeLutToRgba8>,
): void {
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    packed.width,
    packed.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    packed.data,
  );
}

function uploadPreviewLut(
  renderer: ColorGradingPreviewRenderer,
  src: string,
  lut: CubeLut3D,
): RuntimeLutTexture {
  const packed = packCubeLutToRgba8(lut);
  const { gl, program } = renderer;
  uploadLutTexture(gl, program.lutTexture, packed);
  return {
    src,
    size: lut.size,
    domainMin: lut.domainMin,
    domainMax: lut.domainMax,
    textureWidth: packed.width,
    textureHeight: packed.height,
  };
}

function destroyRenderTarget(gl: WebGLRenderingContext, target: RenderTarget): void {
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

function destroyEffectTargets(state: EffectRenderState): void {
  const targets = state.effectTargets;
  if (!targets) return;
  state.gl.deleteProgram(targets.blurProgram.program);
  destroyRenderTarget(state.gl, targets.scratch);
  destroyRenderTarget(state.gl, targets.blur);
  if (targets.bloom) destroyRenderTarget(state.gl, targets.bloom);
  state.effectTargets = null;
}

function destroyKuwaharaTargets(state: EffectRenderState): void {
  const targets = state.kuwaharaTargets;
  if (!targets) return;
  state.gl.deleteProgram(targets.horizontalProgram.program);
  state.gl.deleteProgram(targets.resolveProgram.program);
  destroyRenderTarget(state.gl, targets.moments);
  destroyRenderTarget(state.gl, targets.output);
  state.kuwaharaTargets = null;
}

function destroyProgramResources(renderer: ColorGradingRenderer, loseContext = false): void {
  destroyEffectTargets(renderer);
  destroyKuwaharaTargets(renderer);
  destroyMainProgramResources(renderer.gl, renderer.program);
  if (loseContext) renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
}

function destroyMainProgramResources(gl: WebGLRenderingContext, program: ProgramInfo): void {
  gl.deleteTexture(program.texture);
  gl.deleteTexture(program.lutTexture);
  gl.deleteBuffer(program.quad);
  gl.deleteProgram(program.program);
}

function replaceProgramResources(entry: ColorGradingEntry): boolean {
  const created = createProgramInfo(entry.canvas);
  if (!created) return false;
  destroyProgramResources(entry);
  entry.gl = created.gl;
  entry.program = created.program;
  entry.lut = null;
  entry.lutLoadingSrc = null;
  entry.lutError = null;
  entry.effectError = null;
  return true;
}

function restoreSourceElement(entry: ColorGradingEntry): void {
  if (!entry.sourceHidden) return;
  entry.element.removeAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR);
  const opacity = entry.element.style.getPropertyValue("opacity");
  const priority = entry.element.style.getPropertyPriority("opacity");
  if (opacity === "0" && priority === "important") {
    if (entry.sourceInlineOpacity === null) {
      entry.element.style.removeProperty("opacity");
    } else {
      entry.element.style.setProperty(
        "opacity",
        entry.sourceInlineOpacity,
        entry.sourceInlineOpacityPriority,
      );
    }
  }
  entry.sourceHidden = false;
}

function ensureEffectTargets(state: EffectRenderState): EffectTargets | null {
  if (state.effectTargets) return state.effectTargets;
  const { gl } = state;
  const blurProgram = createBlurProgramInfo(gl, state.program.quad);
  const scratch = createRenderTarget(gl);
  const blur = createRenderTarget(gl);
  if (!blurProgram || !scratch || !blur) {
    if (blurProgram) gl.deleteProgram(blurProgram.program);
    if (scratch) destroyRenderTarget(gl, scratch);
    if (blur) destroyRenderTarget(gl, blur);
    state.effectError = "Framebuffer effects unavailable";
    return null;
  }
  state.effectError = null;
  state.effectTargets = { blurProgram, scratch, blur, bloom: null };
  return state.effectTargets;
}

function ensureBloomOutput(state: EffectRenderState, targets: EffectTargets): RenderTarget | null {
  if (targets.bloom) return targets.bloom;
  targets.bloom = createRenderTarget(state.gl);
  state.effectError = targets.bloom ? null : "Framebuffer effects unavailable";
  return targets.bloom;
}

function destroyBloomOutput(state: EffectRenderState): void {
  const targets = state.effectTargets;
  if (!targets?.bloom) return;
  destroyRenderTarget(state.gl, targets.bloom);
  targets.bloom = null;
}

function ensureKuwaharaTargets(state: EffectRenderState): KuwaharaTargets | null {
  if (state.kuwaharaTargets) return state.kuwaharaTargets;
  const { gl } = state;
  const halfFloat = gl.getExtension("OES_texture_half_float");
  const colorBufferHalfFloat = gl.getExtension("EXT_color_buffer_half_float");
  if (!halfFloat || !colorBufferHalfFloat) {
    state.effectError = "Kuwahara requires half-float framebuffer support";
    return null;
  }
  const horizontalProgram = createKuwaharaHorizontalProgramInfo(gl, state.program.quad);
  const resolveProgram = createKuwaharaResolveProgramInfo(gl, state.program.quad);
  const moments = createRenderTarget(gl, halfFloat.HALF_FLOAT_OES, gl.NEAREST);
  const output = createRenderTarget(gl);
  if (!horizontalProgram || !resolveProgram || !moments || !output) {
    destroyIncompleteKuwaharaTargets(gl, horizontalProgram, resolveProgram, moments, output);
    state.effectError = "Kuwahara framebuffer effects unavailable";
    return null;
  }
  state.kuwaharaTargets = { horizontalProgram, resolveProgram, moments, output };
  return state.kuwaharaTargets;
}

function destroyIncompleteKuwaharaTargets(
  gl: WebGLRenderingContext,
  horizontalProgram: KuwaharaHorizontalProgramInfo | null,
  resolveProgram: KuwaharaResolveProgramInfo | null,
  moments: RenderTarget | null,
  output: RenderTarget | null,
): void {
  if (horizontalProgram) gl.deleteProgram(horizontalProgram.program);
  if (resolveProgram) gl.deleteProgram(resolveProgram.program);
  if (moments) destroyRenderTarget(gl, moments);
  if (output) destroyRenderTarget(gl, output);
}

function resizeEffectTargetPair(
  gl: WebGLRenderingContext,
  scratch: RenderTarget,
  output: RenderTarget,
  width: number,
  height: number,
): { width: number; height: number } {
  const targetWidth = Math.max(1, Math.ceil(width));
  const targetHeight = Math.max(1, Math.ceil(height));
  resizeRenderTarget(gl, scratch, targetWidth, targetHeight);
  resizeRenderTarget(gl, output, targetWidth, targetHeight);
  return { width: targetWidth, height: targetHeight };
}

function renderBlurPass(
  gl: WebGLRenderingContext,
  program: BlurProgramInfo,
  input: WebGLTexture,
  output: RenderTarget,
  layout: { width: number; height: number },
  direction: { x: number; y: number },
  radius: number,
  bloomPass = false,
  threshold = -1,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
  gl.viewport(0, 0, layout.width, layout.height);
  gl.useProgram(program.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, input);
  gl.uniform1i(program.source, 0);
  gl.uniform2f(program.resolution, layout.width, layout.height);
  gl.uniform2f(program.direction, direction.x, direction.y);
  gl.uniform1f(program.radius, radius);
  gl.uniform1f(program.bloomPass, bloomPass ? 1 : 0);
  gl.uniform1f(program.threshold, threshold);
  drawFullscreenQuad(gl, program);
}

function renderBloomTexture(
  gl: WebGLRenderingContext,
  targets: EffectTargets,
  input: WebGLTexture,
  output: RenderTarget,
  width: number,
  height: number,
  radius: number,
): void {
  const layout = resizeEffectTargetPair(gl, targets.scratch, output, width / 2, height / 2);
  const passRadius = radius / 2;
  renderBlurPass(
    gl,
    targets.blurProgram,
    input,
    targets.scratch,
    layout,
    { x: 1, y: 0 },
    passRadius,
    true,
    0.5,
  );
  renderBlurPass(
    gl,
    targets.blurProgram,
    targets.scratch.texture,
    output,
    layout,
    { x: 0, y: 1 },
    passRadius,
    true,
  );
}

function renderGaussianTexture(
  gl: WebGLRenderingContext,
  targets: EffectTargets,
  input: WebGLTexture,
  output: RenderTarget,
  layout: { width: number; height: number },
  radius: number,
  iterations: number,
): void {
  let source = input;
  for (let pass = 0; pass < Math.max(1, Math.floor(iterations)); pass++) {
    renderBlurPass(
      gl,
      targets.blurProgram,
      source,
      targets.scratch,
      layout,
      { x: 1, y: 0 },
      radius,
    );
    renderBlurPass(
      gl,
      targets.blurProgram,
      targets.scratch.texture,
      output,
      layout,
      { x: 0, y: 1 },
      radius,
    );
    source = output.texture;
  }
}

function drawFullscreenQuad(
  gl: WebGLRenderingContext,
  program: { quad: WebGLBuffer; position: number },
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, program.quad);
  gl.enableVertexAttribArray(program.position);
  gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function renderKuwaharaTexture(
  gl: WebGLRenderingContext,
  targets: KuwaharaTargets,
  source: WebGLTexture,
  blurSource: WebGLTexture,
  layout: { width: number; height: number },
  uv: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
  blurReady: boolean,
  effects: NormalizedHfColorGrading["effects"],
): void {
  resizeRenderTarget(gl, targets.moments, layout.width, layout.height);
  resizeRenderTarget(gl, targets.output, layout.width, layout.height);

  const horizontal = targets.horizontalProgram;
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets.moments.framebuffer);
  gl.viewport(0, 0, layout.width, layout.height);
  gl.useProgram(horizontal.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, blurSource);
  gl.uniform1i(horizontal.source, 0);
  gl.uniform1i(horizontal.blurSource, 1);
  gl.uniform2f(horizontal.texel, 1 / layout.width, 1 / layout.height);
  gl.uniform2f(horizontal.uvScale, uv.scaleX, uv.scaleY);
  gl.uniform2f(horizontal.uvOffset, uv.offsetX, uv.offsetY);
  gl.uniform1f(horizontal.blurReady, blurReady ? 1 : 0);
  gl.uniform1f(horizontal.blur, effects.blur);
  gl.uniform1f(horizontal.radius, effects.kuwaharaRadius);
  drawFullscreenQuad(gl, horizontal);

  const resolve = targets.resolveProgram;
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets.output.framebuffer);
  gl.useProgram(resolve.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, targets.moments.texture);
  gl.uniform1i(resolve.moments, 0);
  gl.uniform2f(resolve.texel, 1 / layout.width, 1 / layout.height);
  gl.uniform1f(resolve.radius, effects.kuwaharaRadius);
  gl.uniform1f(resolve.sharpness, effects.kuwaharaSharpness);
  gl.uniform1f(resolve.saturation, effects.kuwaharaSaturation);
  drawFullscreenQuad(gl, resolve);
}

interface PreparedEffectTextures {
  blurReady: boolean;
  bloomReady: boolean;
  kuwaharaReady: boolean;
  blurTexture: WebGLTexture;
  bloomTexture: WebGLTexture;
  kuwaharaTexture: WebGLTexture;
}

function prepareBlurTexture(
  state: EffectRenderState,
  targets: EffectTargets,
  amount: number,
  layout: { width: number; height: number },
): boolean {
  if (amount <= 0) return false;
  const blurLayout = resizeEffectTargetPair(
    state.gl,
    targets.scratch,
    targets.blur,
    layout.width,
    layout.height,
  );
  renderGaussianTexture(
    state.gl,
    targets,
    state.program.texture,
    targets.blur,
    blurLayout,
    0.75 + Math.pow(amount, 1.35) * 32,
    amount > 0.55 ? 3 : 2,
  );
  return true;
}

function prepareBloomTexture(
  state: EffectRenderState,
  targets: EffectTargets,
  amount: number,
  radius: number,
  layout: { width: number; height: number },
  blurReady: boolean,
): WebGLTexture | null {
  if (amount <= 0) {
    destroyBloomOutput(state);
    return null;
  }
  if (!blurReady) destroyBloomOutput(state);
  const output = blurReady ? ensureBloomOutput(state, targets) : targets.blur;
  if (!output) return null;
  renderBloomTexture(
    state.gl,
    targets,
    state.program.texture,
    output,
    layout.width,
    layout.height,
    radius,
  );
  return output.texture;
}

function prepareBlurAndBloomTextures(
  state: EffectRenderState,
  grading: NormalizedHfColorGrading,
  layout: { width: number; height: number },
  releaseIdleTargets: boolean,
): Pick<PreparedEffectTextures, "blurReady" | "bloomReady" | "blurTexture" | "bloomTexture"> {
  const { program } = state;
  const blurAmount = grading.effects.blur;
  const bloomAmount = grading.effects.bloom;
  if (blurAmount <= 0 && bloomAmount <= 0) {
    if (state.effectTargets && releaseIdleTargets) destroyEffectTargets(state);
    return {
      blurReady: false,
      bloomReady: false,
      blurTexture: program.texture,
      bloomTexture: program.texture,
    };
  }

  const targets = ensureEffectTargets(state);
  if (!targets) {
    return {
      blurReady: false,
      bloomReady: false,
      blurTexture: program.texture,
      bloomTexture: program.texture,
    };
  }

  const blurReady = prepareBlurTexture(state, targets, blurAmount, layout);
  const bloomTexture = prepareBloomTexture(
    state,
    targets,
    bloomAmount,
    grading.effects.bloomRadius,
    layout,
    blurReady,
  );
  return {
    blurReady,
    bloomReady: bloomTexture !== null,
    blurTexture: targets.blur.texture,
    bloomTexture: bloomTexture ?? program.texture,
  };
}

function prepareKuwaharaTexture(
  state: EffectRenderState,
  grading: NormalizedHfColorGrading,
  layout: { width: number; height: number },
  uv: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
  blurReady: boolean,
  preserve: boolean,
  releaseIdleTargets: boolean,
): Pick<PreparedEffectTextures, "kuwaharaReady" | "kuwaharaTexture"> {
  const amount = grading.effects.kuwahara;
  if (amount <= 0 && !preserve) {
    if (state.kuwaharaTargets && releaseIdleTargets) destroyKuwaharaTargets(state);
    return { kuwaharaReady: false, kuwaharaTexture: state.program.texture };
  }

  const targets = ensureKuwaharaTargets(state);
  if (!targets || amount <= 0) {
    return {
      kuwaharaReady: false,
      kuwaharaTexture: targets?.output.texture ?? state.program.texture,
    };
  }
  renderKuwaharaTexture(
    state.gl,
    targets,
    state.program.texture,
    state.effectTargets?.blur.texture ?? state.program.texture,
    layout,
    uv,
    blurReady,
    grading.effects,
  );
  return { kuwaharaReady: true, kuwaharaTexture: targets.output.texture };
}

function prepareEffectTextures(
  state: EffectRenderState,
  grading: NormalizedHfColorGrading,
  layout: { width: number; height: number },
  uv: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
  options: { preserveKuwahara?: boolean; releaseIdleTargets?: boolean } = {},
): PreparedEffectTextures {
  const releaseIdleTargets = options.releaseIdleTargets ?? true;
  state.effectError = null;
  const blurAndBloom = prepareBlurAndBloomTextures(state, grading, layout, releaseIdleTargets);
  const kuwahara = prepareKuwaharaTexture(
    state,
    grading,
    layout,
    uv,
    blurAndBloom.blurReady,
    options.preserveKuwahara ?? false,
    releaseIdleTargets,
  );
  return { ...blurAndBloom, ...kuwahara };
}

// fallow-ignore-next-line complexity
function ensureEntryLut(entry: ColorGradingEntry): RuntimeLutTexture | null {
  const src = entry.grading.lut?.src.trim() ?? "";
  const intensity = entry.grading.lut?.intensity ?? 1;
  if (!src || intensity <= 0) {
    entry.lut = null;
    entry.lutLoadingSrc = null;
    entry.lutError = null;
    return null;
  }

  const resolved = resolveLutUrl(src);
  if ("error" in resolved) {
    entry.lut = null;
    entry.lutLoadingSrc = null;
    entry.lutError = resolved.error;
    return null;
  }
  if (entry.lut?.src === resolved.href) return entry.lut;
  entry.lut = null;

  const cached = getCubeLut(src);
  if (cached.state === "ready") return uploadEntryLut(entry, resolved.href, cached.lut);
  if (cached.state === "error") {
    entry.lutError = cached.message;
    entry.lutLoadingSrc = null;
    return null;
  }

  if (entry.lutLoadingSrc !== resolved.href) {
    entry.lutLoadingSrc = resolved.href;
    entry.lutError = null;
    cached.promise.then(
      (lut) => {
        if (entry.destroyed || entry.grading.lut?.src.trim() !== src) return;
        uploadEntryLut(entry, resolved.href, lut);
        drawEntry(entry);
      },
      (err) => {
        if (entry.destroyed || entry.grading.lut?.src.trim() !== src) return;
        entry.lut = null;
        entry.lutError = errorMessage(err);
        entry.lutLoadingSrc = null;
        drawEntry(entry);
      },
    );
  }
  return null;
}

// fallow-ignore-next-line complexity
function resolveTarget(
  target: HfColorGradingTarget | string | null | undefined,
): ColorGradingMediaElement | null {
  if (!target) return null;
  if (typeof target === "string") {
    const trimmed = target.trim();
    if (!trimmed) return null;
    const byId = document.getElementById(trimmed.replace(/^#/, ""));
    if (byId && isColorGradingMediaElement(byId)) return byId;
    try {
      const bySelector = document.querySelector(trimmed);
      return bySelector && isColorGradingMediaElement(bySelector) ? bySelector : null;
    } catch {
      return null;
    }
  }
  if (target.hfId) {
    const byHfId = document.querySelector(`[data-hf-id="${CSS.escape(target.hfId)}"]`);
    if (byHfId && isColorGradingMediaElement(byHfId)) return byHfId;
  }
  if (target.id) {
    const byId = document.getElementById(target.id);
    if (byId && isColorGradingMediaElement(byId)) return byId;
  }
  if (!target.selector) return null;
  try {
    const matches = Array.from(document.querySelectorAll(target.selector));
    const index = Math.max(0, Math.floor(Number(target.selectorIndex ?? 0) || 0));
    const match = matches[index] ?? null;
    return match && isColorGradingMediaElement(match) ? match : null;
  } catch {
    return null;
  }
}

function readSourceSize(source: TexImageSource): { width: number; height: number } | null {
  if (source instanceof HTMLVideoElement) {
    return source.videoWidth > 0 && source.videoHeight > 0
      ? { width: source.videoWidth, height: source.videoHeight }
      : null;
  }
  if (source instanceof HTMLImageElement) {
    return source.naturalWidth > 0 && source.naturalHeight > 0
      ? { width: source.naturalWidth, height: source.naturalHeight }
      : null;
  }
  return null;
}

function isDrawableSource(source: TexImageSource): boolean {
  if (source instanceof HTMLVideoElement) {
    return (
      source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      source.videoWidth > 0 &&
      source.videoHeight > 0
    );
  }
  if (source instanceof HTMLImageElement) {
    return source.complete && source.naturalWidth > 0 && source.naturalHeight > 0;
  }
  return false;
}

function findRenderFrameImage(video: HTMLVideoElement): HTMLImageElement | null {
  if (!video.id) return null;
  const frame = document.getElementById(`__render_frame_${video.id}__`);
  return frame instanceof HTMLImageElement && isDrawableSource(frame) ? frame : null;
}

function hasInjectedRenderFrame(element: ColorGradingMediaElement): boolean {
  if (!(element instanceof HTMLVideoElement)) return false;
  const frame = findRenderFrameImage(element);
  if (!frame) return false;
  const style = window.getComputedStyle(frame);
  return style.display !== "none" && style.visibility !== "hidden";
}

function isRenderFrameImage(source: TexImageSource): source is HTMLImageElement {
  return source instanceof HTMLImageElement && source.classList.contains("__render_frame__");
}

function keepCanvasAboveSource(entry: ColorGradingEntry, source: HTMLImageElement): void {
  if (source.parentNode && source.nextSibling !== entry.canvas) {
    source.parentNode.insertBefore(entry.canvas, source.nextSibling);
  }
}

function getDrawableSource(element: ColorGradingMediaElement): TexImageSource | null {
  if (element instanceof HTMLVideoElement) {
    const renderFrame = findRenderFrameImage(element);
    if (renderFrame) return renderFrame;
  }
  return isDrawableSource(element) ? element : null;
}

function parseObjectPositionPart(value: string, axis: "x" | "y"): number | null {
  const lower = value.toLowerCase();
  if (lower === "center") return 0.5;
  if (axis === "x") {
    if (lower === "left") return 0;
    if (lower === "right") return 1;
  } else {
    if (lower === "top") return 0;
    if (lower === "bottom") return 1;
  }
  if (lower.endsWith("%")) {
    const parsed = Number.parseFloat(lower);
    return Number.isFinite(parsed) ? parsed / 100 : null;
  }
  return null;
}

// fallow-ignore-next-line complexity
function parseObjectPosition(value: string): { x: number; y: number } {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  let x = 0.5;
  let y = 0.5;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    const xValue = parseObjectPositionPart(token, "x");
    const yValue = parseObjectPositionPart(token, "y");
    if (
      xValue !== null &&
      (token === "left" || token === "right" || (token.endsWith("%") && index === 0))
    ) {
      x = xValue;
      continue;
    }
    if (
      yValue !== null &&
      (token === "top" || token === "bottom" || (token.endsWith("%") && index > 0))
    ) {
      y = yValue;
      continue;
    }
  }
  return { x, y };
}

// fallow-ignore-next-line complexity
function calculateObjectFitUv(
  boxWidth: number,
  boxHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  objectFit: string,
  objectPosition: string,
): { scaleX: number; scaleY: number; offsetX: number; offsetY: number } {
  if (boxWidth <= 0 || boxHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  }
  const fit = objectFit || "fill";
  let drawWidth = boxWidth;
  let drawHeight = boxHeight;
  if (fit === "contain" || fit === "cover" || fit === "scale-down") {
    const scale =
      fit === "cover"
        ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
        : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
    drawWidth = sourceWidth * scale;
    drawHeight = sourceHeight * scale;
    if (fit === "scale-down" && drawWidth > sourceWidth && drawHeight > sourceHeight) {
      drawWidth = sourceWidth;
      drawHeight = sourceHeight;
    }
  } else if (fit === "none") {
    drawWidth = sourceWidth;
    drawHeight = sourceHeight;
  }
  const position = parseObjectPosition(objectPosition || "center");
  const offsetX = ((boxWidth - drawWidth) * position.x) / boxWidth;
  const offsetY = ((boxHeight - drawHeight) * position.y) / boxHeight;
  return {
    scaleX: drawWidth / boxWidth,
    scaleY: drawHeight / boxHeight,
    offsetX,
    offsetY,
  };
}

function ensureParentPosition(entry: ColorGradingEntry, parent: HTMLElement): void {
  const computed = window.getComputedStyle(parent);
  if (computed.position !== "static") return;
  if (!entry.touchedParent) {
    entry.touchedParent = parent;
    entry.parentInlinePosition = parent.style.position || null;
  }
  parent.style.position = "relative";
}

function resolvedLayoutSize(primary: number, fallback: number): number {
  return Math.max(0, Math.round(primary > 0 ? primary : fallback));
}

function updateCanvasLayout(
  entry: ColorGradingEntry,
  styleSource: HTMLElement,
): { width: number; height: number } | null {
  const { element, canvas } = entry;
  const parent = element.parentElement;
  if (parent) ensureParentPosition(entry, parent);

  const computed = window.getComputedStyle(styleSource);
  copyMediaVisualStyles(canvas.style, computed);
  canvas.style.pointerEvents = "none";
  canvas.style.position = "absolute";
  canvas.style.inset = "auto";
  canvas.style.left = `${element.offsetLeft}px`;
  canvas.style.top = `${element.offsetTop}px`;
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  canvas.style.width = `${element.offsetWidth}px`;
  canvas.style.height = `${element.offsetHeight}px`;
  canvas.style.display = "block";
  canvas.style.opacity = entry.sourceOpacityForCanvas;
  canvas.style.visibility = entry.sourceVisibleForCanvas ? "visible" : "hidden";

  const rect = element.getBoundingClientRect();
  const cssWidth = resolvedLayoutSize(element.offsetWidth, rect.width);
  const cssHeight = resolvedLayoutSize(element.offsetHeight, rect.height);
  if (cssWidth <= 0 || cssHeight <= 0) {
    canvas.style.display = "none";
    return null;
  }
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height };
}

function setPaletteColorUniform(
  gl: WebGLRenderingContext,
  location: WebGLUniformLocation | null,
  color: string,
): void {
  gl.uniform3f(
    location,
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
  );
}

// fallow-ignore-next-line complexity
function applyUniforms(
  gl: WebGLRenderingContext,
  program: ProgramInfo,
  grading: NormalizedHfColorGrading,
  lut: RuntimeLutTexture | null,
  blurReady: boolean,
  bloomReady: boolean,
  kuwaharaReady: boolean,
  compare: RuntimeColorGradingCompareState,
  layout: { width: number; height: number },
  uv: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
  grainSeed: number,
  effectTime: number,
): void {
  gl.uniform1i(program.source, 0);
  gl.uniform1i(program.blurSource, 1);
  gl.uniform1i(program.lut, 2);
  gl.uniform1i(program.kuwaharaSource, 3);
  gl.uniform1i(program.bloomSource, 4);
  gl.uniform2f(program.resolution, layout.width, layout.height);
  gl.uniform2f(program.uvScale, uv.scaleX, uv.scaleY);
  gl.uniform2f(program.uvOffset, uv.offsetX, uv.offsetY);
  gl.uniform1f(program.blurReady, blurReady ? 1 : 0);
  gl.uniform1f(program.bloomReady, bloomReady ? 1 : 0);
  gl.uniform1f(program.kuwaharaReady, kuwaharaReady ? 1 : 0);
  gl.uniform1f(program.lutEnabled, lut ? 1 : 0);
  gl.uniform1f(program.lutSize, lut?.size ?? 2);
  gl.uniform2f(program.lutTextureSize, lut?.textureWidth ?? 1, lut?.textureHeight ?? 1);
  gl.uniform3f(
    program.lutDomainMin,
    lut?.domainMin[0] ?? 0,
    lut?.domainMin[1] ?? 0,
    lut?.domainMin[2] ?? 0,
  );
  gl.uniform3f(
    program.lutDomainMax,
    lut?.domainMax[0] ?? 1,
    lut?.domainMax[1] ?? 1,
    lut?.domainMax[2] ?? 1,
  );
  gl.uniform1f(program.lutIntensity, grading.lut?.intensity ?? 0);
  for (const [key, location] of program.adjustUniforms) {
    gl.uniform1f(location, grading.adjust[key]);
  }
  for (const [key, location] of program.detailUniforms) {
    gl.uniform1f(location, grading.details[key]);
  }
  gl.uniform1f(program.grainSeed, grainSeed);
  gl.uniform1f(program.effectTime, effectTime);
  for (const [key, location] of program.effectUniforms) {
    gl.uniform1f(location, grading.effects[key]);
  }
  const palette =
    grading.palette ??
    (grading.effects.engraving > 0 || grading.effects.crosshatch > 0
      ? DEFAULT_ART_PALETTE
      : DEFAULT_EFFECT_PALETTE);
  const lastColor = palette[palette.length - 1] ?? DEFAULT_EFFECT_PALETTE[1];
  gl.uniform1f(program.paletteSize, palette.length);
  setPaletteColorUniform(gl, program.palette0, palette[0] ?? DEFAULT_EFFECT_PALETTE[0]);
  setPaletteColorUniform(gl, program.palette1, palette[1] ?? lastColor);
  setPaletteColorUniform(gl, program.palette2, palette[2] ?? lastColor);
  setPaletteColorUniform(gl, program.palette3, palette[3] ?? lastColor);
  setPaletteColorUniform(gl, program.palette4, palette[4] ?? lastColor);
  setPaletteColorUniform(gl, program.palette5, palette[5] ?? lastColor);
  gl.uniform1f(program.intensity, grading.intensity);
  gl.uniform1f(program.compareEnabled, compare.enabled ? 1 : 0);
  gl.uniform1f(program.comparePosition, compare.position);
  gl.uniform1f(program.compareSoftness, compare.softness);
  gl.uniform1f(program.compareLineWidth, compare.lineWidth);
}

function hideSourceElement(entry: ColorGradingEntry): void {
  if (!entry.sourceHidden) {
    // Prefer the parse-time authored capture: by the time the first hide runs,
    // the inline opacity is usually an animation-engine transient (a from()
    // tween's 0 at playhead 0), and restoring THAT when grading is removed
    // would leave the element invisible. Fall back to the live inline value
    // for documents loaded without the capture installed.
    // `null` = never captured; "" = captured, authored none (store as null).
    const authored = entry.element.getAttribute(COLOR_GRADING_AUTHORED_OPACITY_ATTR);
    if (authored !== null) {
      entry.sourceInlineOpacity = authored === "" ? null : authored;
      entry.sourceInlineOpacityPriority = "";
    } else {
      entry.sourceInlineOpacity = entry.element.style.getPropertyValue("opacity") || null;
      entry.sourceInlineOpacityPriority = entry.element.style.getPropertyPriority("opacity");
    }
  }
  entry.element.setAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR, "true");
  entry.element.style.setProperty("opacity", "0", "important");
  entry.sourceHidden = true;
}

type AnimatedProperty = {
  name: string;
  min: number;
  max: number;
};

function animatedProperty(path: HfColorGradingAnimatablePath): AnimatedProperty {
  const property = HF_COLOR_GRADING_ANIMATABLE_PROPERTIES.find(
    (candidate) => candidate.path === path,
  );
  if (!property) throw new Error(`Missing color-grading animation property: ${path}`);
  return property;
}

const ANIMATED_INTENSITY_PROPERTY = animatedProperty("intensity");
const ANIMATED_LUT_INTENSITY_PROPERTY = animatedProperty("lut.intensity");
const ANIMATED_EXPOSURE_PROPERTY = animatedProperty("adjust.exposure");
const ANIMATED_KUWAHARA_PROPERTY = animatedProperty("effects.kuwahara");
const ANIMATED_EFFECT_PROPERTIES = [
  ["blur", animatedProperty("effects.blur")],
  ["bloom", animatedProperty("effects.bloom")],
  ["kuwahara", ANIMATED_KUWAHARA_PROPERTY],
  ["pixelate", animatedProperty("effects.pixelate")],
  ["ascii", animatedProperty("effects.ascii")],
  ["dither", animatedProperty("effects.dither")],
] as const satisfies readonly (readonly [HfColorGradingEffectKey, AnimatedProperty])[];
const ANIMATED_GRADING_PROPERTIES = [
  ANIMATED_INTENSITY_PROPERTY,
  ANIMATED_LUT_INTENSITY_PROPERTY,
  ANIMATED_EXPOSURE_PROPERTY,
  ...ANIMATED_EFFECT_PROPERTIES.map(([, property]) => property),
];

function readAnimatedValue(element: HTMLElement, property: AnimatedProperty): number | null {
  const raw = element.style.getPropertyValue(property.name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(property.max, Math.max(property.min, value)) : null;
}

function isRuntimeColorGradingActive(
  element: ColorGradingMediaElement,
  grading: NormalizedHfColorGrading | null,
): grading is NormalizedHfColorGrading {
  return (
    grading !== null &&
    (isHfColorGradingActive(grading) ||
      ANIMATED_GRADING_PROPERTIES.some((property) => readAnimatedValue(element, property) !== null))
  );
}

function readAnimatedEffects(
  element: HTMLElement,
  grading: NormalizedHfColorGrading,
): NormalizedHfColorGrading["effects"] | null {
  let effects: NormalizedHfColorGrading["effects"] | null = null;
  for (const [key, property] of ANIMATED_EFFECT_PROPERTIES) {
    const value = readAnimatedValue(element, property);
    if (value === null) continue;
    effects ??= { ...grading.effects };
    effects[key] = value;
  }
  return effects;
}

function readAnimatedGrading(entry: ColorGradingEntry): NormalizedHfColorGrading {
  const { element, grading } = entry;
  const intensity = readAnimatedValue(element, ANIMATED_INTENSITY_PROPERTY);
  const lutIntensity = readAnimatedValue(element, ANIMATED_LUT_INTENSITY_PROPERTY);
  const exposure = readAnimatedValue(element, ANIMATED_EXPOSURE_PROPERTY);
  const effects = readAnimatedEffects(element, grading);
  const hasDirectOverride = [intensity, lutIntensity, exposure].some((value) => value !== null);
  if (!hasDirectOverride && effects === null) {
    return grading;
  }
  const animated = {
    ...grading,
    adjust: exposure === null ? grading.adjust : { ...grading.adjust, exposure },
    effects: effects ?? grading.effects,
  };
  if (intensity !== null) animated.intensity = intensity;
  if (grading.lut && lutIntensity !== null) {
    animated.lut = { ...grading.lut, intensity: lutIntensity };
  }
  return animated;
}

function uploadSourceTexture(
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  source: TexImageSource,
): void {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

function bindProgramTextures(
  gl: WebGLRenderingContext,
  program: ProgramInfo,
  prepared: PreparedEffectTextures,
): void {
  const textures = [
    program.texture,
    prepared.blurTexture,
    program.lutTexture,
    prepared.kuwaharaTexture,
    prepared.bloomTexture,
  ];
  for (const [unit, texture] of textures.entries()) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }
}

// fallow-ignore-next-line complexity
function drawEntry(entry: ColorGradingEntry): boolean {
  if (entry.destroyed || entry.contextLost) return false;
  const source = getDrawableSource(entry.element);
  if (!source) {
    if (!entry.hasDrawn) entry.canvas.style.display = "none";
    return false;
  }
  const sourceSize = readSourceSize(source);
  if (!sourceSize) return false;
  const styleSource = source instanceof HTMLElement ? source : entry.element;
  const sourceOpacity = entry.element.style.getPropertyValue("opacity");
  const sourceOpacityPriority = entry.element.style.getPropertyPriority("opacity");
  const hiddenByColorGrading =
    entry.sourceHidden && sourceOpacity === "0" && sourceOpacityPriority === "important";
  const sourceVisibility = entry.element.style.getPropertyValue("visibility");
  const injectedFrameSource = isRenderFrameImage(source);
  if (injectedFrameSource) keepCanvasAboveSource(entry, source);
  if (injectedFrameSource || !hiddenByColorGrading) {
    const computed = window.getComputedStyle(injectedFrameSource ? source : entry.element);
    entry.sourceOpacityForCanvas = computed.opacity || "1";
    entry.sourceVisibleForCanvas =
      (injectedFrameSource || sourceVisibility !== "hidden") && computed.visibility !== "hidden";
  }
  const layout = updateCanvasLayout(entry, styleSource);
  if (!layout) return false;

  const style = window.getComputedStyle(styleSource);
  const uv = calculateObjectFitUv(
    layout.width,
    layout.height,
    sourceSize.width,
    sourceSize.height,
    style.objectFit,
    style.objectPosition,
  );
  const { gl, program } = entry;
  try {
    const grading = readAnimatedGrading(entry);
    const lut = ensureEntryLut(entry);
    // Browser media elements are top-left oriented; WebGL texture coordinates
    // are bottom-left oriented unless the upload is flipped.
    uploadSourceTexture(gl, program.texture, source);
    const hasAnimatedKuwahara =
      readAnimatedValue(entry.element, ANIMATED_KUWAHARA_PROPERTY) !== null;
    const prepared = prepareEffectTextures(entry, grading, layout, uv, {
      preserveKuwahara: hasAnimatedKuwahara,
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, layout.width, layout.height);
    gl.useProgram(program.program);
    bindProgramTextures(gl, program, prepared);
    const runtimeTime = (window as WindowWithColorGrading).__player?.getTime?.();
    const frameTime =
      typeof runtimeTime === "number" && Number.isFinite(runtimeTime)
        ? Math.max(0, runtimeTime)
        : entry.element instanceof HTMLVideoElement
          ? Math.max(0, entry.element.currentTime)
          : 0;
    const grainSeed = entry.grainSeed + Math.floor(frameTime * 60);
    applyUniforms(
      gl,
      program,
      grading,
      lut,
      prepared.blurReady,
      prepared.bloomReady,
      prepared.kuwaharaReady,
      entry.compare,
      layout,
      uv,
      grainSeed,
      frameTime,
    );
    drawFullscreenQuad(gl, program);
    hideSourceElement(entry);
    entry.hasDrawn = true;
    entry.drawError = null;
    return true;
  } catch (err) {
    entry.drawError = err instanceof Error ? err.message : "Shader draw failed";
    swallow("runtime.colorGrading.drawEntry", err);
    return false;
  }
}

function previewDimensions(
  element: ColorGradingMediaElement,
  sourceSize: { width: number; height: number },
  rawMaxDimension: number | undefined,
): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  const boxWidth = element.offsetWidth || rect.width || sourceSize.width;
  const boxHeight = element.offsetHeight || rect.height || sourceSize.height;
  const maxDimension = Math.min(320, Math.max(64, Math.round(rawMaxDimension ?? 160)));
  const aspect =
    boxWidth > 0 && boxHeight > 0 ? boxWidth / boxHeight : sourceSize.width / sourceSize.height;
  return aspect >= 1
    ? { width: maxDimension, height: Math.max(1, Math.round(maxDimension / aspect)) }
    : { width: Math.max(1, Math.round(maxDimension * aspect)), height: maxDimension };
}

function createPreviewRenderer(): ColorGradingPreviewRenderer | null {
  const canvas = document.createElement("canvas");
  const created = createProgramInfo(canvas);
  return created
    ? {
        canvas,
        ...created,
        lut: null,
        effectTargets: null,
        kuwaharaTargets: null,
        effectError: null,
      }
    : null;
}

interface PreviewFrame {
  dimensions: { width: number; height: number };
  uv: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
  grainSeed: number;
  effectTime: number;
}

function previewEffectTime(element: ColorGradingMediaElement, useMediaTime: boolean): number {
  const runtimeTime = useMediaTime
    ? undefined
    : (window as WindowWithColorGrading).__player?.getTime?.();
  if (typeof runtimeTime === "number" && Number.isFinite(runtimeTime)) {
    return Math.max(0, runtimeTime);
  }
  return element instanceof HTMLVideoElement ? Math.max(0, element.currentTime) : 0;
}

function preparePreviewFrame(
  renderer: ColorGradingPreviewRenderer,
  element: ColorGradingMediaElement,
  maxDimension: number | undefined,
  useMediaTime: boolean,
): PreviewFrame | null {
  const source = getDrawableSource(element);
  if (!source) return null;
  const sourceSize = readSourceSize(source);
  if (!sourceSize) return null;
  const dimensions = previewDimensions(element, sourceSize, maxDimension);
  renderer.canvas.width = dimensions.width;
  renderer.canvas.height = dimensions.height;
  const styleSource = source instanceof HTMLElement ? source : element;
  const style = window.getComputedStyle(styleSource);
  const uv = calculateObjectFitUv(
    dimensions.width,
    dimensions.height,
    sourceSize.width,
    sourceSize.height,
    style.objectFit,
    style.objectPosition,
  );
  uploadSourceTexture(renderer.gl, renderer.program.texture, source);
  return {
    dimensions,
    uv,
    effectTime: previewEffectTime(element, useMediaTime),
    grainSeed:
      seedForElement(element) +
      (element instanceof HTMLVideoElement ? Math.floor(element.currentTime * 60) : 0),
  };
}

async function renderPreviewBatch(
  renderer: ColorGradingPreviewRenderer,
  element: ColorGradingMediaElement,
  candidates: readonly RuntimeColorGradingPreviewCandidate[],
  maxDimension: number | undefined,
  useMediaTime = false,
): Promise<RuntimeColorGradingPreviewBatch | null> {
  const frame = preparePreviewFrame(renderer, element, maxDimension, useMediaTime);
  if (!frame) return null;
  const { dimensions, uv, grainSeed, effectTime } = frame;
  const images: RuntimeColorGradingPreviewBatch["images"] = [];

  for (const candidate of candidates.slice(0, 32)) {
    const grading = normalizeHfColorGrading(candidate.grading);
    if (!grading) {
      images.push({ id: candidate.id, dataUrl: null, error: "Invalid grading" });
      continue;
    }
    let lut: RuntimeLutTexture | null = null;
    try {
      if (grading.lut) {
        if (renderer.lut?.src !== grading.lut.src) {
          renderer.lut = uploadPreviewLut(
            renderer,
            grading.lut.src,
            await loadCubeLut(grading.lut.src),
          );
        }
        lut = renderer.lut;
      }
      images.push({
        id: candidate.id,
        dataUrl: renderPreviewCandidate(
          renderer,
          grading,
          lut,
          dimensions,
          uv,
          grainSeed,
          effectTime,
        ),
      });
    } catch (err) {
      images.push({ id: candidate.id, dataUrl: null, error: errorMessage(err) });
    }
  }
  return { ...dimensions, images };
}

function renderPreviewCandidate(
  renderer: ColorGradingPreviewRenderer,
  grading: NormalizedHfColorGrading,
  lut: RuntimeLutTexture | null,
  dimensions: { width: number; height: number },
  uv: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
  grainSeed: number,
  effectTime: number,
): string {
  const { canvas, gl, program } = renderer;
  const prepared = prepareEffectTextures(renderer, grading, dimensions, uv, {
    releaseIdleTargets: false,
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, dimensions.width, dimensions.height);
  gl.useProgram(program.program);
  bindProgramTextures(gl, program, prepared);
  if (!lut) renderer.lut = null;
  applyUniforms(
    gl,
    program,
    grading,
    lut,
    prepared.blurReady,
    prepared.bloomReady,
    prepared.kuwaharaReady,
    DEFAULT_COMPARE,
    dimensions,
    uv,
    grainSeed,
    effectTime,
  );
  drawFullscreenQuad(gl, program);
  return canvas.toDataURL("image/png");
}

function addListener(
  entry: ColorGradingEntry,
  target: EventTarget,
  type: string,
  listener: EventListener,
): void {
  target.addEventListener(type, listener);
  entry.cleanup.push(() => target.removeEventListener(type, listener));
}

function cancelScheduledFrame(entry: ColorGradingEntry): void {
  if (entry.animationFrame !== null) {
    window.cancelAnimationFrame(entry.animationFrame);
    entry.animationFrame = null;
  }
  if (entry.videoFrameHandle !== null && entry.element instanceof HTMLVideoElement) {
    const videoFrameHost: VideoFrameCallbackHost = entry.element;
    videoFrameHost.cancelVideoFrameCallback?.(entry.videoFrameHandle);
    entry.videoFrameHandle = null;
  }
}

function scheduleVideoDraw(entry: ColorGradingEntry): void {
  if (entry.destroyed || !(entry.element instanceof HTMLVideoElement)) return;
  if (entry.videoFrameHandle !== null || entry.animationFrame !== null) return;
  const video = entry.element;
  const videoFrameHost: VideoFrameCallbackHost = video;
  if (typeof videoFrameHost.requestVideoFrameCallback === "function") {
    entry.videoFrameHandle = videoFrameHost.requestVideoFrameCallback(() => {
      entry.videoFrameHandle = null;
      drawEntry(entry);
      if (!entry.destroyed && !video.paused && !video.ended) scheduleVideoDraw(entry);
    });
    return;
  }
  entry.animationFrame = window.requestAnimationFrame(() => {
    entry.animationFrame = null;
    drawEntry(entry);
    if (!entry.destroyed && !video.paused && !video.ended) scheduleVideoDraw(entry);
  });
}

function installEntryListeners(entry: ColorGradingEntry): void {
  const redraw = () => {
    drawEntry(entry);
  };
  addListener(entry, entry.element, "load", redraw);
  addListener(entry, entry.element, "loadedmetadata", redraw);
  addListener(entry, entry.element, "loadeddata", redraw);
  addListener(entry, entry.element, "seeked", redraw);
  addListener(entry, entry.element, "timeupdate", redraw);
  addListener(entry, window, "resize", redraw);
  if (entry.element instanceof HTMLVideoElement) {
    addListener(entry, entry.element, "play", () => scheduleVideoDraw(entry));
    addListener(entry, entry.element, "pause", redraw);
  }
  addListener(entry, entry.canvas, "webglcontextlost", (event) => {
    event.preventDefault();
    entry.contextLost = true;
    entry.drawError = "WebGL context lost";
    entry.canvas.style.display = "none";
    restoreSourceElement(entry);
  });
  addListener(entry, entry.canvas, "webglcontextrestored", () => {
    entry.contextLost = false;
    if (!replaceProgramResources(entry)) {
      entry.contextLost = true;
      entry.drawError = "WebGL context restore failed";
      restoreSourceElement(entry);
      return;
    }
    entry.drawError = null;
    drawEntry(entry);
  });
  if (typeof ResizeObserver !== "undefined") {
    entry.resizeObserver = new ResizeObserver(redraw);
    entry.resizeObserver.observe(entry.element);
  }
  // A studio drag/nudge moves the source via its inline transform — no media
  // event or ResizeObserver fires for that, so the graded canvas (the visible
  // pixels) froze in place until the next seek while the invisible source
  // followed the pointer. Track geometry-relevant inline style and re-sync the
  // canvas, rAF-throttled. The signature guard keeps the opacity/visibility
  // writes drawEntry itself makes (the source hide) from re-triggering a loop.
  if (typeof MutationObserver !== "undefined") {
    const geometrySignature = () => {
      const s = entry.element.style;
      return `${s.transform}|${s.translate}|${s.rotate}|${s.scale}|${s.left}|${s.top}|${s.width}|${s.height}`;
    };
    let lastGeometry = geometrySignature();
    let framePending = false;
    const styleObserver = new MutationObserver(() => {
      if (framePending) return;
      if (geometrySignature() === lastGeometry) return;
      framePending = true;
      requestAnimationFrame(() => {
        framePending = false;
        lastGeometry = geometrySignature();
        drawEntry(entry);
      });
    });
    styleObserver.observe(entry.element, { attributes: true, attributeFilter: ["style"] });
    entry.cleanup.push(() => styleObserver.disconnect());
  }
}

function detachEntry(entry: ColorGradingEntry): ColorGradingRenderer | null {
  if (entry.destroyed) return null;
  entry.destroyed = true;
  cancelScheduledFrame(entry);
  entry.resizeObserver?.disconnect();
  for (const cleanup of entry.cleanup) cleanup();
  entry.cleanup.length = 0;
  entry.canvas.remove();
  destroyEffectTargets(entry);
  destroyKuwaharaTargets(entry);
  restoreSourceElement(entry);
  if (entry.touchedParent) {
    if (entry.parentInlinePosition === null) {
      entry.touchedParent.style.removeProperty("position");
    } else {
      entry.touchedParent.style.position = entry.parentInlinePosition;
    }
  }
  return {
    canvas: entry.canvas,
    gl: entry.gl,
    program: entry.program,
    effectTargets: null,
    kuwaharaTargets: null,
    effectError: null,
  };
}

function attachCanvas(
  canvas: HTMLCanvasElement,
  element: ColorGradingMediaElement,
): HTMLCanvasElement {
  canvas.removeAttribute("style");
  if (element.id) canvas.id = `${HF_COLOR_GRADING_CANVAS_ID_PREFIX}${element.id}`;
  else canvas.removeAttribute("id");
  canvas.className = COLOR_GRADING_CANVAS_CLASS;
  canvas.setAttribute(COLOR_GRADING_CANVAS_ATTR, "true");
  canvas.setAttribute("data-hyperframes-ignore", "");
  canvas.setAttribute("data-hyperframes-picker-ignore", "");
  canvas.setAttribute("data-hf-ignore", "");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.pointerEvents = "none";
  canvas.style.display = "none";
  element.parentNode?.insertBefore(canvas, element.nextSibling);
  return canvas;
}

function makeCanvas(element: ColorGradingMediaElement): HTMLCanvasElement {
  return attachCanvas(document.createElement("canvas"), element);
}

export function createColorGradingRuntime(): RuntimeColorGradingApi {
  const entries = new WeakMap<ColorGradingMediaElement, ColorGradingEntry>();
  const trackedElements = new Set<ColorGradingMediaElement>();
  const idleRenderers: ColorGradingRenderer[] = [];
  let observer: MutationObserver | null = null;
  let previewRenderer: ColorGradingPreviewRenderer | null = null;
  let destroyed = false;

  const upsert = (
    element: ColorGradingMediaElement,
    grading: NormalizedHfColorGrading,
    source: EntrySource,
  ): boolean => {
    const existing = entries.get(element);
    if (existing) {
      existing.grading = grading;
      existing.source = source;
      drawEntry(existing);
      if (element instanceof HTMLVideoElement && !element.paused) scheduleVideoDraw(existing);
      return true;
    }
    let renderer = idleRenderers.pop();
    if (renderer) {
      attachCanvas(renderer.canvas, element);
    } else {
      const canvas = makeCanvas(element);
      const created = createProgramInfo(canvas);
      if (!created) {
        canvas.remove();
        return false;
      }
      renderer = {
        canvas,
        gl: created.gl,
        program: created.program,
        effectTargets: null,
        kuwaharaTargets: null,
        effectError: null,
      };
    }
    const entry: ColorGradingEntry = {
      element,
      ...renderer,
      grading,
      compare: { ...DEFAULT_COMPARE },
      lut: null,
      lutLoadingSrc: null,
      lutError: null,
      drawError: null,
      effectTargets: null,
      kuwaharaTargets: null,
      effectError: null,
      source,
      animationFrame: null,
      videoFrameHandle: null,
      resizeObserver: null,
      cleanup: [],
      touchedParent: null,
      parentInlinePosition: null,
      sourceHidden: false,
      sourceInlineOpacity: null,
      sourceInlineOpacityPriority: "",
      sourceOpacityForCanvas: window.getComputedStyle(element).opacity || "1",
      sourceVisibleForCanvas: window.getComputedStyle(element).visibility !== "hidden",
      hasDrawn: false,
      contextLost: false,
      grainSeed: seedForElement(element),
      destroyed: false,
    };
    entries.set(element, entry);
    trackedElements.add(element);
    installEntryListeners(entry);
    drawEntry(entry);
    if (element instanceof HTMLVideoElement && !element.paused) scheduleVideoDraw(entry);
    return true;
  };

  const setCompare = (
    target: HfColorGradingTarget | string | null | undefined,
    rawCompare: unknown,
  ): boolean => {
    if (destroyed) return false;
    const element = resolveTarget(target);
    if (!element) return false;
    let entry = entries.get(element);
    if (!entry) {
      const grading = readColorGradingAttribute(element);
      if (
        !isRuntimeColorGradingActive(element, grading) ||
        !upsert(element, grading, "attribute")
      ) {
        return false;
      }
      entry = entries.get(element);
    }
    if (!entry) return false;
    entry.compare = normalizeCompare(rawCompare);
    drawEntry(entry);
    return true;
  };

  const removeElement = (element: ColorGradingMediaElement): void => {
    const entry = entries.get(element);
    if (!entry) return;
    const renderer = detachEntry(entry);
    if (renderer) {
      if (entry.contextLost || idleRenderers.length >= MAX_IDLE_COLOR_GRADING_RENDERERS) {
        destroyProgramResources(renderer, true);
      } else {
        idleRenderers.push(renderer);
      }
    }
    entries.delete(element);
    trackedElements.delete(element);
  };

  const refresh = (): number => {
    if (destroyed) return 0;
    const attributeElements = new Set<ColorGradingMediaElement>();
    const nodes = document.querySelectorAll(
      `video[${HF_COLOR_GRADING_ATTR}], img[${HF_COLOR_GRADING_ATTR}]`,
    );
    nodes.forEach((node) => {
      if (!isColorGradingMediaElement(node)) return;
      attributeElements.add(node);
      const grading = readColorGradingAttribute(node);
      if (isRuntimeColorGradingActive(node, grading)) {
        if (isVisibleForColorGrading(node) || hasInjectedRenderFrame(node)) {
          upsert(node, grading, "attribute");
        } else {
          removeElement(node);
        }
      } else {
        removeElement(node);
      }
    });
    for (const element of trackedElements) {
      const entry = entries.get(element);
      if (!entry) continue;
      if (
        !element.isConnected ||
        (entry.source === "attribute" && !attributeElements.has(element))
      ) {
        removeElement(element);
      }
    }
    return trackedElements.size;
  };

  const redraw = (): number => {
    if (destroyed) return 0;
    let drawn = 0;
    for (const element of trackedElements) {
      const entry = entries.get(element);
      if (!entry) continue;
      if (drawEntry(entry)) drawn += 1;
    }
    return drawn;
  };

  const waitForActiveLuts = async (): Promise<number> => {
    const pending = new Set<Promise<CubeLut3D>>();
    for (const element of trackedElements) {
      const lut = entries.get(element)?.grading.lut;
      if (!lut?.src.trim() || (lut.intensity ?? 1) <= 0) continue;
      const cached = getCubeLut(lut.src);
      if (cached.state === "pending") pending.add(cached.promise);
    }
    if (pending.size > 0) await Promise.allSettled(pending);
    // Capture awaits this method after every seek; this paint is required even
    // when no LUT is pending so the screenshot receives the current frame.
    redraw();
    return pending.size;
  };

  const redrawAnimated = (): number => {
    if (destroyed) return 0;
    let drawn = 0;
    for (const element of trackedElements) {
      const entry = entries.get(element);
      if (!entry) continue;
      const hasAnimatedProperty = ANIMATED_GRADING_PROPERTIES.some(
        (property) => readAnimatedValue(element, property) !== null,
      );
      if (!hasAnimatedProperty) continue;
      if (element instanceof HTMLVideoElement && !element.paused && !element.ended) continue;
      if (drawEntry(entry)) drawn += 1;
    }
    return drawn;
  };

  const setGrading = (
    target: HfColorGradingTarget | string | null | undefined,
    rawGrading: unknown,
  ): boolean => {
    if (destroyed) return false;
    const element = resolveTarget(target);
    if (!element) return false;
    const grading = normalizeHfColorGrading(rawGrading);
    if (!isRuntimeColorGradingActive(element, grading)) {
      removeElement(element);
      return true;
    }
    return upsert(element, grading, "live");
  };

  const setSourceVisibility = (target: Element, visible: boolean): boolean => {
    if (!isColorGradingMediaElement(target)) return false;
    const entry = entries.get(target);
    if (!entry) {
      if (!visible) return false;
      const grading = readColorGradingAttribute(target);
      return isRuntimeColorGradingActive(target, grading) && upsert(target, grading, "attribute");
    }
    entry.sourceVisibleForCanvas = visible;
    if (!visible && entry.source === "attribute") {
      removeElement(target);
    }
    return true;
  };

  // fallow-ignore-next-line complexity
  const getStatus = (
    target: HfColorGradingTarget | string | null | undefined,
  ): RuntimeColorGradingStatus => {
    const element = resolveTarget(target);
    if (!element) return { state: "missing", message: "Media not found" };
    const entry = entries.get(element);
    if (entry) {
      if (entry.effectError) {
        return { state: "unavailable", message: entry.effectError };
      }
      if (entry.drawError) {
        return { state: "unavailable", message: entry.drawError };
      }
      if (entry.lutError) {
        return { state: "unavailable", message: `LUT error: ${entry.lutError}` };
      }
      if (entry.grading.lut && entry.lutLoadingSrc) {
        return { state: "pending", message: "Loading LUT" };
      }
      if (entry.canvas.style.display === "none") {
        return { state: "pending", message: "Waiting for media frame" };
      }
      return {
        state: "active",
        message: entry.lut ? "Shader + LUT active" : "Shader active",
      };
    }
    const grading = readColorGradingAttribute(element);
    if (isRuntimeColorGradingActive(element, grading)) {
      if (!isVisibleForColorGrading(element) && !hasInjectedRenderFrame(element)) {
        return { state: "pending", message: "Waiting for visible media" };
      }
      return { state: "unavailable", message: "WebGL unavailable" };
    }
    return { state: "inactive", message: "No grading applied" };
  };

  const renderPreviews = async (
    target: HfColorGradingTarget | string | null | undefined,
    candidates: readonly RuntimeColorGradingPreviewCandidate[],
    options?: { maxDimension?: number; useMediaTime?: boolean },
  ): Promise<RuntimeColorGradingPreviewBatch | null> => {
    if (destroyed || candidates.length === 0) return null;
    const element = resolveTarget(target);
    if (!element) return null;
    previewRenderer ??= createPreviewRenderer();
    if (!previewRenderer) return null;
    return renderPreviewBatch(
      previewRenderer,
      element,
      candidates,
      options?.maxDimension,
      options?.useMediaTime,
    );
  };

  const startPreviewPlayback = (
    target: HfColorGradingTarget | string | null | undefined,
  ): (() => void) | null => {
    const element = resolveTarget(target);
    if (!(element instanceof HTMLVideoElement)) return null;
    if (!element.paused) return () => undefined;
    const time = element.currentTime;
    const loop = element.loop;
    const muted = element.muted;
    element.loop = true;
    element.muted = true;
    if (element.ended || (Number.isFinite(element.duration) && time >= element.duration)) {
      element.currentTime = 0;
    }
    void element.play().catch(() => undefined);
    return () => {
      element.pause();
      element.loop = loop;
      element.muted = muted;
      element.currentTime = time;
    };
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    observer = null;
    for (const element of trackedElements) removeElement(element);
    for (const renderer of idleRenderers) destroyProgramResources(renderer, true);
    idleRenderers.length = 0;
    if (previewRenderer) {
      destroyProgramResources(previewRenderer, true);
      previewRenderer = null;
    }
  };

  if (document.body) {
    observer = new MutationObserver(() => refresh());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [HF_COLOR_GRADING_ATTR],
    });
  }

  const api: RuntimeColorGradingApi = {
    refresh,
    redraw,
    redrawAnimated,
    waitForActiveLuts,
    setGrading,
    setCompare,
    setSourceVisibility,
    getStatus,
    renderPreviews,
    startPreviewPlayback,
    destroy,
  };
  const win = window as WindowWithColorGrading;
  win.__hf = win.__hf || {};
  win.__hf.colorGrading = api;
  refresh();
  return api;
}
