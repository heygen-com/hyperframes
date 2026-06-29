// fallow-ignore-file code-duplication
/**
 * Browser-safe GSAP write path — magic-string offset-splice.
 *
 * T6c: edits GSAP scripts by overwriting/removing byte ranges in the original
 * source. Every byte outside the edited span is preserved verbatim — no
 * pretty-printer churn. Consumes ParsedGsapAcornForWrite from gsapParserAcorn.ts.
 */
import MagicString from "magic-string";
import type {
  GsapAnimation,
  GsapPercentageKeyframe,
  ArcPathConfig,
  ArcPathSegment,
} from "./gsapSerialize.js";
import {
  resolveConversionProps,
  extractArcWaypoints,
  buildMotionPathObjectCode,
} from "./gsapSerialize.js";
import {
  parseGsapScriptAcornForWrite,
  type ParsedGsapAcornForWrite,
  type TweenCallInfo,
} from "./gsapParserAcorn.js";
import { classifyPropertyGroup } from "./gsapConstants.js";
import type { PropertyGroupName } from "./gsapConstants.js";
import type { SplitAnimationsOptions, SplitAnimationsResult } from "./gsapSerialize.js";
import * as acornWalk from "acorn-walk";

// acorn ESTree nodes are structurally untyped here; mirror gsapParserAcorn.ts /
// gsapInline.ts rather than re-deriving the full ESTree union for every access.
type Node = any;

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
  // A base `gsap.set` is off the timeline: no timeline var, no position arg.
  if (anim.method === "set" && anim.global) {
    return `gsap.set(${selector}, ${objCode});`;
  }
  return `${timelineVar}.${anim.method}(${selector}, ${objCode}, ${posCode});`;
}

// ── AST node helpers ─────────────────────────────────────────────────────────

function isObjectProperty(prop: Node): boolean {
  return prop?.type === "ObjectProperty" || prop?.type === "Property";
}

function propKeyName(prop: Node): string | undefined {
  return prop?.key?.name ?? prop?.key?.value;
}

function findPropertyNode(varsArgNode: Node, key: string): Node | undefined {
  if (varsArgNode?.type !== "ObjectExpression") return undefined;
  for (const prop of varsArgNode.properties ?? []) {
    if (!isObjectProperty(prop)) continue;
    if (propKeyName(prop) === key) return prop;
  }
  return undefined;
}

/** The `keyframes` property's ObjectExpression value, or null when not a keyframe tween. */
function keyframesObjectNode(varsNode: Node): Node | null {
  const kfProp = findPropertyNode(varsNode, "keyframes");
  return kfProp?.value?.type === "ObjectExpression" ? kfProp.value : null;
}

function findEnclosingExpressionStatement(ancestors: Node[]): Node | null {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    if (ancestors[i]?.type === "ExpressionStatement") return ancestors[i];
  }
  return null;
}

