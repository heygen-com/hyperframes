// fallow-ignore-file code-duplication
/**
 * Browser-safe anime.js v4 write path — magic-string offset-splice.
 *
 * Consumes the source-located anime parser model and edits only the touched byte
 * ranges. Runtime-dynamic / unresolved calls throw instead of guessing.
 */
import MagicString from "magic-string";
import type { AnimeJsAnimationForInsert, AnimeJsPropertyValue } from "./animeSerialize.js";
import {
  findAnimeJsPropertyNode,
  parseAnimeJsScriptAcornForWrite,
  type AnimeJsCallInfo,
  type ParsedAnimeJsAcornForWrite,
} from "./animejsParserAcorn.js";

type Node = any;

function valueToCode(value: unknown): string {
  if (typeof value === "string" && value.startsWith("__raw:")) return value.slice(6);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isNaN(value) ? "0" : String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => valueToCode(item)).join(", ")}]`;
  return JSON.stringify(value);
}

function safeKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function assertEditable(target: {
  call: AnimeJsCallInfo;
  animation: { provenance?: { kind: string } };
}): void {
  if (
    target.animation.provenance?.kind !== "literal" ||
    target.call.paramsArg?.type !== "ObjectExpression"
  ) {
    throw new Error("anime.js animation is not statically editable");
  }
}

function locate(
  script: string,
  animationId: string,
): {
  parsed: ParsedAnimeJsAcornForWrite;
  target: ParsedAnimeJsAcornForWrite["located"][number];
} | null {
  const parsed = parseAnimeJsScriptAcornForWrite(script);
  const target = parsed?.located.find((entry) => entry.id === animationId);
  return parsed && target ? { parsed, target } : null;
}

function upsertProp(ms: MagicString, objectNode: Node, key: string, value: unknown): void {
  if (objectNode?.type !== "ObjectExpression") return;
  const prop = findAnimeJsPropertyNode(objectNode, key);
  if (prop) {
    ms.overwrite(prop.value.start, prop.value.end, valueToCode(value));
    return;
  }
  const entry = `${safeKey(key)}: ${valueToCode(value)}`;
  const props = objectNode.properties ?? [];
  if (props.length > 0) {
    const last = props[props.length - 1];
    ms.appendLeft(last.end, `, ${entry}`);
  } else {
    ms.appendLeft(objectNode.end - 1, entry);
  }
}

function findEnclosingExpressionStatement(ancestors: Node[]): Node | null {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    if (ancestors[i]?.type === "ExpressionStatement") return ancestors[i];
  }
  return null;
}

function findTimelineDeclarationStatement(parsed: ParsedAnimeJsAcornForWrite): Node | null {
  let found: Node = null;
  for (const statement of parsed.ast.body ?? []) {
    if (found) break;
    if (statement.type === "VariableDeclaration") {
      for (const decl of statement.declarations ?? []) {
        if (decl.id?.name === parsed.timelineVar) found = statement;
      }
    }
  }
  return found;
}

function findInsertionPoint(parsed: ParsedAnimeJsAcornForWrite): number | null {
  const timelineCalls = parsed.located.filter((entry) => entry.animation.method !== "animate");
  const last = timelineCalls[timelineCalls.length - 1];
  if (last) {
    const statement = findEnclosingExpressionStatement(last.call.ancestors);
    return statement?.end ?? last.call.node.end;
  }
  if (!parsed.hasTimeline) return null;
  return findTimelineDeclarationStatement(parsed)?.end ?? parsed.ast.end;
}

function buildParamsCode(anim: AnimeJsAnimationForInsert): string {
  const entries = Object.entries(anim.properties).map(
    ([key, value]) => `${safeKey(key)}: ${valueToCode(value)}`,
  );
  if (anim.duration !== undefined) entries.push(`duration: ${valueToCode(anim.duration)}`);
  if (anim.ease !== undefined) entries.push(`ease: ${valueToCode(anim.ease)}`);
  if (anim.delay !== undefined) entries.push(`delay: ${valueToCode(anim.delay)}`);
  if (anim.extras) {
    for (const [key, value] of Object.entries(anim.extras)) {
      entries.push(`${safeKey(key)}: ${valueToCode(value)}`);
    }
  }
  return `{ ${entries.join(", ")} }`;
}

function buildTimelineStatement(timelineVar: string, anim: AnimeJsAnimationForInsert): string {
  const target = valueToCode(anim.targetSelector);
  const params = buildParamsCode(anim);
  const method = anim.method === "animate" ? "add" : anim.method;
  const position = anim.position === undefined ? "" : `, ${valueToCode(anim.position)}`;
  return `${timelineVar}.${method}(${target}, ${params}${position});`;
}

export function updateAnimeJsAnimationInScript(
  script: string,
  animationId: string,
  updates: Partial<{
    targetSelector: string;
    duration: number | string;
    ease: string;
    delay: number | string;
    position: number | string;
  }>,
): string {
  if (!Object.keys(updates).length) return script;
  let result = script;
  if (updates.targetSelector !== undefined) {
    result = retargetAnimeJsAnimationInScript(result, animationId, updates.targetSelector);
  }
  const located = locate(result, animationId);
  if (!located) return result;
  assertEditable(located.target);
  const ms = new MagicString(result);
  if (updates.duration !== undefined)
    upsertProp(ms, located.target.call.paramsArg, "duration", updates.duration);
  if (updates.ease !== undefined)
    upsertProp(ms, located.target.call.paramsArg, "ease", updates.ease);
  if (updates.delay !== undefined)
    upsertProp(ms, located.target.call.paramsArg, "delay", updates.delay);
  if (updates.position !== undefined) {
    const posArg = located.target.call.positionArg;
    if (posArg) ms.overwrite(posArg.start, posArg.end, valueToCode(updates.position));
    else ms.appendLeft(located.target.call.node.end - 1, `, ${valueToCode(updates.position)}`);
  }
  return ms.toString();
}

export function updateAnimeJsAnimationPropertyInScript(
  script: string,
  animationId: string,
  property: string,
  value: AnimeJsPropertyValue,
): string {
  const located = locate(script, animationId);
  if (!located) return script;
  assertEditable(located.target);
  const ms = new MagicString(script);
  upsertProp(ms, located.target.call.paramsArg, property, value);
  return ms.toString();
}

export function updateAnimeJsAnimationPropertiesInScript(
  script: string,
  animationId: string,
  properties: Record<string, AnimeJsPropertyValue>,
): string {
  if (!Object.keys(properties).length) return script;
  const located = locate(script, animationId);
  if (!located) return script;
  assertEditable(located.target);
  const ms = new MagicString(script);
  for (const [property, value] of Object.entries(properties)) {
    upsertProp(ms, located.target.call.paramsArg, property, value);
  }
  return ms.toString();
}

export function retargetAnimeJsAnimationInScript(
  script: string,
  animationId: string,
  newSelector: string,
): string {
  const located = locate(script, animationId);
  if (!located) return script;
  assertEditable(located.target);
  const targetArg = located.target.call.targetArg;
  if (!targetArg || (targetArg.type !== "Literal" && targetArg.type !== "ArrayExpression")) {
    throw new Error("anime.js animation target is not statically editable");
  }
  const ms = new MagicString(script);
  ms.overwrite(targetArg.start, targetArg.end, valueToCode(newSelector));
  return ms.toString();
}

// fallow-ignore-next-line complexity
export function splitAnimeJsAnimationsInScript(
  script: string,
  opts: {
    originalId: string;
    newId: string;
    splitTime: number;
  },
): { script: string; skippedSelectors: string[] } {
  const parsed = parseAnimeJsScriptAcornForWrite(script);
  if (!parsed) return { script, skippedSelectors: [] };

  const originalSelector = `#${opts.originalId}`;
  const newSelector = `#${opts.newId}`;
  const skippedSelectors: string[] = [];
  const matching = parsed.located.filter((entry) => {
    const selector = entry.animation.targetSelector;
    if (selector !== originalSelector && selector.includes(opts.originalId)) {
      skippedSelectors.push(selector);
    }
    return selector === originalSelector;
  });
  if (matching.length === 0) return { script, skippedSelectors };

  let result = script;
  for (let index = matching.length - 1; index >= 0; index--) {
    const entry = matching[index];
    if (!entry) continue;
    const animation = entry.animation;
    const start =
      typeof animation.resolvedStart === "number"
        ? animation.resolvedStart / 1000
        : typeof animation.position === "number"
          ? animation.position / 1000
          : null;
    if (start === null) {
      skippedSelectors.push(`${originalSelector} (non-numeric anime position)`);
      continue;
    }
    const duration = typeof animation.duration === "number" ? animation.duration / 1000 : 0;
    if (start >= opts.splitTime) {
      result = retargetAnimeJsAnimationInScript(result, animation.id, newSelector);
    } else if (start + duration > opts.splitTime) {
      skippedSelectors.push(`${originalSelector} (anime tween spanning split)`);
    }
  }

  return { script: result, skippedSelectors };
}

