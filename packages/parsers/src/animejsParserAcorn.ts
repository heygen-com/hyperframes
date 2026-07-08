// fallow-ignore-file code-duplication
/**
 * Browser-safe anime.js v4 read path — acorn + acorn-walk.
 *
 * Mirrors the GSAP acorn parser shape where it matters for Studio: static
 * selector/value resolution, source-located calls for MagicString writes,
 * timeline position/label resolution, and provenance-driven editability.
 */
import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";
import type {
  AnimeJsAnimation,
  AnimeJsMethod,
  AnimeJsPrimitive,
  AnimeJsPropertyKeyframe,
  AnimeJsPropertyValue,
  ParsedAnimeJs,
} from "./animeSerialize.js";
import { classifyAnimeJsTweenPropertyGroup } from "./animejsConstants.js";
export { editabilityForAnimeJsProvenance } from "./animeSerialize.js";
export type {
  AnimeJsAnimation,
  AnimeJsAnimationForInsert,
  AnimeJsKeyframeEditability,
  AnimeJsMethod,
  AnimeJsPrimitive,
  AnimeJsPropertyKeyframe,
  AnimeJsPropertyValue,
  AnimeJsProvenance,
  AnimeJsProvenanceKind,
  AnimeJsRawValue,
  ParsedAnimeJs,
} from "./animeSerialize.js";

type Node = any;

interface ScopeContext {
  primitives: Map<string, AnimeJsPrimitive>;
  nodes: Map<string, Node>;
}

type TargetBindings = Map<string, string[]>;
type TimelineRef = { kind: "identifier"; name: string } | { kind: "member"; node: Node };

interface TimelineDefaults {
  duration?: number | string;
  ease?: string;
  delay?: number | string;
}

interface TimelineDetection {
  timelineVar: string | null;
  ref: TimelineRef | null;
  timelineCount: number;
  defaults?: TimelineDefaults;
  declaration?: Node;
}

interface RegistrationInfo {
  idsByVar: Map<string, string[]>;
  labelsByVar: Map<string, Record<string, number>>;
  legacyRegistered: boolean;
}

export interface AnimeJsCallInfo {
  node: Node;
  ancestors: Node[];
  method: AnimeJsMethod;
  targetArg?: Node;
  paramsArg?: Node;
  positionArg?: Node;
  labelArg?: Node;
}

interface ParsedParams {
  properties: Record<string, AnimeJsPropertyValue>;
  propertyKeyframes?: Record<string, AnimeJsPropertyKeyframe[]>;
  duration?: number | string;
  ease?: string;
  delay?: number | string;
  extras?: Record<string, unknown>;
  dynamic: boolean;
}

export interface ParsedAnimeJsAcornForWrite {
  ast: Node;
  timelineVar: string;
  hasTimeline: boolean;
  located: Array<{ id: string; call: AnimeJsCallInfo; animation: AnimeJsAnimation }>;
}

const TIMELINE_METHODS = new Set(["add", "set", "label"]);
const QUERY_METHODS = new Set(["querySelector", "querySelectorAll"]);
const CALLBACK_KEYS = new Set(["onBegin", "onUpdate", "onComplete", "onLoop", "onRender"]);

function isObjectProperty(prop: Node): boolean {
  return prop?.type === "ObjectProperty" || prop?.type === "Property";
}

function propKeyName(prop: Node): string | undefined {
  return prop?.key?.name ?? prop?.key?.value;
}

export function findAnimeJsPropertyNode(objectNode: Node, key: string): Node | undefined {
  if (objectNode?.type !== "ObjectExpression") return undefined;
  for (const prop of objectNode.properties ?? []) {
    if (isObjectProperty(prop) && propKeyName(prop) === key) return prop;
  }
  return undefined;
}

function raw(source: string, node: Node): `__raw:${string}` {
  return `__raw:${source.slice(node.start, node.end)}`;
}

function parseAst(script: string): Node {
  return acorn.parse(script, {
    ecmaVersion: "latest",
    sourceType: "script",
    locations: true,
  });
}

