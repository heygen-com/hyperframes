/**
 * Unroll computed GSAP timelines (helpers / bounded loops) into explicit literal
 * tweens — the source-rewrite behind the Studio "Unroll to edit" action.
 *
 * Strategy: the read parser already resolves each computed tween (positions,
 * motionPath arcs, keyframes, provenance). We serialize those resolved
 * animations back to literal `tl.*` statements and surgically replace the
 * top-level helper-call / loop statements that produced them (and drop the now
 * dead helper declarations) via magic-string, leaving the rest of the source —
 * literal tweens, comments, formatting — untouched. The result is a visual
 * no-op: re-parsing it yields the same animations, now all literal.
 *
 * Scope: top-level helper calls and loops (the common authoring shape). Tweens
 * whose origin can't be mapped to a top-level statement (e.g. helpers nested
 * inside other helpers) are left as-is rather than guessed at.
 */
import * as acorn from "acorn";
import MagicString from "magic-string";
import type { GsapAnimation } from "./gsapSerialize.js";
import { serializeValue as valueToCode, safeJsKey as safeKey } from "./gsapSerialize.js";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";

// acorn nodes are structurally untyped here.
type Node = any;

function propEntries(props: Record<string, number | string>): string[] {
  return Object.entries(props).map(([k, v]) => `${safeKey(k)}: ${valueToCode(v)}`);
}

function motionPathEntry(anim: GsapAnimation): string {
  const waypoints = (anim.keyframes?.keyframes ?? [])
    .filter((k) => typeof k.properties.x === "number" && typeof k.properties.y === "number")
    .map((k) => `{ x: ${valueToCode(k.properties.x!)}, y: ${valueToCode(k.properties.y!)} }`);
  const curviness = anim.arcPath?.segments[0]?.curviness ?? 1;
  const autoRotate = anim.arcPath?.autoRotate;
  const extra = autoRotate ? `, autoRotate: ${valueToCode(autoRotate as number | string)}` : "";
  return `motionPath: { path: [${waypoints.join(", ")}], curviness: ${curviness}${extra} }`;
}

function keyframesEntry(anim: GsapAnimation): string {
  const kfs = (anim.keyframes?.keyframes ?? []).map((k) => {
    const body = propEntries(k.properties);
    if (k.ease) body.push(`ease: ${valueToCode(k.ease)}`);
    return `"${k.percentage}%": { ${body.join(", ")} }`;
  });
  if (anim.keyframes?.easeEach) kfs.push(`easeEach: ${valueToCode(anim.keyframes.easeEach)}`);
  return `keyframes: { ${kfs.join(", ")} }`;
}

/** The vars-object entries for a tween: motionPath/keyframes block, props, duration, ease, extras. */
function buildVarsParts(anim: GsapAnimation): string[] {
  const parts: string[] = [];
  if (anim.arcPath?.enabled) parts.push(motionPathEntry(anim));
  else if (anim.keyframes) parts.push(keyframesEntry(anim));
  parts.push(...propEntries(anim.properties));
  if (anim.method !== "set" && anim.duration !== undefined) {
    parts.push(`duration: ${valueToCode(anim.duration)}`);
  }
  if (anim.ease) parts.push(`ease: ${valueToCode(anim.ease)}`);
  for (const [k, v] of Object.entries(anim.extras ?? {})) {
    parts.push(`${safeKey(k)}: ${valueToCode(v as number | string)}`);
  }
  return parts;
}

/** Serialize one resolved animation to a literal `tl.*` statement (arc/keyframe-aware). */
function serializeTweenStatement(timelineVar: string, anim: GsapAnimation): string {
  const obj = `{ ${buildVarsParts(anim).join(", ")} }`;
  const pos = valueToCode(
    anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0),
  );
  const sel = valueToCode(anim.targetSelector);
  if (anim.method === "fromTo") {
    const from = `{ ${propEntries(anim.fromProperties ?? {}).join(", ")} }`;
    return `${timelineVar}.fromTo(${sel}, ${from}, ${obj}, ${pos});`;
  }
  return `${timelineVar}.${anim.method}(${sel}, ${obj}, ${pos});`;
}

/** A computed animation is one expanded from a helper or loop (not literal/dynamic). */
function isComputed(anim: GsapAnimation): boolean {
  return anim.provenance?.kind === "helper" || anim.provenance?.kind === "loop";
}

/** Top-level statements of the parsed program. */
function topLevelStatements(script: string): Node[] {
  return acorn.parse(script, { ecmaVersion: "latest", sourceType: "script" }).body ?? [];
}

/** The top-level statement whose source span contains [start, end], or null. */
function enclosingTopLevel(statements: Node[], start: number, end: number): Node | null {
  for (const stmt of statements) {
    if (stmt.start <= start && stmt.end >= end) return stmt;
  }
  return null;
}

function isHelperDeclNamed(stmt: Node, names: Set<string>): boolean {
  if (stmt.type === "FunctionDeclaration") return names.has(stmt.id?.name);
  if (stmt.type === "VariableDeclaration") {
    return (stmt.declarations ?? []).some((d: Node) => names.has(d.id?.name));
  }
  return false;
}

/**
 * Rewrite `script` so top-level helper calls / loops that build the timeline
 * become explicit literal tweens. Returns the original script unchanged when
 * there is nothing statically-resolvable to unroll.
 */
export function unrollComputedTimeline(script: string): string {
  const parsed = parseGsapScriptAcorn(script);
  const computed = parsed.animations.filter((a) => isComputed(a) && a.provenance?.sourceRange);
  if (computed.length === 0) return script;

  const statements = topLevelStatements(script);

  // Group computed animations by the top-level statement that produced them,
  // preserving source order within each group.
  const byStatement = new Map<Node, GsapAnimation[]>();
  const helperNames = new Set<string>();
  for (const anim of computed) {
    if (anim.provenance?.fn) helperNames.add(anim.provenance.fn);
    const [s, e] = anim.provenance!.sourceRange!;
    const stmt = enclosingTopLevel(statements, s, e);
    if (!stmt) continue; // nested origin — leave it; can't map to a top-level edit
    const list = byStatement.get(stmt) ?? [];
    list.push(anim);
    byStatement.set(stmt, list);
  }
  if (byStatement.size === 0) return script;

  const ms = new MagicString(script);
  for (const [stmt, anims] of byStatement) {
    const literals = anims.map((a) => serializeTweenStatement(parsed.timelineVar, a)).join("\n");
    ms.overwrite(stmt.start, stmt.end, literals);
  }
  // Drop the now-dead helper declarations.
  for (const stmt of statements) {
    if (isHelperDeclNamed(stmt, helperNames)) ms.remove(stmt.start, stmt.end);
  }
  return ms.toString();
}
