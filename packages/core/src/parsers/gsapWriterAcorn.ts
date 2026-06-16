// fallow-ignore-file code-duplication
/**
 * Browser-safe GSAP write path — magic-string offset-splice.
 *
 * T6c: edits GSAP scripts by overwriting/removing byte ranges in the original
 * source. Every byte outside the edited span is preserved verbatim — no
 * pretty-printer churn. Consumes ParsedGsapAcornForWrite from gsapParserAcorn.ts.
 */
import MagicString from "magic-string";
import { serializeValue, safeJsKey, type GsapAnimation } from "./gsapSerialize.js";
import {
  parseGsapScriptAcornForWrite,
  type ParsedGsapAcornForWrite,
  type TweenCallInfo,
} from "./gsapParserAcorn.js";
import * as acornWalk from "acorn-walk";

// ── Code generation helpers ──────────────────────────────────────────────────

// Local serializer for the tween-statement path, which may carry boolean/object
// extras (stagger config). serializeValue stringifies objects to "[object
// Object]", so keep this richer JSON fallback for that path. Keyframe values are
// always number|string and use the shared serializeValue (recast parity).
function valueToCode(value: unknown): string {
  if (typeof value === "string" && value.startsWith("__raw:")) return value.slice(6);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isNaN(value) ? "0" : String(value);
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function safeKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

// fallow-ignore-next-line complexity
function buildTweenStatementCode(timelineVar: string, anim: Omit<GsapAnimation, "id">): string {
  const selector = JSON.stringify(anim.targetSelector);
  const props: Record<string, number | string> = { ...anim.properties };
  if (anim.method !== "set" && anim.duration !== undefined) props.duration = anim.duration;
  if (anim.ease) props.ease = anim.ease;
  const entries = Object.entries(props).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  if (anim.extras) {
    for (const [k, v] of Object.entries(anim.extras)) {
      entries.push(`${safeKey(k)}: ${valueToCode(v)}`);
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
    return `${timelineVar}.fromTo(${selector}, { ${fromEntries.join(", ")} }, ${objCode}, ${posCode});`;
  }
  return `${timelineVar}.${anim.method}(${selector}, ${objCode}, ${posCode});`;
}

// ── AST node helpers ─────────────────────────────────────────────────────────

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
    if (propKeyName(prop) === key) return prop;
  }
  return undefined;
}

function findEnclosingExpressionStatement(ancestors: any[]): any | null {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    if (ancestors[i]?.type === "ExpressionStatement") return ancestors[i];
  }
  return null;
}

/** Find the VariableDeclaration statement for `tl = gsap.timeline(...)`. */
function findTimelineDeclarationStatement(ast: any, timelineVar: string): any | null {
  let found: any = null;
  acornWalk.simple(ast, {
    // fallow-ignore-next-line complexity
    VariableDeclaration(node: any) {
      if (found) return;
      for (const decl of node.declarations ?? []) {
        if (
          decl.id?.name === timelineVar &&
          decl.init?.type === "CallExpression" &&
          decl.init.callee?.type === "MemberExpression" &&
          decl.init.callee.object?.name === "gsap" &&
          decl.init.callee.property?.name === "timeline"
        ) {
          found = node;
        }
      }
    },
  });
  return found;
}

// ── Property splice helpers ───────────────────────────────────────────────────

/**
 * Remove a property from a properties array, handling its comma.
 * `editableProps` must be the isObjectProperty-filtered subset in source order.
 */
function removeProp(ms: MagicString, propNode: any, editableProps: any[]): void {
  const idx = editableProps.indexOf(propNode);
  if (idx === -1) return;
  if (editableProps.length === 1) {
    ms.remove(propNode.start, propNode.end);
  } else if (idx === 0) {
    // First prop: remove from its start to next prop start (drops trailing ", ")
    ms.remove(editableProps[0].start, editableProps[1].start);
  } else {
    // Non-first: remove from prev prop end to this prop end (drops leading ", ")
    ms.remove(editableProps[idx - 1].end, propNode.end);
  }
}

/**
 * Update a property value if it exists, or append a new key: val before the
 * closing `}`. Call with the full ObjectExpression node.
 */
