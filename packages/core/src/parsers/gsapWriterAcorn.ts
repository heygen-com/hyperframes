// fallow-ignore-file duplication
/**
 * Browser-safe GSAP write path — magic-string offset-splice.
 *
 * T6c: edits GSAP scripts by overwriting/removing byte ranges in the original
 * source. Every byte outside the edited span is preserved verbatim — no
 * pretty-printer churn. Consumes ParsedGsapAcornForWrite from gsapParserAcorn.ts.
 */
import MagicString from "magic-string";
import type { GsapAnimation } from "./gsapSerialize.js";
import { parseGsapScriptAcornForWrite, type TweenCallInfo } from "./gsapParserAcorn.js";
import * as acornWalk from "acorn-walk";

// ── Code generation helpers ──────────────────────────────────────────────────

function valueToCode(value: number | string): string {
  if (typeof value === "string" && value.startsWith("__raw:")) return value.slice(6);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function safeKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
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
function upsertProp(ms: MagicString, objNode: any, key: string, value: number | string): void {
  if (objNode?.type !== "ObjectExpression") return;
  const existing = findPropertyNode(objNode, key);
  if (existing) {
    ms.overwrite(existing.value.start, existing.value.end, valueToCode(value));
  } else {
    const sep = objNode.properties.length > 0 ? ", " : "";
    ms.appendLeft(objNode.end - 1, `${sep}${safeKey(key)}: ${valueToCode(value)}`);
  }
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

  if (updates.duration !== undefined) {
    upsertProp(ms, call.varsArg, "duration", updates.duration);
  }

  if (updates.ease !== undefined) {
    upsertProp(ms, call.varsArg, "ease", updates.ease);
  }

  if (updates.properties) {
    for (const [key, value] of Object.entries(updates.properties)) {
      upsertProp(ms, call.varsArg, key, value);
    }
  }

  if (updates.fromProperties && call.method === "fromTo" && call.fromArg) {
    for (const [key, value] of Object.entries(updates.fromProperties)) {
      upsertProp(ms, call.fromArg, key, value);
    }
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

  const ms = new MagicString(script);
  const statementCode = buildTweenStatementCode(parsed.timelineVar, animation);

  let insertionPoint: number;
  if (parsed.located.length > 0) {
    const lastCall = parsed.located[parsed.located.length - 1]!.call;
    const exprStmt = findEnclosingExpressionStatement(lastCall.ancestors);
    insertionPoint = exprStmt?.end ?? lastCall.node.end;
  } else {
    const tlDecl = findTimelineDeclarationStatement(parsed.ast, parsed.timelineVar);
    insertionPoint = tlDecl?.end ?? script.length;
  }

  ms.appendLeft(insertionPoint, "\n" + statementCode);

  const result = ms.toString();
  const reParsed = parseGsapScriptAcornForWrite(result);
  const newId = reParsed?.located[reParsed.located.length - 1]?.id ?? "";
  return { script: result, id: newId };
}

export function removeAnimationFromScript(script: string, animationId: string): string {
  const parsed = parseGsapScriptAcornForWrite(script);
  if (!parsed) return script;
  let target = parsed.located.find((l) => l.id === animationId);
  if (!target) {
    const convertedId = animationId.replace(/-from-|-fromTo-/, "-to-");
    target = parsed.located.find((l) => l.id === convertedId);
  }
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

// ── Keyframe write ops ────────────────────────────────────────────────────────

const PERCENTAGE_KEY_RE = /^(\d+(?:\.\d+)?)%$/;

function percentageFromKey(key: string): number {
  const m = PERCENTAGE_KEY_RE.exec(key);
  return m ? Number.parseFloat(m[1] ?? "0") : Number.NaN;
}

function buildKeyframeValueCode(
  properties: Record<string, number | string>,
  ease?: string,
): string {
  const entries = Object.entries(properties).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
  if (ease) entries.push(`ease: ${JSON.stringify(ease)}`);
  return `{ ${entries.join(", ")} }`;
}

function findKfPropByPct(kfNode: any, percentage: number): { prop: any; idx: number } | null {
  const props = kfNode.properties ?? [];
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (!isObjectProperty(prop)) continue;
    const key = propKeyName(prop);
    if (typeof key === "string" && Math.abs(percentageFromKey(key) - percentage) < 0.001) {
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

  const ms = new MagicString(script);
  ms.overwrite(
    match.prop.value.start,
    match.prop.value.end,
    buildKeyframeValueCode(properties, ease),
  );
  return ms.toString();
}

// fallow-ignore-next-line complexity
export function addKeyframeToScript(
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
  const kfNode = kfPropNode.value;

  const ms = new MagicString(script);
  const pctKey = `${percentage}%`;
  const valueCode = buildKeyframeValueCode(properties, ease);

  const existing = findKfPropByPct(kfNode, percentage);
  if (existing) {
    ms.overwrite(existing.prop.value.start, existing.prop.value.end, valueCode);
  } else {
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
      // Insert `"pct%": {...}, ` before the next higher-percentage prop
      ms.appendLeft(insertBeforeProp.start, `${JSON.stringify(pctKey)}: ${valueCode}, `);
    } else {
      // Append at end of kfNode properties
      const sep = allProps.length > 0 ? ", " : "";
      ms.appendLeft(kfNode.end - 1, `${sep}${JSON.stringify(pctKey)}: ${valueCode}`);
    }
  }

  return ms.toString();
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

  const allProps = (kfNode.properties ?? []).filter((p: any) => isObjectProperty(p));
  const ms = new MagicString(script);
  removeProp(ms, match.prop, allProps);
  return ms.toString();
}
