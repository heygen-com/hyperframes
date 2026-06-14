// fallow-ignore-file code-duplication
/**
 * Browser-safe GSAP read path — acorn + acorn-walk.
 *
 * T6b oracle: produces identical ParsedGsap output to gsapParser.ts (recast).
 * Replaces recast as the shared implementation once T6d passes.
 *
 * Write path (T6c) will add magic-string splice once read parity is confirmed.
 * No Node globals, no fs, no require — safe to bundle for browser use.
 */
import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";
import type {
  ArcPathConfig,
  ArcPathSegment,
  GsapAnimation,
  GsapKeyframesData,
  GsapMethod,
  GsapPercentageKeyframe,
  ParsedGsap,
} from "./gsapSerialize.js";
import { classifyTweenPropertyGroup } from "./gsapConstants.js";

const GSAP_METHODS = new Set<string>(["set", "to", "from", "fromTo"]);
const QUERY_METHODS = new Set(["querySelector", "querySelectorAll"]);
const ITERATION_METHODS = new Set(["forEach", "map"]);
const SCOPE_NODE_TYPES = new Set([
  "Program",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

// ── Types ────────────────────────────────────────────────────────────────────

type ScopeBindings = ReadonlyMap<string, number | string | boolean>;
/** Per-scope element bindings: scopeNode → (variable name → selector). */
type TargetBindings = Map<any, Map<string, string>>;

// ── Value resolution ─────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
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

// ── DOM selector resolution ───────────────────────────────────────────────────

// fallow-ignore-next-line complexity
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

// ── Ancestor-based scope helpers (replaces NodePath walking) ──────────────────

/**
 * Return the nearest ancestor node whose type is in SCOPE_NODE_TYPES.
 * `ancestors` is the acorn-walk ancestor array (root→current, current is last).
 */
function enclosingScopeNodeFromAncestors(ancestors: any[]): any {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const node = ancestors[i];
    if (node && SCOPE_NODE_TYPES.has(node.type)) return node;
  }
  return null;
}

/** Scope chain innermost-first, derived from the acorn-walk ancestors array. */
function scopeChainFromAncestors(ancestors: any[]): any[] {
  const chain: any[] = [];
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (node && SCOPE_NODE_TYPES.has(node.type)) chain.push(node);
  }
  return chain;
}

// ── Target bindings ───────────────────────────────────────────────────────────

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

function lookupBindingFromAncestors(
  name: string,
  ancestors: any[],
  bindings: TargetBindings,
): string | null {
  for (const scopeNode of scopeChainFromAncestors(ancestors)) {
    const selector = bindings.get(scopeNode)?.get(name);
    if (selector !== undefined) return selector;
  }
  // Program-scope bindings are stored under null (enclosingScopeNodeFromAncestors
  // returns null when no function wrapper exists — the common case in HF scripts).
  return bindings.get(null)?.get(name) ?? null;
}

function isFunctionNode(node: any): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression" ||
    node?.type === "FunctionDeclaration"
  );
}

function resolveCollectionSelector(
  node: any,
  ancestors: any[],
  scope: ScopeBindings,
  bindings: TargetBindings,
): string | null {
  if (node?.type === "Identifier")
    return lookupBindingFromAncestors(node.name, ancestors, bindings);
  if (node?.type === "CallExpression") return selectorFromQueryCall(node, scope);
  return null;
}

function collectScopeBindings(ast: any): ScopeBindings {
  const bindings = new Map<string, number | string | boolean>();
  acornWalk.simple(ast, {
    VariableDeclarator(node: any) {
      const name = node.id?.name;
      const init = node.init;
      if (name && init) {
        const val = resolveNode(init, bindings);
        if (val !== undefined) bindings.set(name, val);
      }
    },
  });
  return bindings;
}

/**
 * Build a lexically-scoped index of element variables → selector.
 * Pass 1: direct DOM-lookup assignments.
 * Pass 2: forEach/map callback params whose collection's selector is known.
 */
