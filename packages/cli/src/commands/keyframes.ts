import { defineCommand } from "citty";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, basename, join, relative, sep } from "node:path";
import { parseGsapScript, type GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Surface every keyframe + motion path in the project", "hyperframes keyframes"],
  ["Inspect one composition file", "hyperframes keyframes compositions/scene.html"],
  ["Machine-readable output for an agent", "hyperframes keyframes --json"],
  ["Only one element's keyframes", "hyperframes keyframes --selector '#puck-a'"],
  ["Runtime-aware hint for CSS/Anime compositions", "hyperframes keyframes --runtime all"],
];

// ── Surfaced shapes ──────────────────────────────────────────────────────────

interface KeyframePoint {
  /** Tween-relative percentage (0–100). */
  pct: number;
  /** Absolute timeline time (seconds) = tweenStart + pct/100 * duration. */
  time: number;
  properties: Record<string, number | string>;
}

interface SurfacedTween {
  id: string;
  target: string;
  method: string;
  group?: string;
  start: number;
  duration: number;
  end: number;
  /** "keyframes" (array/object form), "flat" (to/from), or "motionPath". */
  shape: "keyframes" | "flat" | "motionPath";
  keyframes: KeyframePoint[];
  /** x/y position points (gsap offsets) when this tween animates position. */
  path: Array<{ x: number; y: number }> | null;
  /** Animated ANCESTOR elements (nested composition): this element's rendered
   *  motion is composed with theirs. Surfaced so a reader of the text/JSON
   *  doesn't miss a parent's path/trajectory that lives on another element. */
  composedWith?: Array<{ selector: string; summary: string }>;
}

/** One drawn stroke of a multi-stroke trace — a single position tween. */
interface TraceStroke {
  id: string;
  start: number;
  end: number;
  keyframes: KeyframePoint[];
  points: Array<{ x: number; y: number }>;
}

/** An element's position motion composited into ordered strokes. The gaps
 *  between strokes are pen-up jumps (a 0-duration `set`, or a discontinuity)
 *  and are NOT drawn — this is how one element traces shapes with holes or
 *  detached parts (a `?` dot, an icon counter, multi-letter words). */
interface SurfacedTrace {
  target: string;
  strokes: TraceStroke[];
}

interface CssKeyframeStop {
  selector: string;
  declarations: string[];
}

interface SurfacedCssKeyframes {
  name: string;
  selectors: string[];
  keyframes: CssKeyframeStop[];
}

interface SurfacedAnimeAnimation {
  kind: "animation" | "timeline";
  targets: string[];
  durations: Array<number | string>;
  registered: boolean;
}

interface SurfacedComposition {
  composition: string;
  source: string;
  tweens: SurfacedTween[];
  /** Multi-stroke traces: targets with ≥2 drawn position strokes, composited. */
  traces: SurfacedTrace[];
  cssKeyframes: SurfacedCssKeyframes[];
  anime: SurfacedAnimeAnimation[];
}

// ── GSAP extraction ──────────────────────────────────────────────────────────

// <template> content lives in an inert DocumentFragment that document-level
// querySelectorAll does not traverse — and sub-compositions are REQUIRED to wrap
// markup + script in <template>. Query the document and every template fragment
// (including templates nested inside another template's fragment, walked
// iteratively), or template-wrapped compositions surface zero tweens/keyframes.
// Ordering contract: document-level matches come first, then template contents
// in discovery order — NOT strict source order when a file mixes top-level and
// template scripts. Spec-conformant sub-compositions keep everything in one
// template, so mixed files only need to parse, not preserve interleaving.
function queryIncludingTemplates(html: string, selector: string): Element[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const roots: Array<{ querySelectorAll(s: string): Iterable<Element> }> = [doc];
  const queue = Array.from(doc.querySelectorAll("template")) as HTMLTemplateElement[];
  while (queue.length > 0) {
    const content = queue.shift()!.content;
    if (!content) continue;
    roots.push(content);
    queue.push(...(Array.from(content.querySelectorAll("template")) as HTMLTemplateElement[]));
  }
  return roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
}

