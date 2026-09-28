/**
 * VFX chain: the one description of every per-pixel effect that can be
 * applied to a layer's own pixels through the WebGL2 runtime.
 *
 * Mirrors `audioFx.ts` (`data-fx-chain`) in shape: a versioned JSON chain
 * attribute, a def registry with typed params, and parse/serialize/normalize
 * helpers so the exporter and the runtime agree on one description of each
 * effect.
 */

import { FRACTAL_NOISE_FRAG } from "./vfx/fractalNoise.frag";
import { DISPLACEMENT_MAP_FRAG } from "./vfx/displacementMap.frag";
import { LUMA_MATTE_FRAG } from "./vfx/lumaMatte.frag";
import { NOISE_FRAG } from "./vfx/noise.frag";
import { WAVE_WARP_FRAG } from "./vfx/waveWarp.frag";

export const HF_VFX_ATTR = "data-vfx-chain";

/**
 * Chain files are versioned; a reader must refuse a version it doesn't know.
 * Exported for the exporter (hyperframes-ae-mcp), which stamps the version it
 * emits; inside this repo only parse/serialize below read it.
 */
// fallow-ignore-next-line unused-export
export const HF_VFX_CHAIN_VERSION = 1;

/**
 * What a def's kernel must read besides `(x, y, t, params)`:
 * - `none` — the kernel is a generator/replacement; no captured texture.
 * - `self` — the kernel reads the host's own pixels through a `layoutsubtree`
 *   capture canvas.
 * - `backdrop` — the kernel reads everything below the host (adjustment-layer
 *   style effects).
 */
export type HfVfxCapture = "none" | "self" | "backdrop";

export interface HfVfxNumberParam {
  kind: "number";
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** May be driven by a `--vfx-<nodeId>-<key>` CSS var instead of `params`. */
  animatable?: boolean;
  hint?: string;
}

export interface HfVfxEnumParam {
  kind: "enum";
  key: string;
  label: string;
  options: readonly { value: number; label: string }[];
  default: number;
  hint?: string;
}

export interface HfVfxBoolParam {
  kind: "bool";
  key: string;
  label: string;
  default: boolean;
}

/** A second-source param (v1.1): its value is the id of another element. */
export interface HfVfxRefParam {
  kind: "ref";
  key: string;
  label: string;
  /**
   * The kernel works without it. `displacement-map` reads its own pixels as
   * the map when `map` is empty (every corpus instance is self-referential),
   * while `luma-matte` without a matte has nothing to do, so a missing id
   * there is a loud failure. Spec amendment to v1.1, which had no optional
   * refs because its only ref was required.
   */
  optional?: boolean;
}

export type HfVfxParam = HfVfxNumberParam | HfVfxEnumParam | HfVfxBoolParam | HfVfxRefParam;

/** `string` values only occur for `ref` params (element ids). */
export type HfVfxParamValues = Record<string, number | boolean | string>;

export interface HfVfxDef {
  id: string;
  label: string;
  /** What the kernel must read besides (x, y, t, params). */
  capture: HfVfxCapture;
  params: readonly HfVfxParam[];
  /** GLSL ES 3.00 fragment source; uniforms are u_size/u_t/u_fps/u_src(2)/u_<key>. */
  frag: string;
  /** AE match name this def ports, for docs — e.g. "ADBE Fractal Noise". */
  ae?: string;
}

/**
 * After Effects' channel selector, shared by both Displacement Map axes.
 * Hue (6), Lightness (7) and Saturation (8) stay selectable and are read as
 * Luminance by the kernel — folding them back to the param's default would
 * mean Red on the horizontal axis, a much larger error.
 */
const DISPLACEMENT_CHANNELS = [
  { value: 1, label: "Red" },
  { value: 2, label: "Green" },
  { value: 3, label: "Blue" },
  { value: 4, label: "Alpha" },
  { value: 5, label: "Luminance" },
  { value: 6, label: "Hue" },
  { value: 7, label: "Lightness" },
  { value: 8, label: "Saturation" },
  { value: 9, label: "Full" },
  { value: 10, label: "Half" },
  { value: 11, label: "Off" },
] as const;

/**
 * The def registry. Params come from the AE deep dives and retro-wave's
 * observed values; each kernel's own `frag` module states the v1 scope
 * decision — which of the effect's modes it actually implements and why.
 *
 * Exported as the whole registry for the exporter and Studio's effect picker;
 * inside the runtime, defs are reached through `getVfxDef`.
 */