function upsertProp(ms: MagicString, objNode: any, key: string, value: unknown): void {
  if (objNode?.type !== "ObjectExpression") return;
  const existing = findPropertyNode(objNode, key);
  if (existing) {
    ms.overwrite(existing.value.start, existing.value.end, valueToCode(value));
  } else {
    const sep = objNode.properties.length > 0 ? ", " : "";
    ms.appendLeft(objNode.end - 1, `${sep}${safeKey(key)}: ${valueToCode(value)}`);
  }
}

/**
 * Vars keys that are NOT editable transform/style props: builtins
 * (duration/ease/delay), dropped callbacks, and extras (stagger/yoyo/repeat/…).
 * The exact union of recast's BUILTIN_VAR_KEYS + DROPPED_VAR_KEYS + EXTRAS_KEYS,
 * so both writers classify vars keys identically. (Distinct from the keyframe-
 * conversion NON_EDITABLE_VAR_KEYS below, which intentionally omits `ease`
 * because that path re-emits ease separately.)
 */
const NON_EDITABLE_PROP_KEYS = new Set([
  "duration",
  "ease",
  "delay",
  "onComplete",
  "onStart",
  "onUpdate",
  "onRepeat",
  "stagger",
  "yoyo",
  "repeat",
  "repeatDelay",
  "snap",
  "overwrite",
  "immediateRender",
]);

/**
 * Editable transform/style key test: anything NOT a builtin, dropped callback, or
 * extras key. Mirrors recast's isEditablePropertyKey so both writers classify
 * vars keys identically.
 */
function isEditableVarKey(key: string): boolean {
  return !NON_EDITABLE_PROP_KEYS.has(key);
}

/**
 * Collect verbatim `key: value` entries to PRESERVE from a vars/keyframe
 * ObjectExpression: every property whose key `drop` does not reject, sliced from
 * source — except keys present in `overrides`, whose value is replaced. Returns
 * the entries plus the set of keys it kept, so callers can append new keys.
 */
function preservedEntries(
  objNode: any,
  source: string,
  drop: (key: string) => boolean,
  overrides: Record<string, unknown>,
): { entries: string[]; keys: Set<string> } {
  const entries: string[] = [];
  const keys = new Set<string>();
  for (const prop of objNode.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    if (typeof key !== "string" || drop(key)) continue;
    keys.add(key);
    const code =
      key in overrides
        ? valueToCode(overrides[key])
        : source.slice(prop.value.start, prop.value.end);
    entries.push(`${safeKey(key)}: ${code}`);
  }
  return { entries, keys };
}

/**
 * Replace the editable-property keys on a vars ObjectExpression with exactly
 * `newProps`, leaving non-editable keys (duration/ease/stagger/callbacks/…)
 * untouched unless overridden in `nonEditableOverrides`. Mirrors recast's
 * reconcileEditableProperties: editable keys absent from `newProps` are DROPPED,
 * not merged. Rebuilt in a single ms.overwrite so the splice can never overlap a
 * sibling edit — non-editable updates that also target this node (duration/ease/
 * extras) are folded into the same rebuild rather than spliced separately.
 */
function reconcileEditableProps(
  ms: MagicString,
  objNode: any,
  source: string,
  newProps: Record<string, number | string>,
  nonEditableOverrides?: Record<string, unknown>,
): void {
  if (objNode?.type !== "ObjectExpression") return;
  const overrides = nonEditableOverrides ?? {};
  const { entries, keys } = preservedEntries(objNode, source, isEditableVarKey, overrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (!keys.has(key)) entries.push(`${safeKey(key)}: ${valueToCode(value)}`);
  }
  for (const [key, value] of Object.entries(newProps)) {
    entries.push(`${safeKey(key)}: ${valueToCode(value)}`);
  }
  ms.overwrite(objNode.start, objNode.end, `{ ${entries.join(", ")} }`);
}

// ── Insertion helpers ─────────────────────────────────────────────────────────

/** Traverse callee.object chain to check if a call ultimately roots at timelineVar. */
function isTimelineRooted(node: any, timelineVar: string): boolean {
  if (node?.type === "Identifier") return node.name === timelineVar;
  if (node?.type === "CallExpression") return isTimelineRooted(node.callee?.object, timelineVar);
  return false;
}

/**
 * Find the byte offset after which to insert a new statement (tween or label).
 * Returns null when no timeline declaration exists in the script — callers must
 * not emit `tl.xxx()` calls in that case as `tl` would be undefined at render.
 */
