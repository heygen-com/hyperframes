/**
 * Motion blur without html-in-canvas: an SVG filter on each mover, offset copies of the element
 * averaged along its sampled path. It works in any Chrome and where capture cannot (a WebGL canvas
 * in the page, a transform on the root), because it filters the live DOM instead of copying it.
 * Turn and scale only soften; capture draws those truthfully, so it stays the first choice.
 */

import { swallow } from "../diagnostics";
import { discoverMovers } from "./discover";
import { planFilter, type FilterPlan } from "./filterPlan";
import { readMoverFrames } from "./frames";
import { createPoseReader } from "./pose";
import type { CaptureMotionBlurHost, Config, Report, Tier } from "./tier";

const NS = "http://www.w3.org/2000/svg";
/** Copies per mover; the softening along the motion closes the steps between them. */
const COPIES = 32;
const PREVIEW_READS = 4;
const RENDER_READS = 8;
const FILTER_ID = "hf-mb";
const OWN = new RegExp(`\\s*url\\("?#${FILTER_ID}-\\d+"?\\)`, "g");

interface Layer {
  filter: SVGFilterElement;
  offsets: SVGFEOffsetElement[];
  soften: SVGFEGaussianBlurElement;
  url: string;
  /** The mover's own stylesheet filter, kept under the smear. */
  css: string;
}

function node<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.append(el);
  return el;
}

/** 32 offset copies, averaged in pairs so 8-bit filter buffers do not band, then softened. */
function buildLayer(defs: SVGDefsElement, index: number, el: HTMLElement): Layer {
  const id = `${FILTER_ID}-${index}`;
  const filter = node(defs, "filter", {
    id,
    "color-interpolation-filters": "sRGB",
    filterUnits: "userSpaceOnUse",
  });
  const offsets = Array.from({ length: COPIES }, (_, k) =>
    node(filter, "feOffset", { in: "SourceGraphic", result: `s${k}` }),
  );
  let level = offsets.map((_, k) => `s${k}`);
  for (let depth = 0; level.length > 1; depth++) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const result = `l${depth}-${i / 2}`;
      node(filter, "feComposite", {
        operator: "arithmetic",
        in: level[i] ?? "",
        in2: level[i + 1] ?? "",
        k1: "0",
        k2: "0.5",
        k3: "0.5",
        k4: "0",
        result,
      });
      next.push(result);
    }
    level = next;
  }
  const soften = node(filter, "feGaussianBlur", { in: level[0] ?? "", stdDeviation: "0" });
  const kept = el.style.filter;
  el.style.filter = "";
  const css = getComputedStyle(el).filter;
  el.style.filter = kept;
  return { filter, offsets, soften, url: `url(#${id})`, css: css && css !== "none" ? css : "" };
}

function aim(layer: Layer, plan: FilterPlan): void {
  plan.offsets.forEach(([dx, dy], k) => {
    layer.offsets[k]?.setAttribute("dx", dx.toFixed(2));
    layer.offsets[k]?.setAttribute("dy", dy.toFixed(2));
  });
  layer.soften.setAttribute(
    "stdDeviation",
    `${plan.sigma[0].toFixed(3)} ${plan.sigma[1].toFixed(3)}`,
  );
  const { x, y, w, h } = plan.region;
  layer.filter.setAttribute("x", x.toFixed(1));
  layer.filter.setAttribute("y", y.toFixed(1));
  layer.filter.setAttribute("width", w.toFixed(1));
  layer.filter.setAttribute("height", h.toFixed(1));
}

const strip = (el: HTMLElement): string => el.style.filter.replace(OWN, "").trim();