// fallow-ignore-next-line unused-export
export const HF_VFX: readonly HfVfxDef[] = [
  {
    id: "fractal-noise",
    label: "Fractal Noise",
    ae: "ADBE Fractal Noise",
    capture: "none",
    frag: FRACTAL_NOISE_FRAG,
    params: [
      {
        kind: "enum",
        key: "fractalType",
        label: "Fractal Type",
        options: [{ value: 1, label: "Basic" }],
        default: 1,
        hint: "Only Basic is implemented in v1.",
      },
      {
        kind: "enum",
        key: "noiseType",
        label: "Noise Type",
        options: [
          { value: 1, label: "Block" },
          { value: 2, label: "Linear" },
          { value: 3, label: "Soft Linear" },
          { value: 4, label: "Spline" },
        ],
        default: 3,
      },
      { kind: "bool", key: "invert", label: "Invert", default: false },
      {
        kind: "number",
        key: "contrast",
        label: "Contrast",
        unit: "%",
        min: 0,
        max: 1000,
        step: 1,
        default: 100,
      },
      {
        kind: "number",
        key: "brightness",
        label: "Brightness",
        unit: "",
        min: -1000,
        max: 1000,
        step: 1,
        default: 0,
      },
      {
        kind: "number",
        key: "scale",
        label: "Scale",
        unit: "%",
        min: 6,
        max: 10000,
        step: 1,
        default: 100,
      },
      {
        kind: "number",
        key: "complexity",
        label: "Complexity",
        unit: "",
        min: 1,
        max: 20,
        step: 1,
        default: 6,
      },
      {
        kind: "number",
        key: "subInfluence",
        label: "Sub Influence",
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
        default: 70,
      },
      {
        kind: "number",
        key: "subScaling",
        label: "Sub Scaling",
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
        default: 56,
      },
      {
        kind: "number",
        key: "evolution",
        label: "Evolution",
        unit: "revolutions",
        min: -10000,
        max: 10000,
        step: 0.01,
        default: 0,
        animatable: true,
      },
      {
        kind: "number",
        key: "randomSeed",
        label: "Random Seed",
        unit: "",
        min: 0,
        max: 99999,
        step: 1,
        default: 0,
      },
      {
        kind: "number",
        key: "opacity",
        label: "Opacity",
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
        default: 100,
        animatable: true,
      },
    ],
  },
  {
    id: "wave-warp",
    label: "Wave Warp",
    ae: "ADBE Wave Warp",
    capture: "self",
    frag: WAVE_WARP_FRAG,
    params: [
      {
        kind: "enum",
        key: "waveType",
        label: "Wave Type",
        options: [{ value: 1, label: "Sine" }],
        default: 1,
        hint: "Only Sine is implemented in v1; the exporter marks the others cosmetic.",
      },
      {
        kind: "number",
        key: "height",
        label: "Wave Height",
        unit: "px",
        min: -1000,
        max: 1000,
        step: 1,
        default: 10,
        animatable: true,
      },
      {
        kind: "number",
        key: "width",
        label: "Wave Width",
        unit: "px",
        min: 1,
        max: 10000,
        step: 1,
        default: 40,
        animatable: true,
      },
      {
        kind: "number",
        key: "direction",
        label: "Direction",
        unit: "deg",
        min: -360,
        max: 360,
        step: 1,
        default: 90,
      },
      {
        kind: "number",
        key: "speed",
        label: "Wave Speed",
        unit: "waves/s",
        min: -100,
        max: 100,
        step: 0.1,
        default: 1,
      },
      {
        kind: "enum",
        key: "pinning",
        label: "Pinning",
        options: [{ value: 1, label: "None" }],
        default: 1,
        hint: "Only None is implemented in v1; the exporter marks the others cosmetic.",
      },
      {
        kind: "number",
        key: "phase",
        label: "Phase",
        unit: "deg",
        min: -360,
        max: 360,
        step: 1,
        default: 0,
        animatable: true,
      },
    ],
  },
  {
    id: "displacement-map",
    label: "Displacement Map",
    ae: "ADBE Displacement Map",
    capture: "self",
    frag: DISPLACEMENT_MAP_FRAG,
    params: [
      {
        kind: "ref",
        key: "map",
        label: "Displacement Map Layer",
        // Optional: empty means the AE default the corpus uses, a map layer
        // pointing at the layer itself, which `u_src` already holds.
        optional: true,
      },
      {
        kind: "enum",
        key: "useH",
        label: "Use For Horizontal Displacement",
        options: DISPLACEMENT_CHANNELS,
        default: 1,
        hint: "Hue, Lightness and Saturation are read as Luminance in v1.",
      },
      {
        kind: "number",
        key: "maxH",
        label: "Max Horizontal Displacement",
        unit: "px",
        min: -32000,
        max: 32000,
        step: 1,
        default: 5,
        animatable: true,
      },
      {
        kind: "enum",
        key: "useV",
        label: "Use For Vertical Displacement",
        options: DISPLACEMENT_CHANNELS,
        default: 2,
        hint: "Hue, Lightness and Saturation are read as Luminance in v1.",
      },
      {
        kind: "number",
        key: "maxV",
        label: "Max Vertical Displacement",
        unit: "px",
        min: -32000,
        max: 32000,
        step: 1,
        default: 5,
        animatable: true,
      },
      {
        kind: "enum",
        key: "behavior",
        label: "Displacement Map Behavior",
        options: [{ value: 1, label: "Center Map" }],
        default: 1,
        hint: "Only Center Map is implemented in v1.",
      },
      {
        kind: "enum",
        key: "edge",
        label: "Edge Behavior",
        options: [{ value: 0, label: "Off" }],
        default: 0,
        hint: "Only Off (transparent outside the layer) is implemented in v1.",
      },
      {
        kind: "bool",
        key: "expand",
        label: "Expand Output",
        default: true,
      },
    ],
  },
  {
    id: "luma-matte",
    label: "Matte",
    // Not one AE effect: the runtime form of every matte the exporter cannot
    // express as CSS — unsupported track-matte sources, stencils and
    // silhouettes, Set Matte. Which element is the source and which the matte
    // is the exporter's choice of what to wrap and what to name in `matte`.
    capture: "self",
    frag: LUMA_MATTE_FRAG,
    params: [
      { kind: "ref", key: "matte", label: "Matte Layer" },
      {
        kind: "enum",
        key: "mode",
        label: "Matte Mode",
        options: [
          { value: 1, label: "Alpha" },
          { value: 2, label: "Alpha Inverted" },
          { value: 3, label: "Luma" },
          { value: 4, label: "Luma Inverted" },
        ],
        default: 1,
      },
    ],
  },
  {
    id: "noise",
    label: "Noise",
    ae: "ADBE Noise",
    // `self` on a content layer and `backdrop` on an adjustment layer are the
    // same kernel reading the same `u_src`; the runtime resolves which from
    // the DOM (a `data-vfx-for` wrapper), so the def declares only that a
    // texture is needed.
    capture: "self",
    frag: NOISE_FRAG,
    params: [
      {
        kind: "number",
        key: "amount",
        label: "Amount of Noise",
        unit: "%",
        min: 0,
        max: 400,
        step: 0.1,
        default: 0,
        animatable: true,
      },
      {
        kind: "bool",
        key: "useColorNoise",
        label: "Use Color Noise",
        default: false,
      },
      {
        kind: "bool",
        key: "clipping",
        label: "Clip Result Values",
        default: true,
      },
    ],
  },
] as const;