// fallow-ignore-next-line complexity
function resolvePrimitive(node: Node, scope: ScopeContext): AnimeJsPrimitive | undefined {
  if (!node) return undefined;
  if (node.type === "Literal") {
    return typeof node.value === "number" ||
      typeof node.value === "string" ||
      typeof node.value === "boolean"
      ? node.value
      : undefined;
  }
  if (node.type === "TemplateLiteral" && node.expressions?.length === 0) {
    return node.quasis?.[0]?.value?.cooked;
  }
  if (node.type === "Identifier") return scope.primitives.get(node.name);
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const value = resolvePrimitive(node.argument, scope);
    return typeof value === "number" ? -value : undefined;
  }
  if (node.type === "BinaryExpression") {
    const left = resolvePrimitive(node.left, scope);
    const right = resolvePrimitive(node.right, scope);
    if (typeof left === "number" && typeof right === "number") {
      if (node.operator === "+") return left + right;
      if (node.operator === "-") return left - right;
      if (node.operator === "*") return left * right;
      if (node.operator === "/" && right !== 0) return left / right;
    }
    if (node.operator === "+" && (typeof left === "string" || typeof right === "string")) {
      return String(left ?? "") + String(right ?? "");
    }
  }
  if (node.type === "MemberExpression") return resolveMemberPrimitive(node, scope);
  return undefined;
}

function resolveMemberPrimitive(node: Node, scope: ScopeContext): AnimeJsPrimitive | undefined {
  const objectNode = constNodeFromExpression(node.object, scope);
  if (!objectNode) return undefined;
  const valueNode = memberValueNode(objectNode, node, scope);
  return valueNode ? resolvePrimitive(valueNode, scope) : undefined;
}

function constNodeFromExpression(node: Node, scope: ScopeContext): Node | undefined {
  if (!node) return undefined;
  if (node.type === "ArrayExpression" || node.type === "ObjectExpression") return node;
  if (node.type === "Identifier") return scope.nodes.get(node.name);
  if (node.type !== "MemberExpression") return undefined;
  const objectNode = constNodeFromExpression(node.object, scope);
  return objectNode ? memberValueNode(objectNode, node, scope) : undefined;
}

function memberValueNode(objectNode: Node, member: Node, scope: ScopeContext): Node | undefined {
  if (!member.computed) {
    return objectNode.type === "ObjectExpression"
      ? findAnimeJsPropertyNode(objectNode, member.property?.name ?? member.property?.value)?.value
      : undefined;
  }
  const index = resolvePrimitive(member.property, scope);
  if (objectNode.type === "ArrayExpression" && typeof index === "number") {
    return objectNode.elements?.[index];
  }
  if (
    objectNode.type === "ObjectExpression" &&
    (typeof index === "string" || typeof index === "number")
  ) {
    return findAnimeJsPropertyNode(objectNode, String(index))?.value;
  }
  return undefined;
}

function literalArray(node: Node, scope: ScopeContext): AnimeJsPrimitive[] | null {
  if (node?.type !== "ArrayExpression") return null;
  const values: AnimeJsPrimitive[] = [];
  for (const element of node.elements ?? []) {
    const value = resolvePrimitive(element, scope);
    if (value === undefined) return null;
    values.push(value);
  }
  return values;
}

function collectScope(ast: Node): ScopeContext {
  const scope: ScopeContext = { primitives: new Map(), nodes: new Map() };
  acornWalk.simple(ast, {
    VariableDeclarator(node: Node) {
      const name = node.id?.name;
      if (!name || !node.init) return;
      if (node.init.type === "ArrayExpression" || node.init.type === "ObjectExpression") {
        scope.nodes.set(name, node.init);
      }
      const value = resolvePrimitive(node.init, scope);
      if (value !== undefined) scope.primitives.set(name, value);
    },
  });
  return scope;
}

function selectorFromQueryCall(node: Node, scope: ScopeContext): string | null {
  if (node?.type !== "CallExpression") return null;
  const callee = node.callee;
  if (callee?.type !== "MemberExpression") return null;
  const method = callee.property?.name;
  const arg = resolvePrimitive(node.arguments?.[0], scope);
  if (typeof arg !== "string") return null;
  if (QUERY_METHODS.has(method)) return arg;
  if (method === "getElementById") return `#${arg}`;
  return null;
}

