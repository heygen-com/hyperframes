/**
 * Node-only GSAP AST parser. Depends on recast / @babel/parser, which compile
 * to CommonJS that calls `require("fs")` — so this module must never be in the
 * static import graph of isomorphic/browser code. It is reachable only via the
 * `@hyperframes/core/gsap-parser` subpath (studio-api mutations + the linter).
 *
 * Recast-free helpers (serialization, keyframe conversion, validation, types)
 * live in `./gsapSerialize` and are re-exported here so this subpath exposes the
 * full surface for tests and server-side consumers.
 */
import * as recast from "recast";
import { parse as babelParse } from "@babel/parser";
import {
  type ArcPathConfig,
  type ArcPathSegment,
  type GsapAnimation,
  type GsapKeyframesData,
  type GsapMethod,
  type GsapPercentageKeyframe,
  type ParsedGsap,
} from "./gsapSerialize";

export type {
  ArcPathConfig,
  ArcPathSegment,
  GsapAnimation,
  GsapMethod,
  ParsedGsap,
  GsapKeyframesData,
  GsapPercentageKeyframe,
  GsapKeyframeFormat,
} from "./gsapSerialize";
export {
  serializeGsapAnimations,
  getAnimationsForElementId,
  validateCompositionGsap,
  keyframesToGsapAnimations,
  gsapAnimationsToKeyframes,
  SUPPORTED_PROPS,
  SUPPORTED_EASES,
} from "./gsapSerialize";
export { generateSpringEaseData, SPRING_PRESETS } from "./springEase";
export type { SpringPreset } from "./springEase";

const GSAP_METHODS = new Set<string>(["set", "to", "from", "fromTo"]);

// ── Recast AST Helpers ──────────────────────────────────────────────────────

type ScopeBindings = ReadonlyMap<string, number | string | boolean>;

function parseScript(script: string) {
  return recast.parse(script, {
    parser: {
      parse(source: string) {
        return babelParse(source, { sourceType: "script", plugins: [], tokens: true });
      },
    },
  });
}

function collectScopeBindings(ast: any): ScopeBindings {
  const bindings = new Map<string, number | string | boolean>();
  recast.types.visit(ast, {
    visitVariableDeclarator(path: any) {
      const name = path.node.id?.name;
      const init = path.node.init;
      if (name && init) {
        const val = resolveNode(init, bindings);
        if (val !== undefined) bindings.set(name, val);
      }
      this.traverse(path);
    },
  });
  return bindings;
}

function resolveNode(
  node: any,
  scope: ReadonlyMap<string, number | string | boolean>,
): number | string | boolean | undefined {
  if (!node) return undefined;
  if (node.type === "NumericLiteral" || (node.type === "Literal" && typeof node.value === "number"))
    return node.value;
  if (node.type === "StringLiteral" || (node.type === "Literal" && typeof node.value === "string"))
    return node.value;
  if (
    node.type === "BooleanLiteral" ||
    (node.type === "Literal" && typeof node.value === "boolean")
  )
    return node.value;
  if (node.type === "UnaryExpression" && node.operator === "-" && node.argument) {
    const val = resolveNode(node.argument, scope);
    return typeof val === "number" ? -val : undefined;
  }
  if (node.type === "BinaryExpression") {
    const left = resolveNode(node.left, scope);
    const right = resolveNode(node.right, scope);
    if (typeof left === "number" && typeof right === "number") {
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right !== 0 ? left / right : undefined;
      }
    }
    if (typeof left === "string" && node.operator === "+") return left + String(right ?? "");
    if (typeof right === "string" && node.operator === "+") return String(left ?? "") + right;
  }
  if (node.type === "Identifier" && scope.has(node.name)) {
    return scope.get(node.name);
  }
  if (node.type === "TemplateLiteral" && node.expressions?.length === 0) {
    return node.quasis?.[0]?.value?.cooked ?? undefined;
  }
  return undefined;
}

function extractLiteralValue(node: any, scope: ScopeBindings): unknown {
  return resolveNode(node, scope);
}

// ── Element-target resolution ───────────────────────────────────────────────
//
// Real compositions target tweens through element variables resolved from the
// DOM (`const kicker = root.querySelector(".kicker"); tl.to(kicker, …)`), arrays
// of them (`tl.to([a, b], …)`), `gsap.utils.toArray(".sel")`, and per-element
// loop variables (`items.forEach(el => tl.to(el, …))`) — not inline string
// selectors. To make those tweens editable we resolve each target back to the
// CSS selector(s) it addresses. Resolution is lexically scoped: the same
// variable name can mean different elements in different IIFEs.

const QUERY_METHODS = new Set(["querySelector", "querySelectorAll"]);
const ITERATION_METHODS = new Set(["forEach", "map"]);
const SCOPE_NODE_TYPES = new Set([
  "Program",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * If `node` is a DOM lookup call — `x.querySelector(".sel")`,
 * `document.querySelectorAll(".sel")`, `document.getElementById("id")`, or
 * `gsap.utils.toArray(".sel")` — return the CSS selector it resolves to.
 * `getElementById("id")` maps to `#id`. Returns null for anything else.
 */
function selectorFromQueryCall(node: any, scope: ScopeBindings): string | null {
  if (node?.type !== "CallExpression") return null;
  const callee = node.callee;
  if (callee?.type !== "MemberExpression" || callee.property?.type !== "Identifier") return null;
  const method = callee.property.name;
  const argValue = resolveNode(node.arguments?.[0], scope);
  if (typeof argValue !== "string" || argValue.length === 0) return null;
  if (QUERY_METHODS.has(method) || method === "toArray") return argValue;
  if (method === "getElementById") return `#${argValue}`;
  return null;
}

/** The nearest enclosing function/program node — the binding scope of `path`. */
function enclosingScopeNode(path: any): any {
  let p = path?.parentPath;
  while (p) {
    if (SCOPE_NODE_TYPES.has(p.node?.type)) return p.node;
    p = p.parentPath;
  }
  return null;
}

/** Scope nodes enclosing `path`, innermost first. */
function scopeChainOf(path: any): any[] {
  const chain: any[] = [];
  let p = path;
  while (p) {
    if (SCOPE_NODE_TYPES.has(p.node?.type)) chain.push(p.node);
    p = p.parentPath;
  }
  return chain;
}

/** Per-scope element bindings: scopeNode → (variable name → selector). */
type TargetBindings = Map<any, Map<string, string>>;

function addBinding(
  bindings: TargetBindings,
  scopeNode: any,
  name: string,
  selector: string,
): void {
  let scoped = bindings.get(scopeNode);
  if (!scoped) {
    scoped = new Map();
    bindings.set(scopeNode, scoped);
  }
  if (!scoped.has(name)) scoped.set(name, selector);
}

/**
 * Build a lexically-scoped index of element variables → selector. Two passes:
 * (1) direct DOM-lookup assignments (`const x = root.querySelector(...)`), then
 * (2) iteration callback params (`coll.forEach(el => …)`), whose element type is
 * the collection's selector — resolved against the pass-1 bindings.
 */
function collectTargetBindings(ast: any, scope: ScopeBindings): TargetBindings {
  const bindings: TargetBindings = new Map();

  recast.types.visit(ast, {
    visitVariableDeclarator(path: any) {
      const name = path.node.id?.name;
      const selector = selectorFromQueryCall(path.node.init, scope);
      if (name && selector !== null) addBinding(bindings, enclosingScopeNode(path), name, selector);
      this.traverse(path);
    },
    visitAssignmentExpression(path: any) {
      const left = path.node.left;
      const selector = selectorFromQueryCall(path.node.right, scope);
      if (left?.type === "Identifier" && selector !== null) {
        addBinding(bindings, enclosingScopeNode(path), left.name, selector);
      }
      this.traverse(path);
    },
  });

  // Pass 2: forEach/map callback params take the collection's selector.
  recast.types.visit(ast, {
    visitCallExpression(path: any) {
      const node = path.node;
      const callee = node.callee;
      if (
        callee?.type === "MemberExpression" &&
        callee.property?.type === "Identifier" &&
        ITERATION_METHODS.has(callee.property.name)
      ) {
        const collectionSelector = resolveCollectionSelector(callee.object, path, scope, bindings);
        const fn = node.arguments?.[0];
        const param = fn?.params?.[0];
        if (collectionSelector && param?.type === "Identifier" && isFunctionNode(fn)) {
          addBinding(bindings, fn, param.name, collectionSelector);
        }
      }
      this.traverse(path);
    },
  });

  return bindings;
}

function isFunctionNode(node: any): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression" ||
    node?.type === "FunctionDeclaration"
  );
}

