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
  type GsapAnimation,
  type GsapMethod,
  type ParsedGsap,
  serializeGsapAnimations,
} from "./gsapSerialize";

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

function findAllTweenCalls(ast: any, timelineVar: string): TweenCallInfo[] {
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
        const selectorArg = args[0];
        const selectorValue =
          selectorArg.type === "StringLiteral" || selectorArg.type === "Literal"
            ? String(selectorArg.value)
            : null;
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

// ── Public API ──────────────────────────────────────────────────────────────

export function parseGsapScript(script: string): ParsedGsap {
  try {
    const ast = parseScript(script);
    const scope = collectScopeBindings(ast);
    const detection = findTimelineVar(ast);
    const timelineVar = detection.timelineVar ?? "tl";
    const calls = findAllTweenCalls(ast, timelineVar);
    const animations = assignStableIds(calls.map((call) => tweenCallToAnimation(call, scope)));

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

/** Returns true when the parse result is a failure fallback (no animations, no preamble). */
function isParseFailure(parsed: ParsedGsap): boolean {
  return parsed.animations.length === 0 && !parsed.preamble;
}

export function updateAnimationInScript(
  script: string,
  animationId: string,
  updates: Partial<GsapAnimation>,
): string {
  const parsed = parseGsapScript(script);
  if (isParseFailure(parsed)) return script;
  const updated = parsed.animations.map((anim) =>
    anim.id === animationId ? { ...anim, ...updates } : anim,
  );
  return serializeGsapAnimations(updated, parsed.timelineVar, {
    preamble: parsed.preamble,
    postamble: parsed.postamble,
  });
}

export function addAnimationToScript(
  script: string,
  animation: Omit<GsapAnimation, "id">,
): { script: string; id: string } {
  const parsed = parseGsapScript(script);
  if (isParseFailure(parsed)) return { script, id: "" };
  const id = `anim-${Date.now()}`;
  const newAnim: GsapAnimation = { ...animation, id };
  const allAnimations = [...parsed.animations, newAnim];
  return {
    script: serializeGsapAnimations(allAnimations, parsed.timelineVar, {
      preamble: parsed.preamble,
      postamble: parsed.postamble,
    }),
    id,
  };
}

export function removeAnimationFromScript(script: string, animationId: string): string {
  const parsed = parseGsapScript(script);
  if (isParseFailure(parsed)) return script;
  const filtered = parsed.animations.filter((a) => a.id !== animationId);
  return serializeGsapAnimations(filtered, parsed.timelineVar, {
    preamble: parsed.preamble,
    postamble: parsed.postamble,
  });
}