export function createFilterTier(
  host: CaptureMotionBlurHost,
  config: Config,
  why: { code: string; reason: string } | null,
): Tier {
  const { root } = host;
  const width = Number(root.getAttribute("data-width")) || root.offsetWidth;
  const height = Number(root.getAttribute("data-height")) || root.offsetHeight;
  const seek = (t: number): void => host.seek(t, !config.events);
  let defs: SVGSVGElement | null = null;
  let movers: HTMLElement[] = [];
  let pads = new Map<HTMLElement, number>();
  let reader: ReturnType<typeof createPoseReader> | null = null;
  let scanned: unknown;
  let scanMs = 0;
  let frames = 0;
  let totalMs = 0;
  let rendering = false;
  let suspended = false;
  const layers = new Map<HTMLElement, Layer>();
  const styled = new Set<HTMLElement>();

  function discover(restoreTo: number): void {
    scanned = host.timeline();
    const s0 = performance.now();
    const found = discoverMovers({
      scene: root,
      durationSeconds: host.durationSeconds(),
      fps: host.fps,
      seek,
    });
    seek(restoreTo);
    movers = found.movers;
    pads = found.pads;
    reader = createPoseReader(root, found.dynamic);
    scanMs = Math.round(performance.now() - s0);
  }

  function drop(el: HTMLElement): void {
    const rest = strip(el);
    if (rest) el.style.filter = rest;
    else el.style.removeProperty("filter");
    styled.delete(el);
  }

  function clear(): void {
    for (const el of [...styled]) drop(el);
  }

  function layerOf(el: HTMLElement): Layer {
    let layer = layers.get(el);
    if (layer) return layer;
    if (!defs) {
      defs = document.createElementNS(NS, "svg");
      defs.setAttribute("width", "0");
      defs.setAttribute("height", "0");
      defs.setAttribute("aria-hidden", "true");
      defs.setAttribute("data-hf-ignore", "");
      defs.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
      node(defs, "defs", {});
      root.append(defs);
    }
    layer = buildLayer(defs.querySelector("defs") ?? defs, layers.size, el);
    layers.set(el, layer);
    return layer;
  }

  function show(el: HTMLElement, plan: FilterPlan): void {
    const layer = layerOf(el);
    aim(layer, plan);
    const base = strip(el) || layer.css;
    el.style.filter = base ? `${base} ${layer.url}` : layer.url;
    styled.add(el);
  }

  /** What each mover needs this frame; none for one that is still. */
  function plansAt(t: number, engineMode: boolean): Array<[HTMLElement, FilterPlan]> {
    if (!reader || host.timeline() !== scanned) discover(t);
    if (!reader) return [];
    const read = readMoverFrames({
      movers,
      reader,
      seek,
      t,
      reads: engineMode ? RENDER_READS : PREVIEW_READS,
      shutterSeconds: config.shutterDeg / 360 / host.fps,
      taps: COPIES,
      frameW: width,
      frameH: height,
    });
    const plans: Array<[HTMLElement, FilterPlan]> = [];
    read.els.forEach((el, i) => {
      const frame = read.frames[i];
      const plan = frame && planFilter(frame, pads.get(el) ?? 0, width);
      if (plan) plans.push([el, plan]);
    });
    return plans;
  }

  function paint(t: number, engineMode: boolean): Promise<void> {
    if (engineMode) rendering = true;
    if (suspended) return Promise.resolve();
    const t0 = performance.now();
    try {
      const plans = plansAt(t, engineMode);
      const live = new Set(plans.map(([el]) => el));
      for (const [el, plan] of plans) show(el, plan);
      for (const el of [...styled]) if (!live.has(el)) drop(el);
      frames++;
      totalMs += performance.now() - t0;
    } catch (err) {
      swallow("runtime.captureMotionBlur.filter", err);
      clear();
    }
    return Promise.resolve();
  }

  function report(): Report {
    return {
      state: "on",
      tier: "filter",
      reason: why?.reason ?? null,
      reasonCode: why?.code ?? null,
      movers: movers.length,
      moverNames: movers.map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`),
      scanMs,
      shutterDeg: config.shutterDeg,
      frames,
      meanMs: frames ? Math.round((totalMs / frames) * 10) / 10 : 0,
      failures: 0,
      failedFrames: 0,
    };
  }

  function teardown(): void {
    clear();
    defs?.remove();
    defs = null;
    layers.clear();
  }

  return {
    root,
    paint,
    probe: () => {
      if (!reader || host.timeline() !== scanned) {
        discover(host.now());
      }
      return report();
    },
    rest: () => {
      if (rendering) return false;
      clear();
      return true;
    },
    arm: () => {},
    finish: () => {},
    teardown,
    suspend: () => {
      suspended = true;
      teardown();
    },
    report,
    busy: () => false,
    rediscover: () => {
      reader = null;
    },
  };
}
