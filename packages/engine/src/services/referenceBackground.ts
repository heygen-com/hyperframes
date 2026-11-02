import type { Page } from "puppeteer-core";

export const REFERENCE_BACKGROUND_FIELD = "reference_background";

export type ReferenceBackground =
  | { kind: "solid"; rgb: [number, number, number] }
  | { kind: "none" }
  | { kind: "unsupported_non_solid" }
  | { kind: "unknown" };

export type ReferenceBackgroundResult = {
  [REFERENCE_BACKGROUND_FIELD]: ReferenceBackground;
};

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

function readRgb(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [r, g, b] = value;
  return isByte(r) && isByte(g) && isByte(b) ? [r, g, b] : null;
}

export function referenceBackgroundResult(value: unknown): ReferenceBackgroundResult {
  if (value !== null && typeof value === "object" && "kind" in value) {
    if (value.kind === "solid" && "rgb" in value) {
      const rgb = readRgb(value.rgb);
      if (rgb) return { [REFERENCE_BACKGROUND_FIELD]: { kind: "solid", rgb } };
    }
    if (value.kind === "none" || value.kind === "unsupported_non_solid") {
      return { [REFERENCE_BACKGROUND_FIELD]: { kind: value.kind } };
    }
  }
  return { [REFERENCE_BACKGROUND_FIELD]: { kind: "unknown" } };
}

/** Shared by a render's existing sessions; concurrent workers reserve the first read, not a chunk frame. */
export function createReferenceBackgroundRecorder(
  record: (result: ReferenceBackgroundResult) => void,
): (read: () => Promise<ReferenceBackground>) => Promise<void> {
  let pending: Promise<void> | undefined;
  return (read) => {
    pending ??= read()
      .catch((): ReferenceBackground => ({ kind: "unknown" }))
      .then((value) => record(referenceBackgroundResult(value)));
    return pending;
  };
}

export interface BackgroundLayer {
  rgba: readonly number[];
  image: string;
  opacity: string;
  filter: string;
  blend: string;
  varying: boolean;
}

export interface BackgroundObservation {
  layers: readonly BackgroundLayer[];
  explicitNone: boolean;
}

function layerIsIndeterminate(layer: BackgroundLayer): boolean {
  return (
    layer.varying || layer.opacity !== "1" || layer.filter !== "none" || layer.blend !== "normal"
  );
}

function validLayer(layer: BackgroundLayer): boolean {
  return layer.rgba.length === 4 && layer.rgba.every(isByte) && layer.image.length > 0;
}

function opaqueReference(
  rgb: [number, number, number],
  indeterminate: boolean,
): ReferenceBackground {
  return indeterminate ? { kind: "unknown" } : { kind: "solid", rgb };
}

export function classifyReferenceBackground(
  observation: BackgroundObservation | null,
): ReferenceBackground {
  if (!observation || observation.layers.length === 0) return { kind: "unknown" };
  const indeterminate = observation.layers.some(layerIsIndeterminate);
  let translucent = false;
  for (const layer of observation.layers) {
    if (!validLayer(layer)) return { kind: "unknown" };
    if (layer.image !== "none") return { kind: "unsupported_non_solid" };
    const rgb = layer.rgba[3] === 255 ? readRgb(layer.rgba.slice(0, 3)) : null;
    if (rgb) return opaqueReference(rgb, translucent || indeterminate);
    translucent ||= layer.rgba[3] !== 0;
  }
  return !indeterminate && !translucent && observation.explicitNone
    ? { kind: "none" }
    : { kind: "unknown" };
}