function targetsFromArrayNode(
  node: Node,
  scope: ScopeContext,
  bindings: TargetBindings,
): string[] | null {
  if (node?.type !== "ArrayExpression") return null;
  const targets: string[] = [];
  for (const element of node.elements ?? []) {
    const resolved = resolveTargets(element, scope, bindings);
    if (!resolved) return null;
    targets.push(...resolved);
  }
  return targets;
}

// fallow-ignore-next-line complexity
function resolveTargets(
  node: Node,
  scope: ScopeContext,
  bindings: TargetBindings,
): string[] | null {
  if (!node) return null;
  const primitive = resolvePrimitive(node, scope);
  if (typeof primitive === "string") return [primitive];
  if (node.type === "Identifier") {
    const bound = bindings.get(node.name);
    if (bound) return bound;
    const constNode = scope.nodes.get(node.name);
    return targetsFromArrayNode(constNode, scope, bindings);
  }
  if (node.type === "CallExpression") {
    const selector = selectorFromQueryCall(node, scope);
    return selector ? [selector] : null;
  }
  if (node.type === "ArrayExpression") return targetsFromArrayNode(node, scope, bindings);
  if (node.type === "MemberExpression" && node.object?.type === "Identifier") {
    return bindings.get(node.object.name) ?? null;
  }
  return null;
}

function collectTargetBindings(ast: Node, scope: ScopeContext): TargetBindings {
  const bindings: TargetBindings = new Map();
  acornWalk.simple(ast, {
    VariableDeclarator(node: Node) {
      const name = node.id?.name;
      if (!name) return;
      const targets = resolveTargets(node.init, scope, bindings);
      if (targets?.length) bindings.set(name, targets);
    },
    AssignmentExpression(node: Node) {
      const name = node.left?.type === "Identifier" ? node.left.name : undefined;
      if (!name) return;
      const targets = resolveTargets(node.right, scope, bindings);
      if (targets?.length) bindings.set(name, targets);
    },
  });
  return bindings;
}

function isAnimeTimelineCall(node: Node): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "anime" &&
    (node.callee.property?.name === "createTimeline" || node.callee.property?.name === "timeline")
  );
}

function isStaticMemberRef(node: Node): boolean {
  return (
    node?.type === "MemberExpression" &&
    !!(node.computed ? node.property?.value : node.property?.name)
  );
}

function sameMemberAccess(a: Node, b: Node): boolean {
  if (a?.type !== "MemberExpression" || b?.type !== "MemberExpression") return false;
  const aKey = a.computed ? a.property?.value : a.property?.name;
  const bKey = b.computed ? b.property?.value : b.property?.name;
  if (aKey !== bKey || aKey === undefined) return false;
  if (a.object?.type === "Identifier" && b.object?.type === "Identifier") {
    return a.object.name === b.object.name;
  }
  return sameMemberAccess(a.object, b.object);
}

function timelineRootSource(ref: TimelineRef, script: string): string {
  return ref.kind === "identifier" ? ref.name : script.slice(ref.node.start, ref.node.end);
}

function extractTimelineDefaults(
  callNode: Node,
  scope: ScopeContext,
): TimelineDefaults | undefined {
  const options = callNode.arguments?.[0];
  const defaultsNode = findAnimeJsPropertyNode(options, "defaults")?.value;
  if (defaultsNode?.type !== "ObjectExpression") return undefined;
  const defaults: TimelineDefaults = {};
  const duration = resolvePrimitive(
    findAnimeJsPropertyNode(defaultsNode, "duration")?.value,
    scope,
  );
  const ease = resolvePrimitive(findAnimeJsPropertyNode(defaultsNode, "ease")?.value, scope);
  const delay = resolvePrimitive(findAnimeJsPropertyNode(defaultsNode, "delay")?.value, scope);
  if (typeof duration === "number" || typeof duration === "string") defaults.duration = duration;
  if (typeof ease === "string") defaults.ease = ease;
  if (typeof delay === "number" || typeof delay === "string") defaults.delay = delay;
  return Object.keys(defaults).length ? defaults : undefined;
}