function collectTargetBindings(ast: any, scope: ScopeBindings): TargetBindings {
  const bindings: TargetBindings = new Map();

  acornWalk.ancestor(ast, {
    VariableDeclarator(node: any, _: unknown, ancestors: any[]) {
      const name = node.id?.name;
      const selector = selectorFromQueryCall(node.init, scope);
      if (name && selector !== null) {
        addBinding(bindings, enclosingScopeNodeFromAncestors(ancestors), name, selector);
      }
    },
    AssignmentExpression(node: any, _: unknown, ancestors: any[]) {
      const left = node.left;
      const selector = selectorFromQueryCall(node.right, scope);
      if (left?.type === "Identifier" && selector !== null) {
        addBinding(bindings, enclosingScopeNodeFromAncestors(ancestors), left.name, selector);
      }
    },
  } as any);

  // Pass 2: forEach/map callback params take the collection's selector.
  acornWalk.ancestor(ast, {
    // fallow-ignore-next-line complexity
    CallExpression(node: any, _: unknown, ancestors: any[]) {
      const callee = node.callee;
      if (
        callee?.type === "MemberExpression" &&
        callee.property?.type === "Identifier" &&
        ITERATION_METHODS.has(callee.property.name)
      ) {
        const collectionSelector = resolveCollectionSelector(
          callee.object,
          ancestors,
          scope,
          bindings,
        );
        const fn = node.arguments?.[0];
        const param = fn?.params?.[0];
        if (collectionSelector && param?.type === "Identifier" && isFunctionNode(fn)) {
          addBinding(bindings, fn, param.name, collectionSelector);
        }
      }
    },
  } as any);

  return bindings;
}

// fallow-ignore-next-line complexity
function resolveTargetSelector(
  node: any,
  ancestors: any[],
  scope: ScopeBindings,
  bindings: TargetBindings,
): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral" || node.type === "Literal") {
    return typeof node.value === "string" ? node.value : null;
  }
  if (node.type === "Identifier") {
    return lookupBindingFromAncestors(node.name, ancestors, bindings);
  }
  if (node.type === "CallExpression") {
    return selectorFromQueryCall(node, scope);
  }
  if (node.type === "ArrayExpression") {
    const parts = node.elements
      .map((el: any) => resolveTargetSelector(el, ancestors, scope, bindings))
      .filter((s: string | null): s is string => typeof s === "string" && s.length > 0);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (node.type === "MemberExpression" && node.object?.type === "Identifier") {
    return lookupBindingFromAncestors(node.object.name, ancestors, bindings);
  }
  return null;
}

// ── ObjectExpression utilities ────────────────────────────────────────────────

function isObjectProperty(prop: any): boolean {
  return prop?.type === "ObjectProperty" || prop?.type === "Property";
}

function propKeyName(prop: any): string | undefined {
  return prop?.key?.name ?? prop?.key?.value;
}

function findPropertyNode(varsArgNode: any, key: string): any | undefined {
  if (varsArgNode?.type !== "ObjectExpression") return undefined;
  for (const prop of varsArgNode.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    if (propKeyName(prop) === key) return prop.value;
  }
  return undefined;
}

/**
 * Extract raw source text for a property value — the offset-splice primitive.
 * Equivalent to `recast.print(node).code` for unmodified nodes.
 */
function extractRawPropertySource(
  varsArgNode: any,
  key: string,
  source: string,
): string | undefined {
  const node = findPropertyNode(varsArgNode, key);
  return node ? source.slice(node.start, node.end) : undefined;
}

// fallow-ignore-next-line complexity
function objectExpressionToRecord(
  node: any,
  scope: ScopeBindings,
  source: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (node?.type !== "ObjectExpression") return result;
  for (const prop of node.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    const key = prop.key?.name ?? prop.key?.value;
    if (!key) continue;
    const resolved = resolveNode(prop.value, scope);
    if (resolved !== undefined) {
      result[key] = resolved;
    } else {
      result[key] = `__raw:${source.slice(prop.value.start, prop.value.end)}`;
    }
  }
  return result;
}

