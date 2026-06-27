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
  serializeValue as valueToCode,
  safeJsKey as safeKey,
  resolveConversionProps,
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
export type { PropertyGroupName } from "./gsapConstants";
export {
  PROPERTY_GROUPS,
  classifyPropertyGroup,
  classifyTweenPropertyGroup,
} from "./gsapConstants";
import { classifyPropertyGroup, classifyTweenPropertyGroup } from "./gsapConstants";
import type { PropertyGroupName } from "./gsapConstants";
export { generateSpringEaseData, SPRING_PRESETS } from "./springEase";
export type { SpringPreset } from "./springEase";

const GSAP_METHODS = new Set<string>(["set", "to", "from", "fromTo"]);

// ── Recast / Babel AST shape types ────────────────────────────────────────
//
// Recast's own typings are loose (`any` everywhere). These local shapes
// capture the properties we actually access, giving us IDE navigation and
// catch-at-write-time safety without depending on @babel/types at runtime.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recast AST nodes are inherently untyped
interface AstNode extends Record<string, any> {
  type: string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recast visitor paths are inherently untyped
interface AstPath extends Record<string, any> {
  node: AstNode;
}

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

function collectScopeBindings(ast: AstNode): ScopeBindings {
  const bindings = new Map<string, number | string | boolean>();
  recast.types.visit(ast, {
    visitVariableDeclarator(path: AstPath) {
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
  node: AstNode | undefined,
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

function extractLiteralValue(node: AstNode | undefined, scope: ScopeBindings): unknown {
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
function selectorFromQueryCall(node: AstNode, scope: ScopeBindings): string | null {
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
function enclosingScopeNode(path: AstPath): AstNode | null {
  let p = path?.parentPath;
  while (p) {
    if (SCOPE_NODE_TYPES.has(p.node?.type)) return p.node;
    p = p.parentPath;
  }
  return null;
}

/** Scope nodes enclosing `path`, innermost first. */
function scopeChainOf(path: AstPath): AstNode[] {
  const chain: AstNode[] = [];
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
  scopeNode: AstNode,
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
function collectTargetBindings(ast: AstNode, scope: ScopeBindings): TargetBindings {
  const bindings: TargetBindings = new Map();

  recast.types.visit(ast, {
    visitVariableDeclarator(path: AstPath) {
      const name = path.node.id?.name;
      const selector = selectorFromQueryCall(path.node.init, scope);
      const scopeNode = enclosingScopeNode(path);
      if (name && selector !== null && scopeNode) addBinding(bindings, scopeNode, name, selector);
      this.traverse(path);
    },
    visitAssignmentExpression(path: AstPath) {
      const left = path.node.left;
      const selector = selectorFromQueryCall(path.node.right, scope);
      const scopeNode = enclosingScopeNode(path);
      if (left?.type === "Identifier" && selector !== null && scopeNode) {
        addBinding(bindings, scopeNode, left.name, selector);
      }
      this.traverse(path);
    },
  });

  // Pass 2: forEach/map callback params take the collection's selector.
  recast.types.visit(ast, {
    visitCallExpression(path: AstPath) {
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

function isFunctionNode(node: AstNode): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression" ||
    node?.type === "FunctionDeclaration"
  );
}

/** Resolve the selector a `.forEach`/`.map` is iterating over (variable or inline call). */
function resolveCollectionSelector(
  node: AstNode,
  callPath: AstPath,
  scope: ScopeBindings,
  bindings: TargetBindings,
): string | null {
  if (node?.type === "Identifier") return lookupBinding(node.name, callPath, bindings);
  if (node?.type === "CallExpression") return selectorFromQueryCall(node, scope);
  return null;
}

/** Resolve a variable name to its selector using the lexical scope chain of `path`. */
function lookupBinding(name: string, path: AstPath, bindings: TargetBindings): string | null {
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
  node: AstNode,
  path: AstPath,
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
      .map((el: AstNode) => resolveTargetSelector(el, path, scope, bindings))
      .filter((s: string | null): s is string => typeof s === "string" && s.length > 0);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (node.type === "MemberExpression" && node.object?.type === "Identifier") {
    // `items[i]` — the element type is the collection's selector.
    return lookupBinding(node.object.name, path, bindings);
  }
  return null;
}

function objectExpressionToRecord(node: AstNode, scope: ScopeBindings): Record<string, unknown> {
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

function isGsapTimelineCall(node: AstNode): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.name === "gsap" &&
    node.callee.property?.name === "timeline"
  );
}

interface TimelineDefaults {
  ease?: string;
  duration?: number;
}

interface TimelineDetection {
  timelineVar: string | null;
  timelineCount: number;
  defaults?: TimelineDefaults;
}

function extractTimelineDefaults(
  callNode: AstNode,
  scope: ScopeBindings,
): TimelineDefaults | undefined {
  const arg = callNode.arguments?.[0];
  if (!arg || arg.type !== "ObjectExpression") return undefined;
  const defaultsProp = arg.properties?.find(
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "defaults",
  );
  if (!defaultsProp?.value || defaultsProp.value.type !== "ObjectExpression") return undefined;
  const record = objectExpressionToRecord(defaultsProp.value, scope);
  const result: TimelineDefaults = {};
  if (typeof record.ease === "string") result.ease = record.ease;
  if (typeof record.duration === "number") result.duration = record.duration;
  return Object.keys(result).length > 0 ? result : undefined;
}

function findTimelineVar(ast: AstNode, scope?: ScopeBindings): TimelineDetection {
  let timelineVar: string | null = null;
  let timelineCount = 0;
  let defaults: TimelineDefaults | undefined;
  const emptyScope: ScopeBindings = scope ?? new Map();
  recast.types.visit(ast, {
    visitVariableDeclarator(path: AstPath) {
      if (isGsapTimelineCall(path.node.init)) {
        timelineCount += 1;
        if (!timelineVar) {
          timelineVar = path.node.id?.name ?? null;
          defaults = extractTimelineDefaults(path.node.init, emptyScope);
        }
      }
      this.traverse(path);
    },
    visitAssignmentExpression(path: AstPath) {
      if (isGsapTimelineCall(path.node.right)) {
        timelineCount += 1;
        if (!timelineVar) {
          const left = path.node.left;
          if (left?.type === "Identifier") timelineVar = left.name;
          defaults = extractTimelineDefaults(path.node.right, emptyScope);
        }
      }
      this.traverse(path);
    },
  });
  return { timelineVar, timelineCount, defaults };
}

// ── Find All Tween Calls ────────────────────────────────────────────────────

interface TweenCallInfo {
  path: AstPath;
  node: AstNode;
  method: GsapMethod;
  selector: string;
  varsArg: AstNode;
  fromArg?: AstNode;
  positionArg?: AstNode;
  /** True for a base `gsap.set(...)` (off-timeline) rather than `tl.set(...)`. */
  global?: boolean;
}

/**
 * True when the member chain of `callNode.callee` is rooted at the timeline
 * variable — `tl.to(...)` and every link of a chain `tl.to(...).to(...)`.
 */
function isTimelineRootedCall(callNode: AstNode, timelineVar: string): boolean {
  let obj = callNode.callee?.object;
  while (obj?.type === "CallExpression") {
    obj = obj.callee?.object;
  }
  return obj?.type === "Identifier" && obj.name === timelineVar;
}

function findAllTweenCalls(
  ast: AstNode,
  timelineVar: string,
  scope: ScopeBindings,
  targetBindings: TargetBindings,
): TweenCallInfo[] {
  const results: TweenCallInfo[] = [];
  recast.types.visit(ast, {
    visitCallExpression(path: AstPath) {
      const node = path.node;
      const callee = node.callee;
      // A base `gsap.set("#sel", props)` is an off-timeline static hold (no position,
      // no keyframe marker). Treat it as an editable `set` animation so a static
      // value (e.g. a 3D transform) round-trips and re-edits in place. Restricted to
      // a STRING-LITERAL selector: variable-target `gsap.set(el, ...)` holds stay
      // opaque surrounding source (editing them by selector would be ambiguous).
      const gsapSetArg = node.arguments?.[0];
      const isGlobalSet =
        callee?.type === "MemberExpression" &&
        callee.object?.type === "Identifier" &&
        callee.object.name === "gsap" &&
        callee.property?.type === "Identifier" &&
        callee.property.name === "set" &&
        (gsapSetArg?.type === "StringLiteral" ||
          (gsapSetArg?.type === "Literal" && typeof gsapSetArg.value === "string"));
      if (
        callee?.type === "MemberExpression" &&
        callee.property?.type === "Identifier" &&
        (isTimelineRootedCall(node, timelineVar) || isGlobalSet)
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
            ...(isGlobalSet ? { global: true } : {}),
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
function extractRawPropertySource(varsArgNode: AstNode, key: string): string | undefined {
  const node = findPropertyNode(varsArgNode, key);
  return node ? recast.print(node).code : undefined;
}

/** Find the raw AST node for a named property inside an ObjectExpression. */
function findPropertyNode(varsArgNode: AstNode, key: string): AstNode | undefined {
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
function tryResolveStringProp(propValue: AstNode, scope: ScopeBindings): string | undefined {
  const val = resolveNode(propValue, scope);
  return typeof val === "string" ? val : undefined;
}

/**
 * Parse a `keyframes` property value from a tween vars AST node into a
 * normalized `GsapKeyframesData` structure. Handles all three GSAP formats:
 * percentage objects, object arrays, and simple (property-array) objects.
 */
// fallow-ignore-next-line complexity
function parseKeyframesNode(
  node: AstNode | undefined,
  scope: ScopeBindings,
): GsapKeyframesData | undefined {
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
function parsePercentageKeyframes(node: AstNode, scope: ScopeBindings): GsapKeyframesData {
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

function computeKeyframesTotalDuration(
  varsNode: AstNode,
  scope: ScopeBindings,
): number | undefined {
  const kfNode = (varsNode.properties ?? []).find(
    (p: AstNode) => (p.key?.name ?? p.key?.value) === "keyframes",
  )?.value;
  if (!kfNode || kfNode.type !== "ArrayExpression") return undefined;
  let total = 0;
  for (const el of kfNode.elements ?? []) {
    if (!el || el.type !== "ObjectExpression") continue;
    const r = objectExpressionToRecord(el, scope);
    if (typeof r.duration === "number") total += r.duration;
  }
  return total > 0 ? total : undefined;
}

// fallow-ignore-next-line complexity
function parseObjectArrayKeyframes(node: AstNode, scope: ScopeBindings): GsapKeyframesData {
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
      cumulative += entry.duration ?? 0;
      const percentage = Math.round((cumulative / totalDuration) * 100);
      keyframes.push({
        percentage,
        properties: entry.properties,
        ...(entry.ease ? { ease: entry.ease } : {}),
      });
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
function parseSimpleArrayKeyframes(node: AstNode, scope: ScopeBindings): GsapKeyframesData {
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

function parseMotionPathNode(
  node: AstNode | undefined,
  scope: ScopeBindings,
): MotionPathParseResult | undefined {
  if (!node) return undefined;

  let pathNode: AstNode | undefined;
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

  const hasPositionArg = !!call.positionArg;
  const posVal = call.positionArg ? extractLiteralValue(call.positionArg, scope) : 0;
  const position: number | string =
    typeof posVal === "number" ? posVal : typeof posVal === "string" ? posVal : 0;
  let duration = typeof vars.duration === "number" ? vars.duration : undefined;
  const ease = typeof vars.ease === "string" ? vars.ease : undefined;

  if (duration === undefined && keyframesData) {
    duration = computeKeyframesTotalDuration(call.varsArg, scope);
  }

  const anim: Omit<GsapAnimation, "id"> = {
    targetSelector: call.selector,
    method: call.method,
    position,
    properties,
    fromProperties,
    duration,
    ease,
  };
  if (!hasPositionArg) anim.implicitPosition = true;
  let group = classifyTweenPropertyGroup(properties);
  if (!group && keyframesData) {
    const kfProps: Record<string, unknown> = {};
    for (const kf of keyframesData.keyframes) {
      for (const k of Object.keys(kf.properties)) kfProps[k] = true;
    }
    group = classifyTweenPropertyGroup(kfProps);
  }
  if (group) anim.propertyGroup = group;
  if (call.global) anim.global = true;
  if (Object.keys(extras).length > 0) anim.extras = extras;
  if (keyframesData) anim.keyframes = keyframesData;
  if (motionPathResult) anim.arcPath = motionPathResult.arcPath;
  if (hasUnresolvedKeyframes) anim.hasUnresolvedKeyframes = true;
  if (call.selector === "__unresolved__") anim.hasUnresolvedSelector = true;
  return anim;
}

// ── Timeline Position Resolution ──────────────────────────────────────────

const GSAP_DEFAULT_DURATION = 0.5;

// NOTE: Label-based positions (e.g. "myLabel+=0.5") are not yet resolved —
// they fall through to parseFloat which returns null for non-numeric strings.
function resolvePositionString(pos: string, cursor: number, prevStart: number): number | null {
  const trimmed = pos.trim();
  if (trimmed === "") return cursor;
  if (trimmed.startsWith("+=")) {
    const n = Number.parseFloat(trimmed.slice(2));
    return Number.isFinite(n) ? cursor + n : null;
  }
  if (trimmed.startsWith("-=")) {
    const n = Number.parseFloat(trimmed.slice(2));
    return Number.isFinite(n) ? cursor - n : null;
  }
  if (trimmed === "<") return prevStart;
  if (trimmed === ">") return cursor;
  if (trimmed.startsWith("<")) {
    const n = Number.parseFloat(trimmed.slice(1));
    return Number.isFinite(n) ? prevStart + n : null;
  }
  if (trimmed.startsWith(">")) {
    const n = Number.parseFloat(trimmed.slice(1));
    return Number.isFinite(n) ? cursor + n : null;
  }
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function applyTimelineDefaults(
  anims: Omit<GsapAnimation, "id">[],
  defaults?: TimelineDefaults,
): void {
  if (!defaults) return;
  for (const anim of anims) {
    if (anim.method === "set") continue;
    if (anim.duration === undefined && defaults.duration !== undefined) {
      anim.duration = defaults.duration;
    }
    if (anim.ease === undefined && defaults.ease !== undefined) {
      anim.ease = defaults.ease;
    }
  }
}

function resolveTimelinePositions(anims: Omit<GsapAnimation, "id">[]): void {
  let cursor = 0;
  let prevStart = 0;
  for (const anim of anims) {
    // A global `gsap.set(...)` is off-timeline — it's applied once at load, not
    // sequenced on the master timeline. It carries no position arg, so the
    // cursor-based fallback below would otherwise hand it the comp-end time
    // (every prior tween's duration summed). Pin it to 0 (its load-time start)
    // and don't let it advance the cursor/prevStart for following tweens.
    if (anim.method === "set" && anim.global) {
      anim.resolvedStart = 0;
      continue;
    }
    const duration = anim.method === "set" ? 0 : (anim.duration ?? GSAP_DEFAULT_DURATION);
    let start: number | null;

    if (anim.implicitPosition) {
      start = cursor;
    } else if (typeof anim.position === "number") {
      start = anim.position;
    } else if (typeof anim.position === "string") {
      start = resolvePositionString(anim.position, cursor, prevStart);
    } else {
      start = cursor;
    }

    if (start != null) {
      anim.resolvedStart = Math.max(0, start);
      prevStart = anim.resolvedStart;
      cursor = Math.max(cursor, anim.resolvedStart + duration);
    }
  }
}

function sortBySourcePosition(calls: TweenCallInfo[]): void {
  calls.sort((a, b) => {
    const aLoc = a.node.callee?.property?.loc?.start;
    const bLoc = b.node.callee?.property?.loc?.start;
    if (!aLoc || !bLoc) return 0;
    return aLoc.line - bLoc.line || aLoc.column - bLoc.column;
  });
}

// ── Stable ID Generation ───────────────────────────────────────────────────

/**
 * IDs are transient — recomputed on every parse, never persisted across sessions.
 * They exist only in ephemeral request/response payloads, React component state,
 * and the in-memory keyframe cache (rebuilt on every page load). No database,
 * localStorage, or file stores animation IDs, so changing the ID format (e.g.
 * adding a `-scale`/`-position` suffix) is safe.
 */
function assignStableIds(anims: Omit<GsapAnimation, "id">[]): GsapAnimation[] {
  const counts = new Map<string, number>();
  return anims.map((anim) => {
    const posKey =
      typeof anim.position === "number"
        ? String(Math.round(anim.position * 1000))
        : String(anim.position);
    const groupSuffix = anim.propertyGroup ? `-${anim.propertyGroup}` : "";
    const base = `${anim.targetSelector}-${anim.method}-${posKey}${groupSuffix}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    return { ...anim, id };
  });
}

// ── Shared parse (AST + located tween calls) ────────────────────────────────

interface ParsedGsapAst {
  ast: AstNode;
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
  const detection = findTimelineVar(ast, scope);
  const timelineVar = detection.timelineVar ?? "tl";
  const calls = findAllTweenCalls(ast, timelineVar, scope, targetBindings);
  sortBySourcePosition(calls);
  const rawAnims = calls.map((call) => tweenCallToAnimation(call, scope));
  applyTimelineDefaults(rawAnims, detection.defaults);
  resolveTimelinePositions(rawAnims);
  const animations = assignStableIds(rawAnims);
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

/**
 * Parse a value/expression snippet into a standalone AST expression node.
 * Uses an assignment (`__hf__ = <code>`) rather than wrapping in parens so an
 * object literal parses as an expression without recast re-emitting the
 * surrounding parentheses.
 */
function parseExpr(code: string): AstNode {
  return parseScript(`__hf__ = ${code};`).program.body[0].expression.right;
}

function propKeyName(prop: AstNode): string | undefined {
  return prop?.key?.name ?? prop?.key?.value;
}

function isObjectProperty(prop: AstNode): boolean {
  return prop?.type === "ObjectProperty" || prop?.type === "Property";
}

/** A key the inspector treats as an editable transform/style property. */
function isEditablePropertyKey(key: string): boolean {
  return !BUILTIN_VAR_KEYS.has(key) && !DROPPED_VAR_KEYS.has(key) && !EXTRAS_KEYS.has(key);
}

function makeObjectProperty(key: string, value: number | string): AstNode {
  const obj = parseExpr(`{ ${safeKey(key)}: ${valueToCode(value)} }`);
  return obj.properties[0];
}

/** Set (or insert) a single key on an ObjectExpression, preserving sibling keys. */
function setVarsKey(varsArg: AstNode, key: string, value: number | string): void {
  if (varsArg?.type !== "ObjectExpression") return;
  const existing = varsArg.properties.find(
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === key,
  );
  if (existing) {
    existing.value = parseExpr(valueToCode(value));
  } else {
    varsArg.properties.push(makeObjectProperty(key, value));
  }
}

/**
 * Filter an ObjectExpression's properties, keeping non-editable keys
 * and delegating the keep/drop decision for editable keys to `shouldKeep`.
 */
function filterEditableKeys(varsArg: AstNode, shouldKeep: (key: string) => boolean): void {
  if (varsArg?.type !== "ObjectExpression") return;
  varsArg.properties = varsArg.properties.filter((p: AstNode) => {
    if (!isObjectProperty(p)) return true;
    const key = propKeyName(p);
    if (typeof key !== "string") return true;
    if (!isEditablePropertyKey(key)) return true;
    return shouldKeep(key);
  });
}

/**
 * Replace the editable-property keys on an ObjectExpression with `newProps`,
 * leaving `duration`, `ease`, `stagger`, callbacks and other non-editable keys
 * untouched.
 */
function reconcileEditableProperties(
  varsArg: AstNode,
  newProps: Record<string, number | string>,
): void {
  filterEditableKeys(varsArg, (key) => key in newProps);
  // Upsert each new prop, preserving the order keys first appeared.
  for (const [key, value] of Object.entries(newProps)) {
    setVarsKey(varsArg, key, value);
  }
}

function applyEaseUpdate(varsArg: AstNode, ease: string): void {
  const kfNode = findKeyframesObjectNode(varsArg);
  if (kfNode) {
    setVarsKey(kfNode, "easeEach", ease);
    removeVarsKey(varsArg, "ease");
  } else {
    setVarsKey(varsArg, "ease", ease);
  }
}

/**
 * "Apply to all segments": drop every per-keyframe `ease` override so the single
 * `easeEach` governs all segments uniformly (AE select-all + F9). Mirrors the
 * acorn writer's resetKeyframeEases branch.
 */
function stripKeyframeEases(varsArg: AstNode): void {
  const kfNode = findKeyframesObjectNode(varsArg);
  const props = kfNode?.properties;
  if (!Array.isArray(props)) return;
  for (const entry of props) {
    if (isObjectProperty(entry)) removeVarsKey(entry.value, "ease");
  }
}

function applyUpdatesToCall(
  call: TweenCallInfo,
  updates: Partial<GsapAnimation> & { easeEach?: string; resetKeyframeEases?: boolean },
): void {
  if (updates.properties) reconcileEditableProperties(call.varsArg, updates.properties);
  if (updates.fromProperties && call.method === "fromTo" && call.fromArg) {
    reconcileEditableProperties(call.fromArg, updates.fromProperties);
  }
  if (updates.duration !== undefined) setVarsKey(call.varsArg, "duration", updates.duration);
  if (updates.easeEach !== undefined) applyEaseUpdate(call.varsArg, updates.easeEach);
  else if (updates.ease !== undefined) applyEaseUpdate(call.varsArg, updates.ease);
  if (updates.resetKeyframeEases) stripKeyframeEases(call.varsArg);
  if (updates.position !== undefined) {
    const posIdx = call.method === "fromTo" ? 3 : 2;
    call.node.arguments[posIdx] = parseExpr(valueToCode(updates.position));
  }
}

/** Walk up to the enclosing ExpressionStatement path (for prune / insertAfter). */
function findStatementPath(path: AstPath): AstPath | null {
  let p = path;
  while (p) {
    if (p.node?.type === "ExpressionStatement") return p;
    p = p.parentPath;
  }
  return null;
}

function insertAfterAnchor(parsed: ParsedGsapAst, newStatement: AstNode): void {
  const lastCall = parsed.located[parsed.located.length - 1]?.call;
  const anchorPath = lastCall
    ? findStatementPath(lastCall.path)
    : findTimelineDeclarationPath(parsed.ast, parsed.timelineVar);
  if (anchorPath) {
    anchorPath.insertAfter(newStatement);
  } else {
    parsed.ast.program.body.push(newStatement);
  }
}

/** Build the source for a single `tl.method(selector, vars, position)` call. */
function buildTweenStatementCode(timelineVar: string, anim: Omit<GsapAnimation, "id">): string {
  const selector = JSON.stringify(anim.targetSelector);
  const props: Record<string, number | string> = { ...anim.properties };
  if (anim.method !== "set" && anim.duration !== undefined) props.duration = anim.duration;
  if (anim.ease) props.ease = anim.ease;
  const entries = Object.entries(props).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  // immediateRender forces GSAP to apply the set when added to the timeline,
  // not on the first seek — without it, tl.set at position 0 on a paused
  // timeline is invisible until the playhead moves past 0. A base `gsap.set`
  // already runs immediately, so it doesn't need (or get) the flag.
  if (anim.method === "set" && !anim.global) entries.push("immediateRender: true");
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
  // A base `gsap.set` is off the timeline: no timeline var, no position arg.
  if (anim.method === "set" && anim.global) {
    return `gsap.set(${selector}, ${objCode});`;
  }
  return `${timelineVar}.${anim.method}(${selector}, ${objCode}, ${posCode});`;
}

export function updateAnimationInScript(
  script: string,
  animationId: string,
  updates: Partial<GsapAnimation> & { easeEach?: string; resetKeyframeEases?: boolean },
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

export function shiftPositionsInScript(
  script: string,
  targetSelector: string,
  delta: number,
): string {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch (e) {
    console.warn("[gsap-parser] shiftPositionsInScript parse failed:", e);
    return script;
  }
  let changed = false;
  for (const entry of parsed.located) {
    if (entry.animation.targetSelector !== targetSelector) continue;
    if (typeof entry.animation.position !== "number") continue;
    const newPos = Math.max(0, Math.round((entry.animation.position + delta) * 1000) / 1000);
    applyUpdatesToCall(entry.call, { position: newPos });
    changed = true;
  }
  return changed ? recast.print(parsed.ast).code : script;
}

export function scalePositionsInScript(
  script: string,
  targetSelector: string,
  oldStart: number,
  oldDuration: number,
  newStart: number,
  newDuration: number,
): string {
  if (oldDuration <= 0 || newDuration <= 0) return script;
  const ratio = newDuration / oldDuration;
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch (e) {
    console.warn("[gsap-parser] scalePositionsInScript parse failed:", e);
    return script;
  }
  let changed = false;
  for (const entry of parsed.located) {
    if (entry.animation.targetSelector !== targetSelector) continue;
    if (typeof entry.animation.position !== "number") continue;
    const newPos = Math.max(
      0,
      Math.round((newStart + (entry.animation.position - oldStart) * ratio) * 1000) / 1000,
    );
    const updates: Partial<GsapAnimation> = { position: newPos };
    if (typeof entry.animation.duration === "number" && entry.animation.duration > 0) {
      updates.duration = Math.max(
        0.001,
        Math.round(entry.animation.duration * ratio * 1000) / 1000,
      );
    }
    applyUpdatesToCall(entry.call, updates);
    changed = true;
  }
  return changed ? recast.print(parsed.ast).code : script;
}

function updateAnimationSelector(script: string, animationId: string, newSelector: string): string {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch {
    return script;
  }
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const selectorArg = target.call.path.node.arguments?.[0];
  if (selectorArg?.type === "StringLiteral") {
    selectorArg.value = newSelector;
  } else if (selectorArg?.type === "Identifier") {
    target.call.path.node.arguments[0] = { type: "StringLiteral", value: newSelector };
  }
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
  insertAfterAnchor(parsed, newStatement);
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
  easeEach?: string,
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
  const kfCode = buildKeyframeObjectCode(keyframes, easeEach ? { easeEach } : undefined);
  const varEntries = [`keyframes: ${kfCode}`, `duration: ${valueToCode(duration)}`];
  if (ease) varEntries.push(`ease: ${JSON.stringify(ease)}`);
  const posCode = valueToCode(position);
  const stmtCode = `${parsed.timelineVar}.to(${selector}, { ${varEntries.join(", ")} }, ${posCode});`;

  const newStatement = parseScript(stmtCode).program.body[0];
  insertAfterAnchor(parsed, newStatement);

  const result = recast.print(parsed.ast).code;
  const reParsed = parseGsapAst(result);
  const newId = reParsed.located[reParsed.located.length - 1]?.id ?? "";
  return { script: result, id: newId };
}

/** Find the statement path of `const <timelineVar> = gsap.timeline(...)`. */
function findTimelineDeclarationPath(ast: AstNode, timelineVar: string): AstPath | null {
  let found: AstPath | null = null;
  recast.types.visit(ast, {
    visitVariableDeclaration(path: AstPath) {
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
function findChainParentCall(stmtNode: AstNode, targetNode: AstNode): AstNode | null {
  let found: AstNode | null = null;
  recast.types.visit(stmtNode, {
    visitCallExpression(p: AstPath) {
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
  let target = parsed.located.find((l) => l.id === animationId);
  if (!target) {
    const convertedId = animationId.replace(/-from-|-fromTo-/, "-to-");
    target = parsed.located.find((l) => l.id === convertedId);
  }
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

function insertInheritedStateSet(
  script: string,
  selector: string,
  position: number,
  properties: Record<string, number | string>,
): string {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch {
    return script;
  }
  const tlVar = parsed.timelineVar;
  const props = Object.entries(properties)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
    .join(", ");
  const code = `${tlVar}.set(${JSON.stringify(selector)}, { ${props} }, ${position});`;
  const newStatement = parseScript(code).program.body[0];
  const anchor = findTimelineDeclarationPath(parsed.ast, tlVar);
  if (anchor) {
    anchor.insertAfter(newStatement);
  } else if (parsed.located.length > 0) {
    const firstTween = parsed.located[0]!.call;
    const stmtPath = findStatementPath(firstTween.path);
    if (stmtPath) stmtPath.insertBefore(newStatement);
    else parsed.ast.program.body.unshift(newStatement);
  } else {
    parsed.ast.program.body.push(newStatement);
  }
  return recast.print(parsed.ast).code;
}

/** Marker on Studio-emitted pre-keyframe hold `set`s. `data` is a GSAP-reserved
 * config key (attached to the tween, never applied to the target), so it carries
 * the tag without triggering GSAP's "Invalid property" warning. */
const STUDIO_HOLD_MARKER = "hf-hold";

/** True for a `tl.set(...)` this module emitted to hold a keyframe before its tween.
 * The Studio filters these out so they never appear as user keyframes/diamonds. */
export function isStudioHoldSet(anim: GsapAnimation): boolean {
  return anim.method === "set" && anim.properties?.data === STUDIO_HOLD_MARKER;
}

/**
 * Keep a `tl.set(selector, {x,y}, 0)` "hold" in front of every position-keyframed
 * tween that starts after t=0, so the element holds its first keyframe's position
 * BEFORE the tween plays instead of snapping to its CSS base (the universal NLE
 * "hold before first keyframe" behavior). The set is tagged with `data: "hf-hold"`
 * so this pass owns it: every call wipes the prior holds and recomputes from the
 * current keyframes, keeping them in sync as keyframes are added/moved/deleted.
 *
 * Idempotent. Only position props (x/y/xPercent/yPercent) are held — opacity/scale
 * keep their authored pre-tween behavior. A tween already starting at 0 needs no
 * hold (no gap before it).
 */
export function syncPositionHoldsBeforeKeyframes(script: string): string {
  let parsed: ParsedGsap;
  try {
    parsed = parseGsapScript(script);
  } catch {
    return script;
  }
  // 1. Drop every hold this pass previously emitted, so we recompute fresh.
  let result = script;
  const staleHoldIds = parsed.animations.filter(isStudioHoldSet).map((a) => a.id);
  for (const id of staleHoldIds) result = removeAnimationFromScript(result, id);

  // 2. Re-add a hold for each position-keyframed tween that starts after t=0.
  let reparsed: ParsedGsap;
  try {
    reparsed = parseGsapScript(result);
  } catch {
    return result;
  }
  for (const anim of reparsed.animations) {
    if (!anim.keyframes) continue;
    const start = anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
    if (!(start > 0.001)) continue;
    const firstKf = [...anim.keyframes.keyframes].sort((a, b) => a.percentage - b.percentage)[0];
    if (!firstKf) continue;
    const posProps: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(firstKf.properties)) {
      if (classifyPropertyGroup(k) === "position" && typeof v === "number") posProps[k] = v;
    }
    if (Object.keys(posProps).length === 0) continue;
    result = insertInheritedStateSet(result, anim.targetSelector, 0, {
      ...posProps,
      data: STUDIO_HOLD_MARKER,
    });
  }
  return result;
}

// ── Split Animation Functions ─────────────────────────────────────────────

export interface SplitAnimationsOptions {
  originalId: string;
  newId: string;
  splitTime: number;
  elementStart: number;
  elementDuration: number;
}

export interface SplitAnimationsResult {
  script: string;
  /** Non-ID-selector animations that the engine cannot safely retarget. */
  skippedSelectors: string[];
}

// fallow-ignore-next-line complexity
export function splitAnimationsInScript(
  script: string,
  opts: SplitAnimationsOptions,
): SplitAnimationsResult {
  const parsed = parseGsapScript(script);
  const originalSelector = `#${opts.originalId}`;
  const newSelector = `#${opts.newId}`;

  const skippedSelectors: string[] = [];
  for (const a of parsed.animations) {
    if (a.targetSelector !== originalSelector && a.targetSelector.includes(opts.originalId)) {
      skippedSelectors.push(a.targetSelector);
    }
  }

  const matching = parsed.animations.filter((a) => a.targetSelector === originalSelector);
  if (matching.length === 0) return { script, skippedSelectors };

  let result = script;
  const newElementStart = opts.splitTime;
  const inheritedProps: Record<string, number | string> = {};

  // Reverse iteration: updateAnimationSelector mutates selectors in the source
  // string, which can shift count-based ID suffixes (e.g. "#hero-1" → "#hero-2")
  // for later animations. Processing last-to-first prevents stale ID collisions.
  for (let i = matching.length - 1; i >= 0; i--) {
    const anim = matching[i]!;
    const pos = typeof anim.position === "number" ? anim.position : 0;
    const dur = anim.duration ?? 0;
    const animEnd = pos + dur;

    if (anim.keyframes) {
      if (pos >= opts.splitTime) {
        result = updateAnimationSelector(result, anim.id, newSelector);
      } else if (animEnd > opts.splitTime) {
        // Spanning keyframes can't be correctly split without renormalizing
        // percentages and durations — leave on original, warn the caller.
        skippedSelectors.push(`${originalSelector} (keyframes spanning split)`);
        const kfs = anim.keyframes.keyframes;
        for (const kf of kfs) {
          const kfTime = pos + (kf.percentage / 100) * dur;
          if (kfTime <= opts.splitTime) {
            for (const [k, v] of Object.entries(kf.properties)) {
              inheritedProps[k] = v;
            }
          }
        }
      } else {
        // Entirely before split — extract final keyframe properties
        const kfs = anim.keyframes.keyframes;
        if (kfs.length > 0) {
          for (const [k, v] of Object.entries(kfs[kfs.length - 1]!.properties)) {
            inheritedProps[k] = v;
          }
        }
      }
      continue;
    }

    // `<=` (not `<`) is deliberate: a tween whose end coincides exactly with
    // the split boundary has fully played by splitTime, so it belongs to the
    // first half and contributes its resting state to the clone. The spanning
    // branch below handles only strictly-mid-flight tweens (pos < split < end).
    if (animEnd <= opts.splitTime) {
      // Only a completed .from() reverts the element to its natural state, so
      // its recorded properties are the HIDDEN start (e.g. opacity:0), not the
      // resting state — clearing them keeps the clone at its natural value
      // instead of pinning it to the from-values (which made it invisible).
      // .fromTo() and .to() both END at their to-values (no revert), so they
      // fall through to `else` and inherit `anim.properties` (the to-values) —
      // .fromTo() must NOT join the .from() clear-branch or the clone would
      // drop the very state the fromTo just established.
      if (anim.method === "from") {
        for (const k of Object.keys(anim.properties)) delete inheritedProps[k];
      } else {
        for (const [k, v] of Object.entries(anim.properties)) {
          inheritedProps[k] = v;
        }
      }
      continue;
    }

    if (pos >= opts.splitTime) {
      result = updateAnimationSelector(result, anim.id, newSelector);
      continue;
    }

    // Spans the split — use linear interpolation to compute mid-values,
    // then .fromTo() on the clone so both halves play the correct range.
    // For .fromTo() tweens we have explicit from-values; for .to() tweens
    // we use accumulated state from prior animations, defaulting to 0 for
    // unknown numeric properties (the standard GSAP transform initial state).
    const progress = dur > 0 ? (opts.splitTime - pos) / dur : 0;
    const fromSource = anim.fromProperties ?? inheritedProps;
    const midProps: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(anim.properties)) {
      if (typeof v !== "number") {
        midProps[k] = v;
        continue;
      }
      const fromVal = typeof fromSource[k] === "number" ? (fromSource[k] as number) : 0;
      midProps[k] = fromVal + (v - fromVal) * progress;
    }

    const firstHalfDuration = opts.splitTime - pos;
    result = updateAnimationInScript(result, anim.id, {
      duration: firstHalfDuration,
      properties: midProps,
    });

    const secondHalfDuration = animEnd - opts.splitTime;
    const addResult = addAnimationToScript(result, {
      targetSelector: newSelector,
      method: "fromTo",
      position: newElementStart,
      duration: secondHalfDuration,
      properties: { ...anim.properties },
      fromProperties: { ...midProps },
      ease: anim.ease,
      extras: anim.extras,
    });
    result = addResult.script;

    for (const [k, v] of Object.entries(midProps)) {
      inheritedProps[k] = v;
    }
  }

  if (Object.keys(inheritedProps).length > 0) {
    result = insertInheritedStateSet(result, newSelector, newElementStart, inheritedProps);
  }

  return { script: result, skippedSelectors };
}

// ── Keyframe Mutation Functions ────────────────────────────────────────────

function sortedKeyframes(
  kfs: Array<{ percentage: number; properties: Record<string, number | string>; ease?: string }>,
) {
  return kfs.slice().sort((a, b) => a.percentage - b.percentage);
}

function keyframePropsToCode(kf: { properties: Record<string, number | string> }): string[] {
  return Object.entries(kf.properties).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
}

function buildKeyframeObjectCode(
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
    auto?: boolean;
  }>,
  options?: { easeEach?: string },
): string {
  const entries = keyframes.map((kf) => {
    const props = keyframePropsToCode(kf);
    if (kf.ease) props.push(`ease: ${JSON.stringify(kf.ease)}`);
    if (kf.auto) props.push(`_auto: 1`);
    return `${JSON.stringify(`${kf.percentage}%`)}: { ${props.join(", ")} }`;
  });
  if (options?.easeEach) entries.push(`easeEach: ${JSON.stringify(options.easeEach)}`);
  return `{ ${entries.join(", ")} }`;
}

/** Remove a named property from an ObjectExpression's properties array. */
function removeVarsKey(varsArg: AstNode, key: string): void {
  if (varsArg?.type !== "ObjectExpression") return;
  varsArg.properties = varsArg.properties.filter(
    (p: AstNode) => !(isObjectProperty(p) && propKeyName(p) === key),
  );
}

/** Extract the numeric percentage from a key like "50%". Returns NaN for non-percentage keys. */
function percentageFromKey(key: string): number {
  const m = PERCENTAGE_KEY_RE.exec(key);
  return m ? Number.parseFloat(m[1]!) : Number.NaN;
}

const PCT_TOLERANCE = 2;

function findKeyframePropByPct(
  kfNode: AstNode,
  percentage: number,
): { idx: number; prop: AstNode } | null {
  const props = kfNode.properties;
  for (let i = 0; i < props.length; i++) {
    if (!isObjectProperty(props[i])) continue;
    const key = propKeyName(props[i]);
    if (typeof key !== "string") continue;
    const parsed = percentageFromKey(key);
    if (Number.isNaN(parsed)) continue;
    if (Math.abs(parsed - percentage) <= PCT_TOLERANCE) return { idx: i, prop: props[i] };
  }
  return null;
}

/** Build a keyframe value AST node from properties and optional ease. */
function buildKeyframeValueNode(
  properties: Record<string, number | string>,
  ease?: string,
): AstNode {
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

// Animation ids encode the tween's timeline position in ms
// (`#puck-a-to-1200-position`). A gesture/convert can re-emit a tween at a
// different position, changing its id — so a client that cached the old id (its
// selectedGsapAnimations hasn't refreshed) edits a now-nonexistent id and the op
// no-ops. Parse `{selector}-{method}-{posMs}-{group}` so we can fall back to the
// same selector+method+group tween nearest the requested position.
const ANIM_ID_RE = /^(.*)-(fromTo|from|to|set)-(\d+)-([a-z]+)$/;

function locateAnimationWithFallback(
  script: string,
  animationId: string,
): ReturnType<typeof locateAnimation> {
  const loc = locateAnimation(script, animationId);
  if (loc) return loc;
  const convertedId = animationId.replace(/-from-|-fromTo-/, "-to-");
  if (convertedId !== animationId) {
    const converted = locateAnimation(script, convertedId);
    if (converted) return converted;
  }
  // Position-drift fallback: match by stable identity (selector+method+group),
  // disambiguating by the position closest to the one the caller asked for.
  const want = ANIM_ID_RE.exec(animationId);
  if (!want) return null;
  const [, sel, method, wantPosStr, group] = want;
  const wantPos = Number(wantPosStr);
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch {
    return null;
  }
  let best: ParsedGsapAst["located"][number] | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const l of parsed.located) {
    const m = ANIM_ID_RE.exec(l.id);
    if (!m || m[1] !== sel || m[2] !== method || m[4] !== group) continue;
    const dist = Math.abs(Number(m[3]) - wantPos);
    if (dist < bestDist) {
      best = l;
      bestDist = dist;
    }
  }
  return best ? { parsed, target: best } : null;
}

/** Find the keyframes ObjectExpression node on a tween's varsArg, or null. */
function findKeyframesObjectNode(varsArg: AstNode): AstNode | null {
  const node = findPropertyNode(varsArg, "keyframes");
  return node?.type === "ObjectExpression" ? node : null;
}

/**
 * Convert array-form keyframes (`keyframes: [{x,y}, …]`) to even-percentage object
 * form (`{ "0%": {…}, "33.3%": {…}, … }`) IN PLACE, returning the new object node
 * (or null if not array-form). GSAP distributes an array evenly, so this is
 * runtime-identical — but it gives the percentage-keyed write ops something to
 * target. Needed before INSERTING a keyframe at an arbitrary percentage, which an
 * even array can't host.
 */
function convertArrayKeyframesToObjectNode(varsArg: AstNode): AstNode | null {
  if (varsArg?.type !== "ObjectExpression") return null;
  const prop = (varsArg.properties ?? []).find(
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "keyframes",
  );
  if (!prop || prop.value?.type !== "ArrayExpression") return null;
  const els: AstNode[] = (prop.value.elements ?? []).filter(
    (e: AstNode | null): e is AstNode => !!e && e.type === "ObjectExpression",
  );
  const n = els.length;
  if (n === 0) return null;
  const entries = els.map((el: AstNode, i: number) => {
    const pct = n > 1 ? Math.round((i / (n - 1)) * 1000) / 10 : 0;
    return `${JSON.stringify(`${pct}%`)}: ${recast.print(el).code}`;
  });
  prop.value = parseExpr(`{ ${entries.join(", ")} }`);
  return prop.value;
}

/** Filter percentage-keyed properties from a keyframes ObjectExpression. */
function filterPercentageProps(kfNode: AstNode): AstNode[] {
  return kfNode.properties.filter((p: AstNode) => {
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
function collapseKeyframesToFlat(varsArg: AstNode, record: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(record)) {
    if (k === "ease") continue;
    if (typeof v === "number" || typeof v === "string") setVarsKey(varsArg, k, v);
  }
  removeVarsKey(varsArg, "keyframes");
  removeVarsKey(varsArg, "easeEach");
}

/**
 * Locate an animation's keyframes ObjectExpression and build the percentage key.
 * Shared preamble for addKeyframeToScript, removeKeyframeFromScript, and
 * updateKeyframeInScript.
 */
function locateKeyframeCtx(script: string, animationId: string, percentage: number) {
  const loc = locateAnimationWithFallback(script, animationId);
  if (!loc) return null;
  const kfNode = findKeyframesObjectNode(loc.target.call.varsArg);
  if (!kfNode) return null;
  return { loc, kfNode, pctKey: `${percentage}%` };
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
  let loc = locateAnimationWithFallback(script, animationId);
  if (!loc) return script;
  let kfNode = findKeyframesObjectNode(loc.target.call.varsArg);

  // Array-form keyframes can't host an arbitrary new percentage — normalize to
  // object form in place first. (convertToKeyframesInScript below only converts
  // FLAT tweens; it early-returns when keyframes already exist.)
  if (!kfNode) kfNode = convertArrayKeyframesToObjectNode(loc.target.call.varsArg);

  if (!kfNode) {
    script = convertToKeyframesInScript(script, animationId);
    loc = locateAnimationWithFallback(script, animationId);
    if (!loc) return script;
    kfNode = findKeyframesObjectNode(loc.target.call.varsArg);
    if (!kfNode) return script;
  }
  const pctKey = `${percentage}%`;

  const newValueNode = buildKeyframeValueNode(properties, ease);

  // Merge into existing keyframe at this percentage, or insert new
  const existing = findKeyframePropByPct(kfNode, percentage);
  if (existing) {
    if (existing.prop.value?.type === "ObjectExpression") {
      const existingRecord = objectExpressionToRecord(existing.prop.value, loc.parsed.scope);
      const merged = { ...existingRecord };
      for (const [k, v] of Object.entries(properties)) merged[k] = v;
      existing.prop.value = buildKeyframeValueNode(
        merged as Record<string, number | string>,
        ease ?? (typeof existingRecord.ease === "string" ? existingRecord.ease : undefined),
      );
    } else {
      existing.prop.value = newValueNode;
    }
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

  // Auto-update adjacent endpoints: only update an `_auto` 0% or 100%
  // keyframe when the new keyframe is directly next to it (no other keyframe
  // between them). This prevents a keyframe at 74% from clobbering 100% when
  // 75% already exists, and a keyframe at 30% from clobbering 0% when 25%
  // already exists.
  if (percentage > 0 && percentage < 100) {
    const pctProps = filterPercentageProps(kfNode);
    const allPcts = pctProps
      .map((p: AstNode) => percentageFromKey(propKeyName(p) ?? ""))
      .filter((n: number) => !Number.isNaN(n) && n !== percentage)
      .sort((a: number, b: number) => a - b);
    const leftNeighbor = allPcts.filter((p: number) => p < percentage).pop();
    const rightNeighbor = allPcts.find((p: number) => p > percentage);
    for (const endPct of [0, 100]) {
      const isNeighbor = endPct === 0 ? leftNeighbor === 0 : rightNeighbor === 100;
      if (!isNeighbor) continue;
      const endProp = pctProps.find(
        (p: AstNode) => percentageFromKey(propKeyName(p) ?? "") === endPct,
      );
      if (!endProp?.value || endProp.value.type !== "ObjectExpression") continue;
      const hasAuto = endProp.value.properties.some(
        (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "_auto",
      );
      if (!hasAuto) continue;
      const updatedProps = { ...properties, _auto: 1 as number | string };
      endProp.value = buildKeyframeValueNode(updatedProps, undefined);
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
        valObj.properties
          .filter((p: AstNode) => isObjectProperty(p))
          .map((p: AstNode) => propKeyName(p)),
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
  // Array-form keyframes (`keyframes: [{x,y}, …]`) have no explicit percentages —
  // GSAP distributes them evenly. The object-form path below can't see them
  // (findKeyframesObjectNode only matches ObjectExpression), so removing from an
  // array-form tween silently no-op'd. Resolve the element by its implicit
  // percentage and splice it; collapse to a flat tween when fewer than two remain.
  const arrLoc = locateAnimationWithFallback(script, animationId);
  // findPropertyNode here returns the property's VALUE node directly.
  const arrVal = arrLoc && findPropertyNode(arrLoc.target.call.varsArg, "keyframes");
  if (arrLoc && arrVal?.type === "ArrayExpression") {
    const elements: AstNode[] = (arrVal.elements ?? []).filter(
      (e: AstNode | null): e is AstNode => !!e && e.type === "ObjectExpression",
    );
    const n = elements.length;
    if (n === 0) return script;
    let matchIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const pct = n > 1 ? (i / (n - 1)) * 100 : 0;
      const dist = Math.abs(pct - percentage);
      if (dist <= PCT_TOLERANCE && dist < bestDist) {
        matchIdx = i;
        bestDist = dist;
      }
    }
    if (matchIdx === -1) return script;
    const remaining = elements.filter((_, i) => i !== matchIdx);
    if (remaining.length < 2) {
      const sole = remaining[0];
      const record = sole ? objectExpressionToRecord(sole, arrLoc.parsed.scope) : {};
      collapseKeyframesToFlat(arrLoc.target.call.varsArg, record);
    } else {
      const realIdx = arrVal.elements.indexOf(elements[matchIdx]);
      arrVal.elements.splice(realIdx, 1);
    }
    return recast.print(arrLoc.parsed.ast).code;
  }

  const ctx = locateKeyframeCtx(script, animationId, percentage);
  if (!ctx) return script;
  const { loc, kfNode } = ctx;

  const match = findKeyframePropByPct(kfNode, percentage);
  if (!match) return script;
  const removeIdx = match.idx;

  kfNode.properties.splice(removeIdx, 1);

  const remainingKfs = filterPercentageProps(kfNode);
  if (remainingKfs.length < 2) {
    const record =
      remainingKfs.length === 1
        ? objectExpressionToRecord(remainingKfs[0]!.value, loc.parsed.scope)
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
  // Array-form keyframes (`keyframes: [{x,y}, …]`) have no explicit percentages —
  // GSAP distributes them evenly. The percentage-keyed object path below can't
  // match them (findKeyframesObjectNode only matches ObjectExpression), so dragging
  // a motion-path node on an array-authored tween silently no-op'd. Resolve the
  // element by its implicit percentage and replace it in place. Mirrors the array
  // branch in removeKeyframeFromScript.
  const arrLoc = locateAnimationWithFallback(script, animationId);
  const arrVal = arrLoc && findPropertyNode(arrLoc.target.call.varsArg, "keyframes");
  if (arrLoc && arrVal?.type === "ArrayExpression") {
    const elements: AstNode[] = (arrVal.elements ?? []).filter(
      (e: AstNode | null): e is AstNode => !!e && e.type === "ObjectExpression",
    );
    const n = elements.length;
    if (n === 0) return script;
    let matchIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const pct = n > 1 ? (i / (n - 1)) * 100 : 0;
      const dist = Math.abs(pct - percentage);
      if (dist <= PCT_TOLERANCE && dist < bestDist) {
        matchIdx = i;
        bestDist = dist;
      }
    }
    if (matchIdx === -1) return script;
    const realIdx = arrVal.elements.indexOf(elements[matchIdx]);
    arrVal.elements[realIdx] = buildKeyframeValueNode(properties, ease);
    return recast.print(arrLoc.parsed.ast).code;
  }

  const ctx = locateKeyframeCtx(script, animationId, percentage);
  if (!ctx) return script;
  const { loc, kfNode } = ctx;

  const match = findKeyframePropByPct(kfNode, percentage);
  if (!match) return script;

  if (Object.keys(properties).length === 0 && ease) {
    // Ease-only update: preserve existing properties, just add/replace ease
    const existing = match.prop.value;
    if (existing?.type === "ObjectExpression") {
      const props = (existing.properties ?? []) as AstNode[];
      const easeIdx = props.findIndex(
        (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "ease",
      );
      const easeNode = parseExpr(`({ ease: ${JSON.stringify(ease)} })`).properties[0];
      if (easeIdx >= 0) {
        props[easeIdx] = easeNode;
      } else {
        props.push(easeNode);
      }
      return recast.print(loc.parsed.ast).code;
    }
    // Non-object keyframe value (primitive shorthand, e.g. "50%": "0.5"): there
    // is no property bag to merge the ease into. Rebuilding from empty
    // `properties` would wipe the primitive — leave the keyframe untouched.
    return script;
  }
  match.prop.value = buildKeyframeValueNode(properties, ease);
  return recast.print(loc.parsed.ast).code;
}

/** Strip editable properties and ease/keyframes keys from a varsArg. */
function stripEditableAndEase(varsArg: AstNode): void {
  // ease is a BUILTIN_VAR_KEY (not editable), so filterEditableKeys won't remove it —
  // drop it explicitly before filtering, along with keyframes.
  if (varsArg?.type !== "ObjectExpression") return;
  varsArg.properties = varsArg.properties.filter((p: AstNode) => {
    if (!isObjectProperty(p)) return true;
    const key = propKeyName(p);
    return key !== "ease" && key !== "keyframes";
  });
  filterEditableKeys(varsArg, () => false);
}

/** Build and prepend a keyframes property node onto varsArg. */
function insertKeyframesProp(
  varsArg: AstNode,
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
  setDuration = 1,
): string {
  let loc = locateAnimationWithFallback(script, animationId);
  if (!loc) return script;

  const anim = loc.target.animation;
  if (anim.keyframes) return script;

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

  // A static `set` becomes an animatable `to`: flip the method, drop the
  // immediateRender hold marker, and give it a real duration so the keyframes
  // span time. This is what makes a static 3D transform keyframeable.
  if (anim.method === "set") {
    // A GLOBAL `gsap.set(...)` is off-timeline; flipping only the method would
    // emit `gsap.to(...)`, which fires once at load and is NOT on the paused
    // master timeline (the engine can't seek/render it). Re-root it onto the
    // timeline var and add the position arg (a gsap.set has none) so the
    // converted tween is seekable. A `tl.set` already has the right object.
    const calleeObj = loc.target.call.node.callee.object;
    if (anim.global && calleeObj?.type === "Identifier") {
      calleeObj.name = loc.parsed.timelineVar;
      if (loc.target.call.node.arguments.length < 3) {
        loc.target.call.node.arguments.push(parseExpr("0"));
      }
    }
    loc.target.call.node.callee.property.name = "to";
    removeVarsKey(varsArg, "immediateRender");
    setVarsKey(varsArg, "duration", Math.max(0.001, setDuration));
  }

  return recast.print(loc.parsed.ast).code;
}

/**
 * Remove all keyframes from a tween, collapsing to a flat tween with the
 * last keyframe's properties.
 */
export function removeAllKeyframesFromScript(script: string, animationId: string): string {
  let loc = locateAnimationWithFallback(script, animationId);
  if (!loc) return script;
  const kfNode = findKeyframesObjectNode(loc.target.call.varsArg);
  if (!kfNode) return script;

  const kfEntries = filterPercentageProps(kfNode)
    .map((p: AstNode) => ({ pct: percentageFromKey(propKeyName(p)!), prop: p }))
    .filter((e) => !Number.isNaN(e.pct))
    .sort((a, b) => a.pct - b.pct);
  if (kfEntries.length === 0) return script;

  // For to()/set(): collapse to last keyframe (the destination = visible state).
  // For from(): collapse to first keyframe (the starting state).
  const method = loc.target.call.method;
  const collapseEntry = method === "from" ? kfEntries[0]! : kfEntries[kfEntries.length - 1]!;
  const record = objectExpressionToRecord(collapseEntry.prop.value, loc.parsed.scope);
  collapseKeyframesToFlat(loc.target.call.varsArg, record);

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
  let loc = locateAnimationWithFallback(script, animationId);
  if (!loc) return script;

  const varsArg = loc.target.call.varsArg;

  // Replace dynamic selector with resolved static string
  if (resolvedSelector && loc.target.call.node.arguments[0]) {
    loc.target.call.node.arguments[0] = parseExpr(JSON.stringify(resolvedSelector));
  }

  const kfObjCode = buildKeyframeObjectCode(sortedKeyframes(keyframes), { easeEach });
  const kfParent = varsArg.properties.find(
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "keyframes",
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

function numericXY(props: Record<string, number | string>): { x: number; y: number } | null {
  const x = props.x;
  const y = props.y;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function extractArcWaypoints(anim: GsapAnimation): Array<{ x: number; y: number }> {
  const kfs = anim.keyframes?.keyframes ?? [];
  const waypoints = kfs.map((kf) => numericXY(kf.properties)).filter((p) => p !== null);
  if (waypoints.length >= 2) return waypoints;
  const px = anim.properties.x;
  const py = anim.properties.y;
  if (typeof px !== "number" && typeof py !== "number") return waypoints;
  return [
    { x: 0, y: 0 },
    { x: typeof px === "number" ? px : 0, y: typeof py === "number" ? py : 0 },
  ];
}

function buildMotionPathObjectCode(config: {
  waypoints: Array<{ x: number; y: number }>;
  segments: ArcPathSegment[];
  autoRotate: boolean | number;
}): string {
  const { waypoints, segments, autoRotate } = config;
  const hasExplicitControlPoints = segments.some((s) => s.cp1 && s.cp2);
  // The simple `path` array supports only one scalar curviness for the whole
  // path, so per-segment curviness must use the cubic form (curviness baked into
  // each segment's control points). Without this, the simple branch serializes
  // only segments[0].curviness and silently drops every other segment's curve.
  const curvinessVaries = segments.some(
    (s) => (s.curviness ?? 1) !== (segments[0]?.curviness ?? 1),
  );

  let pathEntries: string[];
  if ((hasExplicitControlPoints || curvinessVaries) && waypoints.length >= 2) {
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
      (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "motionPath",
    );
    if (motionPathProp) {
      const mpVal = motionPathProp.value;
      let pathArr: AstNode[] | undefined;
      if (mpVal?.type === "ObjectExpression") {
        const pathProp = mpVal.properties.find(
          (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "path",
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

  const waypoints = extractArcWaypoints(anim);
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
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "motionPath",
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
        pctProp.value.properties = pctProp.value.properties.filter((p: AstNode) => {
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

  const waypoints = extractArcWaypoints(anim);
  if (waypoints.length < 2) return script;

  const motionPathCode = buildMotionPathObjectCode({
    waypoints,
    segments,
    autoRotate: anim.arcPath.autoRotate,
  });

  const varsArg = loc.target.call.varsArg;
  const existingProp = varsArg.properties.find(
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "motionPath",
  );
  if (existingProp) {
    existingProp.value = parseExpr(motionPathCode);
  }

  return recast.print(loc.parsed.ast).code;
}

/**
 * Move a single motionPath waypoint (anchor) to a new position. The waypoint
 * list is normalized to anchors for both straight and cubic paths, so
 * `pointIndex` matches the node order the studio overlay renders; cubic control
 * points are preserved. No-op when the animation/arc is missing or the index is
 * out of range.
 */
export function updateMotionPathPointInScript(
  script: string,
  animationId: string,
  pointIndex: number,
  point: { x: number; y: number },
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;

  const anim = loc.target.animation;
  if (!anim.arcPath?.enabled) return script;

  const waypoints = extractArcWaypoints(anim);
  if (pointIndex < 0 || pointIndex >= waypoints.length || waypoints.length < 2) return script;

  const nextWaypoints = waypoints.map((wp, i) =>
    i === pointIndex ? { x: point.x, y: point.y } : wp,
  );

  const motionPathCode = buildMotionPathObjectCode({
    waypoints: nextWaypoints,
    segments: anim.arcPath.segments,
    autoRotate: anim.arcPath.autoRotate,
  });

  const varsArg = loc.target.call.varsArg;
  const existingProp = varsArg.properties.find(
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "motionPath",
  );
  if (existingProp) {
    existingProp.value = parseExpr(motionPathCode);
  }

  return recast.print(loc.parsed.ast).code;
}

/** True when any segment carries explicit cubic control points. Add/remove are
 *  restricted to curviness (non-cubic) paths — synthesizing control points for
 *  an inserted cubic anchor is out of scope. */
function hasCubicSegments(segments: ArcPathSegment[]): boolean {
  return segments.some((s) => s.cp1 != null || s.cp2 != null);
}

function writeMotionPathValue(
  loc: NonNullable<ReturnType<typeof locateAnimation>>,
  waypoints: Array<{ x: number; y: number }>,
  segments: ArcPathSegment[],
  autoRotate: boolean | number,
): string {
  const motionPathCode = buildMotionPathObjectCode({ waypoints, segments, autoRotate });
  const varsArg = loc.target.call.varsArg;
  const existingProp = varsArg.properties.find(
    (p: AstNode) => isObjectProperty(p) && propKeyName(p) === "motionPath",
  );
  if (existingProp) existingProp.value = parseExpr(motionPathCode);
  return recast.print(loc.parsed.ast).code;
}

/**
 * Insert a waypoint at `index` (between existing anchors), splitting the segment
 * it lands on so the new neighbor inherits its curviness. Non-cubic paths only.
 * No-op for missing animation/arc, out-of-range index, or cubic paths.
 */
export function addMotionPathPointInScript(
  script: string,
  animationId: string,
  index: number,
  point: { x: number; y: number },
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;
  const anim = loc.target.animation;
  if (!anim.arcPath?.enabled || hasCubicSegments(anim.arcPath.segments)) return script;

  const waypoints = extractArcWaypoints(anim);
  // Insert strictly between two anchors: index 1..length-1.
  if (index < 1 || index > waypoints.length - 1) return script;

  const segments = [...anim.arcPath.segments];
  waypoints.splice(index, 0, { x: point.x, y: point.y });
  const splitCurviness = segments[index - 1]?.curviness ?? 1;
  segments.splice(index - 1, 0, { curviness: splitCurviness });

  return writeMotionPathValue(loc, waypoints, segments, anim.arcPath.autoRotate);
}

/**
 * Remove the waypoint at `index`. Refuses to drop below two anchors (a path
 * can't have fewer). Non-cubic paths only. No-op for missing animation/arc,
 * out-of-range index, cubic paths, or a 2-point path.
 */
export function removeMotionPathPointInScript(
  script: string,
  animationId: string,
  index: number,
): string {
  const loc = locateAnimation(script, animationId);
  if (!loc) return script;
  const anim = loc.target.animation;
  if (!anim.arcPath?.enabled || hasCubicSegments(anim.arcPath.segments)) return script;

  const waypoints = extractArcWaypoints(anim);
  if (waypoints.length <= 2 || index < 0 || index >= waypoints.length) return script;

  const segments = [...anim.arcPath.segments];
  waypoints.splice(index, 1);
  // Drop the segment on the side that still exists (last anchor → preceding segment).
  segments.splice(Math.min(index, segments.length - 1), 1);

  return writeMotionPathValue(loc, waypoints, segments, anim.arcPath.autoRotate);
}

/**
 * Author a fresh 2-anchor motionPath tween on a target element: a straight line
 * from the element's home (0,0) to `point`, gentle ease, ready for waypoint
 * editing. Mirrors `addAnimationWithKeyframesToScript`.
 */
export function addMotionPathToScript(
  script: string,
  targetSelector: string,
  position: number,
  duration: number,
  point: { x: number; y: number },
  ease = "power1.inOut",
): { script: string; id: string | null } {
  // `id: null` on the failure paths is a deliberate sentinel: callers must
  // null-check before chaining (e.g. locating the new tween). An empty string
  // would silently flow into selector/locate calls and match nothing.
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch (e) {
    console.warn("[gsap-parser] addMotionPathToScript parse failed:", e);
    return { script, id: null };
  }
  if (parsed.located.length === 0 && parsed.detection.timelineVar === null) {
    return { script, id: null };
  }

  const motionPathCode = buildMotionPathObjectCode({
    waypoints: [
      { x: 0, y: 0 },
      { x: point.x, y: point.y },
    ],
    segments: [{ curviness: 1 }],
    autoRotate: false,
  });
  const selector = JSON.stringify(targetSelector);
  const varEntries = [
    `motionPath: ${motionPathCode}`,
    `duration: ${valueToCode(duration)}`,
    `ease: ${JSON.stringify(ease)}`,
  ];
  const stmtCode = `${parsed.timelineVar}.to(${selector}, { ${varEntries.join(", ")} }, ${valueToCode(position)});`;
  const newStatement = parseScript(stmtCode).program.body[0];
  insertAfterAnchor(parsed, newStatement);

  const result = recast.print(parsed.ast).code;
  const reParsed = parseGsapAst(result);
  const newId = reParsed.located[reParsed.located.length - 1]?.id ?? null;
  return { script: result, id: newId };
}

export function removeArcPathFromScript(script: string, animationId: string): string {
  return setArcPathInScript(script, animationId, {
    enabled: false,
    autoRotate: false,
    segments: [],
  });
}

// ── Split Into Property Groups ────────────────────────────────────────────

/**
 * Split a multi-group tween into separate per-group tweens. Each resulting
 * tween contains only properties belonging to one property group (position,
 * scale, rotation, visual, etc.). `transformOrigin` stays with the group that
 * has the most properties. If the tween already belongs to a single group,
 * returns the script unchanged with the original ID.
 */
// fallow-ignore-next-line complexity
export function splitIntoPropertyGroups(
  script: string,
  animationId: string,
): { script: string; ids: string[] } {
  let loc = locateAnimationWithFallback(script, animationId);
  if (!loc) return { script, ids: [animationId] };

  const anim = loc.target.animation;

  // Collect the properties to partition. For keyframed tweens, gather the
  // union of all properties across all keyframes. For flat tweens, use the
  // tween's own properties map.
  const allPropKeys = new Set<string>();
  if (anim.keyframes) {
    for (const kf of anim.keyframes.keyframes) {
      for (const k of Object.keys(kf.properties)) allPropKeys.add(k);
    }
  } else {
    for (const k of Object.keys(anim.properties)) allPropKeys.add(k);
  }

  // Partition properties into groups (excluding transformOrigin — handled below).
  const groupProps = new Map<PropertyGroupName, string[]>();
  for (const key of allPropKeys) {
    if (key === "transformOrigin") continue;
    const group = classifyPropertyGroup(key);
    let arr = groupProps.get(group);
    if (!arr) {
      arr = [];
      groupProps.set(group, arr);
    }
    arr.push(key);
  }

  // Only one group (or zero) — no split needed.
  if (groupProps.size <= 1) return { script, ids: [anim.id] };

  // Assign transformOrigin to the group with the most properties.
  if (allPropKeys.has("transformOrigin")) {
    let largestGroup: PropertyGroupName | undefined;
    let largestCount = 0;
    for (const [group, props] of groupProps) {
      if (props.length > largestCount) {
        largestCount = props.length;
        largestGroup = group;
      }
    }
    if (largestGroup) {
      groupProps.get(largestGroup)!.push("transformOrigin");
    }
  }

  // Build per-group tweens and insert them, then remove the original.
  let result = script;

  // Remove the original tween first.
  result = removeAnimationFromScript(result, anim.id);

  // Insert one tween per group. Iteration order of the Map follows insertion
  // order, which mirrors the order properties were encountered.
  for (const [, props] of groupProps) {
    const propSet = new Set(props);

    if (anim.keyframes) {
      // Build keyframes containing only this group's properties per keyframe.
      const groupKeyframes: Array<{
        percentage: number;
        properties: Record<string, number | string>;
        ease?: string;
        auto?: boolean;
      }> = [];

      for (const kf of anim.keyframes.keyframes) {
        const filtered: Record<string, number | string> = {};
        for (const [k, v] of Object.entries(kf.properties)) {
          if (propSet.has(k)) filtered[k] = v;
        }
        // Skip keyframes where this group has zero properties.
        if (Object.keys(filtered).length === 0) continue;
        groupKeyframes.push({
          percentage: kf.percentage,
          properties: filtered,
          ...(kf.ease ? { ease: kf.ease } : {}),
        });
      }

      if (groupKeyframes.length === 0) continue;

      const addResult = addAnimationWithKeyframesToScript(
        result,
        anim.targetSelector,
        typeof anim.position === "number" ? anim.position : 0,
        anim.duration ?? 0.5,
        groupKeyframes,
        anim.keyframes.easeEach ?? anim.ease,
      );
      result = addResult.script;
    } else {
      // Flat tween — filter properties to this group.
      const groupProperties: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(anim.properties)) {
        if (propSet.has(k)) groupProperties[k] = v;
      }
      if (Object.keys(groupProperties).length === 0) continue;

      let fromProperties: Record<string, number | string> | undefined;
      if (anim.method === "fromTo" && anim.fromProperties) {
        fromProperties = {};
        for (const [k, v] of Object.entries(anim.fromProperties)) {
          if (propSet.has(k)) fromProperties[k] = v;
        }
      }

      const addResult = addAnimationToScript(result, {
        targetSelector: anim.targetSelector,
        method: anim.method,
        position: anim.position,
        duration: anim.duration,
        ease: anim.ease,
        properties: groupProperties,
        fromProperties,
        extras: anim.extras,
      });
      result = addResult.script;
    }
  }

  // Re-parse to collect the new IDs.
  const reParsed = parseGsapAst(result);
  const newIds = reParsed.located
    .filter((l) => l.animation.targetSelector === anim.targetSelector)
    .map((l) => l.id);

  return { script: result, ids: newIds };
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
  let loopNode: AstNode | null = null;
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
    const kfCode = buildKeyframeObjectCode(sortedKeyframes(el.keyframes), {
      easeEach: el.easeEach,
    });
    calls.push(
      `${loc.parsed.timelineVar}.to(${JSON.stringify(el.selector)}, { keyframes: ${kfCode}, duration: ${duration}, ease: ${JSON.stringify(ease)} }, ${posCode});`,
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