function findTimeline(ast: Node, scope: ScopeContext): TimelineDetection {
  let timelineVar: string | null = null;
  let ref: TimelineRef | null = null;
  let timelineCount = 0;
  let defaults: TimelineDefaults | undefined;
  let declaration: Node | undefined;
  acornWalk.simple(ast, {
    VariableDeclarator(node: Node) {
      if (!isAnimeTimelineCall(node.init)) return;
      timelineCount += 1;
      if (!ref && node.id?.type === "Identifier") {
        timelineVar = node.id.name;
        ref = { kind: "identifier", name: node.id.name };
        defaults = extractTimelineDefaults(node.init, scope);
        declaration = node;
      }
    },
    AssignmentExpression(node: Node) {
      if (!isAnimeTimelineCall(node.right)) return;
      timelineCount += 1;
      if (ref) return;
      if (node.left?.type === "Identifier") {
        timelineVar = node.left.name;
        ref = { kind: "identifier", name: node.left.name };
        defaults = extractTimelineDefaults(node.right, scope);
        declaration = node;
      } else if (isStaticMemberRef(node.left)) {
        ref = { kind: "member", node: node.left };
        defaults = extractTimelineDefaults(node.right, scope);
        declaration = node;
      }
    },
  });
  return { timelineVar, ref, timelineCount, defaults, declaration };
}

function objectHasName(node: Node, name: string): boolean {
  return node?.type === "Identifier" && node.name === name;
}

function isTimelineRootedCall(call: Node, ref: TimelineRef): boolean {
  let object = call.callee?.object;
  while (object?.type === "CallExpression") object = object.callee?.object;
  if (ref.kind === "identifier") return objectHasName(object, ref.name);
  return sameMemberAccess(object, ref.node);
}

function isAnimeAnimateCall(node: Node): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "anime" &&
    node.callee.property?.name === "animate"
  );
}

function collectCalls(ast: Node, ref: TimelineRef): AnimeJsCallInfo[] {
  const calls: AnimeJsCallInfo[] = [];
  function visit(node: Node, ancestors: Node[]): void {
    if (!node || typeof node !== "object") return;
    const nextAncestors = [...ancestors, node];
    if (node.type === "CallExpression") {
      const callee = node.callee;
      const methodName = callee?.property?.name;
      if (
        callee?.type === "MemberExpression" &&
        TIMELINE_METHODS.has(methodName) &&
        isTimelineRootedCall(node, ref)
      ) {
        const method = methodName === "add" || methodName === "set" ? methodName : "label";
        calls.push({
          node,
          ancestors: nextAncestors,
          method,
          targetArg: method === "label" ? undefined : node.arguments?.[0],
          paramsArg: method === "label" ? undefined : node.arguments?.[1],
          positionArg: method === "label" ? node.arguments?.[1] : node.arguments?.[2],
          labelArg: method === "label" ? node.arguments?.[0] : undefined,
        });
      } else if (isAnimeAnimateCall(node)) {
        calls.push({
          node,
          ancestors: nextAncestors,
          method: "animate",
          targetArg: node.arguments?.[0],
          paramsArg: node.arguments?.[1],
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) visit(item, nextAncestors);
      } else if (child && typeof child === "object" && typeof child.type === "string") {
        visit(child, nextAncestors);
      }
    }
  }
  visit(ast, []);
  calls.sort((a, b) => a.node.start - b.node.start);
  return calls;
}

function isAnimeStaggerCall(node: Node): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "anime" &&
    node.callee.property?.name === "stagger"
  );
}

function propertyValueFromNode(
  node: Node,
  scope: ScopeContext,
  source: string,
): { value: AnimeJsPropertyValue; dynamic: boolean } {
  if (isAnimeStaggerCall(node)) return { value: raw(source, node), dynamic: true };
  const primitive = resolvePrimitive(node, scope);
  if (primitive !== undefined) return { value: primitive, dynamic: false };
  const array = literalArray(node, scope);
  if (array) return { value: array, dynamic: false };
  return { value: raw(source, node), dynamic: true };
}