/** Find the VariableDeclaration statement for `tl = gsap.timeline(...)`. */
function findTimelineDeclarationStatement(ast: Node, timelineVar: string): Node | null {
  let found: Node = null;
  acornWalk.simple(ast, {
    // fallow-ignore-next-line complexity
    VariableDeclaration(node: Node) {
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
function removeProp(ms: MagicString, propNode: Node, editableProps: Node[]): void {
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

/** Serialize a vars record to an object-literal source: `{ k: v, ... }`. */
function buildVarsObjectCode(record: Record<string, number | string | boolean>): string {
  const entries = Object.entries(record).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
}

/** Overwrite a tween call's vars ObjectExpression with freshly-built source. */
function overwriteVarsArg(ms: MagicString, call: TweenCallInfo, objCode: string): void {
  if (!call.varsArg) return;
  ms.overwrite(call.varsArg.start, call.varsArg.end, objCode);
}

/**
 * Update a property value if it exists, or append a new key: val before the
 * closing `}`. Call with the full ObjectExpression node.
 */
function upsertProp(ms: MagicString, objNode: Node, key: string, value: unknown): void {
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
  objNode: Node,
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
  objNode: Node,
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
function isTimelineRooted(node: Node, timelineVar: string, script: string): boolean {
  if (node?.type === "Identifier") return node.name === timelineVar;
  // Inline/member timelines: `timelineVar` is the source slice (e.g.
  // `window.__timelines["scene"]`); match a MemberExpression callee by its source.
  if (node?.type === "MemberExpression") return script.slice(node.start, node.end) === timelineVar;
  if (node?.type === "CallExpression")
    return isTimelineRooted(node.callee?.object, timelineVar, script);
  return false;
}

/**
 * Find the byte offset after which to insert a new statement (tween or label).
 * Returns null when no timeline declaration exists in the script — callers must
 * not emit `tl.xxx()` calls in that case as `tl` would be undefined at render.
 */
function findInsertionPoint(parsed: ParsedGsapAcornForWrite): number | null {
  const lastLocated = parsed.located[parsed.located.length - 1];
  if (lastLocated) {
    const lastCall = lastLocated.call;
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
  updates: Partial<GsapAnimation> & { easeEach?: string; resetKeyframeEases?: boolean },
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
    const easeValue = updates.easeEach ?? updates.ease;
    if (easeValue !== undefined) {
      const kfNode = keyframesObjectNode(call.varsArg);
      if (kfNode) {
        upsertProp(ms, kfNode, "easeEach", easeValue);
        // "Apply to all segments": drop every per-keyframe `ease` override so the
        // single easeEach governs all segments uniformly (AE select-all + F9).
        if (updates.resetKeyframeEases) {
          for (const kfEntry of kfNode.properties ?? []) {
            if (!isObjectProperty(kfEntry)) continue;
            const val = kfEntry.value;
            if (val?.type !== "ObjectExpression") continue;
            const easeNode = findPropertyNode(val, "ease");
            if (easeNode) removeProp(ms, easeNode, val.properties);
          }
        }
      } else {
        upsertProp(ms, call.varsArg, "ease", easeValue);
      }
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
    overwritePosition(ms, call, updates.position);
  }

  return ms.toString();
}

/**
 * Overwrite a tween call's numeric position argument (the positionArg the parser
 * located: 3rd arg for fromTo, else 2nd), or append one when the call has no
 * explicit position. Shared by updateAnimationInScript and the
 * shift/scalePositionsInScript timeline ops.
 */
function overwritePosition(ms: MagicString, call: TweenCallInfo, position: number | string): void {
  if (call.positionArg) {
    ms.overwrite(call.positionArg.start, call.positionArg.end, valueToCode(position));
  } else {
    ms.appendLeft(call.node.end - 1, `, ${valueToCode(position)}`);
  }
}

/**
 * Shift every tween targeting `targetSelector` by `delta` seconds (clamped ≥0),
 * rewriting each call's position argument. Mirrors recast's shiftPositionsInScript
 * (used by timeline clip-move to keep GSAP positions in sync with the clip start).
 */
export function shiftPositionsInScript(
  script: string,
  targetSelector: string,
  delta: number,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const ms = new MagicString(script);
  let changed = false;
  for (const entry of parsed.located) {
    if (entry.animation.targetSelector !== targetSelector) continue;
    if (typeof entry.animation.position !== "number") continue;
    const newPos = Math.max(0, Math.round((entry.animation.position + delta) * 1000) / 1000);
    overwritePosition(ms, entry.call, newPos);
    changed = true;
  }
  return changed ? ms.toString() : script;
}

/**
 * Linearly remap every tween targeting `targetSelector` from the old clip
 * [oldStart, oldDuration] onto the new [newStart, newDuration] (position and,
 * when present, duration scaled by the duration ratio). Mirrors recast's
 * scalePositionsInScript (used by timeline clip-resize).
 */
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
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const ms = new MagicString(script);
  let changed = false;
  for (const entry of parsed.located) {
    if (entry.animation.targetSelector !== targetSelector) continue;
    if (typeof entry.animation.position !== "number") continue;
    const newPos = Math.max(
      0,
      Math.round((newStart + (entry.animation.position - oldStart) * ratio) * 1000) / 1000,
    );
    overwritePosition(ms, entry.call, newPos);
    if (typeof entry.animation.duration === "number" && entry.animation.duration > 0) {
      const newDur = Math.max(0.001, Math.round(entry.animation.duration * ratio * 1000) / 1000);
      upsertProp(ms, entry.call.varsArg, "duration", newDur);
    }
    changed = true;
  }
  return changed ? ms.toString() : script;
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

/** Splice a single located tween call out of a MagicString (standalone stmt or chain link). */
function removeCallFromMagicString(ms: MagicString, call: TweenCallInfo, script: string): void {
  const N = call.node;
  const exprStmt = findEnclosingExpressionStatement(call.ancestors);
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
}

export function removeAnimationFromScript(script: string, animationId: string): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const ms = new MagicString(script);
  removeCallFromMagicString(ms, target.call, script);
  return ms.toString();
}

/**
 * Enforce "exactly one position write per element". Position commits (drag, add
 * keyframe, static hold) must never leave the same selector with two conflicting
 * position representations (e.g. a degenerate `tl.to("#box",{duration:0,x,y})`
 * AND a `gsap.set("#box",{x,y})`) — the later one silently overrides the earlier,
 * so the element "can't move" / snaps / leaves residue on delete.
 *
 * Keeps `keepId` (the write the commit just edited); falls back to the LAST
 * position write in source order (the runtime-effective one) if `keepId` is stale.
 * Removes every OTHER pure-position write (`propertyGroup === "position"`, which
 * covers tl.to/from/fromTo flat-or-keyframed, tl.set, and standalone gsap.set,
 * including degenerate duration:0 tweens). Non-position writes for the same
 * selector (rotation / opacity / size / mixed) are left untouched.
 */
export function dedupePositionWritesInScript(
  script: string,
  selector: string,
  keepId?: string,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const posWrites = parsed.located.filter(
    (l) => l.animation.targetSelector === selector && l.animation.propertyGroup === "position",
  );
  if (posWrites.length <= 1) return script;
  const keeper = posWrites.find((l) => l.id === keepId) ?? posWrites[posWrites.length - 1]!;
  const ms = new MagicString(script);
  for (const l of posWrites) {
    if (l === keeper) continue;
    removeCallFromMagicString(ms, l.call, script);
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
function preservedVarsEntries(varsNode: Node, source: string): string[] {
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
function buildConvertedVarsCode(animation: GsapAnimation, varsNode: Node, source: string): string {
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
  call: Node,
  varsNode: Node,
): void {
  if (animation.method !== "from" && animation.method !== "fromTo") return;
  const calleeProp = call.node.callee?.property;
  if (calleeProp) ms.overwrite(calleeProp.start, calleeProp.end, "to");
  // Remove the from-vars arg and its trailing separator up to the to-vars arg.
  if (animation.method === "fromTo" && call.fromArg) ms.remove(call.fromArg.start, varsNode.start);
}

function convertFlatTweenToKeyframes(script: string, target: Node): string {
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
  const entries = Object.entries(record).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  return `{ ${entries.join(", ")} }`;
}

/** Percentage-keyed property nodes of a keyframes ObjectExpression, in source order. */
function percentagePropsOf(kfNode: Node): Node[] {
  return (kfNode.properties ?? []).filter((p: Node) => {
    if (!isObjectProperty(p)) return false;
    const key = propKeyName(p);
    return typeof key === "string" && PERCENTAGE_KEY_RE.test(key);
  });
}

const LITERAL_NODE_TYPES = new Set(["Literal", "NumericLiteral", "StringLiteral"]);

/** Read one value node: a number/string literal, a negative number, or raw source. */
// fallow-ignore-next-line complexity
function readValueNode(v: Node, source: string): number | string {
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
function valueNodeToRecord(valueNode: Node, source: string): Record<string, number | string> {
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
  kfNode: Node,
  source: string,
  percentage: number,
  properties: Record<string, number | string>,
): Map<any, Record<string, number | string>> {
  const result = new Map<any, Record<string, number | string>>();
  if (percentage <= 0 || percentage >= 100) return result;
  const pctProps = percentagePropsOf(kfNode);
  const allPcts = pctProps
    .map((p: Node) => percentageFromKey(propKeyName(p) ?? ""))
    .filter((n: number) => !Number.isNaN(n) && n !== percentage)
    .sort((a: number, b: number) => a - b);
  const leftNeighbor = allPcts.filter((p: number) => p < percentage).pop();
  const rightNeighbor = allPcts.find((p: number) => p > percentage);
  for (const endPct of [0, 100]) {
    const isNeighbor = endPct === 0 ? leftNeighbor === 0 : rightNeighbor === 100;
    if (!isNeighbor) continue;
    const endProp = pctProps.find((p: Node) => percentageFromKey(propKeyName(p) ?? "") === endPct);
    if (!endProp) continue;
    const rec = valueNodeToRecord(endProp.value, source);
    if (!recordHasAuto(rec)) continue;
    result.set(endProp, { ...properties, _auto: 1 });
  }
  return result;
}

function findKfPropByPct(kfNode: Node, percentage: number): { prop: Node; idx: number } | null {
  // Match the CLOSEST keyframe within tolerance, not the first one within range.
  // Keyframes at e.g. 0/49/50/100 are all valid (the SDK dedups to a unique
  // match at TOLERANCE=0.001 upstream); picking the first-within-PCT_TOLERANCE=2
  // would hit 49% when the caller meant 50%. Tie-break on the earliest index so
  // the choice stays deterministic.
  const props = kfNode.properties ?? [];
  let best: { prop: Node; idx: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    if (typeof key !== "string") continue;
    const dist = Math.abs(percentageFromKey(key) - percentage);
    if (dist <= PCT_TOLERANCE && dist < bestDist) {
      best = { prop, idx: i };
      bestDist = dist;
    }
  }
  return best;
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
  if (!kfPropNode) return script;

  // Array-form keyframes (`keyframes: [{x,y}, ...]`) carry no explicit percentages
  // — GSAP distributes them evenly, and the runtime read assigns even percentages
  // (0, 100/(n-1), …). Map the percentage back to an array index and overwrite that
  // element in place (preserving the array form). Without this the function bailed
  // on the ObjectExpression check, so dragging a motion-path node on an array-form
  // tween committed nothing (server no-op).
  if (kfPropNode.value?.type === "ArrayExpression") {
    return updateArrayKeyframeByPct(script, kfPropNode.value, percentage, properties, ease);
  }
  if (kfPropNode.value?.type !== "ObjectExpression") return script;

  const match = findKfPropByPct(kfPropNode.value, percentage);
  if (!match) return script;

  const ms = new MagicString(script);
  // MERGE the edited props into the existing keyframe, preserving properties already
  // keyframed at this percentage (z, transformPerspective, rotation, …). A whole-value
  // overwrite DROPS every prop not in this edit — e.g. editing rotationY at the 0%
  // keyframe would strip z / transformPerspective, so the lens then animates from 0 and
  // the element pops. Mirrors addKeyframeToScript's merge-into-existing branch.
  if (match.prop.value?.type === "ObjectExpression") {
    for (const [k, v] of Object.entries(properties)) {
      upsertProp(ms, match.prop.value, k, v);
    }
    if (ease !== undefined) upsertProp(ms, match.prop.value, "ease", ease);
  } else {
    const record: Record<string, number | string> = { ...properties };
    if (ease) record.ease = ease;
    ms.overwrite(match.prop.value.start, match.prop.value.end, recordToCode(record));
  }
  return ms.toString();
}

// ponytail: even-spacing index map; if array keyframes ever carry per-element
// `duration`, switch to matching the closest cumulative position.
function updateArrayKeyframeByPct(
  script: string,
  arrayNode: Node,
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
): string {
  const elements = ((arrayNode.elements ?? []) as Array<Node | null>).filter(
    (el): el is Node => !!el && el.type === "ObjectExpression",
  );
  const n = elements.length;
  if (n === 0) return script;
  const idx = n > 1 ? Math.round((percentage / 100) * (n - 1)) : 0;
  const el = elements[Math.max(0, Math.min(n - 1, idx))];
  if (!el) return script;
  const merged: Record<string, number | string> = {
    ...valueNodeToRecord(el, script),
    ...properties,
  };
  if (ease) merged.ease = ease;
  const ms = new MagicString(script);
  ms.overwrite(el.start, el.end, recordToCode(merged));
  return ms.toString();
}

/**
 * Build the final property record for the keyframe at `percentage`. If a
 * keyframe already exists there, MERGE the new props over the existing record
 * (preserve untouched props, preserve `_auto`, preserve the existing per-keyframe
 * ease when the op omits one); otherwise it's just the new props.
 */
function buildTargetRecord(
  existing: { prop: Node; idx: number } | null,
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
  valueNode: Node,
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
): { script: string; parsed: ParsedGsapAcornForWrite; target: Node; kfNode: Node } | null {
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
// Array-form keyframes (`keyframes: [{x,y}, …]`) → even-percentage object form
// (`{ "0%": {…}, "33.3%": {…}, … }`). Inserting a keyframe needs percentage keys,
// which an even array can't host. Runtime-identical; mirrors the recast path.
function convertArrayKeyframesToObject(script: string, target: Node): string {
  const kfPropNode = findPropertyNode(target.call.varsArg, "keyframes");
  if (!kfPropNode || kfPropNode.value?.type !== "ArrayExpression") return script;
  const els = ((kfPropNode.value.elements ?? []) as Array<Node | null>).filter(
    (el): el is Node => !!el && el.type === "ObjectExpression",
  );
  const n = els.length;
  if (n === 0) return script;
  const entries = els.map((el, i) => {
    const pct = n > 1 ? Math.round((i / (n - 1)) * 1000) / 10 : 0;
    return `${JSON.stringify(`${pct}%`)}: ${script.slice(el.start, el.end)}`;
  });
  const ms = new MagicString(script);
  ms.overwrite(kfPropNode.value.start, kfPropNode.value.end, `{ ${entries.join(", ")} }`);
  return ms.toString();
}

function ensureKeyframesNode(
  script: string,
  animationId: string,
): { script: string; parsed: ParsedGsapAcornForWrite; target: Node; kfNode: Node } | null {
  const direct = locateWithKeyframes(script, animationId);
  if (direct) return direct;

  const parsed = parseGsapScriptAcornForWrite(script);
  const target = parsed?.located.find((l) => l.id === animationId);
  if (!target) return null;

  // Array-form keyframes → normalize to object form, then re-locate.
  const kfProp = findPropertyNode(target.call.varsArg, "keyframes");
  if (kfProp?.value?.type === "ArrayExpression") {
    const normalized = convertArrayKeyframesToObject(script, target);
    if (normalized !== script) return locateWithKeyframes(normalized, animationId);
    return null;
  }

  // No static keyframes object — convert the flat tween, then re-locate.
  const converted = convertFlatTweenToKeyframes(script, target);
  if (converted === script) return null;
  return locateWithKeyframes(converted, animationId);
}

/**
 * Compute the sibling keyframe nodes that need a backfilled prop, excluding the
 * target keyframe and any node already being overwritten as an `_auto` endpoint.
 */
function collectBackfillOverwrites(
  kfNode: Node,
  src: string,
  properties: Record<string, number | string>,
  backfillDefaults: Record<string, number | string> | undefined,
  skip: { existingProp: Node; endpoints: Map<any, unknown> },
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
  kfNode: Node,
  percentage: number,
  pctKey: string,
  valueCode: string,
): void {
  const allProps = (kfNode.properties ?? []).filter((p: Node) => isObjectProperty(p));
  let insertBeforeProp: Node = null;
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
  varsNode: Node,
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

/** Implicit tween-relative percentage of array-form keyframe index `i` of `n`
 *  (GSAP distributes array keyframes evenly: 0%, 1/(n-1), …, 100%). */
function arrayKeyframePct(i: number, n: number): number {
  return n > 1 ? (i / (n - 1)) * 100 : 0;
}

// Array-form keyframes (`keyframes: [{x,y}, …]`) carry no explicit percentages —
// GSAP distributes them evenly. removeKeyframeFromScript only handled the
// object-form (`keyframes: { "50%": {…} }`), so removing from an array-form tween
// was a silent no-op (and the downstream hold-sync then stranded an `hf-hold`).
// Resolve the element by its implicit percentage and splice it out; collapse to a
// flat tween when fewer than two remain (parity with the object-form path).
function removeArrayKeyframe(
  ms: MagicString,
  varsArg: Node,
  arrNode: Node,
  script: string,
  percentage: number,
): boolean {
  const elements: Node[] = (arrNode.elements ?? []).filter(
    (e: Node | null): e is Node => !!e && e.type === "ObjectExpression",
  );
  const n = elements.length;
  if (n === 0) return false;

  let matchIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const dist = Math.abs(arrayKeyframePct(i, n) - percentage);
    if (dist <= PCT_TOLERANCE && dist < bestDist) {
      matchIdx = i;
      bestDist = dist;
    }
  }
  if (matchIdx === -1) return false;

  const remaining = elements.filter((_, i) => i !== matchIdx);
  if (remaining.length < 2) {
    const sole = remaining[0];
    const record = sole ? valueNodeToRecord(sole, script) : {};
    collapseKeyframesToFlat(ms, varsArg, script, record);
    return true;
  }
  removeProp(ms, elements[matchIdx], elements);
  return true;
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
  if (!kfPropNode) return script;

  if (kfPropNode.value?.type === "ArrayExpression") {
    const ms = new MagicString(script);
    return removeArrayKeyframe(ms, target.call.varsArg, kfPropNode.value, script, percentage)
      ? ms.toString()
      : script;
  }

  if (kfPropNode.value?.type !== "ObjectExpression") return script;
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
    const sole = remaining[0];
    const record = sole ? valueNodeToRecord(sole.value, script) : {};
    collapseKeyframesToFlat(ms, target.call.varsArg, script, record);
    return ms.toString();
  }

  const allProps = (kfNode.properties ?? []).filter((p: Node) => isObjectProperty(p));
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
  const allProps = (objNode.properties ?? []).filter((p: Node) => isObjectProperty(p));
  const ms = new MagicString(script);
  removeProp(ms, propNode, allProps);
  return ms.toString();
}

/**
 * Remove all keyframes from a tween, collapsing to a flat tween with one
 * keyframe's properties: the first for `from()`, the last otherwise (the
 * destination = the visible resting state).
 */
// fallow-ignore-next-line complexity
export function removeAllKeyframesFromScript(script: string, animationId: string): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const kfs = target.animation.keyframes?.keyframes;
  if (!kfs || kfs.length === 0) return script;

  const sorted = [...kfs].sort((a, b) => a.percentage - b.percentage);
  const collapse = target.call.method === "from" ? sorted[0] : sorted[sorted.length - 1];
  if (!collapse) return script;

  const ms = new MagicString(script);
  overwriteVarsArg(
    ms,
    target.call,
    buildVarsObjectCode(buildCollapsedFlatVars(target.animation, collapse)),
  );
  // Removing all keyframes of a POSITION tween must leave exactly ONE held state:
  // strip every sibling position write for the same selector (a stray gsap.set or
  // a second tl.to/tl.set) so the collapsed hold is the lone position source. Only
  // position siblings are stripped; rotation/opacity/etc. for the selector remain.
  if (target.animation.propertyGroup === "position") {
    for (const l of parsed.located) {
      if (l === target) continue;
      if (
        l.animation.targetSelector === target.animation.targetSelector &&
        l.animation.propertyGroup === "position"
      ) {
        removeCallFromMagicString(ms, l.call, script);
      }
    }
  }
  return ms.toString();
}

// Flat vars for a tween collapsing its keyframes onto one stop: existing
// top-level props, then the collapse keyframe's props (skip per-keyframe
// `ease`), then extras. Removing all keyframes HOLDS the element statically —
// collapse to a zero-duration immediateRender tween (a `gsap.set` equivalent),
// dropping the original duration/ease so the element does not re-animate.
function buildCollapsedFlatVars(
  animation: GsapAnimation,
  collapse: { properties: Record<string, number | string> },
): Record<string, number | string | boolean> {
  const flat: Record<string, number | string | boolean> = { ...animation.properties };
  for (const [k, v] of Object.entries(collapse.properties)) {
    if (k !== "ease") flat[k] = v;
  }
  for (const [k, v] of Object.entries(animation.extras ?? {})) {
    if (typeof v === "number" || typeof v === "string") flat[k] = v;
  }
  // Static hold wins over any carried extras: zero duration + immediateRender,
  // no ease.
  flat.duration = 0;
  flat.immediateRender = true;
  return flat;
}

/** Build the full replacement vars object for a tween being converted to keyframes. */
function buildKeyframesVarsCode(
  animation: GsapAnimation,
  fromProps: Record<string, number | string>,
  toProps: Record<string, number | string>,
  varsNode: Node,
  source: string,
  setDuration?: number,
): string {
  const fromEntries = Object.entries(fromProps).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  const toEntries = Object.entries(toProps).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  const easeEntry = animation.ease ? `, easeEach: ${JSON.stringify(animation.ease)}` : "";
  const kfCode = `{ "0%": { ${fromEntries.join(", ")} }, "100%": { ${toEntries.join(", ")} }${easeEntry} }`;
  // Preserve every non-editable key (duration/delay/callbacks/stagger/yoyo/…)
  // verbatim from source — rebuilding from the animation object alone dropped
  // `delay` (not a GsapAnimation field), shifting the tween's start time.
  let preserved = preservedVarsEntries(varsNode, source);
  // Converting a static `set` → drop its hold markers and give it a real duration
  // so the keyframes span time.
  if (setDuration !== undefined) {
    preserved = preserved.filter((e) => !/^\s*(immediateRender|data|duration)\s*:/.test(e));
  }
  const parts: string[] = [`keyframes: ${kfCode}`, ...preserved];
  if (setDuration !== undefined) parts.push(`duration: ${Math.max(0.001, setDuration)}`);
  if (animation.ease) parts.push(`ease: "none"`);
  return `{ ${parts.join(", ")} }`;
}

/**
 * Convert a flat tween (to/from/fromTo) to percentage-keyframes format.
 * `resolvedFromValues` supplies the current DOM state: overrides the 0% endpoint
 * for `to()`, the 100% endpoint for `from()`, or merges into toProps for `fromTo()`.
 */
export function convertToKeyframesFromScript(
  script: string,
  animationId: string,
  resolvedFromValues?: Record<string, number | string>,
  setDuration = 1,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const { animation, call } = target;
  if (animation.keyframes) return script;
  const isSet = call.method === "set";

  const { fromProps, toProps } = resolveConversionProps(animation, resolvedFromValues);
  const ms = new MagicString(script);

  // A GLOBAL `gsap.set(...)` is off-timeline; rewriting only the method emits
  // `gsap.to(...)`, which fires once at load and isn't on the paused master
  // timeline (the engine can't seek/render it). Re-root onto the timeline var
  // and add the position arg the set lacks so the converted tween is seekable.
  if (isSet && animation.global) {
    const calleeObj = call.node.callee.object;
    if (calleeObj?.type === "Identifier") {
      ms.overwrite(calleeObj.start, calleeObj.end, parsed.timelineVar);
    }
    const args = call.node.arguments;
    if (args.length > 0 && args.length < 3) {
      ms.appendLeft(args[args.length - 1].end, ", 0");
    }
  }

  // set/from/fromTo all become `to`; fromTo also drops its `from` argument.
  if (call.method === "from" || call.method === "fromTo" || isSet) {
    ms.overwrite(call.node.callee.property.start, call.node.callee.property.end, "to");
  }
  if (call.method === "fromTo" && call.fromArg) {
    ms.remove(call.fromArg.start, call.varsArg.start);
  }
  overwriteVarsArg(
    ms,
    call,
    buildKeyframesVarsCode(
      animation,
      fromProps,
      toProps,
      call.varsArg,
      script,
      isSet ? setDuration : undefined,
    ),
  );

  return ms.toString();
}

// ── Keyframe-object code builder ─────────────────────────────────────────────

/** Build a percentage-keyframes object literal: `{ "0%": { x: 0 }, "100%": { x: 100 } }`. */
function buildKeyframeObjectCode(
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
    auto?: boolean;
  }>,
  easeEach?: string,
): string {
  const entries = keyframes.map((kf) => {
    const props = Object.entries(kf.properties).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
    if (kf.ease) props.push(`ease: ${JSON.stringify(kf.ease)}`);
    if (kf.auto) props.push(`_auto: 1`);
    return `${JSON.stringify(`${kf.percentage}%`)}: { ${props.join(", ")} }`;
  });
  if (easeEach) entries.push(`easeEach: ${JSON.stringify(easeEach)}`);
  return `{ ${entries.join(", ")} }`;
}

// ── Materialize keyframes ────────────────────────────────────────────────────

/**
 * Replace a dynamic or static keyframes expression with a fully-resolved
 * percentage-keyframes object. Called when a user first edits a dynamically-
 * generated keyframe in the studio so it becomes statically editable.
 */
export function materializeKeyframesFromScript(
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
  // An empty keyframe list has no materialized form — rebuilding vars with an
  // empty keyframes object would empty the animation. No-op instead.
  if (keyframes.length === 0) return script;
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const { call } = target;
  const sorted = [...keyframes].sort((a, b) => a.percentage - b.percentage);
  const kfObjCode = buildKeyframeObjectCode(sorted, easeEach);
  const ms = new MagicString(script);

  if (resolvedSelector) {
    const selectorArg = call.node.arguments[0];
    if (selectorArg)
      ms.overwrite(selectorArg.start, selectorArg.end, JSON.stringify(resolvedSelector));
  }

  const kfProp = findPropertyNode(call.varsArg, "keyframes");
  if (kfProp) {
    ms.overwrite(kfProp.value.start, kfProp.value.end, kfObjCode);
  } else if (call.varsArg?.type === "ObjectExpression") {
    const vars = call.varsArg;
    if (vars.properties.length > 0) {
      ms.prependLeft(vars.properties[0].start, `keyframes: ${kfObjCode}, `);
    } else {
      ms.appendLeft(vars.end - 1, `keyframes: ${kfObjCode}`);
    }
  }

  const eachProp = findPropertyNode(call.varsArg, "easeEach");
  if (eachProp) {
    const allProps = (call.varsArg.properties ?? []).filter((p: Node) => isObjectProperty(p));
    removeProp(ms, eachProp, allProps);
  }

  return ms.toString();
}

// ── Add animation with keyframes ──────────────────────────────────────────────

/** Insert a new keyframed `to()` call and return the new animation ID. */
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
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return { script, id: "" };
  const insertionPoint = findInsertionPoint(parsed);
  if (insertionPoint === null) return { script, id: "" };

  const sorted = [...keyframes].sort((a, b) => a.percentage - b.percentage);
  const kfObjCode = buildKeyframeObjectCode(sorted, easeEach);
  const varParts = [`keyframes: ${kfObjCode}`, `duration: ${valueToCode(duration)}`];
  if (ease) varParts.push(`ease: ${JSON.stringify(ease)}`);
  const stmtCode = `${parsed.timelineVar}.to(${JSON.stringify(targetSelector)}, { ${varParts.join(", ")} }, ${valueToCode(position)});`;

  const ms = new MagicString(script);
  ms.appendLeft(insertionPoint, "\n" + stmtCode);

  const result = ms.toString();
  const reParsed = parseGsapScriptAcornForWrite(result);
  const newId = reParsed?.located[reParsed.located.length - 1]?.id ?? "";
  return { script: result, id: newId };
}

// ── Split into property groups ────────────────────────────────────────────────

function collectPropertyKeys(anim: GsapAnimation): Set<string> {
  const keys = new Set<string>();
  if (anim.keyframes) {
    for (const kf of anim.keyframes.keyframes) {
      for (const k of Object.keys(kf.properties)) keys.add(k);
    }
  } else {
    for (const k of Object.keys(anim.properties)) keys.add(k);
  }
  return keys;
}

function partitionPropertyGroups(keys: Set<string>): Map<PropertyGroupName, string[]> {
  const groups = new Map<PropertyGroupName, string[]>();
  for (const key of keys) {
    if (key === "transformOrigin") continue;
    const group = classifyPropertyGroup(key);
    let arr = groups.get(group);
    if (!arr) {
      arr = [];
      groups.set(group, arr);
    }
    arr.push(key);
  }
  return groups;
}

function assignTransformOrigin(groupProps: Map<PropertyGroupName, string[]>): void {
  let largestGroup: PropertyGroupName | undefined;
  let largestCount = 0;
  for (const [group, props] of groupProps) {
    if (props.length > largestCount) {
      largestCount = props.length;
      largestGroup = group;
    }
  }
  const largest = largestGroup ? groupProps.get(largestGroup) : undefined;
  if (largest) largest.push("transformOrigin");
}

function filterGroupKeyframes(
  kfs: GsapPercentageKeyframe[],
  propSet: Set<string>,
): Array<{ percentage: number; properties: Record<string, number | string>; ease?: string }> {
  const result: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }> = [];
  for (const kf of kfs) {
    const filtered: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(kf.properties)) {
      if (propSet.has(k)) filtered[k] = v;
    }
    if (Object.keys(filtered).length > 0) {
      result.push({
        percentage: kf.percentage,
        properties: filtered,
        ...(kf.ease ? { ease: kf.ease } : {}),
      });
    }
  }
  return result;
}

function filterGroupProperties(
  properties: Record<string, number | string>,
  propSet: Set<string>,
): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (propSet.has(k)) result[k] = v;
  }
  return result;
}

function addGroupAnimToScript(
  script: string,
  anim: GsapAnimation,
  propSet: Set<string>,
): { script: string; id: string } {
  if (anim.keyframes) {
    const groupKeyframes = filterGroupKeyframes(anim.keyframes.keyframes, propSet);
    if (groupKeyframes.length === 0) return { script, id: "" };
    const pos = typeof anim.position === "number" ? anim.position : 0;
    return addAnimationWithKeyframesToScript(
      script,
      anim.targetSelector,
      pos,
      anim.duration ?? 0.5,
      groupKeyframes,
      anim.keyframes.easeEach ?? anim.ease,
    );
  }
  const groupProperties = filterGroupProperties(anim.properties, propSet);
  if (Object.keys(groupProperties).length === 0) return { script, id: "" };
  const fromProperties =
    anim.method === "fromTo" && anim.fromProperties
      ? filterGroupProperties(anim.fromProperties, propSet)
      : undefined;
  return addAnimationToScript(script, {
    targetSelector: anim.targetSelector,
    method: anim.method,
    position: anim.position,
    duration: anim.duration,
    ease: anim.ease,
    properties: groupProperties,
    fromProperties,
    extras: anim.extras,
  });
}

/**
 * Split a mixed-property tween into one tween per property group (position,
 * scale, visual, etc.) so each group can be edited independently.
 * Returns the updated script and the IDs of the newly-created tweens.
 */
export function splitIntoPropertyGroupsFromScript(
  script: string,
  animationId: string,
): { script: string; ids: string[] } {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return { script, ids: [animationId] };
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return { script, ids: [animationId] };
  const { animation } = target;

  const allPropKeys = collectPropertyKeys(animation);
  const groupProps = partitionPropertyGroups(allPropKeys);
  if (groupProps.size <= 1) return { script, ids: [animationId] };
  if (allPropKeys.has("transformOrigin")) assignTransformOrigin(groupProps);

  let result = removeAnimationFromScript(script, animationId);
  for (const [, props] of groupProps) {
    const { script: next, id } = addGroupAnimToScript(result, animation, new Set(props));
    if (id) result = next;
  }

  const reParsed = parseGsapScriptAcornForWrite(result);
  const newIds = (reParsed?.located ?? [])
    .filter((l) => l.animation.targetSelector === animation.targetSelector)
    .map((l) => l.id);
  return { script: result, ids: newIds };
}

// ── Label write ops ───────────────────────────────────────────────────────────

/** True when `expr` is `tl.<method>(…)` rooted at the timeline var. */
function isTimelineMethodCall(
  expr: Node,
  timelineVar: string,
  method: string,
  script: string,
): boolean {
  return (
    expr?.type === "CallExpression" &&
    expr.callee?.type === "MemberExpression" &&
    isTimelineRooted(expr.callee.object, timelineVar, script) &&
    expr.callee.property?.name === method
  );
}

/** True when `expr` is `tl.addLabel("<name>", …)` rooted at the timeline var. */
function isAddLabelCall(expr: Node, timelineVar: string, name: string, script: string): boolean {
  const firstArg = expr?.arguments?.[0];
  return (
    isTimelineMethodCall(expr, timelineVar, "addLabel", script) &&
    firstArg?.type === "Literal" &&
    firstArg.value === name
  );
}

/** Every `tl.addLabel("<name>", …)` ExpressionStatement in the script. */
function findLabelStatements(
  parsed: ParsedGsapAcornForWrite,
  name: string,
  script: string,
): Node[] {
  const targets: Node[] = [];
  acornWalk.simple(parsed.ast, {
    ExpressionStatement(node: Node) {
      if (isAddLabelCall(node.expression, parsed.timelineVar, name, script)) targets.push(node);
    },
  });
  return targets;
}

export function addLabelToScript(script: string, name: string, position: number): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;

  // If the label already exists, MOVE it (overwrite its position) rather than
  // appending a duplicate. Two same-named addLabel statements make removeLabel
  // over-remove — it deletes every match, including a pre-existing label the
  // user never touched.
  const existing = findLabelStatements(parsed, name, script)[0];
  if (existing) {
    const ms = new MagicString(script);
    const posArg = existing.expression.arguments?.[1];
    if (posArg) ms.overwrite(posArg.start, posArg.end, valueToCode(position));
    else ms.appendLeft(existing.expression.end - 1, `, ${valueToCode(position)}`);
    return ms.toString();
  }

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

  const targets = findLabelStatements(parsed, name, script);
  if (!targets.length) return script;

  const ms = new MagicString(script);
  for (const target of targets) {
    const end =
      target.end < script.length && script[target.end] === "\n" ? target.end + 1 : target.end;
    ms.remove(target.start, end);
  }
  return ms.toString();
}

// ── Arc path helpers ─────────────────────────────────────────────────────────

/**
 * Remove a set of properties from an ObjectExpression in a single pass.
 * Groups consecutive marked props into blocks to avoid overlapping remove ranges.
 */
function removePropsByKey(ms: MagicString, objNode: Node, keys: Set<string>): void {
  if (objNode?.type !== "ObjectExpression") return;
  const allProps = (objNode.properties ?? []).filter(isObjectProperty);
  const marked = allProps.map((p: Node) => keys.has(propKeyName(p) ?? ""));
  let i = 0;
  while (i < allProps.length) {
    if (!marked[i]) {
      i++;
      continue;
    }
    const blockStart = i;
    while (i < allProps.length && marked[i]) i++;
    ms.remove(...blockRemoveRange(allProps, blockStart, i));
  }
}

function blockRemoveRange(
  allProps: Node[],
  blockStart: number,
  blockEnd: number,
): [number, number] {
  if (blockStart === 0 && blockEnd === allProps.length)
    return [allProps[0].start, allProps[allProps.length - 1].end];
  if (blockStart === 0) return [allProps[0].start, allProps[blockEnd].start];
  return [allProps[blockStart - 1].end, allProps[blockEnd - 1].end];
}

// fallow-ignore-next-line complexity
function readLastWaypointXY(mpVal: Node): { x: number | null; y: number | null } {
  if (mpVal?.type !== "ObjectExpression") return { x: null, y: null };
  const pathProp = findPropertyNode(mpVal, "path");
  if (pathProp?.value?.type !== "ArrayExpression") return { x: null, y: null };
  const elems: Node[] = pathProp.value.elements ?? [];
  const last = elems[elems.length - 1];
  if (last?.type !== "ObjectExpression") return { x: null, y: null };
  return {
    x: readNumericLiteralNode(findPropertyNode(last, "x")?.value),
    y: readNumericLiteralNode(findPropertyNode(last, "y")?.value),
  };
}

/**
 * Read a numeric value node — a plain numeric literal or a unary-minus negative
 * literal (e.g. `-120`). Returns null for anything non-numeric. Without the
 * UnaryExpression branch, negative waypoint coords (parsed as a UnaryExpression
 * with no `.value`) would be lost when disabling an arc path.
 */
function readNumericLiteralNode(v: Node): number | null {
  if (LITERAL_NODE_TYPES.has(v?.type) && typeof v.value === "number") return v.value;
  if (
    v?.type === "UnaryExpression" &&
    v.operator === "-" &&
    typeof v.argument?.value === "number"
  ) {
    return -v.argument.value;
  }
  return null;
}

function disableArcPath(ms: MagicString, call: TweenCallInfo): boolean {
  const mpProp = findPropertyNode(call.varsArg, "motionPath");
  if (!mpProp) return false;
  const { x, y } = readLastWaypointXY(mpProp.value);
  if (x === null && y === null) {
    const allProps = (call.varsArg.properties ?? []).filter(isObjectProperty);
    removeProp(ms, mpProp, allProps);
    return true;
  }
  // Overwrite the entire motionPath property with the recovered x/y pair — avoids
  // the appendLeft+remove range-boundary issue in MagicString.
  const parts: string[] = [];
  if (x !== null) parts.push(`x: ${x}`);
  if (y !== null) parts.push(`y: ${y}`);
  ms.overwrite(mpProp.start, mpProp.end, parts.join(", "));
  return true;
}

function stripXYFromKeyframes(ms: MagicString, kfPropNode: Node): void {
  if (kfPropNode?.value?.type !== "ObjectExpression") return;
  const xyKeys = new Set(["x", "y"]);
  for (const pctProp of (kfPropNode.value.properties ?? []).filter(isObjectProperty)) {
    const k = propKeyName(pctProp);
    if (typeof k === "string" && k.endsWith("%") && pctProp.value?.type === "ObjectExpression") {
      removePropsByKey(ms, pctProp.value, xyKeys);
    }
  }
}

function enableArcPath(
  ms: MagicString,
  call: TweenCallInfo,
  animation: GsapAnimation,
  config: ArcPathConfig,
): boolean {
  const waypoints = extractArcWaypoints(animation);
  if (waypoints.length < 2) return false;
  const segments: ArcPathSegment[] =
    config.segments.length === waypoints.length - 1
      ? config.segments
      : Array.from({ length: waypoints.length - 1 }, () => ({ curviness: 1 }));
  const motionPathCode = buildMotionPathObjectCode({
    waypoints,
    segments,
    autoRotate: config.autoRotate,
  });
  const vars = call.varsArg;
  if (vars?.type !== "ObjectExpression") return false;
  // Insert motionPath right after the opening `{` (appendRight at start+1) so the
  // insertion point can never coincide with the end boundary of the x/y removal
  // range. upsertProp would appendLeft at `end - 1`, which collides with a
  // remove-range that ends at the same offset when x/y are the only props —
  // MagicString then discards the append and the output loses everything.
  const editable = (vars.properties ?? []).filter(isObjectProperty);
  const survivesRemoval = editable.some((p: Node) => {
    const k = propKeyName(p);
    return k !== "x" && k !== "y";
  });
  const sep = survivesRemoval ? ", " : "";
  ms.appendRight(vars.start + 1, ` motionPath: ${motionPathCode}${sep}`);
  stripXYFromKeyframes(ms, findPropertyNode(call.varsArg, "keyframes"));
  removePropsByKey(ms, call.varsArg, new Set(["x", "y"]));
  return true;
}

export function setArcPathInScript(
  script: string,
  animationId: string,
  config: ArcPathConfig,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const ms = new MagicString(script);
  const handled = config.enabled
    ? enableArcPath(ms, target.call, target.animation, config)
    : disableArcPath(ms, target.call);
  return handled ? ms.toString() : script;
}

export function updateArcSegmentInScript(
  script: string,
  animationId: string,
  segmentIndex: number,
  update: Partial<ArcPathSegment>,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const { call, animation } = target;
  if (!animation.arcPath?.enabled) return script;

  const segments = [...animation.arcPath.segments];
  const existingSeg = segments[segmentIndex];
  if (segmentIndex < 0 || segmentIndex >= segments.length || !existingSeg) return script;

  segments[segmentIndex] = { ...existingSeg, ...update };

  const waypoints = extractArcWaypoints(animation);
  if (waypoints.length < 2) return script;

  const motionPathCode = buildMotionPathObjectCode({
    waypoints,
    segments,
    autoRotate: animation.arcPath.autoRotate,
  });

  const mpProp = findPropertyNode(call.varsArg, "motionPath");
  if (!mpProp) return script;

  const ms = new MagicString(script);
  ms.overwrite(mpProp.value.start, mpProp.value.end, motionPathCode);
  return ms.toString();
}

export function removeArcPathFromScript(script: string, animationId: string): string {
  return setArcPathInScript(script, animationId, {
    enabled: false,
    autoRotate: false,
    segments: [],
  });
}

// ── splitAnimationsInScript helpers ──────────────────────────────────────────

/** Overwrite the selector (first arg) of a tween call. */
function updateAnimationSelectorInScript(
  script: string,
  animationId: string,
  newSelector: string,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;
  const selectorArg = target.call.node.arguments?.[0];
  if (!selectorArg) return script;
  const ms = new MagicString(script);
  ms.overwrite(selectorArg.start, selectorArg.end, JSON.stringify(newSelector));
  return ms.toString();
}

/**
 * Insert a `tl.set()` call immediately after the timeline declaration
 * (before existing tweens) to establish inherited state on a new element.
 */
function insertInheritedStateSetInScript(
  script: string,
  selector: string,
  position: number,
  properties: Record<string, number | string>,
): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const props = Object.entries(properties)
    .map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`)
    .join(", ");
  const code = `${parsed.timelineVar}.set(${JSON.stringify(selector)}, { ${props} }, ${position});`;
  const ms = new MagicString(script);
  const tlDecl = findTimelineDeclarationStatement(parsed.ast, parsed.timelineVar);
  const firstLocated = parsed.located[0];
  if (tlDecl) {
    ms.appendLeft(tlDecl.end, "\n" + code);
  } else if (firstLocated) {
    const firstCall = firstLocated.call;
    const exprStmt = findEnclosingExpressionStatement(firstCall.ancestors);
    const insertAt = exprStmt?.start ?? firstCall.node.start;
    ms.prependLeft(insertAt, code + "\n");
  } else {
    ms.append("\n" + code);
  }
  return ms.toString();
}

/**
 * Compute, in forward (timeline) order, the inherited-props baseline available
 * BEFORE each matching tween, plus the final cumulative state at the split point.
 * A tween contributes to later baselines when it ends at/before the split (full
 * props or last keyframe), spans the split via keyframes (kfs at/before split),
 * or spans the split as a flat tween (its interpolated midpoint). Decoupled from
 * the reverse write loop so the spanning-tween midpoint reads earlier tweens.
 */
// fallow-ignore-next-line complexity
function computeForwardBaselines(
  matching: GsapAnimation[],
  splitTime: number,
): { before: Array<Record<string, number | string>>; final: Record<string, number | string> } {
  const before: Array<Record<string, number | string>> = [];
  const acc: Record<string, number | string> = {};
  for (const anim of matching) {
    before.push({ ...acc });
    const pos = typeof anim.position === "number" ? anim.position : 0;
    const dur = anim.duration ?? 0;
    const animEnd = pos + dur;

    if (anim.keyframes) {
      const kfs = anim.keyframes.keyframes;
      if (pos >= splitTime) {
        // Moves wholly to the new element — contributes nothing to the baseline.
      } else if (animEnd > splitTime) {
        for (const kf of kfs) {
          const kfTime = pos + (kf.percentage / 100) * dur;
          if (kfTime <= splitTime) {
            for (const [k, v] of Object.entries(kf.properties)) acc[k] = v;
          }
        }
      } else {
        const lastKf = kfs[kfs.length - 1];
        if (lastKf) {
          for (const [k, v] of Object.entries(lastKf.properties)) acc[k] = v;
        }
      }
      continue;
    }

    if (animEnd <= splitTime) {
      for (const [k, v] of Object.entries(anim.properties)) acc[k] = v;
      continue;
    }

    if (pos >= splitTime) continue;

    // Flat tween spanning the split — its midpoint becomes the inherited value.
    const progress = dur > 0 ? (splitTime - pos) / dur : 0;
    const fromSource = anim.fromProperties ?? acc;
    for (const [k, v] of Object.entries(anim.properties)) {
      if (typeof v !== "number") {
        acc[k] = v;
        continue;
      }
      const fromVal = typeof fromSource[k] === "number" ? (fromSource[k] as number) : 0;
      acc[k] = fromVal + (v - fromVal) * progress;
    }
  }
  return { before, final: { ...acc } };
}

// Split one tween that straddles the split point: trim the original to the
// first half (interpolated midpoint as its new end) and add a fromTo for the
// second half on the new element. `fromSource` is the forward baseline.
function buildSpanningSplit(
  result: string,
  anim: GsapAnimation,
  pos: number,
  dur: number,
  fromSource: Record<string, number | string>,
  ctx: { splitTime: number; newSelector: string; newElementStart: number },
): string {
  const progress = dur > 0 ? (ctx.splitTime - pos) / dur : 0;
  const midProps: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(anim.properties)) {
    if (typeof v !== "number") {
      midProps[k] = v;
      continue;
    }
    const fromVal = typeof fromSource[k] === "number" ? (fromSource[k] as number) : 0;
    midProps[k] = fromVal + (v - fromVal) * progress;
  }
  const trimmed = updateAnimationInScript(result, anim.id, {
    duration: ctx.splitTime - pos,
    properties: midProps,
  });
  return addAnimationToScript(trimmed, {
    targetSelector: ctx.newSelector,
    method: "fromTo",
    position: ctx.newElementStart,
    duration: pos + dur - ctx.splitTime,
    properties: { ...anim.properties },
    fromProperties: { ...midProps },
    ease: anim.ease,
    extras: anim.extras,
  }).script;
}

type SplitCtx = {
  splitTime: number;
  originalSelector: string;
  newSelector: string;
  newElementStart: number;
};

// Decide what one matching tween does at the split point: move to the new
// element (wholly after), stay (wholly before / keyframes before), get skipped
// (keyframes spanning), or get interpolated in half (spanning). Returns the
// updated script; pushes any skip reason into `skippedSelectors`.
function applyTweenSplit(
  result: string,
  anim: GsapAnimation,
  baselineBefore: Record<string, number | string>,
  ctx: SplitCtx,
  skippedSelectors: string[],
): string {
  const pos = typeof anim.position === "number" ? anim.position : 0;
  const dur = anim.duration ?? 0;
  const animEnd = pos + dur;

  if (anim.keyframes) {
    if (pos >= ctx.splitTime)
      return updateAnimationSelectorInScript(result, anim.id, ctx.newSelector);
    if (animEnd > ctx.splitTime) {
      skippedSelectors.push(`${ctx.originalSelector} (keyframes spanning split)`);
    }
    // Inherited-state for kf tweens is handled by computeForwardBaselines.
    return result;
  }
  // Wholly before the split — kept on the original element.
  if (animEnd <= ctx.splitTime) return result;
  // Wholly after — move to the new element.
  if (pos >= ctx.splitTime)
    return updateAnimationSelectorInScript(result, anim.id, ctx.newSelector);
  // Spans the split — interpolate the midpoint from the FORWARD baseline.
  const fromSource = anim.fromProperties ?? baselineBefore;
  return buildSpanningSplit(result, anim, pos, dur, fromSource, ctx);
}

export function splitAnimationsInScript(
  script: string,
  opts: SplitAnimationsOptions,
): SplitAnimationsResult {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return { script, skippedSelectors: [] };

  const originalSelector = `#${opts.originalId}`;
  const newSelector = `#${opts.newId}`;

  const animations = parsed.located.map((l) => l.animation);
  const skippedSelectors: string[] = [];

  for (const a of animations) {
    if (a.targetSelector !== originalSelector && a.targetSelector.includes(opts.originalId)) {
      skippedSelectors.push(a.targetSelector);
    }
  }

  const matching = animations.filter((a) => a.targetSelector === originalSelector);
  if (matching.length === 0) return { script, skippedSelectors };

  let result = script;
  const newElementStart = opts.splitTime;

  // Forward pre-pass: compute the inherited-props baseline available BEFORE each
  // matching tween, in source/timeline order. The write loop below runs in
  // REVERSE (so updateAnimationSelectorInScript's selector edits can't shift the
  // count-based IDs of not-yet-processed tweens), but the spanning-tween midpoint
  // interpolation needs the baseline from EARLIER tweens — which a reverse
  // accumulator hasn't seen yet. Decoupling the two fixes the wrong midpoint.
  const { before: baselineBefore, final: finalInheritedProps } = computeForwardBaselines(
    matching,
    opts.splitTime,
  );

  // Reverse iteration: updateAnimationSelectorInScript mutates selectors which
  // can shift count-based ID suffixes for later animations.
  const ctx = { splitTime: opts.splitTime, originalSelector, newSelector, newElementStart };
  for (let i = matching.length - 1; i >= 0; i--) {
    const anim = matching[i];
    if (!anim) continue;
    result = applyTweenSplit(result, anim, baselineBefore[i] ?? {}, ctx, skippedSelectors);
  }

  if (Object.keys(finalInheritedProps).length > 0) {
    result = insertInheritedStateSetInScript(
      result,
      newSelector,
      newElementStart,
      finalInheritedProps,
    );
  }

  return { script: result, skippedSelectors };
}

// ── Unroll dynamic animations ────────────────────────────────────────────────

function isLoopNode(node: Node): boolean {
  const t = node?.type;
  return (
    t === "ForStatement" ||
    t === "ForInStatement" ||
    t === "ForOfStatement" ||
    t === "WhileStatement"
  );
}

function isForEachStatement(node: Node): boolean {
  return (
    node?.type === "ExpressionStatement" &&
    node.expression?.type === "CallExpression" &&
    node.expression.callee?.property?.name === "forEach"
  );
}

/** The nearest enclosing loop / forEach AST node (not just its byte range). */
function findEnclosingLoopNode(ancestors: Node[]): Node | null {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const node = ancestors[i];
    if (isLoopNode(node) || isForEachStatement(node)) return node;
  }
  return null;
}