function findInsertionPoint(parsed: ParsedGsapAcornForWrite): number | null {
  if (parsed.located.length > 0) {
    const lastCall = parsed.located[parsed.located.length - 1]!.call;
    const exprStmt = findEnclosingExpressionStatement(lastCall.ancestors);
    return exprStmt?.end ?? lastCall.node.end;
  }
  if (!parsed.hasTimeline) return null;
  const tlDecl = findTimelineDeclarationStatement(parsed.ast, parsed.timelineVar);
  return tlDecl?.end ?? (parsed.ast.end as number);
}

// ── Public write API ─────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function updateAnimationInScript(
  script: string,
  animationId: string,
  updates: Partial<GsapAnimation>,
): string {
  if (!Object.keys(updates).length) return script;
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const ms = new MagicString(script);
  const { call }: { call: TweenCallInfo } = target;

  // When `properties` is present we REPLACE the editable set (recast parity:
  // editable keys absent from the update are dropped). Fold any concurrent
  // non-editable updates (duration/ease/extras) into the single varsArg rebuild
  // so their splices can't overlap the rebuild's overwrite of the whole node.
  if (updates.properties) {
    const overrides: Record<string, unknown> = {};
    if (updates.duration !== undefined) overrides.duration = updates.duration;
    if (updates.ease !== undefined) overrides.ease = updates.ease;
    if (updates.extras) Object.assign(overrides, updates.extras);
    reconcileEditableProps(ms, call.varsArg, script, updates.properties, overrides);
  } else {
    if (updates.duration !== undefined) {
      upsertProp(ms, call.varsArg, "duration", updates.duration);
    }
    if (updates.ease !== undefined) {
      upsertProp(ms, call.varsArg, "ease", updates.ease);
    }
    if (updates.extras) {
      for (const [key, value] of Object.entries(updates.extras)) {
        upsertProp(ms, call.varsArg, key, value);
      }
    }
  }

  if (updates.fromProperties && call.method === "fromTo" && call.fromArg) {
    // fromTo's from-vars carry only editable props — REPLACE them too (recast
    // parity). fromArg is a distinct node from varsArg, so this rebuild never
    // overlaps the varsArg edits above.
    reconcileEditableProps(ms, call.fromArg, script, updates.fromProperties);
  }

  if (updates.position !== undefined) {
    const posIdx = call.method === "fromTo" ? 3 : 2;
    const posArgNode = call.node.arguments?.[posIdx];
    if (posArgNode) {
      ms.overwrite(posArgNode.start, posArgNode.end, valueToCode(updates.position));
    } else {
      ms.appendLeft(call.node.end - 1, `, ${valueToCode(updates.position)}`);
    }
  }

  return ms.toString();
}

export function addAnimationToScript(
  script: string,
  animation: Omit<GsapAnimation, "id">,
): { script: string; id: string } {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return { script, id: "" };

  const insertionPoint = findInsertionPoint(parsed);
  if (insertionPoint === null) return { script, id: "" };

  const ms = new MagicString(script);
  const statementCode = buildTweenStatementCode(parsed.timelineVar, animation);
  ms.appendLeft(insertionPoint, "\n" + statementCode);

  const result = ms.toString();
  const reParsed = parseGsapScriptAcornForWrite(result);
  const newId = reParsed?.located[reParsed.located.length - 1]?.id ?? "";
  return { script: result, id: newId };
}

export function removeAnimationFromScript(script: string, animationId: string): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const ms = new MagicString(script);
  const N = target.call.node;
  const exprStmt = findEnclosingExpressionStatement(target.call.ancestors);

  if (N.callee?.object?.type !== "CallExpression" && exprStmt?.expression === N) {
    // Standalone `tl.method(...)` — remove the whole ExpressionStatement
    const end =
      exprStmt.end < script.length && script[exprStmt.end] === "\n"
        ? exprStmt.end + 1
        : exprStmt.end;
    ms.remove(exprStmt.start, end);
  } else {
    // Chain link — splice out `.method(args)` from N.callee.object.end to N.end
    ms.remove(N.callee.object.end, N.end);
  }

  return ms.toString();
}