function parsePropertyKeyframe(
  node: Node,
  scope: ScopeContext,
  source: string,
): { keyframe: AnimeJsPropertyKeyframe; dynamic: boolean } {
  const keyframe: AnimeJsPropertyKeyframe = {};
  const extras: Record<string, unknown> = {};
  let dynamic = false;
  for (const prop of node.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    if (!key) continue;
    const value = resolvePrimitive(prop.value, scope);
    if ((key === "from" || key === "to") && value !== undefined) keyframe[key] = value;
    else if ((key === "duration" || key === "delay") && typeof value === "number") {
      keyframe[key] = value;
    } else if (key === "ease" && typeof value === "string") keyframe.ease = value;
    else {
      extras[key] = raw(source, prop.value);
      dynamic = true;
    }
  }
  if (Object.keys(extras).length) keyframe.extras = extras;
  return { keyframe, dynamic };
}

function parsePropertyKeyframeArray(
  node: Node,
  scope: ScopeContext,
  source: string,
): { keyframes: AnimeJsPropertyKeyframe[]; dynamic: boolean } | null {
  if (node?.type !== "ArrayExpression") return null;
  const elements = (node.elements ?? []).filter((element: Node | null) => !!element);
  if (!elements.length || !elements.every((element: Node) => element.type === "ObjectExpression")) {
    return null;
  }
  const keyframes: AnimeJsPropertyKeyframe[] = [];
  let dynamic = false;
  for (const element of elements) {
    const parsed = parsePropertyKeyframe(element, scope, source);
    keyframes.push(parsed.keyframe);
    dynamic ||= parsed.dynamic;
  }
  return { keyframes, dynamic };
}

function collectDerivedDuration(
  propertyKeyframes: Record<string, AnimeJsPropertyKeyframe[]>,
): number | undefined {
  let max = 0;
  for (const keyframes of Object.values(propertyKeyframes)) {
    const total = keyframes.reduce((sum, keyframe) => sum + (keyframe.duration ?? 0), 0);
    max = Math.max(max, total);
  }
  return max > 0 ? max : undefined;
}

function collectDerivedEase(
  propertyKeyframes: Record<string, AnimeJsPropertyKeyframe[]>,
): string | undefined {
  for (const keyframes of Object.values(propertyKeyframes)) {
    for (let i = keyframes.length - 1; i >= 0; i--) {
      const ease = keyframes[i]?.ease;
      if (ease) return ease;
    }
  }
  return undefined;
}

// fallow-ignore-next-line complexity
function parseParams(node: Node, scope: ScopeContext, source: string): ParsedParams {
  const parsed: ParsedParams = { properties: {}, dynamic: false };
  const propertyKeyframes: Record<string, AnimeJsPropertyKeyframe[]> = {};
  const extras: Record<string, unknown> = {};
  if (node?.type !== "ObjectExpression") {
    parsed.dynamic = true;
    return parsed;
  }
  for (const prop of node.properties ?? []) {
    if (!isObjectProperty(prop)) {
      parsed.dynamic = true;
      continue;
    }
    const key = propKeyName(prop);
    if (!key) continue;
    const value = resolvePrimitive(prop.value, scope);
    if (key === "duration" && (typeof value === "number" || typeof value === "string")) {
      parsed.duration = value;
      continue;
    }
    if (key === "ease" && typeof value === "string") {
      parsed.ease = value;
      continue;
    }
    if (key === "delay" && (typeof value === "number" || typeof value === "string")) {
      parsed.delay = value;
      continue;
    }
    if (CALLBACK_KEYS.has(key)) {
      extras[key] = raw(source, prop.value);
      continue;
    }
    const kfArray = parsePropertyKeyframeArray(prop.value, scope, source);
    if (kfArray) {
      propertyKeyframes[key] = kfArray.keyframes;
      parsed.dynamic ||= kfArray.dynamic;
      continue;
    }
    const property = propertyValueFromNode(prop.value, scope, source);
    parsed.properties[key] = property.value;
    if (property.dynamic) {
      extras[key] = property.value;
      parsed.dynamic = true;
    }
  }
  if (Object.keys(propertyKeyframes).length) {
    parsed.propertyKeyframes = propertyKeyframes;
    parsed.duration ??= collectDerivedDuration(propertyKeyframes);
    parsed.ease ??= collectDerivedEase(propertyKeyframes);
  }
  if (Object.keys(extras).length) parsed.extras = extras;
  return parsed;
}