export function addAnimeJsAnimationToScript(
  script: string,
  animation: AnimeJsAnimationForInsert,
): string {
  const parsed = parseAnimeJsScriptAcornForWrite(script);
  if (!parsed) return script;
  const insertionPoint = findInsertionPoint(parsed);
  if (insertionPoint === null) return script;
  const ms = new MagicString(script);
  ms.appendLeft(insertionPoint, `\n${buildTimelineStatement(parsed.timelineVar, animation)}`);
  return ms.toString();
}

function removeCallFromMagicString(ms: MagicString, call: AnimeJsCallInfo, script: string): void {
  const statement = findEnclosingExpressionStatement(call.ancestors);
  if (statement?.expression === call.node) {
    const end =
      statement.end < script.length && script[statement.end] === "\n"
        ? statement.end + 1
        : statement.end;
    ms.remove(statement.start, end);
    return;
  }
  if (call.node.callee?.object?.type === "CallExpression") {
    ms.remove(call.node.callee.object.end, call.node.end);
  }
}

export function removeAnimeJsAnimationFromScript(script: string, animationId: string): string {
  const located = locate(script, animationId);
  if (!located) return script;
  const ms = new MagicString(script);
  removeCallFromMagicString(ms, located.target.call, script);
  return ms.toString();
}

function propertyKeyframeArray(paramsArg: Node, property: string): Node | null {
  const prop = findAnimeJsPropertyNode(paramsArg, property);
  return prop?.value?.type === "ArrayExpression" ? prop.value : null;
}

function objectElements(arrayNode: Node): Node[] {
  return (arrayNode.elements ?? []).filter(
    (element: Node | null) => !!element && element.type === "ObjectExpression",
  );
}

export function updateAnimeJsPropertyKeyframeInScript(
  script: string,
  animationId: string,
  property: string,
  index: number,
  updates: Record<string, AnimeJsPropertyValue>,
): string {
  const located = locate(script, animationId);
  if (!located) return script;
  assertEditable(located.target);
  const arrayNode = propertyKeyframeArray(located.target.call.paramsArg, property);
  if (!arrayNode) throw new Error("anime.js property keyframes are not statically editable");
  const element = objectElements(arrayNode)[index];
  if (!element) throw new Error("anime.js property keyframe index not found");
  const ms = new MagicString(script);
  for (const [key, value] of Object.entries(updates)) {
    upsertProp(ms, element, key, value);
  }
  return ms.toString();
}
