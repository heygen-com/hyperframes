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
  GsapAnimation,
  GsapKeyframesData,
  GsapMethod,
  GsapPercentageKeyframe,
  ParsedGsap,
} from "./gsapSerialize.js";
import { classifyTweenPropertyGroup } from "./gsapConstants.js";
import { buildArcPath } from "./gsapSerialize.js";
import { inlineComputedTimelines, readProvenance } from "./gsapInline.js";

// Browser-safe re-exports so studio code can build arc config without importing
// the recast parser (this acorn module is the browser-safe gsap subpath).
export { buildArcPath, editabilityForProvenance } from "./gsapSerialize.js";
export type {
  ArcPathConfig,
  ArcPathSegment,
  MotionPathShape,
  GsapProvenance,
  GsapProvenanceKind,
  KeyframeEditability,
} from "./gsapSerialize.js";

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

/**
 * Side-table of top-level const/let ARRAY and OBJECT literals (of literals),
 * captured by `collectScopeBindings` and stashed on the scope Map so that
 * `resolveNode` can fold member access (`H.bar0`) and computed array index
 * (`SPARK[0][1]`) without changing the resolveNode signature at its ~15 call
 * sites. ponytail: hidden prop on the Map beats threading a new param everywhere.
 */
const CONST_NODES = Symbol("hf.constNodes");
type ConstNodes = Map<string, any>;

function constNodesOf(
  scope: ReadonlyMap<string, number | string | boolean>,
): ConstNodes | undefined {
  return (scope as any)[CONST_NODES];
}

/** Whitelisted Math members we fold over constant args (deterministic, no I/O). */
const MATH_FNS = new Set(["min", "max", "round", "floor", "ceil", "abs", "sqrt", "sign", "trunc"]);
const MATH_CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E, SQRT2: Math.SQRT2 };

/**
 * Fold a MemberExpression (`obj.prop`, `arr[i]`, `Math.PI`, `Math.round(x)`)
 * against the const-node side-table. Returns undefined when not statically
 * resolvable (genuinely runtime-dynamic) so the caller falls back to __raw.
 */
// fallow-ignore-next-line complexity
function resolveMemberNode(
  node: any,
  scope: ReadonlyMap<string, number | string | boolean>,
): number | string | boolean | undefined {
  // Math.PI / Math.E
  if (node.object?.type === "Identifier" && node.object.name === "Math") {
    const key = node.property?.name;
    return typeof key === "string" ? MATH_CONSTS[key] : undefined;
  }
  // Resolve the object to a const AST node (array/object literal), descending
  // through chained member/index access (SPARK[0][1], H.bar0).
  const objNode = resolveConstNode(node.object, scope);
  if (!objNode) return undefined;
  let valueNode: any;
  if (node.computed) {
    const idx = resolveNode(node.property, scope);
    if (objNode.type === "ArrayExpression" && typeof idx === "number") {
      valueNode = objNode.elements?.[idx];
    } else if (
      objNode.type === "ObjectExpression" &&
      (typeof idx === "string" || typeof idx === "number")
    ) {
      valueNode = findPropertyNode(objNode, String(idx));
    }
  } else if (objNode.type === "ObjectExpression") {
    valueNode = findPropertyNode(objNode, node.property?.name ?? node.property?.value);
  }
  return valueNode ? resolveNode(valueNode, scope) : undefined;
}

/**
 * Descend one MemberExpression step into an already-resolved const ARRAY/OBJECT
 * node (`objNode[idx]` / `objNode.prop`). Split out of resolveConstNode so the
 * recursive walk stays flat/low-branch.
 */
function resolveConstMember(
  objNode: any,
  node: any,
  scope: ReadonlyMap<string, number | string | boolean>,
): any {
  if (!node.computed) {
    return objNode.type === "ObjectExpression"
      ? findPropertyNode(objNode, node.property?.name ?? node.property?.value)
      : undefined;
  }
  const idx = resolveNode(node.property, scope);
  if (objNode.type === "ArrayExpression" && typeof idx === "number") return objNode.elements?.[idx];
  if (objNode.type === "ObjectExpression") return findPropertyNode(objNode, String(idx));
  return undefined;
}