function assignedName(call: AnimeJsCallInfo): string | undefined {
  for (let i = call.ancestors.length - 2; i >= 0; i--) {
    const parent = call.ancestors[i];
    if (parent?.type === "VariableDeclarator" && parent.init === call.node) return parent.id?.name;
    if (parent?.type === "AssignmentExpression" && parent.right === call.node) {
      return parent.left?.type === "Identifier" ? parent.left.name : undefined;
    }
  }
  return undefined;
}

function collectLabelsFromObject(node: Node, scope: ScopeContext): Record<string, number> {
  const labels: Record<string, number> = {};
  if (node?.type !== "ObjectExpression") return labels;
  for (const prop of node.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    const value = resolvePrimitive(prop.value, scope);
    if (key && typeof value === "number") labels[key] = value * 1000;
  }
  return labels;
}

function collectRegistrations(ast: Node, scope: ScopeContext): RegistrationInfo {
  const info: RegistrationInfo = {
    idsByVar: new Map(),
    labelsByVar: new Map(),
    legacyRegistered: false,
  };
  acornWalk.simple(ast, {
    CallExpression(node: Node) {
      const callee = node.callee;
      if (
        callee?.type === "MemberExpression" &&
        callee.object?.type === "Identifier" &&
        callee.object.name === "hyperframesAnime" &&
        callee.property?.name === "register"
      ) {
        const id = resolvePrimitive(node.arguments?.[0], scope);
        const instance = node.arguments?.[1];
        const varName = instance?.type === "Identifier" ? instance.name : undefined;
        if (typeof id === "string" && varName) {
          const ids = info.idsByVar.get(varName) ?? [];
          ids.push(id);
          info.idsByVar.set(varName, ids);
          const labels = collectLabelsFromObject(
            findAnimeJsPropertyNode(node.arguments?.[2], "labels")?.value,
            scope,
          );
          if (Object.keys(labels).length) info.labelsByVar.set(varName, labels);
        }
      }
      if (
        callee?.type === "MemberExpression" &&
        callee.property?.name === "push" &&
        callee.object?.type === "MemberExpression" &&
        callee.object.property?.name === "__hfAnime"
      ) {
        info.legacyRegistered = true;
      }
    },
    AssignmentExpression(node: Node) {
      if (node.left?.type === "MemberExpression" && node.left.property?.name === "__hfAnime") {
        info.legacyRegistered = true;
      }
    },
  });
  return info;
}

