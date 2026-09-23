/**
 * VFX chain: the one description of every per-pixel effect that can be
 * applied to a layer's own pixels through the WebGL2 runtime.
 *
 * Mirrors `audioFx.ts` (`data-fx-chain`) in shape: a versioned JSON chain
 * attribute, a def registry with typed params, and parse/serialize/normalize
 * helpers so the exporter and the runtime agree on one description of each
 * effect.
 */

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
 * `fractal-noise` params, from the fractal-noise deep dive and retro-wave's
 * observed values. Basic (type 1) is the only fractal type implemented in v1;
 * see `vfx/fractalNoise.ts` (Task 1.3) for the kernel scope decision.
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
    frag: "void main(){}",
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