// ── Flat-tween → keyframes conversion ──────────────────────────────────────────
//
// Mirror recast's convertToKeyframesInScript: when the first keyframe op lands
// on a flat to()/from()/fromTo() tween, rewrite its vars object to
// `{ keyframes: { "0%": {from}, "100%": {to} }, <preserved non-editable keys>,
// ease: "none"? }` and convert from()/fromTo() to to(). We rebuild the whole
// vars ObjectExpression in one ms.overwrite (single-edit-per-node), so the next
// keyframe-add re-parses cleanly.

// Identity value for an editable transform/style prop (recast's CSS_IDENTITY).
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

// Keys NOT in the editable set — preserved verbatim on the converted vars object
// (matches the parser's classification: builtin/dropped/extras keys).
const NON_EDITABLE_VAR_KEYS = new Set([
  "duration",
  "delay",
  "onComplete",
  "onStart",
  "onUpdate",
  "onRepeat",
  "stagger",
  "yoyo",
  "repeat",
  "repeatDelay",
  "snap",
  "overwrite",
  "immediateRender",
]);

/** The CSS-identity counterpart of a props record (numbers → identity value). */
function identityProps(
  properties: Record<string, number | string>,
): Record<string, number | string> {
  const identity: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v != null) identity[k] = typeof v === "number" ? cssIdentityValue(k) : v;
  }
  return identity;
}

/** Resolve the 0%/100% endpoint records for a tween being converted. */
function conversionEndpoints(animation: GsapAnimation): {
  fromProps: Record<string, number | string>;
  toProps: Record<string, number | string>;
} {
  if (animation.method === "from") {
    return { fromProps: { ...animation.properties }, toProps: identityProps(animation.properties) };
  }
  if (animation.method === "fromTo") {
    return {
      fromProps: { ...(animation.fromProperties ?? {}) },
      toProps: { ...animation.properties },
    };
  }
  // to(): 0% is the CSS identity state, 100% is the authored props.
  return { fromProps: identityProps(animation.properties), toProps: { ...animation.properties } };
}

/** Collect preserved (non-editable) `key: value` entries from the original vars node. */
function preservedVarsEntries(varsNode: any, source: string): string[] {
  const entries: string[] = [];
  if (varsNode?.type !== "ObjectExpression") return entries;
  for (const prop of varsNode.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    if (typeof key !== "string" || !NON_EDITABLE_VAR_KEYS.has(key)) continue;
    entries.push(`${safeKey(key)}: ${source.slice(prop.value.start, prop.value.end)}`);
  }
  return entries;
}

/** Build the rebuilt vars-object code for a converted flat tween. */
function buildConvertedVarsCode(animation: GsapAnimation, varsNode: any, source: string): string {
  const { fromProps, toProps } = conversionEndpoints(animation);
  const easeEach = animation.ease;
  const easeEachEntry = easeEach ? `, easeEach: ${JSON.stringify(easeEach)}` : "";
  const kfCode = `{ "0%": ${recordToCode(fromProps)}, "100%": ${recordToCode(toProps)}${easeEachEntry} }`;
  const entries = [`keyframes: ${kfCode}`, ...preservedVarsEntries(varsNode, source)];
  if (easeEach) entries.push(`ease: "none"`);
  return `{ ${entries.join(", ")} }`;
}

/** Rename a from()/fromTo() call to to(), dropping fromTo's leading from-vars arg. */
function convertMethodToTo(
  ms: MagicString,
  animation: GsapAnimation,
  call: any,
  varsNode: any,
): void {
  if (animation.method !== "from" && animation.method !== "fromTo") return;
  const calleeProp = call.node.callee?.property;
  if (calleeProp) ms.overwrite(calleeProp.start, calleeProp.end, "to");
  // Remove the from-vars arg and its trailing separator up to the to-vars arg.
  if (animation.method === "fromTo" && call.fromArg) ms.remove(call.fromArg.start, varsNode.start);
}

function convertFlatTweenToKeyframes(script: string, target: any): string {
  const animation: GsapAnimation = target.animation;
  if (animation.keyframes || animation.method === "set") return script;
  const call = target.call;
  const varsNode = call.varsArg;
  if (varsNode?.type !== "ObjectExpression") return script;

  const ms = new MagicString(script);
  ms.overwrite(varsNode.start, varsNode.end, buildConvertedVarsCode(animation, varsNode, script));
  convertMethodToTo(ms, animation, call, varsNode);
  return ms.toString();
}