function positionValue(node: Node, scope: ScopeContext): number | string | undefined {
  const value = resolvePrimitive(node, scope);
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function callToAnimation(
  call: AnimeJsCallInfo,
  scope: ScopeContext,
  bindings: TargetBindings,
  source: string,
  defaults: TimelineDefaults | undefined,
  registrations: RegistrationInfo,
  timelineVar: string,
): Omit<AnimeJsAnimation, "id"> {
  if (call.method === "label") {
    const name = resolvePrimitive(call.labelArg, scope);
    const position = positionValue(call.positionArg, scope) ?? 0;
    return {
      engine: "animejs",
      targetSelector: "",
      targets: [],
      method: "label",
      position,
      properties: {},
      duration: 0,
      label: typeof name === "string" ? name : "__unresolved__",
      registered: registrations.legacyRegistered || registrations.idsByVar.has(timelineVar),
    };
  }
  const targets = resolveTargets(call.targetArg, scope, bindings);
  const parsed = parseParams(call.paramsArg, scope, source);
  parsed.duration ??= defaults?.duration;
  parsed.ease ??= defaults?.ease;
  parsed.delay ??= defaults?.delay;
  if (call.method === "set") parsed.duration = 0;
  const varName = call.method === "animate" ? assignedName(call) : timelineVar;
  const registered =
    registrations.legacyRegistered || (varName ? registrations.idsByVar.has(varName) : false);
  const targetSelector = targets?.join(", ") ?? "__unresolved__";
  const sourceRange: [number, number] = [call.node.start, call.node.end];
  const provenance =
    !targets || parsed.dynamic
      ? { kind: "runtime-dynamic" as const, sourceRange }
      : { kind: "literal" as const, sourceRange };
  return {
    engine: "animejs",
    targetSelector,
    targets: targets ?? [],
    method: call.method,
    position: positionValue(call.positionArg, scope) ?? 0,
    implicitPosition: call.positionArg === undefined && call.method !== "animate",
    properties: parsed.properties,
    propertyKeyframes: parsed.propertyKeyframes,
    duration: parsed.duration,
    ease: parsed.ease,
    delay: parsed.delay,
    extras: parsed.extras,
    registered,
    hasUnresolvedSelector: !targets,
    hasUnresolvedProperties: parsed.dynamic && call.paramsArg?.type !== "ObjectExpression",
    propertyGroup: classifyAnimeJsTweenPropertyGroup({
      ...parsed.properties,
      ...(parsed.propertyKeyframes ?? {}),
    }),
    provenance,
  };
}

function resolvePositionString(pos: string, cursor: number, prevStart: number): number | null {
  const trimmed = pos.trim();
  if (trimmed.startsWith("+=")) {
    const value = Number.parseFloat(trimmed.slice(2));
    return Number.isFinite(value) ? cursor + value : null;
  }
  if (trimmed.startsWith("-=")) {
    const value = Number.parseFloat(trimmed.slice(2));
    return Number.isFinite(value) ? cursor - value : null;
  }
  if (trimmed === "<") return prevStart;
  if (trimmed === ">") return cursor;
  if (trimmed.startsWith("<")) {
    const value = Number.parseFloat(trimmed.slice(1));
    return Number.isFinite(value) ? prevStart + value : null;
  }
  if (trimmed.startsWith(">")) {
    const value = Number.parseFloat(trimmed.slice(1));
    return Number.isFinite(value) ? cursor + value : null;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
}

function resolveLabelPosition(
  pos: string,
  labels: Map<string, number>,
  cursor: number,
): number | null {
  const match = /^([A-Za-z_$][\w$]*)\s*(?:([+-])=\s*([\d.]+))?$/.exec(pos.trim());
  if (!match) return null;
  const name = match[1];
  if (!name) return null;
  const base = labels.get(name) ?? cursor;
  if (!labels.has(name)) labels.set(name, base);
  if (match[2] && match[3]) {
    const value = Number.parseFloat(match[3]);
    if (Number.isFinite(value)) return match[2] === "+" ? base + value : base - value;
  }
  return base;
}

function resolveTimelinePositions(anims: Omit<AnimeJsAnimation, "id">[]): Record<string, number> {
  let cursor = 0;
  let prevStart = 0;
  const labels = new Map<string, number>();
  for (const anim of anims) {
    let start: number | null;
    if (anim.method === "label") {
      if (typeof anim.position === "number") start = anim.position;
      else start = resolveLabelPosition(anim.position, labels, cursor) ?? cursor;
      labels.set(anim.label ?? "__unresolved__", Math.max(0, start));
      anim.resolvedStart = Math.max(0, start);
      continue;
    }
    if (anim.implicitPosition) start = cursor;
    else if (typeof anim.position === "number") start = anim.position;
    else
      start =
        resolveLabelPosition(anim.position, labels, cursor) ??
        resolvePositionString(anim.position, cursor, prevStart);
    if (start == null) start = cursor;
    anim.resolvedStart = Math.max(0, start);
    prevStart = anim.resolvedStart;
    const duration = typeof anim.duration === "number" ? anim.duration : 0;
    cursor = Math.max(cursor, anim.resolvedStart + duration);
  }
  const result: Record<string, number> = {};
  for (const [name, position] of labels) result[name] = position;
  return result;
}

function assignStableIds(anims: Omit<AnimeJsAnimation, "id">[]): AnimeJsAnimation[] {
  const counts = new Map<string, number>();
  return anims.map((anim) => {
    const posKey =
      typeof anim.position === "number" ? String(Math.round(anim.position)) : anim.position;
    const labelPart = anim.method === "label" ? anim.label : anim.targetSelector;
    const group = anim.propertyGroup ? `-${anim.propertyGroup}` : "";
    const base = `${labelPart}-${anim.method}-${posKey}${group}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return { ...anim, id: count === 1 ? base : `${base}-${count}` };
  });
}

function mergeRegisteredLabels(
  labels: Record<string, number>,
  registrations: RegistrationInfo,
  timelineVar: string,
): Record<string, number> {
  const merged: Record<string, number> = { ...labels };
  const registeredLabels = registrations.labelsByVar.get(timelineVar);
  if (!registeredLabels) return merged;
  for (const [name, position] of Object.entries(registeredLabels)) {
    if (merged[name] === undefined) merged[name] = position;
  }
  return merged;
}

function postambleAfterLastCall(script: string, calls: AnimeJsCallInfo[]): string {
  const last = calls[calls.length - 1];
  if (!last) return "";
  const semicolon = script.indexOf(";", last.node.end);
  const end = semicolon === -1 ? last.node.end : semicolon + 1;
  return script.slice(end).trim();
}

function parseInternal(script: string): {
  ast: Node;
  detection: TimelineDetection;
  timelineVar: string;
  calls: AnimeJsCallInfo[];
  animations: AnimeJsAnimation[];
  labels: Record<string, number>;
  registrations: RegistrationInfo;
} | null {
  try {
    const ast = parseAst(script);
    const scope = collectScope(ast);
    const bindings = collectTargetBindings(ast, scope);
    const detection = findTimeline(ast, scope);
    const ref = detection.ref ?? { kind: "identifier", name: "tl" };
    const calls = collectCalls(ast, ref);
    const firstAnimateVar = calls.find((call) => call.method === "animate");
    const timelineVar =
      detection.ref === null && firstAnimateVar
        ? (assignedName(firstAnimateVar) ?? "tl")
        : timelineRootSource(ref, script);
    const registrations = collectRegistrations(ast, scope);
    const rawAnims = calls.map((call) =>
      callToAnimation(
        call,
        scope,
        bindings,
        script,
        detection.defaults,
        registrations,
        timelineVar,
      ),
    );
    const labels = mergeRegisteredLabels(
      resolveTimelinePositions(rawAnims),
      registrations,
      timelineVar,
    );
    const animations = assignStableIds(rawAnims);
    return { ast, detection, timelineVar, calls, animations, labels, registrations };
  } catch {
    return null;
  }
}

export function parseAnimeJsScriptAcornForWrite(script: string): ParsedAnimeJsAcornForWrite | null {
  const parsed = parseInternal(script);
  if (!parsed) return null;
  return {
    ast: parsed.ast,
    timelineVar: parsed.timelineVar,
    hasTimeline: parsed.detection.ref !== null,
    located: parsed.calls.map((call, index) => ({
      id: parsed.animations[index]!.id,
      call,
      animation: parsed.animations[index]!,
    })),
  };
}

export function parseAnimeJsScriptAcorn(script: string): ParsedAnimeJs {
  const parsed = parseInternal(script);
  if (!parsed) {
    return {
      engine: "animejs",
      animations: [],
      timelineVar: "tl",
      preamble: "",
      postamble: "",
      labels: {},
      registered: false,
      registrationIds: [],
    };
  }
  const registrationIds = [...new Set([...parsed.registrations.idsByVar.values()].flat())];
  const registered = parsed.registrations.legacyRegistered || registrationIds.length > 0;
  const preamble =
    parsed.detection.declaration && parsed.detection.declaration.end
      ? script.slice(0, parsed.detection.declaration.end)
      : parsed.detection.ref
        ? script.slice(
            0,
            parsed.detection.ref.kind === "identifier"
              ? parsed.detection.ref.name.length
              : parsed.detection.ref.node.end,
          )
        : "";
  const result: ParsedAnimeJs = {
    engine: "animejs",
    animations: parsed.animations,
    timelineVar: parsed.timelineVar,
    preamble,
    postamble: postambleAfterLastCall(script, parsed.calls),
    labels: parsed.labels,
    registered,
    registrationIds,
  };
  if (parsed.detection.timelineCount > 1) result.multipleTimelines = true;
  if (parsed.detection.timelineCount > 0 && parsed.detection.ref === null)
    result.unsupportedTimelinePattern = true;
  return result;
}

export interface AnimeJsLabelEntry {
  name: string;
  position: number;
}

export function extractAnimeJsLabels(script: string): AnimeJsLabelEntry[] {
  const parsed = parseInternal(script);
  if (!parsed) return [];
  return parsed.animations
    .filter((anim) => anim.method === "label" && typeof anim.label === "string")
    .map((anim) => ({ name: anim.label ?? "", position: anim.resolvedStart ?? 0 }));
}