function inlineScriptText(html: string): string {
  return queryIncludingTemplates(html, "script")
    .filter((s) => !s.getAttribute("src"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

function inlineStyleText(html: string): string {
  return queryIncludingTemplates(html, "style")
    .map((s) => s.textContent ?? "")
    .join("\n");
}

function num(v: number | string | undefined): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isPositionTween(anim: GsapAnimation): boolean {
  if (anim.propertyGroup === "position") return true;
  const has = (p: Record<string, number | string> | undefined) => !!p && ("x" in p || "y" in p);
  if (has(anim.properties) || has(anim.fromProperties)) return true;
  return (anim.keyframes?.keyframes ?? []).some(
    (kf) => "x" in kf.properties || "y" in kf.properties,
  );
}

// The rest-state value for an animated property (what GSAP animates to/from when
// the other endpoint is the element's natural pose): 1 for scale/opacity, 0 for
// translate/rotation.
function baseProps(props: Record<string, number | string>): Record<string, number | string> {
  const base: Record<string, number | string> = {};
  for (const k of Object.keys(props)) {
    if (k === "ease") continue;
    base[k] = k === "opacity" || k.startsWith("scale") ? 1 : 0;
  }
  return base;
}

// Flat tweens carry no explicit keyframes — synthesize a 0%/100% pair against the
// element's rest pose so the surfaced keyframes are uniform. `from()` goes
// fromProperties → base; `to()` goes base → properties.
function flatKeyframes(anim: GsapAnimation): KeyframePoint[] {
  if (anim.method === "fromTo") {
    return [
      { pct: 0, time: 0, properties: anim.fromProperties ?? {} },
      { pct: 100, time: 0, properties: anim.properties ?? {} },
    ];
  }
  // to()/from() vars both live in anim.properties; from() plays them in reverse
  // against the element's rest pose.
  const vars = anim.properties ?? {};
  const base = baseProps(vars);
  return anim.method === "from"
    ? [
        { pct: 0, time: 0, properties: vars },
        { pct: 100, time: 0, properties: base },
      ]
    : [
        { pct: 0, time: 0, properties: base },
        { pct: 100, time: 0, properties: vars },
      ];
}

// Studio-internal markers that aren't user motion: the position-hold `set` GSAP
// runs before a keyframed position tween (`data: "hf-hold"`).
function isHoldMarker(anim: GsapAnimation): boolean {
  return anim.properties?.data === "hf-hold" || anim.fromProperties?.data === "hf-hold";
}

// Drop internal / non-visual keys so they don't pollute the surfaced keyframes.
function cleanProps(props: Record<string, number | string>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "data" || k === "ease") continue;
    out[k] = v;
  }
  return out;
}

function surfaceTween(anim: GsapAnimation): SurfacedTween {
  const start =
    typeof anim.resolvedStart === "number" ? anim.resolvedStart : (num(anim.position) ?? 0);
  const duration = anim.duration ?? 0;

  let shape: SurfacedTween["shape"];
  let rawKfs: Array<{ percentage: number; properties: Record<string, number | string> }>;
  if (anim.keyframes?.keyframes?.length) {
    shape = "keyframes";
    rawKfs = anim.keyframes.keyframes;
  } else if (anim.arcPath?.enabled) {
    shape = "motionPath";
    rawKfs = [];
  } else {
    shape = "flat";
    rawKfs = flatKeyframes(anim).map((k) => ({ percentage: k.pct, properties: k.properties }));
  }

  const keyframes: KeyframePoint[] = rawKfs.map((kf) => ({
    pct: kf.percentage,
    time: Math.round((start + (kf.percentage / 100) * duration) * 1000) / 1000,
    properties: cleanProps(kf.properties),
  }));

  return {
    id: anim.id,
    target: anim.targetSelector,
    method: anim.method,
    group: anim.propertyGroup,
    start: Math.round(start * 1000) / 1000,
    duration,
    end: Math.round((start + duration) * 1000) / 1000,
    shape,
    keyframes,
    path: isPositionTween(anim) ? positionPath(keyframes) : null,
  };
}

// Carry x/y forward across keyframes that only set one axis, so the path is
// continuous (GSAP holds the last value for an unspecified property).
function positionPath(keyframes: KeyframePoint[]): Array<{ x: number; y: number }> | null {
  if (keyframes.length === 0) return null;
  let lastX = 0;
  let lastY = 0;
  return keyframes.map((kf) => {
    const x = num(kf.properties.x);
    const y = num(kf.properties.y);
    if (x !== null) lastX = x;
    if (y !== null) lastY = y;
    return { x: lastX, y: lastY };
  });
}

// ── Composition surfacing ────────────────────────────────────────────────────

export function surfaceComposition(
  html: string,
  label: string,
  source: string,
): SurfacedComposition {
  const script = inlineScriptText(html);
  let animations: GsapAnimation[] = [];
  try {
    animations = parseGsapScript(script).animations;
  } catch {
    animations = [];
  }
  const tweens = animations.filter((a) => !isHoldMarker(a)).map(surfaceTween);
  attachComposedAncestors(tweens, html);
  return {
    composition: label,
    source,
    tweens,
    traces: groupTraces(tweens),
    cssKeyframes: surfaceCssKeyframes(inlineStyleText(html)),
    anime: surfaceAnime(inlineScriptText(html)),
  };
}

// ── CSS / Anime extraction ───────────────────────────────────────────────────

function readBalancedBlock(text: string, openBrace: number): { body: string; end: number } | null {
  if (text[openBrace] !== "{") return null;
  let depth = 0;
  for (let i = openBrace; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { body: text.slice(openBrace + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function parseDeclarations(body: string): string[] {
  return body
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripRanges(text: string, ranges: Array<{ start: number; end: number }>): string {
  let out = "";
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, range.start);
    cursor = range.end;
  }
  return out + text.slice(cursor);
}

function collectKeyframeBlocks(css: string): {
  keyframes: Array<{ name: string; stops: CssKeyframeStop[] }>;
  ranges: Array<{ start: number; end: number }>;
} {
  const keyframes: Array<{ name: string; stops: CssKeyframeStop[] }> = [];
  const ranges: Array<{ start: number; end: number }> = [];
  const re = /@keyframes\s+([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const open = css.indexOf("{", re.lastIndex);
    const block = open >= 0 ? readBalancedBlock(css, open) : null;
    if (!block) continue;
    ranges.push({ start: match.index, end: block.end });
    const stops: CssKeyframeStop[] = [];
    const stopRe = /([^{}]+)\{([^{}]*)\}/g;
    let stop: RegExpExecArray | null;
    while ((stop = stopRe.exec(block.body))) {
      stops.push({
        selector: stop[1]!.trim().replace(/\s+/g, " "),
        declarations: parseDeclarations(stop[2]!),
      });
    }
    keyframes.push({ name: match[1]!, stops });
  }
  return { keyframes, ranges };
}

function stripQuotes(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

// `animation-name: foo, bar;` — each comma-separated part is a full keyframes name.
function addAnimationNameDeclNames(body: string, knownNames: Set<string>, out: Set<string>): void {
  const nameRe = /animation-name\s*:\s*([^;]+)/g;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRe.exec(body))) {
    for (const raw of nameMatch[1]!.split(",")) {
      const name = stripQuotes(raw);
      if (knownNames.has(name)) out.add(name);
    }
  }
}

// `animation: foo 2s ease, bar 1s;` shorthand — the name is one whitespace-separated
// token among duration/timing-function/etc, so every token has to be checked.
function addAnimationShorthandNames(body: string, knownNames: Set<string>, out: Set<string>): void {
  const animationRe = /animation\s*:\s*([^;]+)/g;
  let animationMatch: RegExpExecArray | null;
  while ((animationMatch = animationRe.exec(body))) {
    for (const raw of animationMatch[1]!.split(",")) {
      for (const token of raw.trim().split(/\s+/)) {
        const normalized = stripQuotes(token);
        if (knownNames.has(normalized)) out.add(normalized);
      }
    }
  }
}

function animationNamesFromDeclarations(body: string, knownNames: Set<string>): string[] {
  const out = new Set<string>();
  addAnimationNameDeclNames(body, knownNames, out);
  addAnimationShorthandNames(body, knownNames, out);
  return [...out];
}

// CSS comments would otherwise glue onto the next rule's selector: once the
// @keyframes blocks between them are stripped, a `/* note */` sitting above an
// @keyframes reattaches to the following rule (and corrupts both the printed
// selector and the --shot querySelector). Drop comments up front.
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function surfaceCssKeyframes(rawCss: string): SurfacedCssKeyframes[] {
  const css = stripCssComments(rawCss);
  if (!css.trim()) return [];
  const { keyframes, ranges } = collectKeyframeBlocks(css);
  if (keyframes.length === 0) return [];

  const selectorsByName = new Map<string, Set<string>>();
  for (const kf of keyframes) selectorsByName.set(kf.name, new Set());
  const knownNames = new Set(keyframes.map((kf) => kf.name));
  const cssWithoutKeyframes = stripRanges(css, ranges);
  const ruleRe = /([^{}@]+)\{([^{}]*animation[^{}]*)\}/g;
  let rule: RegExpExecArray | null;
  while ((rule = ruleRe.exec(cssWithoutKeyframes))) {
    const selector = rule[1]!.trim().replace(/\s+/g, " ");
    if (!selector) continue;
    for (const name of animationNamesFromDeclarations(rule[2]!, knownNames)) {
      selectorsByName.get(name)?.add(selector);
    }
  }

  return keyframes.map((kf) => ({
    name: kf.name,
    selectors: [...(selectorsByName.get(kf.name) ?? new Set<string>())],
    keyframes: kf.stops,
  }));
}

function valuesFromProperty(
  script: string,
  property: "targets" | "duration",
): Array<string | number> {
  const values: Array<string | number> = [];
  const quoted = property + "\\s*:\\s*([\"'`])([^\"'`]+)\\1";
  const numeric = property + "\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)";
  const re = new RegExp(`${quoted}|${numeric}`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(script))) {
    if (match[2] !== undefined) values.push(match[2]);
    else if (match[3] !== undefined) values.push(Number(match[3]));
  }
  return values;
}

function animeAddTargets(script: string): string[] {
  const values: string[] = [];
  const re = /\.add\s*\(\s*(["'`])([^"'`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(script))) values.push(match[2]!);
  return values;
}

function surfaceAnime(script: string): SurfacedAnimeAnimation[] {
  if (!/\banime\s*(?:\.(?:timeline|createTimeline))?\s*\(/.test(script)) return [];
  const registered = /__hfAnime[\s\S]*?\.push\s*\(/.test(script) || /__hfAnime\s*=/.test(script);
  const timelineCount = (script.match(/\banime\.(?:timeline|createTimeline)\s*\(/g) ?? []).length;
  const animationCount = (script.match(/\banime\s*\(/g) ?? []).length;
  const targets = [
    ...valuesFromProperty(script, "targets").filter(
      (value): value is string => typeof value === "string",
    ),
    ...animeAddTargets(script),
  ];
  const durations = valuesFromProperty(script, "duration");
  const out: SurfacedAnimeAnimation[] = [];
  for (let i = 0; i < timelineCount; i++) {
    out.push({ kind: "timeline", targets, durations, registered });
  }
  for (let i = 0; i < animationCount; i++) {
    out.push({ kind: "animation", targets, durations, registered });
  }
  return out;
}

// A nested element's rendered motion is the COMPOSITION of its own tween and any
// animated ancestor's. The per-element surface would otherwise hide the parent's
// trajectory (e.g. a child carries a flap while the parent carries the path), so
// annotate each tween with the animated ancestor elements above it in the DOM.
function attachComposedAncestors(tweens: SurfacedTween[], html: string): void {
  const animated = [...new Set(tweens.filter((t) => t.method !== "set").map((t) => t.target))];
  if (animated.length < 2) return; // need ≥2 distinct animated elements to compose
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const t of tweens) {
    const ancestors = animatedAncestors(doc, t.target, animated);
    if (ancestors.length) {
      t.composedWith = ancestors.map((sel) => ({
        selector: sel,
        summary: summarizeMotion(tweens, sel),
      }));
    }
  }
}

const safeMatches = (el: Element, sel: string): boolean => {
  try {
    return el.matches(sel);
  } catch {
    return false;
  }
};

// Animated-target selectors of `target`'s DOM ancestors (in order, parent-first).
function animatedAncestors(doc: Document, target: string, animated: string[]): string[] {
  let el: Element | null = null;
  try {
    el = doc.querySelector(target);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    for (const sel of animated) {
      if (sel !== target && !out.includes(sel) && safeMatches(n, sel)) out.push(sel);
    }
  }
  return out;
}

// Compact extent summary of an element's motion: each animated property's min..max
// across all its keyframes. Ranges (not endpoints) so a CLOSED loop — a figure-8
// or orbit returning to its start — still reveals its travel instead of reading
// static (0→0).
function summarizeMotion(tweens: SurfacedTween[], sel: string): string {
  const ranges = new Map<string, { min: number; max: number }>();
  const kfs = tweens
    .filter((t) => t.target === sel && t.method !== "set")
    .flatMap((t) => t.keyframes);
  for (const kf of kfs) {
    for (const [k, v] of Object.entries(kf.properties)) {
      const n = num(v);
      if (n !== null) bumpRange(ranges, k, n);
    }
  }
  const varying = [...ranges.entries()]
    .filter(([, r]) => r.max - r.min > 0.5)
    .map(([k, r]) => `${k} ${Math.round(r.min)}..${Math.round(r.max)}`);
  return varying.length ? varying.join(", ") : "(static)";
}

function bumpRange(ranges: Map<string, { min: number; max: number }>, k: string, n: number): void {
  const r = ranges.get(k);
  if (r) {
    r.min = Math.min(r.min, n);
    r.max = Math.max(r.max, n);
  } else ranges.set(k, { min: n, max: n });
}

// A drawn stroke must actually move across the canvas. A position tween whose
// points never leave the start (an opacity/scale tween merely carrying a static
// y) is not a pen stroke — exclude it so repeated in-place tweens don't
// masquerade as a multi-stroke trace.
function pathTravels(points: Array<{ x: number; y: number }>): boolean {
  const first = points[0];
  if (!first) return false;
  return points.some((p) => Math.abs(p.x - first.x) > 0.5 || Math.abs(p.y - first.y) > 0.5);
}

// Group an element's DRAWN position strokes (to/from/fromTo/keyframes that carry
// a path) into one ordered trace. A `set` with x/y is a pen-up jump — excluded
// (not drawn). Only targets with ≥2 strokes become a composited trace; a single
// stroke stays on the normal per-tween path so existing output is unchanged.
function groupTraces(tweens: SurfacedTween[]): SurfacedTrace[] {
  const byTarget = new Map<string, SurfacedTween[]>();
  for (const t of tweens) {
    if (t.method === "set") continue;
    if (!t.path || t.path.length < 2) continue;
    if (!pathTravels(t.path)) continue; // in-place tween (e.g. opacity carrying a static y) is not a drawn stroke
    const list = byTarget.get(t.target);
    if (list) list.push(t);
    else byTarget.set(t.target, [t]);
  }
  const traces: SurfacedTrace[] = [];
  for (const [target, list] of byTarget) {
    if (list.length < 2) continue;
    const strokes = [...list]
      .sort((a, b) => a.start - b.start)
      .map((t) => ({
        id: t.id,
        start: t.start,
        end: t.end,
        keyframes: t.keyframes,
        points: t.path!,
      }));
    traces.push({ target, strokes });
  }
  return traces;
}

function collectCompositions(indexPath: string): SurfacedComposition[] {
  const html = readFileSync(indexPath, "utf-8");
  const baseDir = dirname(indexPath);
  const out: SurfacedComposition[] = [
    surfaceComposition(html, basename(indexPath), basename(indexPath)),
  ];

  // Deliberately document-root only (NOT queryIncludingTemplates): host divs
  // with [data-composition-src] live in the orchestrating index.html light
  // tree, never inside <template>. Widening this scan would change discovery
  // semantics, not fix a gap.
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const div of Array.from(doc.querySelectorAll("[data-composition-src]"))) {
    const src = div.getAttribute("data-composition-src");
    if (!src) continue;
    const subPath = resolve(baseDir, src);
    if (!existsSync(subPath)) continue;
    const id = div.getAttribute("data-composition-id") ?? src;
    out.push(surfaceComposition(readFileSync(subPath, "utf-8"), id, src));
  }
  return out;
}

// ── Render (human) ───────────────────────────────────────────────────────────

function fmtProps(props: Record<string, number | string>): string {
  return Object.entries(props)
    .filter(([k]) => k !== "ease")
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
}

function printTween(t: SurfacedTween): void {
  const timing = c.dim(`@${t.start}s→${t.end}s (${t.duration}s)`);
  const group = t.group ? c.dim(` ${t.group}`) : "";
  console.log(`  ${c.accent(t.target)}${group}  ${c.dim(t.method)}/${t.shape}  ${timing}`);
  if (t.shape === "motionPath") {
    console.log(c.dim(`    motionPath arc (${t.keyframes.length} stops)`));
  } else {
    const kfLine = t.keyframes.map((k) => `${k.pct}% {${fmtProps(k.properties)}}`).join("  ");
    console.log(`    ${c.dim(kfLine)}`);
  }
  if (t.composedWith?.length) {
    for (const a of t.composedWith) {
      console.log(c.dim(`    ↑ composed with ${c.accent(a.selector)}${c.dim(": " + a.summary)}`));
    }
  }
  console.log();
}

function printTrace(tr: SurfacedTrace): void {
  const start = Math.min(...tr.strokes.map((s) => s.start));
  const end = Math.max(...tr.strokes.map((s) => s.end));
  const n = tr.strokes.length;
  console.log(
    `  ${c.accent(tr.target)}${c.dim(" position")}  ${c.dim("trace")}  ${c.dim(`${n} strokes`)} ${c.dim(`@${start}s→${end}s`)}`,
  );
  tr.strokes.forEach((s, i) => {
    const kfLine = s.keyframes.map((k) => `${k.pct}% {${fmtProps(k.properties)}}`).join("  ");
    console.log(`    ${c.dim(`stroke ${i + 1}:`)} ${c.dim(kfLine)}`);
  });
  console.log();
}

// ── Onion-skin self-verify shot ──────────────────────────────────────────────

interface ShotArgs {
  shot?: string;
  samples?: string;
  layout?: string;
  from?: string;
  to?: string;
  fit?: boolean;
  angle?: string;
  ghost?: boolean;
}

// Every animated element qualifies — the onion samples the live element and shows
// every channel (rotation / scale / opacity / colour / 3D), not just x/y. A
// 0-duration `set` is a pen-up marker, not motion.
function addTraceSelectors(selectors: Set<string>, cmp: SurfacedComposition): void {
  for (const tr of cmp.traces) selectors.add(tr.target);
}

function addTweenSelectors(selectors: Set<string>, cmp: SurfacedComposition): void {
  for (const t of cmp.tweens) {
    if (t.method !== "set") selectors.add(t.target);
  }
}

function addCssKeyframeSelectors(selectors: Set<string>, cmp: SurfacedComposition): void {
  for (const css of cmp.cssKeyframes) {
    for (const selector of css.selectors) {
      if (selector) selectors.add(selector);
    }
  }
}

function addAnimeSelectors(selectors: Set<string>, cmp: SurfacedComposition): void {
  for (const anime of cmp.anime) {
    for (const selector of anime.targets) {
      if (selector) selectors.add(selector);
    }
  }
}

export function collectShotSelectors(comps: SurfacedComposition[]): Array<{ selector: string }> {
  const selectors = new Set<string>();
  for (const cmp of comps) {
    addTraceSelectors(selectors, cmp);
    addTweenSelectors(selectors, cmp);
    addCssKeyframeSelectors(selectors, cmp);
    addAnimeSelectors(selectors, cmp);
  }
  return [...selectors].map((selector) => ({ selector }));
}

// Guard checks that must pass before capturing the onion-skin shot. Returns the
// message to print when a guard fails, or null when clear to proceed.
function onionShotGuardError(
  projectDir: string | undefined,
  requests: Array<{ selector: string }>,
  ghost: boolean,
): string | null {
  if (!projectDir) return "--shot needs a project directory (not a single .html file).";
  // The rendered onion (--ghost) screenshots the whole painted stage, so it does
  // not need an animated DOM element to sample — only the marker onion does.
  if (requests.length === 0 && !ghost)
    return "--shot: no animated element to sample for the selection.";
  return null;
}

function onionShotOptions(args: ShotArgs & { selector?: string }) {
  return {
    samples: num(args.samples) ?? 9,
    layout: (args.layout === "strip" ? "strip" : "path") as "strip" | "path",
    fit: args.fit ?? true,
    from: num(args.from),
    to: num(args.to),
    angle: args.angle,
    scopeSelector: args.selector ?? null,
    ghost: args.ghost ?? false,
  };
}

function printOnionShotSaved(saved: string, elementCount: number): void {
  console.log(`${c.success("◇")}  onion-skin screenshot saved ${c.accent(saved)}`);
  console.log(
    c.dim(
      `   ${elementCount} element${elementCount === 1 ? "" : "s"} · open it to verify the motion matches your target, then read the keyframes below.`,
    ),
  );
  console.log();
}

/** Render the 3D onion-skin screenshot for every animated element. Returns true
 *  when the command should early-return (a guard failed). */
async function runOnionShot(
  comps: SurfacedComposition[],
  allComps: SurfacedComposition[],
  projectDir: string | undefined,
  entryFile: string | undefined,
  args: ShotArgs & { selector?: string },
): Promise<boolean> {
  const { captureMotionPathShot } = await import("./motionShot.js");
  // With --selector, sample from the FULL animated set and let the browser scope
  // to the selector (or its animated descendants when the selector is a static
  // wrapper like `.clip`). Without it, only the (already-filtered) comps qualify.
  const requests = collectShotSelectors(args.selector ? allComps : comps);
  const guardError = onionShotGuardError(projectDir, requests, args.ghost ?? false);
  if (guardError) {
    console.log(c.dim(guardError));
    return true;
  }
  const saved = await captureMotionPathShot(projectDir!, requests, resolve(args.shot!), {
    ...onionShotOptions(args),
    entryFile,
  });
  printOnionShotSaved(saved, requests.length);
  return false;
}

// Resolve the command target (a project dir or a single .html) into surfaced
// compositions, applying the optional --selector filter.
export function resolveScope(args: { target?: string; selector?: string }): {
  comps: SurfacedComposition[];
  allComps: SurfacedComposition[];
  projectName: string;
  projectDir: string | undefined;
  entryFile: string | undefined;
} {
  const raw = args.target?.trim();
  let comps: SurfacedComposition[];
  let projectName: string;
  let projectDir: string | undefined;
  let entryFile: string | undefined;
  if (raw && raw.endsWith(".html") && existsSync(raw) && statSync(raw).isFile()) {
    const entryPath = resolve(raw);
    comps = [surfaceComposition(readFileSync(entryPath, "utf-8"), basename(entryPath), entryPath)];
    projectName = basename(entryPath);
    projectDir = findProjectRoot(entryPath);
    entryFile = relative(projectDir, entryPath).split(sep).join("/");
  } else {
    const project = resolveProject(raw);
    comps = collectCompositions(project.indexPath);
    projectName = project.name;
    projectDir = project.dir;
  }
  // allComps keeps the unfiltered set so --shot --selector can resolve a STATIC
  // wrapper (e.g. `.clip`) to its animated descendants in the live DOM, even
  // though the literal selector filter (for print/json) drops it to empty.
  const allComps = comps;
  if (args.selector) {
    const sel = args.selector;
    const matches = (target: string) => target.split(",").some((s) => s.trim() === sel);
    comps = comps
      .map((cmp) => ({
        ...cmp,
        tweens: cmp.tweens.filter((t) => matches(t.target)),
        traces: cmp.traces.filter((tr) => matches(tr.target)),
        cssKeyframes: cmp.cssKeyframes.filter((kf) => kf.selectors.some(matches)),
        anime: cmp.anime.filter((a) => a.targets.some(matches)),
      }))
      .filter(
        (cmp) =>
          cmp.tweens.length > 0 ||
          cmp.traces.length > 0 ||
          cmp.cssKeyframes.length > 0 ||
          cmp.anime.length > 0,
      );
  }
  return { comps, allComps, projectName, projectDir, entryFile };
}

function findProjectRoot(entryPath: string): string {
  const entryDir = dirname(entryPath);
  let candidate = entryDir;
  for (;;) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
    if (existsSync(join(candidate, ".git"))) return entryDir;
    const parent = dirname(candidate);
    if (parent === candidate) return entryDir;
    candidate = parent;
  }
}

function isEmptyComposition(cmp: SurfacedComposition): boolean {
  return (
    cmp.tweens.length === 0 &&
    cmp.traces.length === 0 &&
    cmp.cssKeyframes.length === 0 &&
    cmp.anime.length === 0
  );
}

// Print tweens not already shown as part of a trace (a drawn stroke, or its
// internal pen-up jump).
function printCompositionTweens(cmp: SurfacedComposition): void {
  const tracedIds = new Set(cmp.traces.flatMap((tr) => tr.strokes.map((s) => s.id)));
  const tracedTargets = new Set(cmp.traces.map((tr) => tr.target));
  for (const t of cmp.tweens) {
    if (tracedIds.has(t.id)) continue; // already shown as part of its trace
    if (t.method === "set" && tracedTargets.has(t.target)) continue; // internal pen-up jump
    printTween(t);
  }
}

// Print one composition's traces + tweens (skipping strokes already shown in a trace).
function printComposition(cmp: SurfacedComposition): void {
  if (isEmptyComposition(cmp)) return;
  console.log(c.bold(`${cmp.composition}`) + c.dim(`  (${cmp.source})`));
  for (const tr of cmp.traces) printTrace(tr);
  printCompositionTweens(cmp);
  for (const cssKeyframes of cmp.cssKeyframes) printCssKeyframes(cssKeyframes);
  for (const anime of cmp.anime) printAnime(anime);
}

function printCssKeyframes(cssKeyframes: SurfacedCssKeyframes): void {
  const selectors = cssKeyframes.selectors.length
    ? cssKeyframes.selectors.join(", ")
    : "(no selector found)";
  console.log(
    `  ${c.accent(`@keyframes ${cssKeyframes.name}`)}${c.dim(" css")}  ${c.dim(selectors)}`,
  );
  for (const stop of cssKeyframes.keyframes) {
    console.log(`    ${c.dim(`${stop.selector} {${stop.declarations.join("; ")}}`)}`);
  }
  console.log();
}

function printAnime(anime: SurfacedAnimeAnimation): void {
  const targets = anime.targets.length ? anime.targets.join(", ") : "(targets not parsed)";
  const durations = anime.durations.length ? ` duration ${anime.durations.join(",")}` : "";
  const registered = anime.registered ? "registered" : "not registered";
  console.log(
    `  ${c.accent(`anime.${anime.kind}`)}${c.dim(` ${registered}`)}  ${c.dim(`${targets}${durations}`)}`,
  );
  console.log();
}

// ── Command ──────────────────────────────────────────────────────────────────

interface KeyframesCommandOptions {
  name: string;
  description: string;
  invocation: string;
  defaultRuntime: "gsap" | "css" | "anime" | "all";
}

const defaultKeyframesCommand: KeyframesCommandOptions = {
  name: "keyframes",
  description:
    "See, debug, and refine keyframes — surface GSAP, CSS @keyframes, Anime.js, paths, and onion-shot diagnostics",
  invocation: "hyperframes keyframes",
  defaultRuntime: "all",
};

function createKeyframesCommand(options: Partial<KeyframesCommandOptions> = {}) {
  const commandOptions = { ...defaultKeyframesCommand, ...options };

  return defineCommand({
    meta: {
      name: commandOptions.name,
      description: commandOptions.description,
    },
    args: {
      target: {
        type: "positional",
        description: "Project dir or composition .html",
        required: false,
      },
      selector: { type: "string", description: "Only keyframes matching this CSS selector" },
      runtime: {
        type: "string",
        description:
          "Runtime filter hint: gsap|css|anime|all. Surfaces GSAP tweens, CSS @keyframes, and Anime.js timelines when detectable.",
      },
      json: { type: "boolean", description: "Machine-readable JSON (for agents)", default: false },
      shot: {
        type: "string",
        description:
          "Onion-skin screenshot to PNG: the real element sampled over the timeline (true 3D, every channel) for visual self-verify. Pair with --selector to focus one element.",
      },
      samples: {
        type: "string",
        description: "Onion samples (equal-time steps) for --shot. Default 9.",
      },
      layout: {
        type: "string",
        description:
          "--shot layout: 'path' (ghosts at real positions + path, default) or 'strip' (filmstrip by time — for in-place/overlapping motion).",
      },
      from: { type: "string", description: "--shot: sample only from this time (seconds)." },
      to: { type: "string", description: "--shot: sample only up to this time (seconds)." },
      angle: {
        type: "string",
        description:
          "--shot orbit camera: a preset (front|iso|top|side|rear-iso) or 'yaw,pitch' degrees — view 3D motion from the angle that reveals it.",
      },
      fit: {
        type: "boolean",
        description:
          "--shot: zoom the motion to fill the frame (default true; --no-fit to disable).",
        default: true,
      },
      ghost: {
        type: "boolean",
        description:
          "--shot: rendered onion-skin — composite the real canvas/WebGL frames as translucent ghosts (older fainter), instead of bbox markers. For the canvas-internal 3D motion the marker onion can't see (requires a <canvas>).",
        default: false,
      },
    },
    async run({ args }) {
      ensureDOMParser();
      const runtime = normalizeRuntime(args.runtime, commandOptions.defaultRuntime);
      if (runtime === "css" || runtime === "anime") {
        console.log(
          c.dim(
            `${commandOptions.name}: ${runtime} output is a static authoring surface; use validate/render/snapshot to verify runtime adapter seekability.`,
          ),
        );
        console.log();
      }
      const { comps: rawComps, allComps, projectName, projectDir, entryFile } = resolveScope(args);
      const comps = filterCompositionsByRuntime(rawComps, runtime);

      // --shot: 3D onion-skin self-verify screenshot. Returns true when the command
      // should stop (guard failure) so run() stays small.
      if (args.shot && (await runOnionShot(comps, allComps, projectDir, entryFile, args))) return;

      if (args.json) {
        console.log(
          JSON.stringify(withMeta({ project: projectName, runtime, compositions: comps }), null, 2),
        );
        return;
      }

      const total = comps.reduce(
        (n, cmp) => n + cmp.tweens.length + cmp.cssKeyframes.length + cmp.anime.length,
        0,
      );
      if (total === 0) {
        console.log(`${c.success("◇")}  ${c.accent(projectName)} ${c.dim("— no keyframes found")}`);
        return;
      }
      console.log(
        `${c.success("◇")}  ${c.accent(projectName)} ${c.dim("—")} ${c.dim(`${total} item${total === 1 ? "" : "s"}`)}`,
      );
      console.log();
      for (const cmp of comps) printComposition(cmp);
      console.log(
        c.dim(
          `Tip: edit the keyframes in source, then \`${commandOptions.invocation} --shot out.png\` to see the rendered motion.`,
        ),
      );
    },
  });
}

function normalizeRuntime(
  runtime: unknown,
  fallback: KeyframesCommandOptions["defaultRuntime"],
): KeyframesCommandOptions["defaultRuntime"] {
  if (typeof runtime !== "string") return fallback;
  const normalized = runtime.toLowerCase();
  return normalized === "gsap" ||
    normalized === "css" ||
    normalized === "anime" ||
    normalized === "all"
    ? normalized
    : fallback;
}

function filterCompositionsByRuntime(
  comps: SurfacedComposition[],
  runtime: KeyframesCommandOptions["defaultRuntime"],
): SurfacedComposition[] {
  return comps.map((cmp) => ({
    ...cmp,
    tweens: runtime === "gsap" || runtime === "all" ? cmp.tweens : [],
    traces: runtime === "gsap" || runtime === "all" ? cmp.traces : [],
    cssKeyframes: runtime === "css" || runtime === "all" ? cmp.cssKeyframes : [],
    anime: runtime === "anime" || runtime === "all" ? cmp.anime : [],
  }));
}

export default createKeyframesCommand();