// ── Keyframe write ops ────────────────────────────────────────────────────────
//
// Design: mirror the recast writer's rebuild-the-node model. The recast writer
// mutates AST nodes in place and re-prints, so it never has an offset-overlap
// problem. Here we instead compute the FINAL property record for every keyframe
// value node that must change (the target merge, `_auto` endpoint sync, and
// backfilled siblings) against the ORIGINAL parsed AST, then emit exactly ONE
// `ms.overwrite(valueNode.start, valueNode.end, code)` per changed node (and a
// single insert for a brand-new key). No node is ever both overwritten and
// appended into, so the splices can never overlap.

const PERCENTAGE_KEY_RE = /^(\d+(?:\.\d+)?)%$/;

// Matches recast's PCT_TOLERANCE: percentages within 2 of an existing key are
// treated as the same keyframe (merge), not a new insert.
const PCT_TOLERANCE = 2;

function percentageFromKey(key: string): number {
  const m = PERCENTAGE_KEY_RE.exec(key);
  return m ? Number.parseFloat(m[1] ?? "0") : Number.NaN;
}

/** Serialize a final keyframe property record (number|string values) to code. */
function recordToCode(record: Record<string, number | string>): string {
  const entries = Object.entries(record).map(([k, v]) => `${safeJsKey(k)}: ${serializeValue(v)}`);
  return `{ ${entries.join(", ")} }`;
}

/** Percentage-keyed property nodes of a keyframes ObjectExpression, in source order. */
function percentagePropsOf(kfNode: any): any[] {
  return (kfNode.properties ?? []).filter((p: any) => {
    if (!isObjectProperty(p)) return false;
    const key = propKeyName(p);
    return typeof key === "string" && PERCENTAGE_KEY_RE.test(key);
  });
}

const LITERAL_NODE_TYPES = new Set(["Literal", "NumericLiteral", "StringLiteral"]);

/** Read one value node: a number/string literal, a negative number, or raw source. */
// fallow-ignore-next-line complexity
function readValueNode(v: any, source: string): number | string {
  if (
    LITERAL_NODE_TYPES.has(v?.type) &&
    (typeof v.value === "number" || typeof v.value === "string")
  ) {
    return v.value;
  }
  if (
    v?.type === "UnaryExpression" &&
    v.operator === "-" &&
    typeof v.argument?.value === "number"
  ) {
    return -v.argument.value;
  }
  return `__raw:${source.slice(v.start, v.end)}`;
}

/**
 * Read a keyframe value ObjectExpression into a record, mirroring the parser's
 * `objectExpressionToRecord`: literals resolve to their value; anything else is
 * preserved as `__raw:<source>` so serializeValue round-trips it verbatim.
 * Keyframe values are literals in practice, so the raw fallback is rarely hit.
 */
function valueNodeToRecord(valueNode: any, source: string): Record<string, number | string> {
  const record: Record<string, number | string> = {};
  if (valueNode?.type !== "ObjectExpression") return record;
  for (const prop of valueNode.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    if (typeof key !== "string") continue;
    record[key] = readValueNode(prop.value, source);
  }
  return record;
}

/** True when a keyframe value record carries the synthetic `_auto` marker. */
function recordHasAuto(record: Record<string, number | string>): boolean {
  return "_auto" in record;
}

/**
 * Compute `_auto` endpoint overwrites: when the new keyframe is the immediate
 * neighbor of an `_auto` 0% or 100% endpoint, that endpoint is rewritten to
 * `{ ...newProps, _auto: 1 }`. Only fires for interior keyframes. Returns the
 * percentage→overwrite map so the caller can fold these into the per-node final
 * records (never a separate splice).
 */
function autoEndpointOverwrites(
  kfNode: any,
  source: string,
  percentage: number,
  properties: Record<string, number | string>,
): Map<any, Record<string, number | string>> {
  const result = new Map<any, Record<string, number | string>>();
  if (percentage <= 0 || percentage >= 100) return result;
  const pctProps = percentagePropsOf(kfNode);
  const allPcts = pctProps
    .map((p: any) => percentageFromKey(propKeyName(p) ?? ""))
    .filter((n: number) => !Number.isNaN(n) && n !== percentage)
    .sort((a: number, b: number) => a - b);
  const leftNeighbor = allPcts.filter((p: number) => p < percentage).pop();
  const rightNeighbor = allPcts.find((p: number) => p > percentage);
  for (const endPct of [0, 100]) {
    const isNeighbor = endPct === 0 ? leftNeighbor === 0 : rightNeighbor === 100;
    if (!isNeighbor) continue;
    const endProp = pctProps.find((p: any) => percentageFromKey(propKeyName(p) ?? "") === endPct);
    if (!endProp) continue;
    const rec = valueNodeToRecord(endProp.value, source);
    if (!recordHasAuto(rec)) continue;
    result.set(endProp, { ...properties, _auto: 1 });
  }
  return result;
}

