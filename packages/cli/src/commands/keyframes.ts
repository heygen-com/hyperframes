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
  ["Surface every keyframe + motion path in the project", "hyperframes keyframes"],
  ["Inspect one composition file", "hyperframes keyframes compositions/scene.html"],
  ["Machine-readable output for an agent", "hyperframes keyframes --json"],
  ["Only one element's tweens", "hyperframes keyframes --selector '#puck-a'"],
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
// element's rest pose so the surface (and ASCII path) is uniform. `from()` goes
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

  // Carry x/y forward across keyframes that only set one axis, so the path is
  // continuous (GSAP holds the last value for an unspecified property).
  let path: Array<{ x: number; y: number }> | null = null;
  if (isPositionTween(anim) && keyframes.length > 0) {
    let lastX = 0;
    let lastY = 0;
    path = keyframes.map((kf) => {
      const x = num(kf.properties.x);
      const y = num(kf.properties.y);
      if (x !== null) lastX = x;
      if (y !== null) lastY = y;
      return { x: lastX, y: lastY };
    });
  }

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
    path,
  };
}

// ── ASCII motion path ────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

/** Core plotter: render one or more strokes into a shared-scale ASCII grid.
 *  Dots connect only WITHIN a stroke (never across a pen-up gap); keyframes are
 *  marked with a continuous index across strokes (0–9, a–z, A–Z), or — once a
 *  trace exceeds `denseAbove` points — only Start/End per stroke. `legend`
 *  builds the trailing caption from (dense, strokeCount). Coords are GSAP px. */
function plotStrokes(
  strokes: Pt[][],
  denseAbove: number,
  legend: (dense: boolean, strokeCount: number) => string,
  width = 48,
  height = 11,
): string[] {
  const all = strokes.flat();
  if (all.length === 0) return [];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (maxX - minX < 1) {
    minX -= 1;
    maxX += 1;
  }
  if (maxY - minY < 1) {
    minY -= 1;
    maxY += 1;
  }
  const cols = width;
  const rows = height;
  const toCol = (x: number) => Math.round(((x - minX) / (maxX - minX)) * (cols - 1));
  // Screen y grows downward — invert so up on screen = smaller gsap y.
  const toRow = (y: number) => Math.round(((y - minY) / (maxY - minY)) * (rows - 1));
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => " "),
  );
  const dense = all.length > denseAbove;
  // 0–9, a–z, then A–Z = 62 labels.
  const markChar = (i: number) =>
    i < 10
      ? String(i)
      : i < 36
        ? String.fromCharCode(97 + (i - 10))
        : String.fromCharCode(65 + (i - 36));

  // Trace each stroke's own segments with dots — gaps between strokes stay blank.
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length - 1; i++) {
      const c0 = toCol(stroke[i]!.x);
      const r0 = toRow(stroke[i]!.y);
      const c1 = toCol(stroke[i + 1]!.x);
      const r1 = toRow(stroke[i + 1]!.y);
      const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
      for (let s = 1; s < steps; s++) {
        const cc = Math.round(c0 + ((c1 - c0) * s) / steps);
        const rr = Math.round(r0 + ((r1 - r0) * s) / steps);
        if (grid[rr]![cc] === " ") grid[rr]![cc] = "·";
      }
    }
  }
  // Then overwrite endpoints with index marks (or S/E per stroke when dense).
  let idx = 0;
  for (const stroke of strokes) {
    stroke.forEach((p, j) => {
      grid[toRow(p.y)]![toCol(p.x)] = dense
        ? j === 0
          ? "S"
          : j === stroke.length - 1
            ? "E"
            : "·"
        : markChar(idx);
      idx++;
    });
  }

  const top = `    ┌${"─".repeat(cols)}┐`;
  const body = grid.map((row) => `    │${row.join("")}│`);
  const bottom = `    └${"─".repeat(cols)}┘`;
  const axis = `    x ${Math.round(minX)}..${Math.round(maxX)}   y ${Math.round(minY)}..${Math.round(maxY)} (gsap px; ${legend(dense, strokes.length)})`;
  return [top, ...body, bottom, c.dim(axis)];
}