/** Resolve an expression to a const ARRAY/OBJECT AST node (for nested access). */
function resolveConstNode(node: any, scope: ReadonlyMap<string, number | string | boolean>): any {
  if (!node) return undefined;
  if (node.type === "ArrayExpression" || node.type === "ObjectExpression") return node;
  if (node.type === "Identifier") return constNodesOf(scope)?.get(node.name);
  if (node.type !== "MemberExpression") return undefined;
  const objNode = resolveConstNode(node.object, scope);
  return objNode ? resolveConstMember(objNode, node, scope) : undefined;
}

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
  if (node.type === "MemberExpression") {
    return resolveMemberNode(node, scope);
  }
  // Whitelisted Math.fn(...) over constant args (Math.round/min/max/...).
  if (
    node.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "Math" &&
    MATH_FNS.has(node.callee.property?.name)
  ) {
    const args = (node.arguments ?? []).map((a: any) => resolveNode(a, scope));
    if (args.every((a: unknown) => typeof a === "number")) {
      return (Math as any)[node.callee.property.name](...(args as number[]));
    }
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
  // This compact resolver is intentionally conservative: it does not carry a
  // full lexical environment. If the same identifier has different constant
  // values in separate function/IIFE scopes, treating either value as global
  // corrupts every tween in the other scope. Mark that name ambiguous so its
  // expressions stay __raw and timing-sensitive lint rules skip them.
  const ambiguousBindings = new Set<string>();
  // Const ARRAY/OBJECT literals are kept as AST nodes for member/index folding
  // (resolveMemberNode), exposed to resolveNode via the CONST_NODES side-table.
  const constNodes: ConstNodes = new Map();
  Object.defineProperty(bindings, CONST_NODES, { value: constNodes, enumerable: false });
  acornWalk.simple(ast, {
    VariableDeclarator(node: any) {
      const name = node.id?.name;
      const init = node.init;
      if (!name || !init) return;
      if (init.type === "ArrayExpression" || init.type === "ObjectExpression") {
        constNodes.set(name, init);
        return;
      }
      const val = resolveNode(init, bindings);
      if (val === undefined || ambiguousBindings.has(name)) return;
      const existing = bindings.get(name);
      if (existing !== undefined && existing !== val) {
        bindings.delete(name);
        ambiguousBindings.add(name);
      } else if (existing === undefined) {
        bindings.set(name, val);
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

  // Pass 3: collection ALIASES inherit their source collection's selector.
  // `const lead = glyphs[0]`, `const rest = glyphs.slice(1)`,
  // `const some = glyphs.filter(...)` all still target the same selector
  // (`.glyph`). Per-element identity isn't statically recoverable (DOM-sized
  // collection), but the selector + stagger should not read as __unresolved__.
  const COLLECTION_ALIAS_METHODS = new Set(["slice", "filter", "concat", "reverse"]);
  acornWalk.ancestor(ast, {
    // fallow-ignore-next-line complexity
    VariableDeclarator(node: any, _: unknown, ancestors: any[]) {
      const name = node.id?.name;
      const init = node.init;
      if (!name || !init) return;
      let sourceVar: string | undefined;
      // x = coll[i]
      if (init.type === "MemberExpression" && init.object?.type === "Identifier") {
        sourceVar = init.object.name;
      }
      // x = coll.slice(...) / coll.filter(...)
      else if (
        init.type === "CallExpression" &&
        init.callee?.type === "MemberExpression" &&
        init.callee.object?.type === "Identifier" &&
        init.callee.property?.type === "Identifier" &&
        COLLECTION_ALIAS_METHODS.has(init.callee.property.name)
      ) {
        sourceVar = init.callee.object.name;
      }
      if (!sourceVar) return;
      const selector = lookupBindingFromAncestors(sourceVar, ancestors, bindings);
      if (selector)
        addBinding(bindings, enclosingScopeNodeFromAncestors(ancestors), name, selector);
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

/**
 * Classify an otherwise-unresolved tween target that is a plain object literal
 * (`tl.to({}, …)`) or a proxy object (`tl.to(s, {onUpdate})`). Returns a
 * descriptive pseudo-selector or null when the target isn't an object proxy.
 *
 * - Empty object literal → "dwell/hold" (a timing-only spacer tween, #11).
 * - Proxy with onUpdate that writes a DOM attribute/style → "proxy → <attr>"
 *   (best-effort #5; the channel name is parsed from the onUpdate body).
 */
function describeProxyTarget(targetNode: any, varsNode: any, scope: ScopeBindings): string | null {
  // Resolve an Identifier proxy (const s = {u:0}) to its object literal.
  const objNode =
    targetNode?.type === "ObjectExpression"
      ? targetNode
      : targetNode?.type === "Identifier"
        ? resolveConstNode(targetNode, scope)
        : undefined;
  if (objNode?.type !== "ObjectExpression") return null;

  const onUpdate = findPropertyNode(varsNode, "onUpdate");
  const driven = onUpdate ? drivenDomChannel(onUpdate) : undefined;
  if (driven) return `proxy → ${driven}`;
  // Empty / proxy object with no resolvable DOM write ⇒ a timing spacer.
  return "dwell/hold";
}

/** True for `el.style.foo = …` (nested-member style write). */
function isStyleAssignmentTarget(left: any): boolean {
  return (
    left?.type === "MemberExpression" &&
    left.object?.type === "MemberExpression" &&
    left.object.property?.name === "style" &&
    !!left.property?.name
  );
}

/** Best-effort: find the DOM attribute/style channel an onUpdate body writes. */
// fallow-ignore-next-line complexity
function drivenDomChannel(fnNode: any): string | undefined {
  let found: string | undefined;
  acornWalk.simple(fnNode, {
    CallExpression(node: any) {
      // setAttribute("d" | "points" | "stroke-dashoffset", …)
      if (
        node.callee?.type === "MemberExpression" &&
        node.callee.property?.name === "setAttribute" &&
        typeof node.arguments?.[0]?.value === "string"
      ) {
        found ??= node.arguments[0].value;
      }
    },
    AssignmentExpression(node: any) {
      // el.style.foo = … / el.setAttribute-less style writes
      const left = node.left;
      if (isStyleAssignmentTarget(left)) found ??= `style.${left.property.name}`;
    },
  });
  return found;
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

// How the timeline is referred to in source. `identifier` is the canonical
// `const tl = ...` form; `member` is the inline
// `window.__timelines["scene"] = ...` form, where the timeline is the member
// expression itself.
type TimelineRef = { kind: "identifier"; name: string } | { kind: "member"; node: any };

interface TimelineDetection {
  /** Identifier name for the canonical form, else null for member/none. */
  timelineVar: string | null;
  /** Structural reference: identifier or member expression. Null when none found. */
  ref: TimelineRef | null;
  timelineCount: number;
  defaults?: TimelineDefaults;
}

/** The static string key of a member access (`window.__timelines["scene"]` -> "scene"), else null. */
function staticMemberKey(node: any): string | null {
  if (!node || node.type !== "MemberExpression") return null;
  if (node.computed) {
    const p = node.property;
    if (p?.type === "Literal" && typeof p.value === "string") return p.value;
    return null;
  }
  return node.property?.type === "Identifier" ? node.property.name : null;
}

/** True when a member expression refers to a statically-resolvable timeline slot. */
function isStaticMemberRef(node: any): boolean {
  return node?.type === "MemberExpression" && staticMemberKey(node) !== null;
}

/** Structural equality of two member-access nodes (object chain + static key), quote-insensitive. */
function sameMemberAccess(a: any, b: any): boolean {
  if (a?.type !== "MemberExpression" || b?.type !== "MemberExpression") return false;
  if (staticMemberKey(a) !== staticMemberKey(b) || staticMemberKey(a) === null) return false;
  const ao = a.object;
  const bo = b.object;
  if (ao?.type === "Identifier" && bo?.type === "Identifier") return ao.name === bo.name;
  if (ao?.type === "MemberExpression" && bo?.type === "MemberExpression")
    return sameMemberAccess(ao, bo);
  return false;
}

/** The source string a tween call is rooted at: identifier name, or the member source as written. */
function timelineRootSource(ref: TimelineRef, script: string): string {
  return ref.kind === "identifier" ? ref.name : script.slice(ref.node.start, ref.node.end);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  let ref: TimelineRef | null = null;
  let timelineCount = 0;
  let defaults: TimelineDefaults | undefined;
  const emptyScope: ScopeBindings = scope ?? new Map();

  acornWalk.simple(ast, {
    VariableDeclarator(node: any) {
      if (isGsapTimelineCall(node.init)) {
        timelineCount += 1;
        if (!ref && node.id?.type === "Identifier") {
          timelineVar = node.id.name;
          ref = { kind: "identifier", name: node.id.name };
          defaults = extractTimelineDefaults(node.init, emptyScope);
        }
      }
    },
    AssignmentExpression(node: any) {
      if (isGsapTimelineCall(node.right)) {
        timelineCount += 1;
        if (!ref) {
          const left = node.left;
          if (left?.type === "Identifier") {
            timelineVar = left.name;
            ref = { kind: "identifier", name: left.name };
            defaults = extractTimelineDefaults(node.right, emptyScope);
          } else if (isStaticMemberRef(left)) {
            // Inline form: `window.__timelines["scene"] = gsap.timeline(...)`.
            ref = { kind: "member", node: left };
            defaults = extractTimelineDefaults(node.right, emptyScope);
          }
        }
      }
    },
  });

  return { timelineVar, ref, timelineCount, defaults };
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
  /** True for a base `gsap.set(...)` (off-timeline) rather than `tl.set(...)`. */
  global?: boolean;
}

/** True when the callee chain is rooted at the timeline reference (identifier or member). */
function isTimelineRootedCall(callNode: any, ref: TimelineRef): boolean {
  let obj = callNode.callee?.object;
  while (obj?.type === "CallExpression") {
    obj = obj.callee?.object;
  }
  if (ref.kind === "identifier") return obj?.type === "Identifier" && obj.name === ref.name;
  return sameMemberAccess(obj, ref.node);
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
  ref: TimelineRef,
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
      // A base `gsap.set("#sel", props)` is an off-timeline static hold. Parse
      // it as an editable global `set` so static values round-trip and re-edit
      // in place. Variable-target holds stay surrounding source.
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
        (isTimelineRootedCall(node, ref) || isGlobalSet) &&
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
            ...(isGlobalSet ? { global: true } : {}),
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

  return buildArcPath(coords, curviness, autoRotate, isCubic);
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
    typeof posVal === "number"
      ? posVal
      : typeof posVal === "string"
        ? posVal
        : hasPositionArg
          ? `__raw:${source.slice(call.positionArg.start, call.positionArg.end)}`
          : 0;
  let duration = typeof vars.duration === "number" ? vars.duration : undefined;
  const ease = typeof vars.ease === "string" ? vars.ease : undefined;

  if (duration === undefined && keyframesData) {
    duration = computeKeyframesTotalDuration(call.varsArg, scope, source);
  }

  // Relabel object-proxy / empty-target tweens so they don't read as bare
  // __unresolved__: a dwell/hold spacer or an onUpdate-driven DOM channel (#5/#11).
  let selector = call.selector;
  if (selector === "__unresolved__") {
    const proxyLabel = describeProxyTarget(call.node.arguments?.[0], call.varsArg, scope);
    if (proxyLabel) selector = proxyLabel;
  }

  const anim: Omit<GsapAnimation, "id"> = {
    targetSelector: selector,
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
  if (selector === "__unresolved__") anim.hasUnresolvedSelector = true;
  const provenance = readProvenance(call.node);
  if (provenance) anim.provenance = provenance;
  return anim;
}

// ── Stagger annotation (read path) ────────────────────────────────────────────

/**
 * Pull the per-element stagger amount out of a captured `extras.stagger` value.
 * GSAP staggers are either a number (`0.08`) or an object (`{ each: 0.012, ... }`).
 * The value arrives here as the round-trip form `__raw:<source>`; we only need
 * the leading numeric / `each:` figure for the annotation. Returns undefined for
 * non-numeric (function) staggers — there's nothing honest to print.
 */
function staggerAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return undefined;
  const src = raw.startsWith("__raw:") ? raw.slice(6) : raw;
  const m = /(?:each\s*:\s*)?(-?\d+(?:\.\d+)?)/.exec(src);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1]!);
  return Number.isFinite(n) ? n : undefined;
}

/** Rest-pose value GSAP animates to/from for an unspecified endpoint. */
function restValue(prop: string): number {
  return prop === "opacity" || prop.startsWith("scale") ? 1 : 0;
}

/**
 * Honest from/to keyframes for a flat staggered tween, mirroring how a flat
 * tween renders: `from()` plays vars -> rest, `to()` plays rest -> vars, `fromTo`
 * plays its authored endpoints. A synthetic `stagger` channel rides on both
 * keyframes so the per-element cascade is visible even when the tween lands on
 * the rest pose (a 1->1 collection that would otherwise read as a no-op).
 */
function staggeredKeyframes(
  anim: Omit<GsapAnimation, "id">,
  each: number,
): GsapPercentageKeyframe[] {
  const vars = { ...anim.properties };
  let from: Record<string, number | string>;
  let to: Record<string, number | string>;
  if (anim.method === "fromTo") {
    from = { ...(anim.fromProperties ?? {}) };
    to = vars;
  } else if (anim.method === "from") {
    from = vars;
    to = {};
    for (const k of Object.keys(vars)) to[k] = restValue(k);
  } else {
    from = { ...(anim.fromProperties ?? {}) };
    for (const k of Object.keys(vars)) if (from[k] === undefined) from[k] = restValue(k);
    to = vars;
  }
  return [
    { percentage: 0, properties: { ...from, stagger: each } },
    { percentage: 100, properties: { ...to, stagger: each } },
  ];
}

/**
 * Read-path honesty pass: a tween with a `stagger` targets a per-element
 * collection that animates one element at a time. A flat staggered tween that
 * lands on (or starts from) the rest pose otherwise renders as a misleading
 * X->X no-op. Surface real from/to keyframes plus the per-element `stagger`
 * amount so the reader can tell the collection DOES animate and roughly how.
 *
 * Read path only — the write/serialize path ignores `keyframes` and keeps the
 * literal `extras.stagger` source, so round-trips are untouched. Keyframed /
 * motionPath tweens already surface their motion, so they're left alone.
 */
function annotateStaggeredCollections(anims: Omit<GsapAnimation, "id">[]): void {
  for (const anim of anims) {
    if (anim.keyframes || anim.arcPath) continue;
    const each = staggerAmount(anim.extras?.stagger);
    if (each === undefined) continue;
    anim.keyframes = { format: "percentage", keyframes: staggeredKeyframes(anim, each) };
  }
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

// ── set() pre-state seeding (#3 in eval) ──────────────────────────────────────

/**
 * Collect `gsap.set(target, {prop: v})` calls into selector → {prop: value}.
 * These run before the (paused) timeline builds, establishing the initial DOM
 * state. tl.set(...) calls are already in the animation list, so they're folded
 * in during the seeding walk instead.
 */
function collectGsapSetStates(
  ast: any,
  scope: ScopeBindings,
  bindings: TargetBindings,
  source: string,
): Map<string, Record<string, number | string>> {
  const states = new Map<string, Record<string, number | string>>();
  acornWalk.ancestor(ast, {
    // fallow-ignore-next-line complexity
    CallExpression(node: any, _: unknown, ancestors: any[]) {
      const callee = node.callee;
      if (
        callee?.type !== "MemberExpression" ||
        callee.object?.name !== "gsap" ||
        callee.property?.name !== "set"
      )
        return;
      const selector = resolveTargetSelector(node.arguments?.[0], ancestors, scope, bindings);
      if (!selector) return;
      const rec = objectExpressionToRecord(node.arguments?.[1], scope, source);
      const props: Record<string, number | string> = states.get(selector) ?? {};
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v === "number" || typeof v === "string") props[k] = v;
      }
      states.set(selector, props);
    },
  } as any);
  return states;
}

/**
 * Seed each tween's start keyframe from the most recent set() value on the same
 * target. Without this, `set(scaleY:0)` then `.to(scaleY:1)` reports the CSS
 * default as the start, so a grow/fold/fade-from reads as a flat no-op.
 *
 * Walks animations in timeline order, tracking per-target current state from
 * gsap.set() (pre-seeded) and tl.set() tweens. For a later to/from tween that
 * lacks an explicit from-value for an animated prop, the tracked set() value
 * becomes its from-keyframe.
 */
/** Overwrite `target` in place with `props`, returning it (for Map.set chaining). */
function mergeProps(
  target: Record<string, number | string>,
  props: Record<string, number | string>,
): Record<string, number | string> {
  for (const [k, v] of Object.entries(props)) target[k] = v;
  return target;
}

/**
 * Fill in `anim.fromProperties` for a `.to()` tween's props that lack an
 * explicit start, from the tracked pre-tween state. Mutates `anim` only when
 * at least one prop is actually seeded.
 */
function seedFromPreState(
  anim: Omit<GsapAnimation, "id">,
  cur: Record<string, number | string>,
): void {
  const from = { ...(anim.fromProperties ?? {}) };
  let seeded = false;
  for (const prop of Object.keys(anim.properties)) {
    if (from[prop] === undefined && cur[prop] !== undefined) {
      from[prop] = cur[prop];
      seeded = true;
    }
  }
  if (seeded) anim.fromProperties = from;
}

function seedSetStates(
  anims: Omit<GsapAnimation, "id">[],
  initial: Map<string, Record<string, number | string>>,
): void {
  const state = new Map<string, Record<string, number | string>>();
  for (const [sel, props] of initial) state.set(sel, { ...props });

  for (const anim of anims) {
    const sel = anim.targetSelector;
    if (anim.method === "set") {
      state.set(sel, mergeProps(state.get(sel) ?? {}, anim.properties));
      continue;
    }
    // fromTo authors its own start explicitly — don't override it.
    const cur = state.get(sel);
    if (anim.method === "to" && cur) seedFromPreState(anim, cur);
    // After a to/from tween, the target's state is the tween's END values.
    state.set(sel, mergeProps(state.get(sel) ?? {}, anim.properties));
  }
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

/** A source-ordered addLabel(name, position) definition. */
interface AddLabelDef {
  name: string;
  /** Raw position string/number, or undefined ⇒ label sits at current end. */
  position: string | number | undefined;
  /** Source-order key (parallel to anims), for interleaving. */
  order: number;
}

/**
 * Resolve a label-relative position string against a live label table.
 * Handles "label", "label+=n", "label-=n". Unknown labels auto-create at the
 * current playhead (cursor) — GSAP's behavior when a tween references a label
 * that hasn't been added yet. Returns null when not a label form.
 */
function resolveLabelPosition(
  pos: string,
  labels: Map<string, number>,
  cursor: number,
): number | null {
  const m = /^([A-Za-z_$][\w$]*)\s*(?:([+-])=\s*([\d.]+))?$/.exec(pos.trim());
  if (!m) return null;
  const name = m[1]!;
  let base = labels.get(name);
  if (base === undefined) {
    base = cursor; // auto-create label at the current end-of-timeline
    labels.set(name, base);
  }
  if (m[2] && m[3]) {
    const n = Number.parseFloat(m[3]);
    if (Number.isFinite(n)) return m[2] === "+" ? base + n : base - n;
  }
  return base;
}

/** Resolve a single tween's unresolved start time against the live cursor/labels. */
function resolveAnimStart(
  anim: Omit<GsapAnimation, "id">,
  cursor: number,
  prevStart: number,
  labels: Map<string, number>,
): number | null {
  if (anim.implicitPosition) return cursor;
  if (typeof anim.position === "number") return anim.position;
  if (typeof anim.position === "string") {
    return (
      resolveLabelPosition(anim.position, labels, cursor) ??
      resolvePositionString(anim.position, cursor, prevStart)
    );
  }
  return cursor;
}

function resolveTimelinePositions(
  anims: Omit<GsapAnimation, "id">[],
  labelDefs: AddLabelDef[] = [],
): void {
  let cursor = 0;
  let prevStart = 0;
  const labels = new Map<string, number>();
  // Interleave addLabel definitions with tweens by source order so labels are
  // available exactly when later tweens reference them.
  let labelIdx = 0;
  const sortedLabels = [...labelDefs].sort((a, b) => a.order - b.order);

  const defineLabel = (def: AddLabelDef): void => {
    let value: number;
    if (typeof def.position === "number") value = def.position;
    else if (typeof def.position === "string") {
      value = resolveLabelPosition(def.position, labels, cursor) ?? cursor;
    } else value = cursor; // no position ⇒ end of timeline
    labels.set(def.name, Math.max(0, value));
  };

  anims.forEach((anim, i) => {
    // Apply any addLabel calls authored before this tween.
    while (labelIdx < sortedLabels.length && sortedLabels[labelIdx]!.order <= i) {
      defineLabel(sortedLabels[labelIdx]!);
      labelIdx++;
    }

    // A global `gsap.set(...)` is off-timeline: applied once at load, not
    // sequenced on the master timeline. It has no position arg, so pin it to 0
    // and do not advance the cursor.
    if (anim.method === "set" && anim.global) {
      anim.resolvedStart = 0;
      return;
    }

    const duration = anim.method === "set" ? 0 : (anim.duration ?? GSAP_DEFAULT_DURATION);
    const start = resolveAnimStart(anim, cursor, prevStart, labels);

    if (start != null) {
      anim.resolvedStart = Math.max(0, start);
      prevStart = anim.resolvedStart;
      cursor = Math.max(cursor, anim.resolvedStart + duration);
    }
  });

  // Any trailing addLabel calls (define for completeness; no tweens follow).
  while (labelIdx < sortedLabels.length) defineLabel(sortedLabels[labelIdx++]!);
}

/**
 * Collect `tl.addLabel(name, position)` calls and compute each one's `order` —
 * the count of tween calls that precede it in source order — so positions can
 * be interleaved against the sorted animation list in resolveTimelinePositions.
 */
function collectAddLabelDefs(
  ast: any,
  ref: TimelineRef,
  scope: ScopeBindings,
  sortedCalls: TweenCallInfo[],
): AddLabelDef[] {
  const callLocs = sortedCalls.map((c) => c.node.callee?.property?.loc?.start);
  const defs: AddLabelDef[] = [];
  acornWalk.simple(ast, {
    // fallow-ignore-next-line complexity
    CallExpression(node: any) {
      const callee = node.callee;
      const objMatches =
        ref.kind === "identifier"
          ? callee.object?.type === "Identifier" && callee.object.name === ref.name
          : sameMemberAccess(callee.object, ref.node);
      if (
        callee?.type !== "MemberExpression" ||
        !objMatches ||
        callee.property?.name !== "addLabel"
      )
        return;
      const nameNode = node.arguments?.[0];
      const name = typeof nameNode?.value === "string" ? nameNode.value : undefined;
      if (!name) return;
      // position may be numeric, a label-relative string, or omitted.
      const posVal = resolveNode(node.arguments?.[1], scope);
      const position =
        typeof posVal === "number" || typeof posVal === "string" ? posVal : undefined;
      const labelLoc = callee.property?.loc?.start;
      let order = sortedCalls.length;
      if (labelLoc) {
        order = callLocs.findIndex(
          (l) =>
            l &&
            (l.line > labelLoc.line || (l.line === labelLoc.line && l.column > labelLoc.column)),
        );
        if (order === -1) order = sortedCalls.length;
      }
      defs.push({ name, position, order });
    },
  });
  return defs;
}

function compareByLoc(a: TweenCallInfo, b: TweenCallInfo): number {
  const aLoc = a.node.callee?.property?.loc?.start;
  const bLoc = b.node.callee?.property?.loc?.start;
  if (!aLoc || !bLoc) return 0;
  return aLoc.line - bLoc.line || aLoc.column - bLoc.column;
}

// Inlined tweens carry a monotonic __hfOrder (clones share source loc, so loc
// can't order them); they sort by that, after all literal (loc-ordered) tweens.
function compareCallOrder(a: TweenCallInfo, b: TweenCallInfo): number {
  const ao = a.node.__hfOrder;
  const bo = b.node.__hfOrder;
  if (ao === undefined && bo === undefined) return compareByLoc(a, b);
  if (ao === undefined) return -1;
  if (bo === undefined) return 1;
  return ao - bo;
}

function sortBySourcePosition(calls: TweenCallInfo[]): void {
  calls.sort(compareCallOrder);
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
    const ref: TimelineRef = detection.ref ?? { kind: "identifier", name: "tl" };
    const timelineVar = timelineRootSource(ref, script);
    const calls = findAllTweenCalls(ast, ref, scope, targetBindings);
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
    return { ast, timelineVar, hasTimeline: detection.ref !== null, located };
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
    const detection = findTimelineVar(ast, scope);
    const ref: TimelineRef = detection.ref ?? { kind: "identifier", name: "tl" };
    const timelineVar = timelineRootSource(ref, script);
    // Expand helper-built / bounded-loop timelines before analysis so their
    // tweens resolve at true positions (read path only — the write path keeps
    // original source nodes). Degrades to the un-inlined AST on any failure.
    // Only identifier timelines use the helper-built pattern; inline member
    // timelines have nothing to inline, so skip to avoid mis-rooting on member refs.
    if (ref.kind === "identifier") {
      try {
        inlineComputedTimelines(ast, timelineVar, (node) => resolveNode(node, scope));
      } catch {
        /* fall back to current behavior */
      }
    }
    const targetBindings = collectTargetBindings(ast, scope);
    const calls = findAllTweenCalls(ast, ref, scope, targetBindings);
    sortBySourcePosition(calls);
    const rawAnims = calls.map((call) => tweenCallToAnimation(call, scope, script));
    applyTimelineDefaults(rawAnims, detection.defaults);
    // Seed tween start-keyframes from gsap.set()/tl.set() pre-states (read-only
    // enrichment; the write path keeps source untouched for round-trip parity).
    seedSetStates(rawAnims, collectGsapSetStates(ast, scope, targetBindings, script));
    const labelDefs = collectAddLabelDefs(ast, ref, scope, calls);
    resolveTimelinePositions(rawAnims, labelDefs);
    // Honesty pass (read path only): make staggered collection tweens read as
    // real per-element motion instead of a flat no-op. Done after positions so
    // duration is settled; before ids so the annotation is part of the id.
    annotateStaggeredCollections(rawAnims);
    const animations = assignStableIds(rawAnims);

    const declPattern =
      ref.kind === "identifier"
        ? `(?:const|let|var)\\s+${timelineVar}\\s*=\\s*gsap\\.timeline\\s*\\([^)]*\\)\\s*;?`
        : `${escapeRegExp(timelineVar)}\\s*=\\s*gsap\\.timeline\\s*\\([^)]*\\)\\s*;?`;
    const timelineMatch = script.match(new RegExp(`^[\\s\\S]*?${declPattern}`));
    const fallbackPreamble =
      ref.kind === "identifier"
        ? `const ${timelineVar} = gsap.timeline({ paused: true });`
        : `${timelineVar} = gsap.timeline({ paused: true });`;
    const preamble = timelineMatch?.[0] ?? fallbackPreamble;

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
    if (detection.timelineCount > 0 && detection.ref === null)
      result.unsupportedTimelinePattern = true;
    return result;
  } catch {
    return { animations: [], timelineVar: "tl", preamble: "", postamble: "" };
  }
}

// ── Label extraction (WS-C) ──────────────────────────────────────────────────

export interface GsapLabelEntry {
  name: string;
  position: number;
}

/**
 * Extract all `tl.addLabel("name", position)` calls from a GSAP script.
 *
 * Returns labels in source order. Position must be a numeric literal; labels
 * with non-numeric positions (e.g. label-relative offsets) are skipped.
 *
 * Pure — no side effects, no DOM, no Date.now.
 */
export function extractGsapLabels(script: string): GsapLabelEntry[] {
  try {
    const ast = acorn.parse(script, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
    });
    const scope = collectScopeBindings(ast);
    const detection = findTimelineVar(ast, scope);
    const ref: TimelineRef = detection.ref ?? { kind: "identifier", name: "tl" };

    const labels: GsapLabelEntry[] = [];

    acornWalk.simple(ast, {
      // fallow-ignore-next-line complexity
      ExpressionStatement(node: any) {
        const expr = node.expression;
        if (!expr || expr.type !== "CallExpression") return;
        const callee = expr.callee;
        // Match <timeline>.addLabel(...) for identifier or member timeline refs.
        const objMatches =
          ref.kind === "identifier"
            ? callee.object?.type === "Identifier" && callee.object.name === ref.name
            : sameMemberAccess(callee.object, ref.node);
        if (
          callee?.type !== "MemberExpression" ||
          !objMatches ||
          callee.property?.name !== "addLabel"
        )
          return;
        const args = expr.arguments ?? [];
        const nameNode = args[0];
        const posNode = args[1];
        if (nameNode?.type !== "Literal" || typeof nameNode.value !== "string") return;
        if (!posNode) return;
        const pos = resolveNode(posNode, scope);
        if (typeof pos !== "number" || !Number.isFinite(pos)) return;
        labels.push({ name: nameNode.value, position: pos });
      },
    });

    return labels;
  } catch {
    // Labels are best-effort/supplementary, not load-bearing — a malformed or
    // unparseable script yields no labels rather than failing the caller.
    return [];
  }
}