/** Statements making up a loop's body block, or null when not a simple block. */
function loopBodyStatements(loopNode: Node): Node[] | null {
  let body: Node;
  if (loopNode?.type === "ExpressionStatement") {
    // forEach(cb): body is the callback's block.
    const cb = loopNode.expression?.arguments?.[0];
    body = cb?.body;
  } else {
    body = loopNode?.body;
  }
  if (body?.type !== "BlockStatement") return null;
  return (body.body ?? []).filter((s: Node) => s?.type === "ExpressionStatement");
}

/** The loop's index identifier name (`for (let i …)`), used for per-iteration substitution. */
function loopIndexVarName(loopNode: Node): string | null {
  if (loopNode?.type === "ForStatement") {
    const decl = loopNode.init?.declarations?.[0];
    return typeof decl?.id?.name === "string" ? decl.id.name : null;
  }
  return null;
}

/**
 * Rewrite one body statement's source for iteration `idx`: replace USES of the
 * loop index variable (AST Identifier nodes) with the literal index. AST-based,
 * not a text regex, so the index name appearing inside a string literal (e.g. a
 * selector ".row-i") or as a non-computed member/key (`obj.i`, `{ i: … }`) is
 * left untouched — only real references to the variable are substituted.
 */
// An identifier in "binding position" is a name, not a value reference: a
// non-computed member property (`obj.i`) or object-literal key (`{ i: … }`).
// Those must NOT be substituted with the iteration index.
function isIndexBindingPosition(node: Node, parent: Node): boolean {
  if (parent?.type === "MemberExpression") return parent.property === node && !parent.computed;
  if (parent?.type === "Property" || parent?.type === "ObjectProperty") {
    return parent.key === node && !parent.computed;
  }
  return false;
}