// ── Timeline detection ────────────────────────────────────────────────────────

function isGsapTimelineCall(node: any): boolean {
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

// fallow-ignore-next-line complexity
function extractTimelineDefaults(
  callNode: any,
  scope: ScopeBindings,
): TimelineDefaults | undefined {
  const arg = callNode.arguments?.[0];
  if (!arg || arg.type !== "ObjectExpression") return undefined;
  const defaultsProp = arg.properties?.find(
    (p: any) => isObjectProperty(p) && propKeyName(p) === "defaults",
  );
  if (!defaultsProp?.value || defaultsProp.value.type !== "ObjectExpression") return undefined;
  const result: TimelineDefaults = {};
  for (const prop of defaultsProp.value.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    const val = resolveNode(prop.value, scope);
    if (key === "ease" && typeof val === "string") result.ease = val;
    if (key === "duration" && typeof val === "number") result.duration = val;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function findTimelineVar(ast: any, scope?: ScopeBindings): TimelineDetection {
  let timelineVar: string | null = null;
  let timelineCount = 0;
  let defaults: TimelineDefaults | undefined;
  const emptyScope: ScopeBindings = scope ?? new Map();

  acornWalk.simple(ast, {
    VariableDeclarator(node: any) {
      if (isGsapTimelineCall(node.init)) {
        timelineCount += 1;
        if (!timelineVar) {
          timelineVar = node.id?.name ?? null;
          defaults = extractTimelineDefaults(node.init, emptyScope);
        }
      }
    },
    AssignmentExpression(node: any) {
      if (isGsapTimelineCall(node.right)) {
        timelineCount += 1;
        if (!timelineVar) {
          const left = node.left;
          if (left?.type === "Identifier") timelineVar = left.name;
          defaults = extractTimelineDefaults(node.right, emptyScope);
        }
      }
    },
  });

  return { timelineVar, timelineCount, defaults };
}

// ── Tween call collection ─────────────────────────────────────────────────────

/** Keys stored on dedicated GsapAnimation fields (not in properties/extras). */
const BUILTIN_VAR_KEYS = new Set(["duration", "ease", "delay"]);
/** Keys never preserved (callbacks / advanced patterns). */
const DROPPED_VAR_KEYS = new Set(["onComplete", "onStart", "onUpdate", "onRepeat"]);
/** Keys that go in `extras` — non-editable GSAP config that must survive round-trips. */
const EXTRAS_KEYS = new Set([
  "stagger",
  "yoyo",
  "repeat",
  "repeatDelay",
  "snap",
  "overwrite",
  "immediateRender",
]);

export interface TweenCallInfo {
  node: any;
  /** acorn-walk ancestor array at the call site (root→call, call is last). */
  ancestors: any[];
  method: GsapMethod;
  selector: string;
  varsArg: any;
  fromArg?: any;
  positionArg?: any;
}

/** True when callee chain is rooted at the timeline variable. */
function isTimelineRootedCall(callNode: any, timelineVar: string): boolean {
  let obj = callNode.callee?.object;
  while (obj?.type === "CallExpression") {
    obj = obj.callee?.object;
  }
  return obj?.type === "Identifier" && obj.name === timelineVar;
}

/**
 * Pre-order recursive walk for tween collection.
 *
 * acorn-walk is POST-order (visitor fires after children), which reverses
 * chained calls vs recast.types.visit (PRE-order). We need pre-order to
 * match the golden ordering where the outermost chained call appears first.
 */
function findAllTweenCalls(
  ast: any,
  timelineVar: string,
  scope: ScopeBindings,
  targetBindings: TargetBindings,
): TweenCallInfo[] {
  const results: TweenCallInfo[] = [];

  // fallow-ignore-next-line complexity
  function visit(node: any, ancestors: readonly any[]): void {
    if (!node || typeof node !== "object") return;
    const nodeAncestors = [...ancestors, node];

    // Fire BEFORE children (pre-order) so chained outer calls come first.
    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (
        callee?.type === "MemberExpression" &&
        callee.property?.type === "Identifier" &&
        isTimelineRootedCall(node, timelineVar) &&
        GSAP_METHODS.has(callee.property.name)
      ) {
        const method = callee.property.name;
        const args = node.arguments;
        const selectorValue =
          args.length >= 1
            ? (resolveTargetSelector(args[0], nodeAncestors, scope, targetBindings) ??
              "__unresolved__")
            : "__unresolved__";

        if (method === "fromTo" && args.length >= 3) {
          results.push({
            node,
            ancestors: nodeAncestors,
            method: "fromTo",
            selector: selectorValue,
            fromArg: args[1],
            varsArg: args[2],
            positionArg: args[3],
          });
        } else if (method !== "fromTo" && args.length >= 2) {
          results.push({
            node,
            ancestors: nodeAncestors,
            method: method as GsapMethod,
            selector: selectorValue,
            varsArg: args[1],
            positionArg: args[2],
          });
        }
      }
    }

    // Traverse children. Object.keys preserves insertion order, so callee
    // comes before arguments in acorn's CallExpression nodes.
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) visit(item, nodeAncestors);
        }
      } else if (child && typeof child === "object" && (child as any).type) {
        visit(child, nodeAncestors);
      }
    }
  }

  visit(ast, []);
  return results;
}