/** Plot a single continuous position path (one tween). */
function asciiPath(points: Pt[]): string[] {
  return plotStrokes(points.length ? [points] : [], 36, (dense) =>
    dense ? "S→E, · path" : "marks 0..n = keyframe order",
  );
}

/** Plot a multi-stroke trace: all strokes share ONE scale, dots connect only
 *  within a stroke (never across a pen-up gap), marks run across strokes. */
function asciiTrace(strokes: Pt[][]): string[] {
  return plotStrokes(
    strokes,
    62,
    (dense, n) =>
      `${n} strokes · pen-up gaps not drawn · ${dense ? "S→E per stroke, · path" : "marks run across strokes in order"}`,
  );
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
  return { composition: label, source, tweens, traces: groupTraces(tweens) };
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

// Plot the ASCII grid only for genuine motion paths — multi-keyframe, or a path
// that moves on BOTH axes. Simple 2-point single-axis slides (entrances, a flat
// `to(x)`) are clear enough from the keyframe line alone.
function shouldPlotPath(path: Array<{ x: number; y: number }>): boolean {
  const xs = path.map((p) => p.x);
  const ys = path.map((p) => p.y);
  const xVaries = Math.max(...xs) - Math.min(...xs) > 0.5;
  const yVaries = Math.max(...ys) - Math.min(...ys) > 0.5;
  const distinct = new Set(path.map((p) => `${p.x},${p.y}`)).size;
  return distinct > 2 || (xVaries && yVaries);
}

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
  if (t.path && shouldPlotPath(t.path)) {
    for (const line of asciiPath(t.path)) console.log(line);
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
  for (const line of asciiTrace(tr.strokes.map((s) => s.points))) console.log(line);
  console.log();
}

// ── Command ──────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "keyframes",
    description: "Surface every GSAP tween, keyframe, and motion path for agent-driven editing",
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
        "Screenshot the element with its motion-path overlaid (PNG path) — visual self-verify alongside the ASCII. Pair with --selector to pick the element.",
    },
  },
  async run({ args }) {
    ensureDOMParser();

    // Accept either a project directory or a single .html file.
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

    // --shot: render the composition headless, overlay the surfaced motion path
    // on the real element, screenshot one frame for visual self-verification.
    if (args.shot) {
      const { captureMotionPathShot } = await import("./keyframesShot.js");
      // Build one draw request per element: prefer multi-stroke traces, else
      // each position tween's own path (each as a single stroke).
      const requests: import("./keyframesShot.js").ShotRequest[] = [];
      for (const cmp of comps) {
        for (const tr of cmp.traces) {
          requests.push({
            selector: tr.target,
            strokes: tr.strokes.map((s) => ({ points: s.points })),
          });
        }
        const tracedIds = new Set(cmp.traces.flatMap((tr) => tr.strokes.map((s) => s.id)));
        for (const t of cmp.tweens) {
          if (t.method === "set" || tracedIds.has(t.id) || !t.path || !shouldPlotPath(t.path))
            continue;
          requests.push({ selector: t.target, strokes: [{ points: t.path }] });
        }
      }
      if (!projectDir) {
        console.log(c.dim("--shot needs a project directory (not a single .html file)."));
        return;
      }
      if (requests.length === 0) {
        console.log(c.dim("--shot: no position motion path to draw for the selected element(s)."));
        return;
      }
      const saved = await captureMotionPathShot(projectDir, requests, resolve(args.shot));
      console.log(`${c.success("◇")}  motion-path screenshot saved ${c.accent(saved)}`);
      console.log(
        c.dim(
          `   ${requests.length} element${requests.length === 1 ? "" : "s"} · open it to verify the path matches your target, then read the ASCII below.`,
        ),
      );
      console.log();
    }

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
    for (const cmp of comps) {
      if (cmp.tweens.length === 0 && cmp.traces.length === 0) continue;
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
    console.log(
      c.dim("Tip: edit the keyframes: [...] / x/y values in source, then re-run to verify."),
    );
  },
});