function substituteLoopIndex(stmt: Node, indexVar: string, idx: number, script: string): string {
  const base = stmt.start as number;
  const src = script.slice(base, stmt.end as number);
  const ranges: Array<[number, number]> = [];
  acornWalk.ancestor(stmt, {
    Identifier(node: Node, _state: unknown, ancestors: Node[]) {
      if (node.name !== indexVar) return;
      if (isIndexBindingPosition(node, ancestors[ancestors.length - 2])) return;
      ranges.push([(node.start as number) - base, (node.end as number) - base]);
    },
  });
  if (ranges.length === 0) return src;
  ranges.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [s, e] of ranges) out = out.slice(0, s) + String(idx) + out.slice(e);
  return out;
}

function buildUnrollReplacement(
  timelineVar: string,
  animation: GsapAnimation,
  elements: Array<{
    selector: string;
    keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
    easeEach?: string;
  }>,
): string {
  const duration = typeof animation.duration === "number" ? animation.duration : 8;
  const ease = typeof animation.ease === "string" ? animation.ease : "none";
  const pos = animation.position ?? 0;
  const posCode = typeof pos === "number" ? String(pos) : JSON.stringify(pos);
  const calls = elements.map((el) => {
    const sorted = [...el.keyframes].sort((a, b) => a.percentage - b.percentage);
    const kfCode = buildKeyframeObjectCode(sorted, el.easeEach);
    return `${timelineVar}.to(${JSON.stringify(el.selector)}, { keyframes: ${kfCode}, duration: ${duration}, ease: ${JSON.stringify(ease)} }, ${posCode});`;
  });
  return calls.join("\n  ");
}