// ── Keyframes parsing ─────────────────────────────────────────────────────────

const PERCENTAGE_KEY_RE = /^(\d+(?:\.\d+)?)%$/;

function tryResolveStringProp(propValue: any, scope: ScopeBindings): string | undefined {
  const val = resolveNode(propValue, scope);
  return typeof val === "string" ? val : undefined;
}

// fallow-ignore-next-line complexity
function parsePercentageKeyframes(
  node: any,
  scope: ScopeBindings,
  source: string,
): GsapKeyframesData {
  const keyframes: GsapPercentageKeyframe[] = [];
  let ease: string | undefined;
  let easeEach: string | undefined;

  for (const prop of node.properties ?? []) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    const key = prop.key?.value ?? prop.key?.name;
    if (typeof key !== "string") continue;

    const pctMatch = PERCENTAGE_KEY_RE.exec(key);
    if (pctMatch) {
      const percentage = Number.parseFloat(pctMatch[1] ?? "0");
      const record = objectExpressionToRecord(prop.value, scope, source);
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
function computeKeyframesTotalDuration(
  varsNode: any,
  scope: ScopeBindings,
  source: string,
): number | undefined {
  const kfNode = (varsNode.properties ?? []).find(
    (p: any) => (p.key?.name ?? p.key?.value) === "keyframes",
  )?.value;
  if (!kfNode || kfNode.type !== "ArrayExpression") return undefined;
  let total = 0;
  for (const el of kfNode.elements ?? []) {
    if (!el || el.type !== "ObjectExpression") continue;
    const r = objectExpressionToRecord(el, scope, source);
    if (typeof r.duration === "number") total += r.duration;
  }
  return total > 0 ? total : undefined;
}

// fallow-ignore-next-line complexity
function parseObjectArrayKeyframes(
  node: any,
  scope: ScopeBindings,
  source: string,
): GsapKeyframesData {
  const elements = node.elements ?? [];
  const raw: Array<{
    properties: Record<string, number | string>;
    duration?: number;
    ease?: string;
  }> = [];

  for (const el of elements) {
    if (!el || el.type !== "ObjectExpression") continue;
    const record = objectExpressionToRecord(el, scope, source);
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
      const entry = raw[i];
      if (!entry) continue;
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

  const maxLen = Math.max(...[...arrayProps.values()].map((a) => a.length), 0);
  const keyframes: GsapPercentageKeyframe[] = [];

  for (let i = 0; i < maxLen; i++) {
    const percentage = maxLen > 1 ? Math.round((i / (maxLen - 1)) * 100) : 0;
    const properties: Record<string, number | string> = {};
    for (const [key, values] of arrayProps) {
      if (i < values.length) properties[key] = values[i] as number | string;
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

// fallow-ignore-next-line complexity
function parseKeyframesNode(
  node: any,
  scope: ScopeBindings,
  source: string,
): GsapKeyframesData | undefined {
  if (!node) return undefined;

  if (node.type === "ArrayExpression") {
    return parseObjectArrayKeyframes(node, scope, source);
  }

  if (node.type !== "ObjectExpression") return undefined;

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

  if (hasPercentageKey) return parsePercentageKeyframes(node, scope, source);
  if (hasArrayValue) return parseSimpleArrayKeyframes(node, scope);

  return undefined;
}

// ── MotionPath parsing ────────────────────────────────────────────────────────

interface MotionPathParseResult {
  arcPath: ArcPathConfig;
  waypoints: Array<{ x: number; y: number }>;
}

// fallow-ignore-next-line complexity
function parseMotionPathNode(
  node: any,
  scope: ScopeBindings,
  source: string,
): MotionPathParseResult | undefined {
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
    const rec = objectExpressionToRecord(elem, scope, source);
    const x = typeof rec.x === "number" ? rec.x : undefined;
    const y = typeof rec.y === "number" ? rec.y : undefined;
    if (x !== undefined && y !== undefined) coords.push({ x, y });
  }

  if (coords.length < 2) return undefined;

  let waypoints: Array<{ x: number; y: number }>;
  const segments: ArcPathSegment[] = [];

  if (isCubic && coords.length >= 4) {
    waypoints = [];
    const first = coords[0];
    if (first) waypoints.push(first);
    for (let i = 1; i + 2 < coords.length; i += 3) {
      const cp1 = coords[i];
      const cp2 = coords[i + 1];
      const anchor = coords[i + 2];
      if (!cp1 || !cp2 || !anchor) continue;
      waypoints.push(anchor);
      segments.push({ curviness, cp1, cp2 });
    }
  } else {
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

// ── Animation assembly ────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function tweenCallToAnimation(
  call: TweenCallInfo,
  scope: ScopeBindings,
  source: string,
): Omit<GsapAnimation, "id"> {
  const vars = objectExpressionToRecord(call.varsArg, scope, source);
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
      keyframesData = parseKeyframesNode(kfNode, scope, source);
      if (!keyframesData && kfNode) hasUnresolvedKeyframes = true;
      continue;
    }

    if (key === "motionPath") {
      const mpNode = findPropertyNode(call.varsArg, "motionPath");
      motionPathResult = parseMotionPathNode(mpNode, scope, source);
      continue;
    }

    if (key === "easeEach") continue;

    if (EXTRAS_KEYS.has(key)) {
      const rawSource = extractRawPropertySource(call.varsArg, key, source);
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

  if (keyframesData && typeof vars.easeEach === "string") {
    keyframesData.easeEach = vars.easeEach as string;
  }

  if (motionPathResult) {
    const { waypoints } = motionPathResult;
    if (!keyframesData) {
      const kf: GsapPercentageKeyframe[] = waypoints.map((wp, i) => ({
        percentage: waypoints.length > 1 ? Math.round((i / (waypoints.length - 1)) * 100) : 0,
        properties: { x: wp.x, y: wp.y },
      }));
      keyframesData = { format: "percentage", keyframes: kf };
    } else {
      const kfs = keyframesData.keyframes;
      if (kfs.length === waypoints.length) {
        for (let i = 0; i < kfs.length; i++) {
          const kf = kfs[i];
          const wp = waypoints[i];
          if (kf && wp) {
            kf.properties.x = wp.x;
            kf.properties.y = wp.y;
          }
        }
      }
    }
  }

  let fromProperties: Record<string, number | string> | undefined;
  if (call.method === "fromTo" && call.fromArg) {
    fromProperties = {};
    const fromVars = objectExpressionToRecord(call.fromArg, scope, source);
    for (const [key, val] of Object.entries(fromVars)) {
      if (typeof val === "number" || typeof val === "string") {
        fromProperties[key] = val;
      }
    }
  }

  const hasPositionArg = !!call.positionArg;
  const posVal = hasPositionArg ? extractLiteralValue(call.positionArg, scope) : 0;
  const position: number | string =
    typeof posVal === "number" ? posVal : typeof posVal === "string" ? posVal : 0;
  let duration = typeof vars.duration === "number" ? vars.duration : undefined;
  const ease = typeof vars.ease === "string" ? vars.ease : undefined;

  if (duration === undefined && keyframesData) {
    duration = computeKeyframesTotalDuration(call.varsArg, scope, source);
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
  if (Object.keys(extras).length > 0) anim.extras = extras;
  if (keyframesData) anim.keyframes = keyframesData;
  if (motionPathResult) anim.arcPath = motionPathResult.arcPath;
  if (hasUnresolvedKeyframes) anim.hasUnresolvedKeyframes = true;
  if (call.selector === "__unresolved__") anim.hasUnresolvedSelector = true;
  return anim;
}

// ── Timeline position resolution ─────────────────────────────────────────────

const GSAP_DEFAULT_DURATION = 0.5;

// fallow-ignore-next-line complexity
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

// ── Stable ID generation ──────────────────────────────────────────────────────

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

// ── Write-path internal parse ─────────────────────────────────────────────────

export interface ParsedGsapAcornForWrite {
  ast: any;
  timelineVar: string;
  hasTimeline: boolean;
  located: Array<{ id: string; call: TweenCallInfo; animation: GsapAnimation }>;
}

/**
 * Parse a GSAP script and return internal AST + call nodes for the write path.
 * Consumed by gsapWriterAcorn.ts (magic-string offset-splice).
 */
export function parseGsapScriptAcornForWrite(script: string): ParsedGsapAcornForWrite | null {
  try {
    const ast = acorn.parse(script, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
    });
    const scope = collectScopeBindings(ast);
    const targetBindings = collectTargetBindings(ast, scope);
    const detection = findTimelineVar(ast, scope);
    const timelineVar = detection.timelineVar ?? "tl";
    const calls = findAllTweenCalls(ast, timelineVar, scope, targetBindings);
    sortBySourcePosition(calls);
    const rawAnims = calls.map((call) => tweenCallToAnimation(call, scope, script));
    applyTimelineDefaults(rawAnims, detection.defaults);
    resolveTimelinePositions(rawAnims);
    const animations = assignStableIds(rawAnims);
    const located = calls.map((call, i) => ({
      id: animations[i]!.id,
      call,
      animation: animations[i]!,
    }));
    return { ast, timelineVar, hasTimeline: detection.timelineVar !== null, located };
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Browser-safe equivalent of `parseGsapScript` (gsapParser.ts).
 * Uses acorn + acorn-walk instead of recast + @babel/parser.
 */
export function parseGsapScriptAcorn(script: string): ParsedGsap {
  try {
    const ast = acorn.parse(script, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
    });
    const scope = collectScopeBindings(ast);
    const targetBindings = collectTargetBindings(ast, scope);
    const detection = findTimelineVar(ast, scope);
    const timelineVar = detection.timelineVar ?? "tl";
    const calls = findAllTweenCalls(ast, timelineVar, scope, targetBindings);
    sortBySourcePosition(calls);
    const rawAnims = calls.map((call) => tweenCallToAnimation(call, scope, script));
    applyTimelineDefaults(rawAnims, detection.defaults);
    resolveTimelinePositions(rawAnims);
    const animations = assignStableIds(rawAnims);

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