const BY_ID = new Map(HF_VFX.map((d) => [d.id, d]));

export function getVfxDef(id: string): HfVfxDef | undefined {
  return BY_ID.get(id);
}

/**
 * Clamp and fill a parameter set so it is always renderable: unknown keys are
 * dropped, missing keys take their default, numbers are clamped into their
 * declared range, an unrecognised enum value falls back to its default, and a
 * non-boolean bool value falls back to its default. Mirrors
 * `normalizeAudioFxParams`.
 */
export function normalizeVfxParams(
  id: string,
  values: Readonly<HfVfxParamValues> | undefined,
): HfVfxParamValues {
  const def = BY_ID.get(id);
  if (!def) return {};
  const out: HfVfxParamValues = {};
  for (const p of def.params) {
    const raw = values?.[p.key];
    out[p.key] =
      p.kind === "enum"
        ? normalizeEnumParam(p, raw)
        : p.kind === "bool"
          ? normalizeBoolParam(p, raw)
          : p.kind === "ref"
            ? normalizeRefParam(raw)
            : normalizeNumberParam(p, raw);
  }
  return out;
}

/** A number, or a string that actually spells one; `undefined` otherwise.
 *  `Number(null)`, `Number("")`, `Number(false)` and `Number([])` are all 0
 *  and all pass `Number.isFinite`, so a raw value of that shape must be
 *  treated as missing rather than coerced to 0 — 0 is a legal value for most
 *  of these knobs, so nothing downstream could otherwise tell. */