export type UnrollElement = {
  selector: string;
  keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
  easeEach?: string;
};

/** Build one element's unrolled `tl.to(...)` call from the target animation. */
function buildUnrollCallForElement(
  timelineVar: string,
  animation: GsapAnimation,
  el: UnrollElement,
): string {
  const duration = typeof animation.duration === "number" ? animation.duration : 8;
  const ease = typeof animation.ease === "string" ? animation.ease : "none";
  const pos = animation.position ?? 0;
  const posCode = typeof pos === "number" ? String(pos) : JSON.stringify(pos);
  const sorted = [...el.keyframes].sort((a, b) => a.percentage - b.percentage);
  const kfCode = buildKeyframeObjectCode(sorted, el.easeEach);
  return `${timelineVar}.to(${JSON.stringify(el.selector)}, { keyframes: ${kfCode}, duration: ${duration}, ease: ${JSON.stringify(ease)} }, ${posCode});`;
}

/** Sentinel: the unroll cannot safely reproduce the loop body — caller no-ops. */
const REFUSE_UNROLL = Symbol("refuse-unroll");

/** Every statement in a loop's body block (unfiltered), or [] when not a block. */
function loopBodyRawStatements(loopNode: Node): Node[] {
  const body =
    loopNode?.type === "ExpressionStatement"
      ? loopNode.expression?.arguments?.[0]?.body
      : loopNode?.body;
  return body?.type === "BlockStatement" ? (body.body ?? []) : [];
}

