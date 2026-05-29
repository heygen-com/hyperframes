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
import { type GsapAnimation, type GsapMethod, type ParsedGsap } from "./gsapSerialize";

export type { GsapAnimation, GsapMethod, ParsedGsap } from "./gsapSerialize";
export {
  serializeGsapAnimations,
  getAnimationsForElement,
  validateCompositionGsap,
  keyframesToGsapAnimations,
  gsapAnimationsToKeyframes,
  SUPPORTED_PROPS,
  SUPPORTED_EASES,
} from "./gsapSerialize";

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
// DOM (`const kicker = root.querySelector(".kicker"); tl.to(kicker, …)`) rather
// than inline string selectors. To make those tweens editable we map each such
// variable back to the CSS selector it was queried with.

const QUERY_METHODS = new Set(["querySelector", "querySelectorAll"]);

/**
 * If `node` is a DOM lookup call (`x.querySelector(".sel")`,
 * `document.querySelectorAll(".sel")`, `document.getElementById("id")`),
 * return the CSS selector it resolves to. `getElementById("id")` maps to
 * `#id`. Returns null for anything else.
 */
function selectorFromQueryCall(node: any, scope: ScopeBindings): string | null {
  if (node?.type !== "CallExpression") return null;
  const callee = node.callee;
  if (callee?.type !== "MemberExpression" || callee.property?.type !== "Identifier") return null;
  const method = callee.property.name;
  const argValue = resolveNode(node.arguments?.[0], scope);
  if (typeof argValue !== "string" || argValue.length === 0) return null;
  if (QUERY_METHODS.has(method)) return argValue;
  if (method === "getElementById") return `#${argValue}`;
  return null;
}

type TargetBindings = ReadonlyMap<string, string>;

/** Map element variables (assigned from a DOM lookup) to their CSS selector. */
function collectTargetBindings(ast: any, scope: ScopeBindings): TargetBindings {
  const bindings = new Map<string, string>();
  recast.types.visit(ast, {
    visitVariableDeclarator(path: any) {
      const name = path.node.id?.name;
      const selector = selectorFromQueryCall(path.node.init, scope);
      if (name && selector !== null) bindings.set(name, selector);
      this.traverse(path);
    },
    visitAssignmentExpression(path: any) {
      const left = path.node.left;
      const selector = selectorFromQueryCall(path.node.right, scope);
      if (left?.type === "Identifier" && selector !== null && !bindings.has(left.name)) {
        bindings.set(left.name, selector);
      }
      this.traverse(path);
    },
  });
  return bindings;
}

/**
 * Resolve a tween's first argument to a CSS selector. Handles inline string
 * literals, element variables (via {@link collectTargetBindings}), and inline
 * DOM lookup calls. Returns null when the target can't be resolved statically
 * (e.g. an object-target duration anchor `tl.to({ _: 0 }, …)`).
 */
function resolveTargetSelector(
  node: any,
  scope: ScopeBindings,
  targetBindings: TargetBindings,
): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral" || node.type === "Literal") {
    return typeof node.value === "string" ? node.value : null;
  }
  if (node.type === "Identifier") {
    return targetBindings.get(node.name) ?? null;
  }
  if (node.type === "CallExpression") {
    return selectorFromQueryCall(node, scope);
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
        callee.object?.type === "Identifier" &&
        callee.object.name === timelineVar &&
        callee.property?.type === "Identifier"
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
        const selectorValue = resolveTargetSelector(args[0], scope, targetBindings);
        if (!selectorValue) {
          this.traverse(path);
          return;
        }

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
const DROPPED_VAR_KEYS = new Set(["keyframes", "onComplete", "onStart", "onUpdate", "onRepeat"]);

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
  if (varsArgNode?.type !== "ObjectExpression") return undefined;
  for (const prop of varsArgNode.properties ?? []) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    const propKey = prop.key?.name ?? prop.key?.value;
    if (propKey === key) {
      return recast.print(prop.value).code;
    }
  }
  return undefined;
}

function tweenCallToAnimation(
  call: TweenCallInfo,
  scope: ScopeBindings,
): Omit<GsapAnimation, "id"> {
  const vars = objectExpressionToRecord(call.varsArg, scope);
  const properties: Record<string, number | string> = {};
  const extras: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(vars)) {
    if (BUILTIN_VAR_KEYS.has(key)) continue;
    if (DROPPED_VAR_KEYS.has(key)) continue;

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
  if (updates.ease !== undefined) setVarsKey(call.varsArg, "ease", updates.ease);
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
  if (anim.duration !== undefined) props.duration = anim.duration;
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
  } catch {
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
  } catch {
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

export function removeAnimationFromScript(script: string, animationId: string): string {
  let parsed: ParsedGsapAst;
  try {
    parsed = parseGsapAst(script);
  } catch {
    return script;
  }
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const stmtPath = findStatementPath(target.call.path);
  if (!stmtPath) return script;
  stmtPath.prune();
  return recast.print(parsed.ast).code;
}