function findKfPropByPct(kfNode: any, percentage: number): { prop: any; idx: number } | null {
  const props = kfNode.properties ?? [];
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    if (typeof key === "string" && Math.abs(percentageFromKey(key) - percentage) <= PCT_TOLERANCE) {
      return { prop, idx: i };
    }
  }
  return null;
}

export function updateKeyframeInScript(
  script: string,
  animationId: string,
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const kfPropNode = findPropertyNode(target.call.varsArg, "keyframes");
  if (!kfPropNode || kfPropNode.value?.type !== "ObjectExpression") return script;

  const match = findKfPropByPct(kfPropNode.value, percentage);
  if (!match) return script;

  const record: Record<string, number | string> = { ...properties };
  if (ease) record.ease = ease;
  const ms = new MagicString(script);
  ms.overwrite(match.prop.value.start, match.prop.value.end, recordToCode(record));
  return ms.toString();
}

/**
 * Build the final property record for the keyframe at `percentage`. If a
 * keyframe already exists there, MERGE the new props over the existing record
 * (preserve untouched props, preserve `_auto`, preserve the existing per-keyframe
 * ease when the op omits one); otherwise it's just the new props.
 */
function buildTargetRecord(
  existing: { prop: any; idx: number } | null,
  source: string,
  properties: Record<string, number | string>,
  ease: string | undefined,
): Record<string, number | string> {
  if (!existing || existing.prop.value?.type !== "ObjectExpression") {
    const record: Record<string, number | string> = { ...properties };
    if (ease) record.ease = ease;
    return record;
  }
  const existingRecord = valueNodeToRecord(existing.prop.value, source);
  const existingEase = typeof existingRecord.ease === "string" ? existingRecord.ease : undefined;
  const merged: Record<string, number | string> = { ...existingRecord };
  for (const [k, v] of Object.entries(properties)) merged[k] = v;
  const finalEase = ease ?? existingEase;
  if (finalEase) merged.ease = finalEase;
  else delete merged.ease;
  return merged;
}

/**
 * Compute the backfilled final record for one sibling keyframe: append any of
 * `newPropKeys` it's missing, using the backfill default. Returns null when
 * nothing changes (so the caller emits no overwrite for it).
 */
function backfilledSiblingRecord(
  valueNode: any,
  source: string,
  newPropKeys: string[],
  backfillDefaults: Record<string, number | string>,
): Record<string, number | string> | null {
  if (valueNode?.type !== "ObjectExpression") return null;
  const record = valueNodeToRecord(valueNode, source);
  let changed = false;
  for (const pk of newPropKeys) {
    const defaultVal = backfillDefaults[pk];
    if (pk in record || defaultVal == null) continue;
    record[pk] = defaultVal;
    changed = true;
  }
  return changed ? record : null;
}

/** A located tween whose varsArg has a static keyframes ObjectExpression, or null. */
function locateWithKeyframes(
  script: string,
  animationId: string,
): { script: string; parsed: ParsedGsapAcornForWrite; target: any; kfNode: any } | null {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return null;
  // Converting from()/fromTo() to to() rewrites the content-derived id; match
  // recast's locateAnimationWithFallback by remapping the method segment.
  const convertedId = animationId.replace(/-from-|-fromTo-/, "-to-");
  const target =
    parsed.located.find((l) => l.id === animationId) ??
    parsed.located.find((l) => l.id === convertedId);
  if (!target) return null;
  const kfPropNode = findPropertyNode(target.call.varsArg, "keyframes");
  if (!kfPropNode || kfPropNode.value?.type !== "ObjectExpression") return null;
  return { script, parsed, target, kfNode: kfPropNode.value };
}