/** A node that re-binds `indexVar`: a re-declaration or a function param. */
function rebindsIndex(node: Node, indexVar: string): boolean {
  if (node.type === "VariableDeclarator") return node.id?.name === indexVar;
  if (
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return (node.params ?? []).some((p: Node) => p?.name === indexVar);
  }
  return false;
}

/** Object shorthand `{ i }` — substituting the value would yield invalid `{ 0 }`. */
function isShorthandIndexUse(node: Node, indexVar: string): boolean {
  return (
    (node.type === "Property" || node.type === "ObjectProperty") &&
    node.shorthand === true &&
    propKeyName(node) === indexVar
  );
}

/**
 * A sibling statement can't be safely index-substituted when it re-binds the
 * loop index (shadowing — a nested `for (let i …)`, a callback param `i`) or
 * uses it in object shorthand (`{ i }`, which would splice to the invalid
 * `{ 0 }`). substituteLoopIndex has no scope analysis, so in these cases it
 * would emit broken or wrong code — the unroll must refuse instead.
 */
function hasUnsafeLoopIndexUse(stmt: Node, indexVar: string): boolean {
  let unsafe = false;
  acornWalk.full(stmt, (node: Node) => {
    if (!unsafe && (isShorthandIndexUse(node, indexVar) || rebindsIndex(node, indexVar))) {
      unsafe = true;
    }
  });
  return unsafe;
}