/** Resolve the selector a `.forEach`/`.map` is iterating over (variable or inline call). */
function resolveCollectionSelector(
  node: any,
  callPath: any,
  scope: ScopeBindings,
  bindings: TargetBindings,
): string | null {
  if (node?.type === "Identifier") return lookupBinding(node.name, callPath, bindings);
  if (node?.type === "CallExpression") return selectorFromQueryCall(node, scope);
  return null;
}

/** Resolve a variable name to its selector using the lexical scope chain of `path`. */
function lookupBinding(name: string, path: any, bindings: TargetBindings): string | null {
  for (const scopeNode of scopeChainOf(path)) {
    const selector = bindings.get(scopeNode)?.get(name);
    if (selector !== undefined) return selector;
  }
  return null;
}

/**
 * Resolve a tween's first argument to a CSS selector. Handles inline string
 * literals, element variables (lexically scoped), arrays of elements (joined
 * into a CSS group selector), inline DOM lookup / `toArray` calls, and indexed
 * access (`items[i]`). Returns null when the target can't be resolved
 * statically (e.g. an object-target duration anchor `tl.to({ _: 0 }, …)`, or a
 * runtime-computed selector).
 */
function resolveTargetSelector(
  node: any,
  path: any,
  scope: ScopeBindings,
  bindings: TargetBindings,
): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral" || node.type === "Literal") {
    return typeof node.value === "string" ? node.value : null;
  }
  if (node.type === "Identifier") {
    return lookupBinding(node.name, path, bindings);
  }
  if (node.type === "CallExpression") {
    return selectorFromQueryCall(node, scope);
  }
  if (node.type === "ArrayExpression") {
    const parts = node.elements
      .map((el: any) => resolveTargetSelector(el, path, scope, bindings))
      .filter((s: string | null): s is string => typeof s === "string" && s.length > 0);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (node.type === "MemberExpression" && node.object?.type === "Identifier") {
    // `items[i]` — the element type is the collection's selector.
    return lookupBinding(node.object.name, path, bindings);
  }
  return null;
}

function objectExpressionToRecord(node: any, scope: ScopeBindings): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (node?.type !== "ObjectExpression") return result;
  for (const prop of node.properties ?? []) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    const key = prop.key?.name ?? prop.key?.value;
    if (!key) continue;
    const resolved = resolveNode(prop.value, scope);
    if (resolved !== undefined) {
      result[key] = resolved;
    } else {
      // Preserve unresolvable values as raw source text so they survive round-trips
      result[key] = `__raw:${recast.print(prop.value).code}`;
    }
  }
  return result;
}

// ── Timeline Variable Detection ─────────────────────────────────────────────

function isGsapTimelineCall(node: any): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.name === "gsap" &&
    node.callee.property?.name === "timeline"
  );
}

interface TimelineDetection {
  timelineVar: string | null;
  timelineCount: number;
}

function findTimelineVar(ast: any): TimelineDetection {
  let timelineVar: string | null = null;
  let timelineCount = 0;
  recast.types.visit(ast, {
    visitVariableDeclarator(path: any) {
      if (isGsapTimelineCall(path.node.init)) {
        timelineCount += 1;
        if (!timelineVar) timelineVar = path.node.id?.name ?? null;
      }
      this.traverse(path);
    },
    visitAssignmentExpression(path: any) {
      if (isGsapTimelineCall(path.node.right)) {
        timelineCount += 1;
        if (!timelineVar) {
          const left = path.node.left;
          if (left?.type === "Identifier") timelineVar = left.name;
        }
      }
      this.traverse(path);
    },
  });
  return { timelineVar, timelineCount };
}

// ── Find All Tween Calls ────────────────────────────────────────────────────

interface TweenCallInfo {
  path: any;
  node: any;
  method: GsapMethod;
  selector: string;
  varsArg: any;
  fromArg?: any;
  positionArg?: any;
}

/**
 * True when the member chain of `callNode.callee` is rooted at the timeline
 * variable — `tl.to(...)` and every link of a chain `tl.to(...).to(...)`.
 */
function isTimelineRootedCall(callNode: any, timelineVar: string): boolean {
  let obj = callNode.callee?.object;
  while (obj?.type === "CallExpression") {
    obj = obj.callee?.object;
  }
  return obj?.type === "Identifier" && obj.name === timelineVar;
}

function findAllTweenCalls(
  ast: any,
  timelineVar: string,
  scope: ScopeBindings,
  targetBindings: TargetBindings,
): TweenCallInfo[] {
  const results: TweenCallInfo[] = [];
  recast.types.visit(ast, {
    visitCallExpression(path: any) {
      const node = path.node;
      const callee = node.callee;
      if (
        callee?.type === "MemberExpression" &&
        callee.property?.type === "Identifier" &&
        isTimelineRootedCall(node, timelineVar)
      ) {
        const method = callee.property.name;
        if (!GSAP_METHODS.has(method)) {
          this.traverse(path);
          return;
        }
        const args = node.arguments;
        if (args.length < 2) {
          this.traverse(path);
          return;
        }
        const selectorValue =
          resolveTargetSelector(args[0], path, scope, targetBindings) ?? "__unresolved__";

        if (method === "fromTo") {
          results.push({
            path,
            node,
            method: "fromTo",
            selector: selectorValue,
            fromArg: args[1],
            varsArg: args[2],
            positionArg: args[3],
          });
        } else {
          results.push({
            path,
            node,
            method: method as GsapMethod,
            selector: selectorValue,
            varsArg: args[1],
            positionArg: args[2],
          });
        }
      }
      this.traverse(path);
    },
  });
  return results;
}

/** Keys that are stored on dedicated GsapAnimation fields (not in properties/extras). */
const BUILTIN_VAR_KEYS = new Set(["duration", "ease", "delay"]);

/** Keys that are never preserved (callbacks / advanced patterns). */
const DROPPED_VAR_KEYS = new Set(["onComplete", "onStart", "onUpdate", "onRepeat"]);

/** Keys that belong in `extras` — non-editable GSAP config that must survive round-trips. */
const EXTRAS_KEYS = new Set([
  "stagger",
  "yoyo",
  "repeat",
  "repeatDelay",
  "snap",
  "overwrite",
  "immediateRender",
]);

/**
 * Extract raw source text for a property in an ObjectExpression AST node.
 * Returns the printed source of the value node, suitable for verbatim re-emission.
 */
function extractRawPropertySource(varsArgNode: any, key: string): string | undefined {
  const node = findPropertyNode(varsArgNode, key);
  return node ? recast.print(node).code : undefined;
}

/** Find the raw AST node for a named property inside an ObjectExpression. */
function findPropertyNode(varsArgNode: any, key: string): any | undefined {
  if (varsArgNode?.type !== "ObjectExpression") return undefined;
  for (const prop of varsArgNode.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    if (propKeyName(prop) === key) return prop.value;
  }
  return undefined;
}

// ── Native GSAP Keyframes Parsing ──────────────────────────────────────────

const PERCENTAGE_KEY_RE = /^(\d+(?:\.\d+)?)%$/;

/** Extract a string-valued ease or easeEach from an AST property node. */
function tryResolveStringProp(propValue: any, scope: ScopeBindings): string | undefined {
  const val = resolveNode(propValue, scope);
  return typeof val === "string" ? val : undefined;
}

/**
 * Parse a `keyframes` property value from a tween vars AST node into a
 * normalized `GsapKeyframesData` structure. Handles all three GSAP formats:
 * percentage objects, object arrays, and simple (property-array) objects.
 */
// fallow-ignore-next-line complexity
function parseKeyframesNode(node: any, scope: ScopeBindings): GsapKeyframesData | undefined {
  if (!node) return undefined;

  // ── Object array format: keyframes: [ { x: 0, duration: 0.5 }, ... ] ──
  if (node.type === "ArrayExpression") {
    return parseObjectArrayKeyframes(node, scope);
  }

  if (node.type !== "ObjectExpression") return undefined;

  // Distinguish percentage vs simple-array by inspecting property keys/values.
  const props = node.properties ?? [];
  let hasPercentageKey = false;
  let hasArrayValue = false;

  for (const prop of props) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    const key = prop.key?.value ?? prop.key?.name;
    if (typeof key === "string" && PERCENTAGE_KEY_RE.test(key)) {
      hasPercentageKey = true;
      break;
    }
    if (prop.value?.type === "ArrayExpression") {
      hasArrayValue = true;
    }
  }

  if (hasPercentageKey) return parsePercentageKeyframes(node, scope);
  if (hasArrayValue) return parseSimpleArrayKeyframes(node, scope);

  return undefined;
}