/** Locate a tween's keyframes object, converting a flat tween first if absent. */
function ensureKeyframesNode(
  script: string,
  animationId: string,
): { script: string; parsed: ParsedGsapAcornForWrite; target: any; kfNode: any } | null {
  const direct = locateWithKeyframes(script, animationId);
  if (direct) return direct;

  // No static keyframes object — convert the flat tween, then re-locate.
  const parsed = parseGsapScriptAcornForWrite(script);
  const target = parsed?.located.find((l) => l.id === animationId);
  if (!target) return null;
  const converted = convertFlatTweenToKeyframes(script, target);
  if (converted === script) return null;
  return locateWithKeyframes(converted, animationId);
}

/**
 * Compute the sibling keyframe nodes that need a backfilled prop, excluding the
 * target keyframe and any node already being overwritten as an `_auto` endpoint.
 */
function collectBackfillOverwrites(
  kfNode: any,
  src: string,
  properties: Record<string, number | string>,
  backfillDefaults: Record<string, number | string> | undefined,
  skip: { existingProp: any; endpoints: Map<any, unknown> },
): Map<any, Record<string, number | string>> {
  const result = new Map<any, Record<string, number | string>>();
  if (!backfillDefaults) return result;
  const newPropKeys = Object.keys(properties);
  for (const prop of percentagePropsOf(kfNode)) {
    if (prop === skip.existingProp || skip.endpoints.has(prop)) continue;
    const rec = backfilledSiblingRecord(prop.value, src, newPropKeys, backfillDefaults);
    if (rec) result.set(prop, rec);
  }
  return result;
}

export function addKeyframeToScript(
  script: string,
  animationId: string,
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
  backfillDefaults?: Record<string, number | string>,
): string {
  const located = ensureKeyframesNode(script, animationId);
  if (!located) return script;
  const { script: src, kfNode } = located;

  const existing = findKfPropByPct(kfNode, percentage);

  // Final record for the target keyframe (merge if it already exists).
  const targetRecord = buildTargetRecord(existing, src, properties, ease);
  // `_auto` endpoint syncs fire only on new inserts; a merge landing ON an
  // endpoint already preserves `_auto` via buildTargetRecord.
  const endpointOverwrites = existing
    ? new Map<any, Record<string, number | string>>()
    : autoEndpointOverwrites(kfNode, src, percentage, properties);
  // Backfilled siblings (each node changes at most once).
  const backfillOverwrites = collectBackfillOverwrites(kfNode, src, properties, backfillDefaults, {
    existingProp: existing?.prop,
    endpoints: endpointOverwrites,
  });

  // Emit exactly one overwrite per changed node, plus one insert for a new key.
  const ms = new MagicString(src);
  if (existing) {
    // Merge into the existing keyframe at this percentage, preserving sibling
    // properties — overwrite only the given keys. (A whole-value overwrite here
    // would silently drop other properties already keyframed at this percent.)
    if (existing.prop.value?.type === "ObjectExpression") {
      for (const [k, v] of Object.entries(properties)) {
        upsertProp(ms, existing.prop.value, k, v);
      }
      if (ease !== undefined) upsertProp(ms, existing.prop.value, "ease", ease);
    } else {
      ms.overwrite(existing.prop.value.start, existing.prop.value.end, recordToCode(targetRecord));
    }
  } else {
    insertNewKeyframe(ms, kfNode, percentage, `${percentage}%`, recordToCode(targetRecord));
  }
  for (const [prop, rec] of [...endpointOverwrites, ...backfillOverwrites]) {
    ms.overwrite(prop.value.start, prop.value.end, recordToCode(rec));
  }

  return ms.toString();
}

/** Insert a brand-new `"pct%": {...}` property in sorted order. */
function insertNewKeyframe(
  ms: MagicString,
  kfNode: any,
  percentage: number,
  pctKey: string,
  valueCode: string,
): void {
  const allProps = (kfNode.properties ?? []).filter((p: any) => isObjectProperty(p));
  let insertBeforeProp: any = null;
  for (const prop of allProps) {
    const key = propKeyName(prop);
    if (typeof key === "string" && percentageFromKey(key) > percentage) {
      insertBeforeProp = prop;
      break;
    }
  }
  if (insertBeforeProp) {
    ms.appendLeft(insertBeforeProp.start, `${JSON.stringify(pctKey)}: ${valueCode}, `);
  } else {
    const sep = allProps.length > 0 ? ", " : "";
    ms.appendLeft(kfNode.end - 1, `${sep}${JSON.stringify(pctKey)}: ${valueCode}`);
  }
}