/** How to handle the loop body's non-target siblings when unrolling. */
function unrollSiblingStrategy(
  loopNode: Node,
  targetStmt: Node,
  stmts: Node[],
  indexVar: string | null,
): "blanket" | "refuse" | "preserve" {
  const siblings = stmts.filter((s) => s !== targetStmt);
  // A sibling the filtered statement list doesn't model (non-ExpressionStatement)
  // would be silently lost by either path — refuse if any exists.
  const hasUnmodeledSibling = loopBodyRawStatements(loopNode).some(
    (s) => s !== targetStmt && !stmts.includes(s),
  );
  if (siblings.length === 0 && !hasUnmodeledSibling) return "blanket";
  if (hasUnmodeledSibling || !indexVar) return "refuse";
  return siblings.some((s) => hasUnsafeLoopIndexUse(s, indexVar)) ? "refuse" : "preserve";
}

/** Emit the per-iteration unrolled lines (target → static tl.to, siblings → index-substituted). */
function emitUnrolledLines(
  stmts: Node[],
  targetStmt: Node,
  elements: UnrollElement[],
  timelineVar: string,
  animation: GsapAnimation,
  indexVar: string,
  script: string,
): string {
  const lines: string[] = [];
  for (let idx = 0; idx < elements.length; idx++) {
    const el = elements[idx];
    if (!el) continue;
    for (const stmt of stmts) {
      lines.push(
        stmt === targetStmt
          ? buildUnrollCallForElement(timelineVar, animation, el)
          : substituteLoopIndex(stmt, indexVar, idx, script),
      );
    }
  }
  return lines.join("\n  ");
}

