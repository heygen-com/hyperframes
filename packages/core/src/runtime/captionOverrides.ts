/**
 * Caption Overrides — applies per-word style overrides from a JSON data file.
 *
 * Strategy: wrap each overridden word span in an inline-block wrapper span,
 * then apply transforms to the wrapper. The inner span keeps all its original
 * GSAP animations (entrance, karaoke, exit) untouched. No tweens are killed.
 *
 * Matching (in priority order):
 * 1. `wordId` — matches by element ID (document.getElementById)
 * 2. `wordIndex` — fallback, DOM traversal order across .caption-group > span
 */

import { isHtmlElement } from "./domRealm";

interface CaptionOverride {
  wordId?: string;
  wordIndex?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  /** Color when the word is being spoken (karaoke active state) */
  activeColor?: string;
  /** Color before and after the word is spoken (dim/inactive state) */
  dimColor?: string;
  opacity?: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
}

function isCaptionOverride(value: unknown): value is CaptionOverride {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCaptionOverridePayload(value: unknown): CaptionOverride[] {
  if (!Array.isArray(value)) {
    throw new Error("expected a JSON array");
  }
  if (!value.every(isCaptionOverride)) {
    throw new Error("every array entry must be an object");
  }
  return value;
}

interface GsapTween {
  vars: Record<string, unknown>;
  startTime(): number;
  invalidate?(): void;
}

interface GsapStatic {
  set: (target: Element, vars: Record<string, unknown>) => void;
  killTweensOf: (target: Element, props: string) => void;
  getTweensOf: (target: Element) => GsapTween[];
}

/**
 * The caption state a composition DECLARES for a colour tween, if any.
 *
 * Authored as `data: { captionState: "dim" | "active" }` in the tween's vars. GSAP passes unknown
 * vars through untouched, so this costs a declaring composition nothing at runtime.
 *
 * It exists because the fallback below has to GUESS. Classifying by colour equality breaks outright
 * when a composition's two states share a colour: every tween matches the rest colour, and the
 * active override is silently dropped. A declaration is the composition telling us what it built,
 * rather than us inferring it from what it happens to look like.
 */
function declaredCaptionState(tween: GsapTween): "dim" | "active" | undefined {
  const data = tween.vars.data as { captionState?: unknown } | undefined;
  const state = data?.captionState;
  return state === "dim" || state === "active" ? state : undefined;
}

function resolveCaptionWordElement(el: Element | null): HTMLElement | null {
  if (!isHtmlElement(el)) return null;
  if (el.dataset.captionWrapper !== "true") return el;

  const inner = el.querySelector<HTMLElement>(":scope > span");
  return inner ?? null;
}

function getCaptionWordElements(): HTMLElement[] {
  const wordEls: HTMLElement[] = [];
  const groups = document.querySelectorAll(".caption-group");

  for (const group of groups) {
    for (const child of group.children) {
      if (!isHtmlElement(child)) continue;

      const wordEl =
        child.dataset.captionWrapper === "true"
          ? child.querySelector<HTMLElement>(":scope > span")
          : child.tagName === "SPAN"
            ? child
            : null;

      if (wordEl) wordEls.push(wordEl);
    }
  }

  return wordEls;
}

function getOrCreateCaptionWrapper(el: HTMLElement): HTMLElement {
  const parent = el.parentElement;
  if (parent?.dataset.captionWrapper === "true") return parent;

  const wrapper = document.createElement("span");
  wrapper.style.display = "inline-block";
  wrapper.dataset.captionWrapper = "true";
  el.parentNode?.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  return wrapper;
}

const gsapOf = () => (window as unknown as { gsap?: GsapStatic }).gsap;

const fetchOverridesPayload = (): Promise<unknown> =>
  fetch("caption-overrides.json").then((r) => (r.ok ? r.json() : null));

const parseOverrides = (data: unknown): readonly CaptionOverride[] =>
  data === null ? [] : parseCaptionOverridePayload(data);

function logInvalidOverrides(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[HyperFrames] Invalid caption-overrides.json: ${message}`);
}

/** The page's caption overrides; empty when there are none or no GSAP to apply them with. */
export function fetchCaptionOverrides(): Promise<readonly CaptionOverride[]> {
  if (!gsapOf()) return Promise.resolve([]);
  return fetchOverridesPayload()
    .then(parseOverrides)
    .catch((error: unknown) => {
      logInvalidOverrides(error);
      return [];
    });
}

export function applyCaptionOverrides(
  within?: readonly Element[],
  beforeRewrite?: () => void,
): Promise<void> {
  if (!gsapOf()) return Promise.resolve();
  // Only fetch overrides if the composition has caption groups
  if (document.querySelectorAll(".caption-group").length === 0) return Promise.resolve();
  return fetchOverridesPayload()
    .then((data) => applyFetchedCaptionOverrides(parseOverrides(data), within, beforeRewrite))
    .catch(logInvalidOverrides);
}

function findOverrideTarget(override: CaptionOverride, wordEls: HTMLElement[]): HTMLElement | null {
  const byId = override.wordId
    ? resolveCaptionWordElement(document.getElementById(override.wordId))
    : null;
  return byId ?? (override.wordIndex !== undefined ? (wordEls[override.wordIndex] ?? null) : null);
}

function definedProps(override: CaptionOverride, keys: (keyof CaptionOverride)[]) {
  return Object.fromEntries(
    keys.filter((key) => override[key] !== undefined).map((key) => [key, override[key]]),
  );
}

// The colour the browser paints on `el` with `color` inline, so any spelling compares equal.
// An empty `color` reads the stylesheet colour past whatever GSAP has rendered inline.
function paintedColor(el: HTMLElement, color: string): string {
  const inline = el.style.color;
  el.style.color = color;
  const painted = getComputedStyle(el).color;
  el.style.color = inline;
  return painted;
}

// What the word shows before it is spoken: its first colour tween's start colour (a fromTo()),
// else its stylesheet colour.
function restColorOf(el: HTMLElement, colorTweens: GsapTween[]): string {
  const startAt = colorTweens[0]?.vars.startAt as { color?: unknown } | undefined;
  return paintedColor(el, startAt?.color === undefined ? "" : String(startAt.color));
}

// A declaration wins, per tween; otherwise a tween back to the word's rest colour is dim.
// `painted` caches resolutions for one apply: tween colours repeat, and each forces a style recalc.
function tweenState(
  tw: GsapTween,
  el: HTMLElement,
  rest: string,
  painted: Map<string, string>,
): "dim" | "active" {
  const declared = declaredCaptionState(tw);
  if (declared) return declared;
  const color = String(tw.vars.color);
  if (!painted.has(color)) painted.set(color, paintedColor(el, color));
  return painted.get(color) === rest ? "dim" : "active";
}

function rewriteColorTweens(
  gsap: GsapStatic,
  el: HTMLElement,
  override: CaptionOverride,
  painted: Map<string, string>,
): void {
  const colorTweens = gsap
    .getTweensOf(el)
    .filter((tw) => tw.vars.color !== undefined)
    .sort((a, b) => a.startTime() - b.startTime());
  const rest = restColorOf(el, colorTweens);

  for (const tw of colorTweens) {
    const state = tweenState(tw, el, rest, painted);
    const color = state === "dim" ? override.dimColor : override.activeColor;
    if (color) tw.vars.color = color;
    // Each re-reads its start from the word as repainted below, rewritten or not.
    // A from() re-read that way would end on that colour instead.
    if (!tw.vars.runBackwards) tw.invalidate?.();
  }

  // The invalidated tweens re-read their start from this, wherever the playhead has been.
  // A from() recorded its own start, which the rest colour would overwrite.
  const restPaint =
    override.dimColor || (colorTweens.some((tw) => tw.vars.runBackwards) ? undefined : rest);
  if (restPaint) gsap.set(el, { color: restPaint });
}

function applyWordOverride(
  gsap: GsapStatic,
  el: HTMLElement,
  override: CaptionOverride,
  painted: Map<string, string>,
): void {
  // Split into transform props (wrapper) and style props (word span)
  const transformProps = definedProps(override, ["x", "y", "scale", "rotation"]);
  const styleProps = definedProps(override, ["opacity", "fontWeight", "fontFamily"]);
  if (override.fontSize !== undefined) styleProps.fontSize = `${override.fontSize}px`;

  if (override.activeColor || override.dimColor) rewriteColorTweens(gsap, el, override, painted);

  // Apply non-color style props
  if (Object.keys(styleProps).length > 0) {
    gsap.set(el, styleProps);
  }

  // Wrap the word in an inline-block span and apply transforms to the wrapper.
  // This preserves all GSAP entrance/exit/karaoke animations on the inner span.
  if (Object.keys(transformProps).length > 0) {
    const wrapper = getOrCreateCaptionWrapper(el);
    gsap.set(wrapper, transformProps);
  }
}

export function applyFetchedCaptionOverrides(
  overrides: readonly CaptionOverride[],
  within?: readonly Element[],
  beforeRewrite: () => void = () => {},
): void {
  const gsap = gsapOf();
  if (!gsap || overrides.length === 0) return;
  beforeRewrite();

  // Build word element index for wordIndex fallback
  const wordEls = getCaptionWordElements();
  const painted = new Map<string, string>();

  for (const override of overrides) {
    const el = findOverrideTarget(override, wordEls);
    if (!el || (within && !within.some((root) => root.contains(el)))) continue;
    applyWordOverride(gsap, el, override, painted);
  }
}