function coerceFiniteNumber(raw: unknown): number | undefined {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function normalizeEnumParam(p: HfVfxEnumParam, raw: unknown): number {
  const n = coerceFiniteNumber(raw);
  return n !== undefined && p.options.some((o) => o.value === n) ? n : p.default;
}

function normalizeBoolParam(p: HfVfxBoolParam, raw: unknown): boolean {
  return typeof raw === "boolean" ? raw : p.default;
}

function normalizeRefParam(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function normalizeNumberParam(p: HfVfxNumberParam, raw: unknown): number {
  const n = coerceFiniteNumber(raw);
  return n !== undefined ? Math.min(p.max, Math.max(p.min, n)) : p.default;
}

export interface HfVfxNode {
  type: string;
  id: string;
  enabled?: boolean;
  params: HfVfxParamValues;
}

export interface HfVfxChain {
  version: 1;
  nodes: HfVfxNode[];
}

export class VfxChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VfxChainError";
  }
}

/** The nodes that should paint, in order. */
export function enabledVfxNodes(chain: HfVfxChain): HfVfxNode[] {
  return chain.nodes.filter((n) => n.enabled !== false);
}

const CAPTURE_RANK: Record<HfVfxCapture, number> = { none: 0, self: 1, backdrop: 2 };

/** A chain's capture requirement is the strongest of its enabled nodes'. */
export function chainCapture(chain: HfVfxChain): HfVfxCapture {
  let best: HfVfxCapture = "none";
  for (const node of enabledVfxNodes(chain)) {
    const def = BY_ID.get(node.type);
    if (def && CAPTURE_RANK[def.capture] > CAPTURE_RANK[best]) best = def.capture;
  }
  return best;
}

/**
 * Parse a chain file. Unknown effect ids are rejected rather than skipped: a
 * chain that silently loses a node would render differently from the
 * composition the author saved, which is worse than refusing to render at
 * all. Params are kept as given (not normalized) so a chain round-trips
 * exactly; call `normalizeVfxParams` at paint time.
 */
export function parseVfxChain(json: string): HfVfxChain {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new VfxChainError(`Chain file is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new VfxChainError("Chain file must be a JSON object.");
  }
  const obj = raw as { version?: unknown; nodes?: unknown };
  if (obj.version !== HF_VFX_CHAIN_VERSION) {
    throw new VfxChainError(`Unsupported chain version: ${String(obj.version)}`);
  }
  if (!Array.isArray(obj.nodes)) {
    throw new VfxChainError("Chain file is missing a `nodes` array.");
  }
  const nodes = obj.nodes.map(parseVfxNode);
  return { version: HF_VFX_CHAIN_VERSION, nodes };
}

/** Serialise a chain for the `data-vfx-chain` attribute. */
export function serializeVfxChain(chain: HfVfxChain): string {
  return JSON.stringify({
    version: HF_VFX_CHAIN_VERSION,
    nodes: chain.nodes.map(serializeVfxNode),
  });
}

/** The shape a node is READ as: everything unknown until checked. */
interface RawVfxNode {
  type?: unknown;
  id?: unknown;
  enabled?: unknown;
  params?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function requireVfxNodeType(node: RawVfxNode, i: number): string {
  if (typeof node.type !== "string" || !BY_ID.has(node.type)) {
    throw new VfxChainError(`Node ${i} has unknown effect type: ${String(node.type)}`);
  }
  return node.type;
}

function requireVfxNodeId(node: RawVfxNode, i: number): string {
  if (typeof node.id !== "string" || node.id === "") {
    throw new VfxChainError(`Node ${i} is missing an id.`);
  }
  return node.id;
}

/**
 * One node out of a chain file, validated. Throws rather than dropping: a
 * chain that silently loses a node would render differently from the
 * composition the author saved.
 */
function parseVfxNode(n: unknown, i: number): HfVfxNode {
  if (!isPlainObject(n)) {
    throw new VfxChainError(`Node ${i} is not an object.`);
  }
  const node = n as RawVfxNode;
  const type = requireVfxNodeType(node, i);
  const id = requireVfxNodeId(node, i);
  const params = isPlainObject(node.params) ? (node.params as HfVfxParamValues) : {};
  return withoutUndefined({
    type,
    id,
    enabled: node.enabled === false ? false : undefined,
    params,
  });
}

/** One node as the `data-vfx-chain` attribute carries it. `enabled` is
 *  omitted when it holds its default, so a plain chain stays plain. */
function serializeVfxNode(node: HfVfxNode) {
  return withoutUndefined({
    type: node.type,
    id: node.id,
    enabled: node.enabled === false ? false : undefined,
    params: node.params,
  });
}

// Mirrors audioFx.ts's identical helper (Task 1.1: copy the shape of the
// audio chain, not its code — the two chain files stay independently
// readable rather than sharing a module neither owns).
// fallow-ignore-next-line code-duplication
function withoutUndefined<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}