/**
 * Unroll the loop body, preserving every statement that is NOT the target tween.
 * For each iteration, emit each non-target statement with the loop index
 * substituted (e.g. `tl.set(items[i], …)` → `tl.set(items[0], …)`), and replace
 * the target tween statement with that element's static `tl.to()` call.
 *
 * Returns null when a blanket overwrite is lossless (no sibling statements), and
 * REFUSE_UNROLL when siblings exist but can't be safely reproduced — a non-`for`
 * loop (no numeric index to splice), a statement we don't model, or an unsafe
 * index use (shadowing / shorthand). Refusing no-ops the unroll, which is safe:
 * the dynamic loop keeps rendering correctly, just un-flattened.
 */
function buildLoopUnrollPreserving(
  script: string,
  timelineVar: string,
  animation: GsapAnimation,
  elements: UnrollElement[],
  loopNode: Node,
  targetStmt: Node,
): string | null | typeof REFUSE_UNROLL {
  const stmts = loopBodyStatements(loopNode);
  if (!stmts || !stmts.includes(targetStmt)) return null;
  const indexVar = loopIndexVarName(loopNode);
  const strategy = unrollSiblingStrategy(loopNode, targetStmt, stmts, indexVar);
  if (strategy === "blanket") return null;
  if (strategy === "refuse" || !indexVar) return REFUSE_UNROLL;
  return emitUnrolledLines(stmts, targetStmt, elements, timelineVar, animation, indexVar, script);
}

/**
 * Replace a dynamic loop that generates multiple tween calls with individual
 * static `tl.to()` calls — one per element. Finds the loop containing the
 * animation and replaces the loop with unrolled static calls, preserving every
 * non-target statement in the loop body per iteration.
 */
export function unrollDynamicAnimations(
  script: string,
  animationId: string,
  elements: UnrollElement[],
): string {
  // An empty element list has no unrolled form — replacing the loop/statement
  // with zero calls would silently delete the animation. No-op instead.
  if (elements.length === 0) return script;
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  const target = parsed.located.find((l) => l.id === animationId);
  if (!target) return script;

  const ms = new MagicString(script);
  const loopNode = findEnclosingLoopNode(target.call.ancestors);
  if (loopNode) {
    const targetStmt = findEnclosingExpressionStatement(target.call.ancestors);
    const preserving = targetStmt
      ? buildLoopUnrollPreserving(
          script,
          parsed.timelineVar,
          target.animation,
          elements,
          loopNode,
          targetStmt,
        )
      : null;
    // Siblings exist but can't be safely reproduced — leave the loop untouched
    // rather than drop or corrupt them. The op no-ops (before === after).
    if (preserving === REFUSE_UNROLL) return script;
    // Fall back to the simple whole-body replacement when the body isn't a plain
    // block of statements we can preserve.
    const replacement =
      preserving ?? buildUnrollReplacement(parsed.timelineVar, target.animation, elements);
    ms.overwrite(loopNode.start as number, loopNode.end as number, replacement);
  } else {
    const stmt = findEnclosingExpressionStatement(target.call.ancestors);
    if (!stmt) return script;
    const replacement = buildUnrollReplacement(parsed.timelineVar, target.animation, elements);
    ms.overwrite(stmt.start as number, stmt.end as number, replacement);
  }
  return ms.toString();
}