// fallow-ignore-next-line complexity
function parsePercentageKeyframes(node: any, scope: ScopeBindings): GsapKeyframesData {
  const keyframes: GsapPercentageKeyframe[] = [];
  let ease: string | undefined;
  let easeEach: string | undefined;

  for (const prop of node.properties ?? []) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    const key = prop.key?.value ?? prop.key?.name;
    if (typeof key !== "string") continue;

    const pctMatch = PERCENTAGE_KEY_RE.exec(key);
    if (pctMatch) {
      const percentage = Number.parseFloat(pctMatch[1]!);
      const record = objectExpressionToRecord(prop.value, scope);
      const properties: Record<string, number | string> = {};
      let kfEase: string | undefined;
      for (const [k, v] of Object.entries(record)) {
        if (k === "ease" && typeof v === "string") {
          kfEase = v;
        } else if (typeof v === "number" || typeof v === "string") {
          properties[k] = v;
        }
      }
      keyframes.push({ percentage, properties, ...(kfEase ? { ease: kfEase } : {}) });
    } else if (key === "ease") {
      ease = tryResolveStringProp(prop.value, scope) ?? ease;
    } else if (key === "easeEach") {
      easeEach = tryResolveStringProp(prop.value, scope) ?? easeEach;
    }
  }

  keyframes.sort((a, b) => a.percentage - b.percentage);

  return {
    format: "percentage",
    keyframes,
    ...(ease ? { ease } : {}),
    ...(easeEach ? { easeEach } : {}),
  };
}

// fallow-ignore-next-line complexity
function parseObjectArrayKeyframes(node: any, scope: ScopeBindings): GsapKeyframesData {
  const elements = node.elements ?? [];
  const raw: Array<{
    properties: Record<string, number | string>;
    duration?: number;
    ease?: string;
  }> = [];

  for (const el of elements) {
    if (!el || (el.type !== "ObjectExpression" && el.type !== "ObjectProperty")) {
      // Skip non-object elements
      if (el?.type !== "ObjectExpression") continue;
    }
    const record = objectExpressionToRecord(el, scope);
    const properties: Record<string, number | string> = {};
    let duration: number | undefined;
    let ease: string | undefined;
    for (const [k, v] of Object.entries(record)) {
      if (k === "duration" && typeof v === "number") {
        duration = v;
      } else if (k === "ease" && typeof v === "string") {
        ease = v;
      } else if (typeof v === "number" || typeof v === "string") {
        properties[k] = v;
      }
    }
    raw.push({ properties, duration, ease });
  }

  // Convert durations to percentage positions. If durations are present, use
  // cumulative ratios; otherwise distribute evenly.
  const totalDuration = raw.reduce((sum, r) => sum + (r.duration ?? 0), 0);
  const keyframes: GsapPercentageKeyframe[] = [];

  if (totalDuration > 0) {
    let cumulative = 0;
    for (const entry of raw) {
      const percentage = Math.round((cumulative / totalDuration) * 100);
      keyframes.push({
        percentage,
        properties: entry.properties,
        ...(entry.ease ? { ease: entry.ease } : {}),
      });
      cumulative += entry.duration ?? 0;
    }
  } else {
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i]!;
      const percentage = raw.length > 1 ? Math.round((i / (raw.length - 1)) * 100) : 0;
      keyframes.push({
        percentage,
        properties: entry.properties,
        ...(entry.ease ? { ease: entry.ease } : {}),
      });
    }
  }

  return { format: "object-array", keyframes };
}

// fallow-ignore-next-line complexity
function parseSimpleArrayKeyframes(node: any, scope: ScopeBindings): GsapKeyframesData {
  const arrayProps: Map<string, (number | string)[]> = new Map();
  let ease: string | undefined;
  let easeEach: string | undefined;

  for (const prop of node.properties ?? []) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    const key = prop.key?.name ?? prop.key?.value;
    if (typeof key !== "string") continue;

    if (prop.value?.type === "ArrayExpression") {
      const values: (number | string)[] = [];
      for (const el of prop.value.elements ?? []) {
        const val = resolveNode(el, scope);
        if (typeof val === "number" || typeof val === "string") {
          values.push(val);
        }
      }
      if (values.length > 0) arrayProps.set(key, values);
    } else if (key === "ease") {
      ease = tryResolveStringProp(prop.value, scope) ?? ease;
    } else if (key === "easeEach") {
      easeEach = tryResolveStringProp(prop.value, scope) ?? easeEach;
    }
  }

  // Zip arrays into percentage keyframes (evenly spaced).
  const maxLen = Math.max(...[...arrayProps.values()].map((a) => a.length), 0);
  const keyframes: GsapPercentageKeyframe[] = [];

  for (let i = 0; i < maxLen; i++) {
    const percentage = maxLen > 1 ? Math.round((i / (maxLen - 1)) * 100) : 0;
    const properties: Record<string, number | string> = {};
    for (const [key, values] of arrayProps) {
      if (i < values.length) properties[key] = values[i]!;
    }
    keyframes.push({ percentage, properties });
  }

  return {
    format: "simple-array",
    keyframes,
    ...(ease ? { ease } : {}),
    ...(easeEach ? { easeEach } : {}),
  };
}

// ── MotionPath Parsing ────────────────────────────────────────────────────

interface MotionPathParseResult {
  arcPath: ArcPathConfig;
  waypoints: Array<{ x: number; y: number }>;
}

function parseMotionPathNode(node: any, scope: ScopeBindings): MotionPathParseResult | undefined {
  if (!node) return undefined;

  let pathNode: any;
  let autoRotate: boolean | number = false;
  let curviness = 1;
  let isCubic = false;

  if (node.type === "ObjectExpression") {
    for (const prop of node.properties ?? []) {
      if (!isObjectProperty(prop)) continue;
      const key = propKeyName(prop);
      if (key === "path") pathNode = prop.value;
      else if (key === "autoRotate") {
        const val = resolveNode(prop.value, scope);
        autoRotate = typeof val === "number" ? val : val === true;
      } else if (key === "curviness") {
        const val = resolveNode(prop.value, scope);
        if (typeof val === "number") curviness = val;
      } else if (key === "type") {
        const val = resolveNode(prop.value, scope);
        if (val === "cubic") isCubic = true;
      }
    }
  } else if (node.type === "ArrayExpression") {
    pathNode = node;
  }

  if (!pathNode || pathNode.type !== "ArrayExpression") return undefined;

  const elements = pathNode.elements ?? [];
  const coords: Array<{ x: number; y: number }> = [];
  for (const elem of elements) {
    if (!elem || elem.type !== "ObjectExpression") continue;
    const rec = objectExpressionToRecord(elem, scope);
    const x = typeof rec.x === "number" ? rec.x : undefined;
    const y = typeof rec.y === "number" ? rec.y : undefined;
    if (x !== undefined && y !== undefined) coords.push({ x, y });
  }

  if (coords.length < 2) return undefined;

  let waypoints: Array<{ x: number; y: number }>;
  const segments: ArcPathSegment[] = [];

  if (isCubic && coords.length >= 4) {
    // type: "cubic" — coords are [anchor, cp1, cp2, anchor, cp1, cp2, anchor, ...]
    // Every 3rd coord starting from 0 is an anchor, the two between are control points.
    waypoints = [];
    waypoints.push(coords[0]!);
    for (let i = 1; i + 2 < coords.length; i += 3) {
      const cp1 = coords[i]!;
      const cp2 = coords[i + 1]!;
      const anchor = coords[i + 2]!;
      waypoints.push(anchor);
      segments.push({ curviness, cp1, cp2 });
    }
  } else {
    // Waypoint array with global curviness
    waypoints = coords;
    for (let i = 0; i < waypoints.length - 1; i++) {
      segments.push({ curviness });
    }
  }

  return {
    arcPath: { enabled: true, autoRotate, segments },
    waypoints,
  };
}

