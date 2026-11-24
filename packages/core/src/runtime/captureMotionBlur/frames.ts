/** Where each mover is across the shutter: its pose read at several times, then tapped. */

import type { MoverFrame } from "./composite";
import { resolveMoverSettings, type MotionBlurSettings } from "../../motionBlurSettings";
import {
  type Affine,
  type createPoseReader,
  IDENTITY,
  autoTaps,
  invert,
  tapsFromReads,
  translate,
} from "./pose";

export const CONTENT_NODE_LIMIT = 256;

type Box = [number, number, number, number];
type PoseReader = ReturnType<typeof createPoseReader>;

function clientToMover(pose: Affine, scene: HTMLElement, frameW: number): Affine | null {
  const sr = scene.getBoundingClientRect();
  const s = frameW > 0 && sr.width > 0 ? sr.width / frameW : 1;
  return invert({
    a: pose.a * s,
    b: pose.b * s,
    c: pose.c * s,
    d: pose.d * s,
    e: sr.left + pose.e * s,
    f: sr.top + pose.f * s,
  });
}

const SUBPIXEL = 0.5;

export const within = (r: DOMRect, o: DOMRect): boolean =>
  r.left >= o.left - SUBPIXEL &&
  r.top >= o.top - SUBPIXEL &&
  r.right <= o.right + SUBPIXEL &&
  r.bottom <= o.bottom + SUBPIXEL;

function growToRect(box: Box, back: Affine, r: DOMRect): void {
  for (const [x, y] of [
    [r.left, r.top],
    [r.right, r.top],
    [r.left, r.bottom],
    [r.right, r.bottom],
  ] as const) {
    const lx = back.a * x + back.c * y + back.e;
    const ly = back.b * x + back.d * y + back.f;
    box[0] = Math.min(box[0], lx);
    box[1] = Math.min(box[1], ly);
    box[2] = Math.max(box[2], lx);
    box[3] = Math.max(box[3], ly);
  }
}

export function holdsFixedChild(el: HTMLElement): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  for (let n = 0; n < CONTENT_NODE_LIMIT && walker.nextNode(); n++) {
    if (getComputedStyle(walker.currentNode as Element).position === "fixed") return true;
  }
  return false;
}

const POSITIONED = new Set(["absolute", "fixed"]);
const NO_CONTENT = new Set(["none", "normal"]);