/**
 * Rebuild a vars ObjectExpression that has just dropped below two keyframes,
 * collapsing `keyframes: {…}` back to a flat tween. Mirrors recast's
 * collapseKeyframesToFlat: drop the `keyframes` + `easeEach` keys, preserve every
 * other vars key verbatim, and splice the remaining keyframe's properties (minus
 * its per-keyframe `ease`) in as flat vars keys. Single ms.overwrite of the whole
 * vars node so the splice can't overlap the keyframe removal.
 */
function collapseKeyframesToFlat(
  ms: MagicString,
  varsNode: any,
  source: string,
  remainingRecord: Record<string, number | string>,
): void {
  if (varsNode?.type !== "ObjectExpression") return;
  const dropKeyframeKeys = (key: string) => key === "keyframes" || key === "easeEach";
  const { entries } = preservedEntries(varsNode, source, dropKeyframeKeys, {});
  for (const [k, v] of Object.entries(remainingRecord)) {
    if (k !== "ease") entries.push(`${safeKey(k)}: ${valueToCode(v)}`);
  }
  ms.overwrite(varsNode.start, varsNode.end, `{ ${entries.join(", ")} }`);
}

export function removeKeyframeFromScript(
  script: string,
  animationId: string,
  percentage: number,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const kfPropNode = findPropertyNode(target.call.varsArg, "keyframes");
  if (!kfPropNode || kfPropNode.value?.type !== "ObjectExpression") return script;
  const kfNode = kfPropNode.value;

  const match = findKfPropByPct(kfNode, percentage);
  if (!match) return script;

  const ms = new MagicString(script);

  // If removing this keyframe leaves fewer than two, collapse the keyframes
  // object back to a flat tween (recast parity) instead of leaving a lone
  // keyframe. We rebuild the whole vars node, so we never also splice the kf
  // node — the two edits would overlap.
  const remaining = percentagePropsOf(kfNode).filter((p) => p !== match.prop);
  if (remaining.length < 2) {
    const record = remaining.length === 1 ? valueNodeToRecord(remaining[0]!.value, script) : {};
    collapseKeyframesToFlat(ms, target.call.varsArg, script, record);
    return ms.toString();
  }

  const allProps = (kfNode.properties ?? []).filter((p: any) => isObjectProperty(p));
  removeProp(ms, match.prop, allProps);
  return ms.toString();
}

export function removePropertyFromAnimation(
  script: string,
  animationId: string,
  property: string,
  from = false,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const { call } = target;
  const objNode = from ? (call.method === "fromTo" ? call.fromArg : null) : call.varsArg;
  if (!objNode) return script;
  const propNode = findPropertyNode(objNode, property);
  if (!propNode) return script;
  const allProps = (objNode.properties ?? []).filter((p: any) => isObjectProperty(p));
  const ms = new MagicString(script);
  removeProp(ms, propNode, allProps);
  return ms.toString();
}

// ── Label write ops ───────────────────────────────────────────────────────────

export function addLabelToScript(script: string, name: string, position: number): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;

  const insertionPoint = findInsertionPoint(parsed);
  if (insertionPoint === null) return script;

  const ms = new MagicString(script);
  const labelCode = `${parsed.timelineVar}.addLabel(${JSON.stringify(name)}, ${valueToCode(position)});`;
  ms.appendLeft(insertionPoint, "\n" + labelCode);
  return ms.toString();
}

export function removeLabelFromScript(script: string, name: string): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;

  const targets: any[] = [];
  acornWalk.simple(parsed.ast, {
    // fallow-ignore-next-line complexity
    ExpressionStatement(node: any) {
      const expr = node.expression;
      if (
        expr?.type === "CallExpression" &&
        expr.callee?.type === "MemberExpression" &&
        isTimelineRooted(expr.callee.object, parsed.timelineVar) &&
        expr.callee.property?.name === "addLabel" &&
        expr.arguments?.[0]?.type === "Literal" &&
        expr.arguments[0].value === name
      ) {
        targets.push(node);
      }
    },
  });

  if (!targets.length) return script;

  const ms = new MagicString(script);
  for (const target of targets) {
    const end =
      target.end < script.length && script[target.end] === "\n" ? target.end + 1 : target.end;
    ms.remove(target.start, end);
  }
  return ms.toString();
}
