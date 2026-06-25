import { defineCommand } from "citty";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { parseGsapScript, type GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Surface every keyframe + motion path in the project", "hyperframes motion"],
  ["Inspect one composition file", "hyperframes motion compositions/scene.html"],
  ["Machine-readable output for an agent", "hyperframes motion --json"],
  ["Only one element's tweens", "hyperframes motion --selector '#puck-a'"],
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

interface SurfacedComposition {
  composition: string;
  source: string;
  tweens: SurfacedTween[];
  /** Multi-stroke traces: targets with ≥2 drawn position strokes, composited. */
  traces: SurfacedTrace[];
}

// ── GSAP extraction ──────────────────────────────────────────────────────────

function inlineScriptText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("script"))
    .filter((s) => !s.getAttribute("src"))
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
  return { composition: label, source, tweens, traces: groupTraces(tweens) };
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

// Group an element's DRAWN position strokes (to/from/fromTo/keyframes that carry
// a path) into one ordered trace. A `set` with x/y is a pen-up jump — excluded
// (not drawn). Only targets with ≥2 strokes become a composited trace; a single
// stroke stays on the normal per-tween path so existing output is unchanged.
function groupTraces(tweens: SurfacedTween[]): SurfacedTrace[] {
  const byTarget = new Map<string, SurfacedTween[]>();
  for (const t of tweens) {
    if (t.method === "set") continue;
    if (!t.path || t.path.length < 2) continue;
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
function collectAnimatedSelectors(comps: SurfacedComposition[]): Array<{ selector: string }> {
  const selectors = new Set<string>();
  for (const cmp of comps) {
    for (const tr of cmp.traces) selectors.add(tr.target);
    for (const t of cmp.tweens) {
      if (t.method !== "set") selectors.add(t.target);
    }
  }
  return [...selectors].map((selector) => ({ selector }));
}

/** Render the 3D onion-skin screenshot for every animated element. Returns true
 *  when the command should early-return (a guard failed). */
async function runOnionShot(
  comps: SurfacedComposition[],
  allComps: SurfacedComposition[],
  projectDir: string | undefined,
  args: ShotArgs & { selector?: string },
): Promise<boolean> {
  const { captureMotionPathShot } = await import("./motionShot.js");
  // With --selector, sample from the FULL animated set and let the browser scope
  // to the selector (or its animated descendants when the selector is a static
  // wrapper like `.clip`). Without it, only the (already-filtered) comps qualify.
  const requests = collectAnimatedSelectors(args.selector ? allComps : comps);
  if (!projectDir) {
    console.log(c.dim("--shot needs a project directory (not a single .html file)."));
    return true;
  }
  // The rendered onion (--ghost) screenshots the whole painted stage, so it does
  // not need an animated DOM element to sample — only the marker onion does.
  if (requests.length === 0 && !args.ghost) {
    console.log(c.dim("--shot: no animated element to sample for the selection."));
    return true;
  }
  const saved = await captureMotionPathShot(projectDir, requests, resolve(args.shot!), {
    samples: num(args.samples) ?? 9,
    layout: args.layout === "strip" ? "strip" : "path",
    fit: args.fit ?? true,
    from: num(args.from),
    to: num(args.to),
    angle: args.angle,
    scopeSelector: args.selector ?? null,
    ghost: args.ghost ?? false,
  });
  console.log(`${c.success("◇")}  onion-skin screenshot saved ${c.accent(saved)}`);
  console.log(
    c.dim(
      `   ${requests.length} element${requests.length === 1 ? "" : "s"} · open it to verify the motion matches your target, then read the keyframes below.`,
    ),
  );
  console.log();
  return false;
}

// Resolve the command target (a project dir or a single .html) into surfaced
// compositions, applying the optional --selector filter.
function resolveScope(args: { target?: string; selector?: string }): {
  comps: SurfacedComposition[];
  allComps: SurfacedComposition[];
  projectName: string;
  projectDir: string | undefined;
} {
  const raw = args.target?.trim();
  let comps: SurfacedComposition[];
  let projectName: string;
  let projectDir: string | undefined;
  if (raw && raw.endsWith(".html") && existsSync(raw) && statSync(raw).isFile()) {
    comps = [surfaceComposition(readFileSync(raw, "utf-8"), basename(raw), raw)];
    projectName = basename(raw);
    projectDir = dirname(raw);
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
      }))
      .filter((cmp) => cmp.tweens.length > 0 || cmp.traces.length > 0);
  }
  return { comps, allComps, projectName, projectDir };
}

// Print one composition's traces + tweens (skipping strokes already shown in a trace).
function printComposition(cmp: SurfacedComposition): void {
  if (cmp.tweens.length === 0 && cmp.traces.length === 0) return;
  console.log(c.bold(`${cmp.composition}`) + c.dim(`  (${cmp.source})`));
  const tracedIds = new Set(cmp.traces.flatMap((tr) => tr.strokes.map((s) => s.id)));
  const tracedTargets = new Set(cmp.traces.map((tr) => tr.target));
  for (const tr of cmp.traces) printTrace(tr);
  for (const t of cmp.tweens) {
    if (tracedIds.has(t.id)) continue; // already shown as part of its trace
    if (t.method === "set" && tracedTargets.has(t.target)) continue; // internal pen-up jump
    printTween(t);
  }
}

// ── Command ──────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "motion",
    description:
      "See, debug, and refine motion — surface every GSAP tween, keyframe, and motion path, then --shot the onion-skin",
  },
  args: {
    target: {
      type: "positional",
      description: "Project dir or composition .html",
      required: false,
    },
    selector: { type: "string", description: "Only tweens matching this CSS selector" },
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
      description: "--shot: zoom the motion to fill the frame (default true; --no-fit to disable).",
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
    const { comps, allComps, projectName, projectDir } = resolveScope(args);

    // --shot: 3D onion-skin self-verify screenshot. Returns true when the command
    // should stop (guard failure) so run() stays small.
    if (args.shot && (await runOnionShot(comps, allComps, projectDir, args))) return;

    if (args.json) {
      console.log(JSON.stringify(withMeta({ project: projectName, compositions: comps }), null, 2));
      return;
    }

    const total = comps.reduce((n, cmp) => n + cmp.tweens.length, 0);
    if (total === 0) {
      console.log(`${c.success("◇")}  ${c.accent(projectName)} ${c.dim("— no GSAP tweens found")}`);
      return;
    }
    console.log(
      `${c.success("◇")}  ${c.accent(projectName)} ${c.dim("—")} ${c.dim(`${total} tween${total === 1 ? "" : "s"}`)}`,
    );
    console.log();
    for (const cmp of comps) printComposition(cmp);
    console.log(
      c.dim(
        "Tip: edit the keyframes in source, then `motion --shot out.png` to see the rendered motion.",
      ),
    );
  },
});