// fallow-ignore-next-line complexity
function tweenCallToAnimation(
  call: TweenCallInfo,
  scope: ScopeBindings,
): Omit<GsapAnimation, "id"> {
  const vars = objectExpressionToRecord(call.varsArg, scope);
  const properties: Record<string, number | string> = {};
  const extras: Record<string, unknown> = {};
  let keyframesData: GsapKeyframesData | undefined;
  let hasUnresolvedKeyframes = false;
  let motionPathResult: MotionPathParseResult | undefined;

  for (const [key, val] of Object.entries(vars)) {
    if (BUILTIN_VAR_KEYS.has(key)) continue;
    if (DROPPED_VAR_KEYS.has(key)) continue;

    if (key === "keyframes") {
      const kfNode = findPropertyNode(call.varsArg, "keyframes");
      keyframesData = parseKeyframesNode(kfNode, scope);
      if (!keyframesData && kfNode) hasUnresolvedKeyframes = true;
      continue;
    }

    if (key === "motionPath") {
      const mpNode = findPropertyNode(call.varsArg, "motionPath");
      motionPathResult = parseMotionPathNode(mpNode, scope);
      continue;
    }

    if (key === "easeEach") {
      // easeEach is only meaningful alongside keyframes — handled below.
      continue;
    }

    if (EXTRAS_KEYS.has(key)) {
      // For extras, prefer the raw AST source so complex objects like
      // `stagger: { each: 0.15, from: "start" }` survive verbatim.
      const rawSource = extractRawPropertySource(call.varsArg, key);
      if (rawSource !== undefined) {
        extras[key] = `__raw:${rawSource}`;
      } else if (val !== undefined) {
        extras[key] = val;
      }
      continue;
    }

    if (typeof val === "number" || typeof val === "string") {
      properties[key] = val;
    }
  }

  // Apply tween-level easeEach to keyframes data.
  if (keyframesData && typeof vars.easeEach === "string") {
    keyframesData.easeEach = vars.easeEach as string;
  }

  // When motionPath is present, reconstruct x/y as keyframe waypoints.
  if (motionPathResult) {
    const { waypoints } = motionPathResult;
    if (!keyframesData) {
      // No explicit keyframes — create synthetic percentage keyframes from waypoints.
      const kf: GsapPercentageKeyframe[] = waypoints.map((wp, i) => ({
        percentage: waypoints.length > 1 ? Math.round((i / (waypoints.length - 1)) * 100) : 0,
        properties: { x: wp.x, y: wp.y },
      }));
      keyframesData = { format: "percentage", keyframes: kf };
    } else {
      // Merge waypoint positions into existing keyframes at matching percentages.
      // If keyframe count matches waypoint count, assign positionally.
      const kfs = keyframesData.keyframes;
      if (kfs.length === waypoints.length) {
        for (let i = 0; i < kfs.length; i++) {
          kfs[i]!.properties.x = waypoints[i]!.x;
          kfs[i]!.properties.y = waypoints[i]!.y;
        }
      }
    }
    // arcPath is attached below on the animation result.
  }

  let fromProperties: Record<string, number | string> | undefined;
  if (call.method === "fromTo" && call.fromArg) {
    fromProperties = {};
    const fromVars = objectExpressionToRecord(call.fromArg, scope);
    for (const [key, val] of Object.entries(fromVars)) {
      if (typeof val === "number" || typeof val === "string") {
        fromProperties[key] = val;
      }
    }
  }

  const posVal = call.positionArg ? extractLiteralValue(call.positionArg, scope) : 0;
  const position: number | string =
    typeof posVal === "number" ? posVal : typeof posVal === "string" ? posVal : 0;
  const duration = typeof vars.duration === "number" ? vars.duration : undefined;
  const ease = typeof vars.ease === "string" ? vars.ease : undefined;

  const anim: Omit<GsapAnimation, "id"> = {
    targetSelector: call.selector,
    method: call.method,
    position,
    properties,
    fromProperties,
    duration,
    ease,
  };
  if (Object.keys(extras).length > 0) anim.extras = extras;
  if (keyframesData) anim.keyframes = keyframesData;
  if (motionPathResult) anim.arcPath = motionPathResult.arcPath;
  if (hasUnresolvedKeyframes) anim.hasUnresolvedKeyframes = true;
  if (call.selector === "__unresolved__") anim.hasUnresolvedSelector = true;
  return anim;
}

// ── Stable ID Generation ───────────────────────────────────────────────────

function assignStableIds(anims: Omit<GsapAnimation, "id">[]): GsapAnimation[] {
  const counts = new Map<string, number>();
  return anims.map((anim) => {
    const posKey =
      typeof anim.position === "number"
        ? String(Math.round(anim.position * 1000))
        : String(anim.position);
    const base = `${anim.targetSelector}-${anim.method}-${posKey}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    return { ...anim, id };
  });
}

// ── Shared parse (AST + located tween calls) ────────────────────────────────

interface ParsedGsapAst {
  ast: any;
  scope: ScopeBindings;
  timelineVar: string;
  detection: TimelineDetection;
  /** Tween calls in document order, each paired with its stable animation id. */
  located: Array<{ id: string; call: TweenCallInfo; animation: GsapAnimation }>;
}

/**
 * Parse a script to its recast AST plus the located tween calls. The mutation
 * functions reuse this so they can edit the exact call node in place (recast
 * preserves all surrounding source — interleaved `gsap.set`, element variable
 * declarations, the IIFE wrapper, comments and formatting).
 */
function parseGsapAst(script: string): ParsedGsapAst {
  const ast = parseScript(script);
  const scope = collectScopeBindings(ast);
  const targetBindings = collectTargetBindings(ast, scope);
  const detection = findTimelineVar(ast);
  const timelineVar = detection.timelineVar ?? "tl";
  const calls = findAllTweenCalls(ast, timelineVar, scope, targetBindings);
  const animations = assignStableIds(calls.map((call) => tweenCallToAnimation(call, scope)));
  const located = animations.map((animation, i) => ({
    id: animation.id,
    call: calls[i]!,
    animation,
  }));
  return { ast, scope, timelineVar, detection, located };
}

// ── Public API ──────────────────────────────────────────────────────────────

export function parseGsapScript(script: string): ParsedGsap {
  try {
    const { detection, timelineVar, located } = parseGsapAst(script);
    const animations = located.map((l) => l.animation);

    const timelineMatch = script.match(
      new RegExp(
        `^[\\s\\S]*?(?:const|let|var)\\s+${timelineVar}\\s*=\\s*gsap\\.timeline\\s*\\([^)]*\\)\\s*;?`,
      ),
    );
    const preamble =
      timelineMatch?.[0] ?? `const ${timelineVar} = gsap.timeline({ paused: true });`;

    const lastCallIdx = script.lastIndexOf(`${timelineVar}.`);
    let postamble = "";
    if (lastCallIdx !== -1) {
      const afterLast = script.slice(lastCallIdx);
      const endOfCall = afterLast.indexOf(";");
      if (endOfCall !== -1) {
        postamble = script.slice(lastCallIdx + endOfCall + 1).trim();
      }
    }

    const result: ParsedGsap = { animations, timelineVar, preamble, postamble };
    if (detection.timelineCount > 1) result.multipleTimelines = true;
    if (detection.timelineCount > 0 && detection.timelineVar === null)
      result.unsupportedTimelinePattern = true;
    return result;
  } catch {
    return { animations: [], timelineVar: "tl", preamble: "", postamble: "" };
  }
}

// ── In-place AST mutation helpers ───────────────────────────────────────────
//
// Edits operate directly on the located call's AST node and reprint via recast,
// which preserves every untouched statement. This is what lets us edit tweens
// in real compositions (variable targets, interleaved `gsap.set`, IIFE wrapper)
// without regenerating — and discarding — the surrounding code.

/** Render a model value to the JS source it should emit as. Mirrors gsapSerialize. */
function valueToCode(value: number | string): string {
  if (typeof value === "string" && value.startsWith("__raw:")) return value.slice(6);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function safeKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Parse a value/expression snippet into a standalone AST expression node.
 * Uses an assignment (`__hf__ = <code>`) rather than wrapping in parens so an
 * object literal parses as an expression without recast re-emitting the
 * surrounding parentheses.
 */
function parseExpr(code: string): any {
  return parseScript(`__hf__ = ${code};`).program.body[0].expression.right;
}

function propKeyName(prop: any): string | undefined {
  return prop?.key?.name ?? prop?.key?.value;
}

function isObjectProperty(prop: any): boolean {
  return prop?.type === "ObjectProperty" || prop?.type === "Property";
}

/** A key the inspector treats as an editable transform/style property. */
function isEditablePropertyKey(key: string): boolean {
  return !BUILTIN_VAR_KEYS.has(key) && !DROPPED_VAR_KEYS.has(key) && !EXTRAS_KEYS.has(key);
}

function makeObjectProperty(key: string, value: number | string): any {
  const obj = parseExpr(`{ ${safeKey(key)}: ${valueToCode(value)} }`);
  return obj.properties[0];
}

/** Set (or insert) a single key on an ObjectExpression, preserving sibling keys. */
function setVarsKey(varsArg: any, key: string, value: number | string): void {
  if (varsArg?.type !== "ObjectExpression") return;
  const existing = varsArg.properties.find(
    (p: any) => isObjectProperty(p) && propKeyName(p) === key,
  );
  if (existing) {
    existing.value = parseExpr(valueToCode(value));
  } else {
    varsArg.properties.push(makeObjectProperty(key, value));
  }
}

/**
 * Replace the editable-property keys on an ObjectExpression with `newProps`,
 * leaving `duration`, `ease`, `stagger`, callbacks and other non-editable keys
 * untouched.
 */
function reconcileEditableProperties(
  varsArg: any,
  newProps: Record<string, number | string>,
): void {
  if (varsArg?.type !== "ObjectExpression") return;
  // Drop editable props no longer present.
  varsArg.properties = varsArg.properties.filter((p: any) => {
    if (!isObjectProperty(p)) return true;
    const key = propKeyName(p);
    if (typeof key !== "string") return true;
    if (!isEditablePropertyKey(key)) return true;
    return key in newProps;
  });
  // Upsert each new prop, preserving the order keys first appeared.
  for (const [key, value] of Object.entries(newProps)) {
    setVarsKey(varsArg, key, value);
  }
}

function applyUpdatesToCall(call: TweenCallInfo, updates: Partial<GsapAnimation>): void {
  if (updates.properties) reconcileEditableProperties(call.varsArg, updates.properties);
  if (updates.fromProperties && call.method === "fromTo") {
    reconcileEditableProperties(call.fromArg, updates.fromProperties);
  }
  if (updates.duration !== undefined) setVarsKey(call.varsArg, "duration", updates.duration);
  if (updates.ease !== undefined) {
    const kfNode = findKeyframesObjectNode(call.varsArg);
    if (kfNode) {
      setVarsKey(kfNode, "easeEach", updates.ease);
      removeVarsKey(call.varsArg, "ease");
    } else {
      setVarsKey(call.varsArg, "ease", updates.ease);
    }
  }
  if (updates.position !== undefined) {
    const posIdx = call.method === "fromTo" ? 3 : 2;
    call.node.arguments[posIdx] = parseExpr(valueToCode(updates.position));
  }
}

/** Walk up to the enclosing ExpressionStatement path (for prune / insertAfter). */
function findStatementPath(path: any): any {
  let p = path;
  while (p) {
    if (p.node?.type === "ExpressionStatement") return p;
    p = p.parentPath;
  }
  return null;
}

/** Build the source for a single `tl.method(selector, vars, position)` call. */
function buildTweenStatementCode(timelineVar: string, anim: Omit<GsapAnimation, "id">): string {
  const selector = JSON.stringify(anim.targetSelector);
  const props: Record<string, number | string> = { ...anim.properties };
  // `set` is instantaneous — GSAP ignores duration on it, so don't emit one.
  if (anim.method !== "set" && anim.duration !== undefined) props.duration = anim.duration;
  if (anim.ease) props.ease = anim.ease;
  const entries = Object.entries(props).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  if (anim.extras) {
    for (const [k, v] of Object.entries(anim.extras)) {
      entries.push(`${safeKey(k)}: ${valueToCode(v as number | string)}`);
    }
  }
  const objCode = `{ ${entries.join(", ")} }`;
  const posCode = valueToCode(
    typeof anim.position === "number" ? anim.position : (anim.position ?? 0),
  );
  if (anim.method === "fromTo") {
    const fromEntries = Object.entries(anim.fromProperties ?? {}).map(
      ([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`,
    );
    const fromCode = `{ ${fromEntries.join(", ")} }`;
    return `${timelineVar}.fromTo(${selector}, ${fromCode}, ${objCode}, ${posCode});`;
  }
  return `${timelineVar}.${anim.method}(${selector}, ${objCode}, ${posCode});`;
}

