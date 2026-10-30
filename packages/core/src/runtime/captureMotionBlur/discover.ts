/**
 * Which elements to blur: the ones that move fast enough for a smear to show.
 *
 * One scan: candidates are elements whose inline style changes or that a CSS / WAAPI animation
 * moves; they must reach MIN_SPEED px/frame outside any 3D context (the redraw is 2D), and only
 * the outermost of nested candidates is kept. A large element that is see-through while it moves
 * (a sweep, a light leak) is no mover: its crop would carry the scene beneath it along its path.
 */

import { isHtmlElement } from "../domRealm";
import { inkPad } from "./ink";
import { individualIs3d, parseTransform } from "./pose";

/** Under this peak speed (px per frame) a smear is invisible, so the element stays sharp. */
const MIN_SPEED = 2;

/** A box this share of the scene or more holds other content, whatever sits in it. */
const LARGE_SHARE = 0.5;

/** Scan resolution: at most this many timeline samples, however long the composition. */
const SCAN_STEPS = 240;

const ANIMATED_POSE_PROPS = new Set<string>([
  "transform",
  "translate",
  "rotate",
  "scale",
  "left",
  "top",
  "right",
  "bottom",
]);

export interface DiscoverOptions {
  scene: HTMLElement;
  durationSeconds: number;
  fps: number;
  /** Seek the composition (timeline + adapters) to a time. */
  seek: (t: number) => void;
  onStep?: (i: number, steps: number) => void;
}

export interface Discovery {
  movers: HTMLElement[];
  /** Every element whose pose changes at all; their transforms are never cached. */
  dynamic: Set<Element>;
  /** Px each mover's ink reaches past its box (shadows, glows), the largest seen. */
  pads: Map<HTMLElement, number>;
  translationOnly: boolean;
}

// The whole inline style in one read; opacity or colour tweens only cost a rect check.
const styleKey = (el: HTMLElement): string => el.getAttribute("style") ?? "";

function optedOut(el: Element, scene: Element): boolean {
  for (let n: Element | null = el; n && n !== scene; n = n.parentElement) {
    if (n.getAttribute("data-motion-blur") === "off") return true;
  }
  return false;
}

function in3d(el: Element, scene: Element): boolean {
  for (let n: Element | null = el; n && n !== scene; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (
      cs.transform.startsWith("matrix3d") ||
      cs.transformStyle === "preserve-3d" ||
      cs.perspective !== "none" ||
      (cs.offsetPath ?? "none") !== "none" ||
      individualIs3d(cs)
    ) {
      return true;
    }
  }
  return false;
}

function linearSignature(el: Element, scene: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el; n && n !== scene; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const m = parseTransform(cs.transform);
    parts.push(m ? [m.a, m.b, m.c, m.d].map((v) => v.toFixed(3)).join(",") : "1,0,0,1");
    parts.push(cs.rotate ?? "none", cs.scale ?? "none");
  }
  return parts.join("|");
}

function hasOwnContext(el: Element): boolean {
  const cs = getComputedStyle(el);
  return cs.transform !== "none" || (cs.translate ?? "none") !== "none";
}

/** Elements a CSS animation or WAAPI animation moves (no inline style to diff). */
function pageAnimated(scene: Element): Set<HTMLElement> {
  const out = new Set<HTMLElement>();
  if (typeof document.getAnimations !== "function") return out;
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!isHtmlElement(target) || !scene.contains(target)) continue;
    const frames = typeof effect?.getKeyframes === "function" ? effect.getKeyframes() : [];
    if (frames.some((frame) => Object.keys(frame).some((k) => ANIMATED_POSE_PROPS.has(k))))
      out.add(target);
  }
  return out;
}

// Alpha of a computed colour (`rgba(r, g, b, a)` or `rgb(r g b / a)`); 1 when it has none.
function alphaOf(color: string): number {
  const m = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color) ?? /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
  if (!m) return 1;
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
}

type Bitmap = HTMLImageElement | HTMLCanvasElement;

const isBitmap = (el: HTMLElement): el is Bitmap => el.tagName === "IMG" || el.tagName === "CANVAS";

const ALPHA_PROBE = 32;

/** Whether any pixel of a bitmap is not fully opaque; an undecoded or unreadable one counts. */
function bitmapHasAlpha(el: Bitmap): boolean {
  if ("naturalWidth" in el && !(el.complete && el.naturalWidth > 0)) return true;
  try {
    const probe = el.ownerDocument.createElement("canvas");
    probe.width = probe.height = ALPHA_PROBE;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(el, 0, 0, ALPHA_PROBE, ALPHA_PROBE);
    const { data } = ctx.getImageData(0, 0, ALPHA_PROBE, ALPHA_PROBE);
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) < 255) return true;
    return false;
  } catch {
    return true;
  }
}