export function pseudoBox(el: HTMLElement, which: "::before" | "::after"): Box | null {
  const cs = getComputedStyle(el, which);
  if (NO_CONTENT.has(cs.content) || !POSITIONED.has(cs.position)) return null;
  const left = parseFloat(cs.left) + el.clientLeft;
  const top = parseFloat(cs.top) + el.clientTop;
  const width = parseFloat(cs.width);
  const height = parseFloat(cs.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  return [left, top, left + width, top + height];
}

function growToBox(box: Box, other: Box | null): void {
  if (!other) return;
  box[0] = Math.min(box[0], other[0]);
  box[1] = Math.min(box[1], other[1]);
  box[2] = Math.max(box[2], other[2]);
  box[3] = Math.max(box[3], other[3]);
}

function grownBox(el: HTMLElement, pose: Affine, scene: HTMLElement, frameW: number): Box {
  const box: Box = [0, 0, el.offsetWidth, el.offsetHeight];
  growToBox(box, pseudoBox(el, "::before"));
  growToBox(box, pseudoBox(el, "::after"));
  const back = clientToMover(pose, scene, frameW);
  if (!back) return box;
  const own = el.getBoundingClientRect();
  const growOutside = (r: DOMRect): void => {
    if (r.width && r.height && !within(r, own)) growToRect(box, back, r);
  };
  const text = el.ownerDocument.createRange();
  text.selectNodeContents(el);
  growOutside(text.getBoundingClientRect());
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  for (let n = 0; n < CONTENT_NODE_LIMIT && walker.nextNode(); n++) {
    growOutside((walker.currentNode as Element).getBoundingClientRect());
  }
  return [Math.floor(box[0]), Math.floor(box[1]), Math.ceil(box[2]), Math.ceil(box[3])];
}

const OWN_TRANSFORM = ["transform", "rotate", "scale", "translate"] as const;
// will-change keeps the mover the containing block of its absolute children.
const UNTRANSFORMED = `${OWN_TRANSFORM.map((p) => `${p}: none !important`).join("; ")}; will-change: transform !important`;

/** The crop is cut to this box, so it must hold content that overflows the mover (wide text). */
function contentBox(el: HTMLElement, reader: PoseReader, scene: HTMLElement, frameW: number): Box {
  const cs = getComputedStyle(el);
  if (cs.overflowX !== "visible" && cs.overflowY !== "visible") {
    return [0, 0, el.offsetWidth, el.offsetHeight];
  }
  const pose = reader.pose(el);
  const ownTransform = OWN_TRANSFORM.some((p) => (cs[p] || "none") !== "none");
  if ((pose.b === 0 && pose.c === 0) || !ownTransform) return grownBox(el, pose, scene, frameW);
  // Upright rects of rotated content leave its corners out, so it is measured unrotated.
  const style = el.getAttribute("style");
  el.setAttribute("style", `${style ?? ""};${UNTRANSFORMED}`);
  reader.reset();
  try {
    return grownBox(el, reader.pose(el), scene, frameW);
  } finally {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
    reader.reset();
  }
}

export interface MoverOverride {
  shutterSeconds: number;
  phaseSeconds: number;
  taps: number | null;
}

export interface FrameRequest {
  movers: HTMLElement[];
  reader: PoseReader;
  seek: (t: number) => void;
  restore?: (t: number) => void;
  t: number;
  /** Pose reads across the shutter; the taps between them are interpolated. */
  reads: number;
  shutterSeconds: number;
  phaseSeconds: number;
  /** A fixed tap count, or null to size the taps to each smear. */
  taps: number | null;
  /** Optional per-mover shutter/phase/taps overrides, parallel to `movers`. */
  moverOverrides?: ReadonlyArray<MoverOverride>;
  /** Px each mover's box grows by on every side (its glow); none for a mover not listed. */
  pads?: ReadonlyMap<HTMLElement, number>;
  scene?: HTMLElement;
  frameW: number;
  frameH: number;
}

export function resolveMoverOverrides(
  movers: ReadonlyArray<HTMLElement>,
  config: Pick<MotionBlurSettings, "shutterDeg" | "phaseDeg" | "samples">,
  fps: number,
  fixedTaps?: number | null,
): MoverOverride[] {
  return movers.map((el) => {
    const resolved = resolveMoverSettings((name) => el.getAttribute(name), config);
    return {
      ...shutterTimes(resolved.shutterDeg, resolved.phaseDeg, fps),
      taps: fixedTaps !== undefined ? fixedTaps : resolved.samples,
    };
  });
}

export function shutterTimes(
  shutterDeg: number,
  phaseDeg: number | null,
  fps: number,
): { shutterSeconds: number; phaseSeconds: number } {
  const shutterSeconds = shutterDeg / 360 / fps;
  return {
    shutterSeconds,
    phaseSeconds: phaseDeg === null ? -shutterSeconds / 2 : phaseDeg / 360 / fps,
  };
}

export function readMoverFrames(req: FrameRequest): { els: HTMLElement[]; frames: MoverFrame[] } {
  const { reader: r, t, reads, seek } = req;
  const fallback: MoverOverride = {
    shutterSeconds: req.shutterSeconds,
    phaseSeconds: req.phaseSeconds,
    taps: req.taps,
  };
  const active: Array<{ el: HTMLElement; override: MoverOverride }> = [];
  req.movers.forEach((el, idx) => {
    if (
      typeof el.checkVisibility === "function" &&
      !el.checkVisibility({ visibilityProperty: true })
    ) {
      return;
    }
    const override = req.moverOverrides?.[idx] ?? fallback;
    if (override.shutterSeconds <= 0) return;
    active.push({ el, override });
  });
  if (active.length === 0) return { els: [], frames: [] };
  const visible = active.map((a) => a.el);
  const poses = active.map((): Affine[] => []);
  const groups = new Map<
    string,
    { shutterSeconds: number; phaseSeconds: number; indices: number[] }
  >();
  active.forEach(({ override }, i) => {
    const key = `${override.shutterSeconds}:${override.phaseSeconds}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        shutterSeconds: override.shutterSeconds,
        phaseSeconds: override.phaseSeconds,
        indices: [],
      };
      groups.set(key, group);
    }
    group.indices.push(i);
  });
  for (const group of groups.values()) {
    const start = t + group.phaseSeconds;
    for (let j = 0; j < reads; j++) {
      seek(Math.max(0, start + (j / (reads - 1)) * group.shutterSeconds));
      r.reset();
      for (const i of group.indices) {
        const el = visible[i];
        if (el) poses[i]?.push(r.pose(el));
      }
    }
  }
  (req.restore ?? seek)(t);
  r.reset();
  const frames = active.map(({ el, override }, i) => {
    const pad = req.pads?.get(el) ?? 0;
    const [x0, y0, x1, y1] = req.scene
      ? contentBox(el, r, req.scene, req.frameW)
      : [0, 0, el.offsetWidth, el.offsetHeight];
    const pose = r.pose(el);
    const w = x1 - x0 + 2 * pad;
    const h = y1 - y0 + 2 * pad;
    const ox = x0 - pad;
    const oy = y0 - pad;
    const grow = (m: Affine): Affine => translate(m, ox, oy);
    const path = (poses[i] ?? [IDENTITY]).map(grow);
    return {
      w,
      h,
      origin: [ox, oy] as [number, number],
      now: grow(pose),
      taps:
        override.taps === null
          ? autoTaps(path, w, h, req.frameW, req.frameH)
          : tapsFromReads(path, override.taps),
    };
  });
  r.reset();
  return { els: visible, frames };
}