export function updateAnimationInScript(
  script: string,
  animationId: string,
  updates: Partial<GsapAnimation>,
): string {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch (e) {
    console.warn("[gsap-parser] updateAnimationInScript parse failed:", e);
    return script;
  }
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  applyUpdatesToCall(target.call, updates);
  return recast.print(parsed.ast).code;
}

export function addAnimationToScript(
  script: string,
  animation: Omit<GsapAnimation, "id">,
): { script: string; id: string } {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch (e) {
    console.warn("[gsap-parser] addAnimationToScript parse failed:", e);
    return { script, id: "" };
  }
  // Nothing to anchor against and no timeline to target — treat as parse failure.
  if (parsed.located.length === 0 && parsed.detection.timelineVar === null) {
    return { script, id: "" };
  }

  const id = `anim-${Date.now()}`;
  const statementCode = buildTweenStatementCode(parsed.timelineVar, animation);
  const newStatement = parseScript(statementCode).program.body[0];

  const lastCall = parsed.located[parsed.located.length - 1]?.call;
  const anchorPath = lastCall
    ? findStatementPath(lastCall.path)
    : findTimelineDeclarationPath(parsed.ast, parsed.timelineVar);

  if (anchorPath) {
    anchorPath.insertAfter(newStatement);
  } else {
    parsed.ast.program.body.push(newStatement);
  }
  return { script: recast.print(parsed.ast).code, id };
}