/** Runs in the browser, before transparent capture rewrites the author's root/body styles. */
export async function observeReferenceBackground(): Promise<BackgroundObservation | null> {
  const root = document.querySelector("[data-composition-id]");
  if (!root || !document.body) return null;
  // Inspect the initial film state, never the worker's eventual frame range.
  window.__hf?.seek?.(0);
  if (
    "__hfWaitForSeekCompletion" in window &&
    typeof window.__hfWaitForSeekCompletion === "function"
  ) {
    await window.__hfWaitForSeekCompletion();
  }
  const elements: Element[] = [];
  for (let element: Element | null = root; element; element = element.parentElement)
    elements.push(element);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const layers = elements.map((element): BackgroundLayer => {
    const style = getComputedStyle(element);
    context.clearRect(0, 0, 1, 1);
    if (!CSS.supports("color", style.backgroundColor))
      return { rgba: [], image: "", opacity: "", filter: "", blend: "", varying: false };
    // Chromium resolves CSS color syntax and color spaces; this is a swatch, not film pixels.
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return {
      rgba: Array.from(context.getImageData(0, 0, 1, 1).data),
      image: style.backgroundImage,
      opacity: style.opacity,
      filter: style.filter,
      blend: style.mixBlendMode,
      varying: false,
    };
  });
  return { layers, explicitNone: false };
}

function hasChangingCssBackground(): boolean {
  const root = document.querySelector("[data-composition-id]");
  if (!root) return true;
  const properties = [
    "background",
    "backgroundColor",
    "backgroundImage",
    "opacity",
    "filter",
    "mixBlendMode",
  ];
  return document.getAnimations().some((animation) => {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) return false;
    return (
      effect.target.contains(root) &&
      effect.getKeyframes().some((frame) => properties.some((key) => key in frame))
    );
  });
}

function hasChangingTimelineBackground(): boolean {
  const root = document.querySelector("[data-composition-id]");
  const timelines: unknown = "__timelines" in window ? window.__timelines : undefined;
  if (!root || !timelines || typeof timelines !== "object") return false;
  const children = Object.values(timelines).flatMap((timeline) =>
    typeof timeline?.getChildren === "function" ? timeline.getChildren(true, true, false) : [],
  );
  return children.some((tween) => {
    const vars = { ...tween?.vars, ...tween?.vars?.css, ...tween?.vars?.startAt };
    const targets = typeof tween?.targets === "function" ? tween.targets() : [];
    const changesPaint = Object.keys(vars).some(
      (key) =>
        key.startsWith("background") ||
        ["opacity", "filter", "autoAlpha", "mixBlendMode"].includes(key),
    );
    return (
      changesPaint &&
      targets.some((target: unknown) => target instanceof Element && target.contains(root))
    );
  });
}

function hasExplicitNoBackground(): boolean {
  const root = document.querySelector("[data-composition-id]");
  const elements: Element[] = [];
  for (let element: Element | null = root; element; element = element.parentElement)
    elements.push(element);
  const declarations: CSSStyleDeclaration[] = elements.flatMap((element) =>
    element instanceof HTMLElement || element instanceof SVGElement ? [element.style] : [],
  );
  const sheets = [...document.styleSheets, ...document.adoptedStyleSheets].filter(
    (sheet) => !sheet.disabled,
  );
  for (const rule of sheets.flatMap((sheet) => Array.from(sheet.cssRules))) {
    if (rule instanceof CSSFontFaceRule || rule instanceof CSSKeyframesRule) continue;
    // Proving absence needs complete cascade participation. Unhandled grouping/nesting stays unknown.
    if (!(rule instanceof CSSStyleRule) || rule.cssRules.length > 0) return false;
    if (elements.some((element) => element.matches(rule.selectorText)))
      declarations.push(rule.style);
  }
  const backgrounds = declarations.filter(
    (style) =>
      style.getPropertyValue("background-color") || style.getPropertyValue("background-image"),
  );
  return (
    backgrounds.length > 0 &&
    backgrounds.every((style) => style.getPropertyValue("background").trim() === "none")
  );
}

export async function readReferenceBackground(
  page: Pick<Page, "evaluate">,
): Promise<ReferenceBackground> {
  try {
    const observation = await page.evaluate(observeReferenceBackground);
    const initial = classifyReferenceBackground(observation);
    if (!observation || initial.kind === "unsupported_non_solid") return initial;
    const changes = await Promise.all([
      page.evaluate(hasChangingCssBackground),
      page.evaluate(hasChangingTimelineBackground),
    ]);
    if (changes.some(Boolean)) return { kind: "unknown" };
    if (initial.kind === "solid") return initial;
    observation.explicitNone = await page.evaluate(hasExplicitNoBackground);
    return classifyReferenceBackground(observation);
  } catch {
    return { kind: "unknown" };
  }
}