/** Whether the element, on screen right now, lets what is beneath its box show through. */
function seesThrough(el: HTMLElement, scene: Element, hasAlpha: Map<Bitmap, boolean>): boolean {
  let alpha = 1;
  for (let n: Element | null = el; n && n !== scene; n = n.parentElement) {
    alpha *= parseFloat(getComputedStyle(n).opacity);
  }
  if (alpha < 0.05) return false;
  if (alpha < 0.99) return true;
  if (isBitmap(el)) {
    if (!hasAlpha.has(el)) hasAlpha.set(el, bitmapHasAlpha(el));
    return hasAlpha.get(el) === true;
  }
  return !/^(VIDEO|PICTURE)$/.test(el.tagName) && paintSeesThrough(el);
}

function paintSeesThrough(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  if (alphaOf(cs.backgroundColor) >= 0.99) return false;
  if (cs.backgroundImage === "none") return true;
  return [...cs.backgroundImage.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].some(
    (m) => Number(m[1]) < 0.99,
  );
}

/** How far a box's farthest-moving edge travelled between two reads; 0 when either is empty. */
function edgeShift(a: DOMRect | undefined, b: DOMRect | undefined): number {
  if (!a || !b || !a.width || !b.width) return 0;
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.right - b.right),
    Math.abs(a.bottom - b.bottom),
  );
}

/** Boxes of `els` now, but with their inline style put back: their own change left out. */
function rectsAtStyle(els: HTMLElement[], styles: string[]): DOMRect[] {
  const now = els.map(styleKey);
  els.forEach((el, i) => el.setAttribute("style", styles[i] ?? ""));
  const rects = els.map((el) => el.getBoundingClientRect());
  els.forEach((el, i) => el.setAttribute("style", now[i] ?? ""));
  return rects;
}

export function discoverMovers({
  scene,
  durationSeconds,
  fps,
  seek,
  onStep,
}: DiscoverOptions): Discovery {
  seek(0);
  const all = [...scene.querySelectorAll("*")].filter(isHtmlElement);
  const dynamic = new Set<Element>(pageAnimated(scene));
  const first = all.map(styleKey);
  const baseRects = all.map((el) => el.getBoundingClientRect());
  const frames = Math.max(1, Math.round(durationSeconds * fps));
  // One pass, about every other frame on a typical composition. A whip shorter than one step
  // can be under-measured; ponytail: raise SCAN_STEPS if a fast move goes unblurred.
  const steps = Math.min(frames, SCAN_STEPS);
  const framesPerStep = frames / steps;
  const fast = new Set<HTMLElement>();
  const threeD = new Set<HTMLElement>();
  const pads = new Map<HTMLElement, number>();
  const signatures = new Map<HTMLElement, string>();
  const notPlain = new Set<HTMLElement>();
  const measure = (el: HTMLElement): void => {
    pads.set(el, Math.max(pads.get(el) ?? 0, inkPad(el)));
    const sig = linearSignature(el, scene);
    const first = signatures.get(el);
    if (first === undefined) signatures.set(el, sig);
    else if (first !== sig) notPlain.add(el);
    if (!hasOwnContext(el)) notPlain.add(el);
  };
  const seeThrough = new Set<HTMLElement>();
  const alphaCache = new Map<Bitmap, boolean>();
  const sceneRect = scene.getBoundingClientRect();
  const largeArea = sceneRect.width * sceneRect.height * LARGE_SHARE;
  let prev: Array<DOMRect | undefined> = [];

  for (let i = 0; i <= steps; i++) {
    if (i > 0) seek((i / steps) * durationSeconds);
    onStep?.(i, steps);
    // Rects only for elements whose style has changed; a first change is judged against its
    // own baseline style at this time, so an ancestor's pan is not its move.
    const rects: Array<DOMRect | undefined> = [];
    const fresh: number[] = [];
    all.forEach((el, j) => {
      if (!dynamic.has(el) && styleKey(el) === first[j]) return;
      if (!dynamic.has(el)) fresh.push(j);
      dynamic.add(el);
      rects[j] = el.getBoundingClientRect();
    });
    const away = fresh.filter(
      (j) => edgeShift(baseRects[j], rects[j]) / framesPerStep >= MIN_SPEED,
    );
    const before = rectsAtStyle(
      away.map((j) => all[j] as HTMLElement),
      away.map((j) => first[j] ?? ""),
    );
    away.forEach((j, k) => {
      prev[j] = before[k];
    });
    rects.forEach((box, j) => {
      const el = all[j];
      if (!el || edgeShift(prev[j], box) / framesPerStep < MIN_SPEED) return;
      if (!fast.has(el)) measure(el);
      fast.add(el);
      if (
        box &&
        largeArea > 0 &&
        box.width * box.height >= largeArea &&
        seesThrough(el, scene, alphaCache)
      )
        seeThrough.add(el);
    });
    // Style reads up the chain are the costly part; every 10th step is enough to see a 3D turn.
    if (i % 10 === 0 || i === steps) {
      for (const el of fast) {
        if (in3d(el, scene)) threeD.add(el);
        measure(el);
      }
    }
    prev = rects;
  }

  const candidates = all.filter(
    (el) => fast.has(el) && !threeD.has(el) && !seeThrough.has(el) && !optedOut(el, scene),
  );
  const movers = candidates.filter((el) => !candidates.some((o) => o !== el && o.contains(el)));
  const translationOnly = movers.length > 0 && movers.every((el) => !notPlain.has(el));
  return { movers, dynamic, pads, translationOnly };
}