export function addAnimationWithKeyframesToScript(
  script: string,
  targetSelector: string,
  position: number,
  duration: number,
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
    auto?: boolean;
  }>,
  ease?: string,
): { script: string; id: string } {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch (e) {
    console.warn("[gsap-parser] addAnimationWithKeyframesToScript parse failed:", e);
    return { script, id: "" };
  }
  if (parsed.located.length === 0 && parsed.detection.timelineVar === null) {
    return { script, id: "" };
  }

  const selector = JSON.stringify(targetSelector);
  const kfEntries = keyframes.map((kf) => {
    const propEntries = Object.entries(kf.properties).map(
      ([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`,
    );
    if (kf.ease) propEntries.push(`ease: ${JSON.stringify(kf.ease)}`);
    if (kf.auto) propEntries.push(`_auto: 1`);
    return `${JSON.stringify(`${kf.percentage}%`)}: { ${propEntries.join(", ")} }`;
  });
  const kfCode = `{ ${kfEntries.join(", ")} }`;
  const varEntries = [`keyframes: ${kfCode}`, `duration: ${valueToCode(duration)}`];
  if (ease) varEntries.push(`ease: ${JSON.stringify(ease)}`);
  const posCode = valueToCode(position);
  const stmtCode = `${parsed.timelineVar}.to(${selector}, { ${varEntries.join(", ")} }, ${posCode});`;

  const newStatement = parseScript(stmtCode).program.body[0];
  const lastCall = parsed.located[parsed.located.length - 1]?.call;
  const anchorPath = lastCall
    ? findStatementPath(lastCall.path)
    : findTimelineDeclarationPath(parsed.ast, parsed.timelineVar);

  if (anchorPath) {
    anchorPath.insertAfter(newStatement);
  } else {
    parsed.ast.program.body.push(newStatement);
  }

  const result = recast.print(parsed.ast).code;
  const reParsed = parseGsapAst(result);
  const newId = reParsed.located[reParsed.located.length - 1]?.id ?? "";
  return { script: result, id: newId };
}

/** Find the statement path of `const <timelineVar> = gsap.timeline(...)`. */
function findTimelineDeclarationPath(ast: any, timelineVar: string): any {
  let found: any = null;
  recast.types.visit(ast, {
    visitVariableDeclaration(path: any) {
      if (found) return false;
      for (const decl of path.node.declarations ?? []) {
        if (decl.id?.name === timelineVar && isGsapTimelineCall(decl.init)) {
          found = path;
          return false;
        }
      }
      this.traverse(path);
    },
  });
  return found;
}

/** Find the call that chains off `targetNode` (i.e. whose callee object IS it). */
function findChainParentCall(stmtNode: any, targetNode: any): any {
  let found: any = null;
  recast.types.visit(stmtNode, {
    visitCallExpression(p: any) {
      if (found) return false;
      if (p.node.callee?.type === "MemberExpression" && p.node.callee.object === targetNode) {
        found = p.node;
        return false;
      }
      this.traverse(p);
    },
  });
  return found;
}

export function removeAnimationFromScript(script: string, animationId: string): string {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch (e) {
    console.warn("[gsap-parser] removeAnimationFromScript parse failed:", e);
    return script;
  }
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const node = target.call.node;
  const stmtPath = findStatementPath(target.call.path);
  if (!stmtPath) return script;

  const parentCall = findChainParentCall(stmtPath.node, node);
  if (parentCall) {
    // Inner link of a chain — splice it out by re-pointing the next link.
    parentCall.callee.object = node.callee.object;
  } else if (node.callee?.object?.type === "CallExpression") {
    // Outermost link of a chain with earlier links — drop just this link.
    stmtPath.node.expression = node.callee.object;
  } else {
    // Standalone tween — remove the whole statement.
    stmtPath.prune();
  }
  return recast.print(parsed.ast).code;
}

// ── Keyframe Mutation Functions ────────────────────────────────────────────

/** Remove a named property from an ObjectExpression's properties array. */
function removeVarsKey(varsArg: any, key: string): void {
  if (varsArg?.type !== "ObjectExpression") return;
  varsArg.properties = varsArg.properties.filter(
    (p: any) => !(isObjectProperty(p) && propKeyName(p) === key),
  );
}

/** Extract the numeric percentage from a key like "50%". Returns NaN for non-percentage keys. */
function percentageFromKey(key: string): number {
  const m = PERCENTAGE_KEY_RE.exec(key);
  return m ? Number.parseFloat(m[1]!) : Number.NaN;
}

/** Build a keyframe value AST node from properties and optional ease. */
function buildKeyframeValueNode(properties: Record<string, number | string>, ease?: string): any {
  const entries = Object.entries(properties).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  if (ease) entries.push(`ease: ${JSON.stringify(ease)}`);
  return parseExpr(`{ ${entries.join(", ")} }`);
}

/** Parse + locate a target animation, returning null on failure. */
function locateAnimation(
  script: string,
  animationId: string,
): { parsed: ParsedGsapAst; target: ParsedGsapAst["located"][number] } | null {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch {
    return null;
  }
  const target = parsed.located.find((l) => l.id === animationId);
  return target ? { parsed, target } : null;
}

/** Find the keyframes ObjectExpression node on a tween's varsArg, or null. */
function findKeyframesObjectNode(varsArg: any): any | null {
  const node = findPropertyNode(varsArg, "keyframes");
  return node?.type === "ObjectExpression" ? node : null;
}

/** Filter percentage-keyed properties from a keyframes ObjectExpression. */
function filterPercentageProps(kfNode: any): any[] {
  return kfNode.properties.filter((p: any) => {
    if (!isObjectProperty(p)) return false;
    const key = propKeyName(p);
    return typeof key === "string" && PERCENTAGE_KEY_RE.test(key);
  });
}

/**
 * Collapse a keyframes node to flat tween: apply `record` entries as vars keys,
 * then remove `keyframes` and `easeEach` from varsArg. Skips the `ease` key
 * from the record (per-keyframe ease, not a tween ease).
 */
function collapseKeyframesToFlat(varsArg: any, record: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(record)) {
    if (k === "ease") continue;
    if (typeof v === "number" || typeof v === "string") setVarsKey(varsArg, k, v);
  }
  removeVarsKey(varsArg, "keyframes");
  removeVarsKey(varsArg, "easeEach");
}

/**
 * Insert a keyframe at the given percentage in an existing percentage-keyframes
 * object. If the percentage already exists, its value is replaced.
 */
export function addKeyframeToScript(
  script: string,
  animationId: string,
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
  backfillDefaults?: Record<string, number | string>,
): string {
  let loc = locateAnimation(script, animationId);
  if (!loc) {
    const convertedId = animationId.replace(/-from-|-fromTo-/, "-to-");
    loc = locateAnimation(script, convertedId);
  }
  if (!loc) return script;
  let kfNode = findKeyframesObjectNode(loc.target.call.varsArg);

  if (!kfNode) {
    script = convertToKeyframesInScript(script, animationId);
    loc = locateAnimation(script, animationId);
    if (!loc) {
      const convertedId = animationId.replace(/-from-|-fromTo-/, "-to-");
      loc = locateAnimation(script, convertedId);
    }
    if (!loc) return script;
    kfNode = findKeyframesObjectNode(loc.target.call.varsArg);
    if (!kfNode) return script;
  }

  const pctKey = `${percentage}%`;
  const newValueNode = buildKeyframeValueNode(properties, ease);

  // Replace if this percentage already exists
  const existingIdx = kfNode.properties.findIndex(
    (p: any) => isObjectProperty(p) && propKeyName(p) === pctKey,
  );
  if (existingIdx !== -1) {
    kfNode.properties[existingIdx].value = newValueNode;
  } else {
    // Build the new property node with a quoted percentage key
    const newProp = parseExpr(`{ ${JSON.stringify(pctKey)}: {} }`).properties[0];
    newProp.value = newValueNode;

    // Insert in sorted order by percentage
    let insertIdx = kfNode.properties.length;
    for (let i = 0; i < kfNode.properties.length; i++) {
      const key = isObjectProperty(kfNode.properties[i])
        ? propKeyName(kfNode.properties[i])
        : undefined;
      if (typeof key === "string" && percentageFromKey(key) > percentage) {
        insertIdx = i;
        break;
      }
    }
    kfNode.properties.splice(insertIdx, 0, newProp);
  }

  // Auto-update 100%: if the 100% keyframe still has `_auto: 1` (never
  // explicitly edited by the user), update it to match the new keyframe's
  // values so the element holds its final position instead of snapping back.
  // Once the user drags at 100%, `_auto` is gone and we stop touching it.
  if (percentage < 100 && percentage !== 0) {
    const pctProps = filterPercentageProps(kfNode);
    const hundredProp = pctProps.find((p: any) => percentageFromKey(propKeyName(p) ?? "") === 100);
    if (hundredProp?.value?.type === "ObjectExpression") {
      const hasAuto = hundredProp.value.properties.some(
        (p: any) => isObjectProperty(p) && propKeyName(p) === "_auto",
      );
      if (hasAuto) {
        const updatedProps = { ...properties, _auto: 1 as number | string };
        hundredProp.value = buildKeyframeValueNode(updatedProps, undefined);
      }
    }
  }

  // Backfill: when the new keyframe introduces properties absent from other
  // keyframes, add default values so GSAP can interpolate them.
  if (backfillDefaults) {
    const newPropKeys = Object.keys(properties);
    const pctProps = filterPercentageProps(kfNode);
    for (const prop of pctProps) {
      const key = propKeyName(prop);
      if (key === pctKey) continue;
      const valObj = prop.value;
      if (!valObj || valObj.type !== "ObjectExpression") continue;
      const existingKeys = new Set(
        valObj.properties.filter((p: any) => isObjectProperty(p)).map((p: any) => propKeyName(p)),
      );
      for (const pk of newPropKeys) {
        if (existingKeys.has(pk)) continue;
        const defaultVal = backfillDefaults[pk];
        if (defaultVal == null) continue;
        const fillProp = parseExpr(`{ ${safeKey(pk)}: ${valueToCode(defaultVal)} }`).properties[0];
        valObj.properties.push(fillProp);
      }
    }
  }

  return recast.print(loc.parsed.ast).code;
}

/**
 * Remove a keyframe at the given percentage. If fewer than 2 keyframes remain
 * after removal, collapse the keyframes object to a flat tween using the
 * remaining keyframe's properties.
 */
export function removeKeyframeFromScript(
  script: string,
  animationId: string,
  percentage: number,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;
  const kfNode = findKeyframesObjectNode(loc.target.call.varsArg);
  if (!kfNode) return script;

  const pctKey = `${percentage}%`;
  const removeIdx = kfNode.properties.findIndex(
    (p: any) => isObjectProperty(p) && propKeyName(p) === pctKey,
  );
  if (removeIdx === -1) return script;

  kfNode.properties.splice(removeIdx, 1);

  const remainingKfs = filterPercentageProps(kfNode);
  if (remainingKfs.length < 2) {
    const record =
      remainingKfs.length === 1
        ? objectExpressionToRecord(remainingKfs[0].value, loc.parsed.scope)
        : {};
    collapseKeyframesToFlat(loc.target.call.varsArg, record);
  }

  return recast.print(loc.parsed.ast).code;
}

/**
 * Replace the properties (and optionally ease) at an existing keyframe percentage.
 */
export function updateKeyframeInScript(
  script: string,
  animationId: string,
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;
  const kfNode = findKeyframesObjectNode(loc.target.call.varsArg);
  if (!kfNode) return script;

  const pctKey = `${percentage}%`;
  const existing = kfNode.properties.find(
    (p: any) => isObjectProperty(p) && propKeyName(p) === pctKey,
  );
  if (!existing) return script;

  existing.value = buildKeyframeValueNode(properties, ease);
  return recast.print(loc.parsed.ast).code;
}

/** Resolve from/to property maps for a tween being converted to keyframes. */
const CSS_IDENTITY: Record<string, number> = {
  opacity: 1,
  autoAlpha: 1,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
};

function cssIdentityValue(prop: string): number {
  return CSS_IDENTITY[prop] ?? 0;
}

function resolveConversionProps(
  anim: GsapAnimation,
  resolvedFromValues?: Record<string, number | string>,
): { fromProps: Record<string, number | string>; toProps: Record<string, number | string> } {
  if (anim.method === "to") {
    if (resolvedFromValues) {
      return { fromProps: resolvedFromValues, toProps: { ...anim.properties } };
    }
    const identityFrom: Record<string, number | string> = {};
    for (const [key, val] of Object.entries(anim.properties)) {
      if (val != null) identityFrom[key] = typeof val === "number" ? cssIdentityValue(key) : val;
    }
    return { fromProps: identityFrom, toProps: { ...anim.properties } };
  }
  if (anim.method === "from") {
    if (resolvedFromValues) {
      return { fromProps: { ...anim.properties }, toProps: resolvedFromValues };
    }
    const identityTo: Record<string, number | string> = {};
    for (const [key, val] of Object.entries(anim.properties)) {
      if (val != null) identityTo[key] = typeof val === "number" ? cssIdentityValue(key) : val;
    }
    return { fromProps: { ...anim.properties }, toProps: identityTo };
  }
  // fromTo
  return { fromProps: { ...(anim.fromProperties ?? {}) }, toProps: { ...anim.properties } };
}

/** Strip editable properties and ease/keyframes keys from a varsArg. */
function stripEditableAndEase(varsArg: any): void {
  if (varsArg?.type !== "ObjectExpression") return;
  varsArg.properties = varsArg.properties.filter((p: any) => {
    if (!isObjectProperty(p)) return true;
    const key = propKeyName(p);
    if (typeof key !== "string") return true;
    if (key === "ease" || key === "keyframes") return false;
    return !isEditablePropertyKey(key);
  });
}

/** Build and prepend a keyframes property node onto varsArg. */
function insertKeyframesProp(
  varsArg: any,
  fromProps: Record<string, number | string>,
  toProps: Record<string, number | string>,
  easeEach?: string,
): void {
  const fromEntries = Object.entries(fromProps).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  const toEntries = Object.entries(toProps).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  const easeEntry = easeEach ? `, easeEach: ${JSON.stringify(easeEach)}` : "";
  const kfCode = `{ "0%": { ${fromEntries.join(", ")} }, "100%": { ${toEntries.join(", ")} }${easeEntry} }`;
  const kfProp = parseExpr(`{ keyframes: {} }`).properties[0];
  kfProp.value = parseExpr(kfCode);
  if (varsArg?.type === "ObjectExpression") varsArg.properties.unshift(kfProp);
}

/**
 * Convert a flat tween (to/from/fromTo) to percentage-keyframes format.
 * `resolvedFromValues` supplies the "from" state for `to()` tweens or
 * the "to" state for `from()` tweens (the values the DOM would resolve to).
 */
export function convertToKeyframesInScript(
  script: string,
  animationId: string,
  resolvedFromValues?: Record<string, number | string>,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;

  const anim = loc.target.animation;
  if (anim.keyframes || anim.method === "set") return script;

  const { fromProps, toProps } = resolveConversionProps(anim, resolvedFromValues);
  const varsArg = loc.target.call.varsArg;
  const originalEase = anim.ease;

  stripEditableAndEase(varsArg);
  insertKeyframesProp(varsArg, fromProps, toProps, originalEase || undefined);

  if (originalEase) {
    setVarsKey(varsArg, "ease", "none");
  }

  // For from() or fromTo(), convert to to()
  if (anim.method === "from" || anim.method === "fromTo") {
    loc.target.call.node.callee.property.name = "to";
    if (anim.method === "fromTo") loc.target.call.node.arguments.splice(1, 1);
  }

  return recast.print(loc.parsed.ast).code;
}

/**
 * Remove all keyframes from a tween, collapsing to a flat tween with the
 * last keyframe's properties.
 */
export function removeAllKeyframesFromScript(script: string, animationId: string): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;
  const kfNode = findKeyframesObjectNode(loc.target.call.varsArg);
  if (!kfNode) return script;

  // Collect all percentage keyframe entries, sorted
  const kfEntries = filterPercentageProps(kfNode)
    .map((p: any) => ({ pct: percentageFromKey(propKeyName(p)!), prop: p }))
    .filter((e) => !Number.isNaN(e.pct))
    .sort((a, b) => a.pct - b.pct);
  if (kfEntries.length === 0) return script;

  const lastRecord = objectExpressionToRecord(
    kfEntries[kfEntries.length - 1]!.prop.value,
    loc.parsed.scope,
  );
  collapseKeyframesToFlat(loc.target.call.varsArg, lastRecord);

  return recast.print(loc.parsed.ast).code;
}

/**
 * Replace a dynamic `keyframes: <expr>` with a static percentage-keyframes object.
 * Called when the user first edits a dynamically-generated keyframe in the studio.
 */
export function materializeKeyframesInScript(
  script: string,
  animationId: string,
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }>,
  easeEach?: string,
  resolvedSelector?: string,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;

  const varsArg = loc.target.call.varsArg;

  // Replace dynamic selector with resolved static string
  if (resolvedSelector && loc.target.call.node.arguments[0]) {
    loc.target.call.node.arguments[0] = parseExpr(JSON.stringify(resolvedSelector));
  }

  const entries: string[] = [];
  const sorted = keyframes.slice().sort((a, b) => a.percentage - b.percentage);
  for (const kf of sorted) {
    const propEntries = Object.entries(kf.properties).map(
      ([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`,
    );
    if (kf.ease) propEntries.push(`ease: ${JSON.stringify(kf.ease)}`);
    entries.push(`${JSON.stringify(kf.percentage + "%")}: { ${propEntries.join(", ")} }`);
  }
  if (easeEach) {
    entries.push(`easeEach: ${JSON.stringify(easeEach)}`);
  }

  const kfObjCode = `{ ${entries.join(", ")} }`;
  const kfParent = varsArg.properties.find(
    (p: any) => isObjectProperty(p) && propKeyName(p) === "keyframes",
  );
  if (kfParent) {
    kfParent.value = parseExpr(kfObjCode);
  } else {
    const kfProp = parseExpr(`{ keyframes: ${kfObjCode} }`).properties[0];
    varsArg.properties.unshift(kfProp);
  }

  removeVarsKey(varsArg, "easeEach");

  return recast.print(loc.parsed.ast).code;
}

// ── Arc Path (motionPath) AST Mutations ──────────────────────────────────

function buildMotionPathObjectCode(config: {
  waypoints: Array<{ x: number; y: number }>;
  segments: ArcPathSegment[];
  autoRotate: boolean | number;
}): string {
  const { waypoints, segments, autoRotate } = config;
  const hasExplicitControlPoints = segments.some((s) => s.cp1 && s.cp2);

  let pathEntries: string[];
  if (hasExplicitControlPoints && waypoints.length >= 2) {
    // type: "cubic" — interleave control points: [anchor, cp1, cp2, anchor, ...]
    pathEntries = [`{x: ${waypoints[0]!.x}, y: ${waypoints[0]!.y}}`];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const nextWp = waypoints[i + 1]!;
      if (seg.cp1 && seg.cp2) {
        pathEntries.push(`{x: ${seg.cp1.x}, y: ${seg.cp1.y}}`);
        pathEntries.push(`{x: ${seg.cp2.x}, y: ${seg.cp2.y}}`);
      } else {
        // Auto-generate simple midpoint control points from curviness
        const wp = waypoints[i]!;
        const dx = nextWp.x - wp.x;
        const dy = nextWp.y - wp.y;
        const c = seg.curviness ?? 1;
        pathEntries.push(
          `{x: ${wp.x + dx * 0.33}, y: ${wp.y + dy * 0.33 - c * Math.abs(dx) * 0.25}}`,
        );
        pathEntries.push(
          `{x: ${wp.x + dx * 0.66}, y: ${wp.y + dy * 0.66 - c * Math.abs(dx) * 0.25}}`,
        );
      }
      pathEntries.push(`{x: ${nextWp.x}, y: ${nextWp.y}}`);
    }
    const pathStr = pathEntries.join(", ");
    const parts = [`path: [${pathStr}]`, `type: "cubic"`];
    if (autoRotate === true) parts.push("autoRotate: true");
    else if (typeof autoRotate === "number") parts.push(`autoRotate: ${autoRotate}`);
    return `{ ${parts.join(", ")} }`;
  }

  // Simple waypoint array with curviness
  pathEntries = waypoints.map((wp) => `{x: ${wp.x}, y: ${wp.y}}`);
  const curviness = segments[0]?.curviness ?? 1;
  const parts = [`path: [${pathEntries.join(", ")}]`];
  if (curviness !== 1) parts.push(`curviness: ${curviness}`);
  if (autoRotate === true) parts.push("autoRotate: true");
  else if (typeof autoRotate === "number") parts.push(`autoRotate: ${autoRotate}`);
  return `{ ${parts.join(", ")} }`;
}

export function setArcPathInScript(
  script: string,
  animationId: string,
  config: ArcPathConfig,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;

  const varsArg = loc.target.call.varsArg;
  const anim = loc.target.animation;

  if (!config.enabled) {
    // Disable arc: restore x/y from motionPath's last waypoint, then remove motionPath
    const motionPathProp = varsArg.properties.find(
      (p: any) => isObjectProperty(p) && propKeyName(p) === "motionPath",
    );
    if (motionPathProp) {
      const mpVal = motionPathProp.value;
      let pathArr: any[] | undefined;
      if (mpVal?.type === "ObjectExpression") {
        const pathProp = mpVal.properties.find(
          (p: any) => isObjectProperty(p) && propKeyName(p) === "path",
        );
        if (pathProp?.value?.type === "ArrayExpression") pathArr = pathProp.value.elements;
      }
      if (pathArr && pathArr.length > 0) {
        const last = pathArr[pathArr.length - 1];
        if (last?.type === "ObjectExpression") {
          for (const p of last.properties) {
            const k = propKeyName(p);
            if (k === "x" || k === "y") {
              const v = p.value?.value;
              if (typeof v === "number") setVarsKey(varsArg, k, v);
            }
          }
        }
      }
    }
    removeVarsKey(varsArg, "motionPath");
    return recast.print(loc.parsed.ast).code;
  }

  // Extract x/y waypoints from keyframes or flat tween properties
  const kfs = anim.keyframes?.keyframes ?? [];
  const waypoints: Array<{ x: number; y: number }> = [];
  for (const kf of kfs) {
    const x = typeof kf.properties.x === "number" ? kf.properties.x : undefined;
    const y = typeof kf.properties.y === "number" ? kf.properties.y : undefined;
    if (x !== undefined && y !== undefined) waypoints.push({ x, y });
  }

  // For flat tweens with x/y in properties, synthesize start → end waypoints
  if (waypoints.length < 2) {
    const px = anim.properties.x;
    const py = anim.properties.y;
    if (typeof px === "number" || typeof py === "number") {
      waypoints.length = 0;
      waypoints.push({ x: 0, y: 0 });
      waypoints.push({ x: typeof px === "number" ? px : 0, y: typeof py === "number" ? py : 0 });
    }
  }

  if (waypoints.length < 2) return script;

  // Build segments — use provided segments or create defaults
  const segments: ArcPathSegment[] =
    config.segments.length === waypoints.length - 1
      ? config.segments
      : Array.from({ length: waypoints.length - 1 }, () => ({ curviness: 1 }));

  const motionPathCode = buildMotionPathObjectCode({
    waypoints,
    segments,
    autoRotate: config.autoRotate,
  });

  // Set motionPath on the vars
  const motionPathNode = parseExpr(motionPathCode);
  const existingProp = varsArg.properties.find(
    (p: any) => isObjectProperty(p) && propKeyName(p) === "motionPath",
  );
  if (existingProp) {
    existingProp.value = motionPathNode;
  } else {
    const prop = parseExpr(`{ motionPath: ${motionPathCode} }`).properties[0];
    varsArg.properties.push(prop);
  }

  // Strip x/y from keyframes (they're now in motionPath)
  const kfNode = findKeyframesObjectNode(varsArg);
  if (kfNode) {
    for (const pctProp of filterPercentageProps(kfNode)) {
      if (pctProp.value?.type === "ObjectExpression") {
        pctProp.value.properties = pctProp.value.properties.filter((p: any) => {
          const k = propKeyName(p);
          return k !== "x" && k !== "y";
        });
      }
    }
  }

  // Strip flat x/y from vars (they're now in motionPath)
  removeVarsKey(varsArg, "x");
  removeVarsKey(varsArg, "y");

  return recast.print(loc.parsed.ast).code;
}

export function updateArcSegmentInScript(
  script: string,
  animationId: string,
  segmentIndex: number,
  update: Partial<ArcPathSegment>,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;

  const anim = loc.target.animation;
  if (!anim.arcPath?.enabled) return script;

  const segments = [...anim.arcPath.segments];
  if (segmentIndex < 0 || segmentIndex >= segments.length) return script;

  segments[segmentIndex] = { ...segments[segmentIndex]!, ...update };

  // Rebuild the full motionPath with updated segments
  const kfs = anim.keyframes?.keyframes ?? [];
  const waypoints: Array<{ x: number; y: number }> = [];
  for (const kf of kfs) {
    const x = typeof kf.properties.x === "number" ? kf.properties.x : undefined;
    const y = typeof kf.properties.y === "number" ? kf.properties.y : undefined;
    if (x !== undefined && y !== undefined) waypoints.push({ x, y });
  }

  if (waypoints.length < 2) return script;

  const motionPathCode = buildMotionPathObjectCode({
    waypoints,
    segments,
    autoRotate: anim.arcPath.autoRotate,
  });

  const varsArg = loc.target.call.varsArg;
  const existingProp = varsArg.properties.find(
    (p: any) => isObjectProperty(p) && propKeyName(p) === "motionPath",
  );
  if (existingProp) {
    existingProp.value = parseExpr(motionPathCode);
  }

  return recast.print(loc.parsed.ast).code;
}

export function removeArcPathFromScript(script: string, animationId: string): string {
  return setArcPathInScript(script, animationId, {
    enabled: false,
    autoRotate: false,
    segments: [],
  });
}

/**
 * Replace a dynamic loop that generates multiple tween calls with individual
 * static `tl.to()` calls — one per element. Finds the loop containing the
 * animation and replaces the entire loop body with unrolled static calls.
 */
export function unrollDynamicAnimations(
  script: string,
  animationId: string,
  elements: Array<{
    selector: string;
    keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
    easeEach?: string;
  }>,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;

  const varsArg = loc.target.call.varsArg;

  // Read duration and ease from the original tween vars
  const durationVal = extractLiteralValue(findPropertyNode(varsArg, "duration"), loc.parsed.scope);
  const easeVal = extractLiteralValue(findPropertyNode(varsArg, "ease"), loc.parsed.scope);
  const duration = typeof durationVal === "number" ? durationVal : 8;
  const ease = typeof easeVal === "string" ? easeVal : "none";
  const posArg = loc.target.call.positionArg;
  const position = posArg ? extractLiteralValue(posArg, loc.parsed.scope) : 0;
  const posCode =
    typeof position === "number"
      ? String(position)
      : typeof position === "string"
        ? JSON.stringify(position)
        : "0";

  // Find the enclosing loop (for/forEach) by walking up the AST path
  let loopNode: any = null;
  let current = loc.target.call.path;
  while (current) {
    const node = current.node ?? current.value;
    if (
      node?.type === "ForStatement" ||
      node?.type === "ForInStatement" ||
      node?.type === "ForOfStatement" ||
      node?.type === "WhileStatement"
    ) {
      loopNode = node;
      break;
    }
    if (
      node?.type === "ExpressionStatement" &&
      node.expression?.type === "CallExpression" &&
      node.expression.callee?.property?.name === "forEach"
    ) {
      loopNode = node;
      break;
    }
    current = current.parent ?? current.parentPath;
  }

  // Build replacement code: individual tl.to() calls for each element
  const calls: string[] = [];
  for (const el of elements) {
    const kfEntries: string[] = [];
    const sorted = el.keyframes.slice().sort((a, b) => a.percentage - b.percentage);
    for (const kf of sorted) {
      const propEntries = Object.entries(kf.properties).map(
        ([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`,
      );
      kfEntries.push(`${JSON.stringify(kf.percentage + "%")}: { ${propEntries.join(", ")} }`);
    }
    if (el.easeEach) {
      kfEntries.push(`easeEach: ${JSON.stringify(el.easeEach)}`);
    }
    calls.push(
      `tl.to(${JSON.stringify(el.selector)}, { keyframes: { ${kfEntries.join(", ")} }, duration: ${duration}, ease: ${JSON.stringify(ease)} }, ${posCode});`,
    );
  }

  const replacement = calls.join("\n  ");

  if (loopNode) {
    // Replace the entire loop with the unrolled calls
    const start = loopNode.start ?? loopNode.range?.[0];
    const end = loopNode.end ?? loopNode.range?.[1];
    if (typeof start === "number" && typeof end === "number") {
      return script.slice(0, start) + replacement + script.slice(end);
    }
  }

  // Fallback: replace just the tween call's enclosing expression statement
  const stmtNode = loc.target.call.path?.parent?.node ?? loc.target.call.path?.parentPath?.node;
  if (stmtNode?.type === "ExpressionStatement") {
    const start = stmtNode.start ?? stmtNode.range?.[0];
    const end = stmtNode.end ?? stmtNode.range?.[1];
    if (typeof start === "number" && typeof end === "number") {
      return script.slice(0, start) + replacement + script.slice(end);
    }
  }

  return script;
}
