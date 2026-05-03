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

export interface CaptionOverride {
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

interface GsapTween {
  vars: Record<string, unknown>;
  startTime(): number;
}

interface GsapStatic {
  set: (target: Element, vars: Record<string, unknown>) => void;
  killTweensOf: (target: Element, props: string) => void;
  getTweensOf: (target: Element) => GsapTween[];
}

function resolveCaptionWordElement(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.dataset.captionWrapper !== "true") return el;

  const inner = el.querySelector<HTMLElement>(":scope > span");
  return inner ?? null;
}

function getCaptionWordElements(): HTMLElement[] {
  const wordEls: HTMLElement[] = [];
  const groups = document.querySelectorAll(".caption-group");

  for (const group of groups) {
    for (const child of group.children) {
      if (!(child instanceof HTMLElement)) continue;

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

export function applyCaptionOverrides(): void {
  const gsap = (window as unknown as { gsap?: GsapStatic }).gsap;
  if (!gsap) return;

  // Only fetch overrides if the composition has caption groups
  if (document.querySelectorAll(".caption-group").length === 0) return;

  fetch("caption-overrides.json")
    .then((r) => {
      if (!r.ok) return null;
      return r.json();
    })
    .then((data: CaptionOverride[] | null) => {
      if (!data || !Array.isArray(data) || data.length === 0) return;

      // Build word element index for wordIndex fallback
      const wordEls = getCaptionWordElements();

      for (const override of data) {
        let el: HTMLElement | null = null;
        if (override.wordId) {
          el = resolveCaptionWordElement(document.getElementById(override.wordId));
        }
        if (!el && override.wordIndex !== undefined) {
          el = wordEls[override.wordIndex] ?? null;
        }
        if (!el) continue;

        // Split into transform props (wrapper) and style props (word span)
        const transformProps: Record<string, unknown> = {};
        const styleProps: Record<string, unknown> = {};

        if (override.x !== undefined) transformProps.x = override.x;
        if (override.y !== undefined) transformProps.y = override.y;
        if (override.scale !== undefined) transformProps.scale = override.scale;
        if (override.rotation !== undefined) transformProps.rotation = override.rotation;
        if (override.opacity !== undefined) styleProps.opacity = override.opacity;
        if (override.fontSize !== undefined) styleProps.fontSize = `${override.fontSize}px`;
        if (override.fontWeight !== undefined) styleProps.fontWeight = override.fontWeight;
        if (override.fontFamily !== undefined) styleProps.fontFamily = override.fontFamily;

        // Replace color values in existing GSAP tweens.
        // Instead of relying on timeline position order (fragile if custom
        // color tweens exist), we classify each tween by comparing its
        // target color to the current computed color of the element.
        // Tweens that match the current color are "dim" tweens; tweens
        // with a different color are "active" tweens.
        if (override.activeColor || override.dimColor) {
          const allTweens = gsap.getTweensOf(el);
          const colorTweens = allTweens
            .filter((tw) => tw.vars.color !== undefined)
            .sort((a, b) => a.startTime() - b.startTime());

          // Use the first tween's color as the dim baseline — if no tweens,
          // fall back to computed style.
          const dimBaseline = colorTweens.length > 0 ? String(colorTweens[0].vars.color) : "";

          for (const tw of colorTweens) {
            const tweenColor = String(tw.vars.color);
            if (tweenColor === dimBaseline) {
              // This tween targets the dim/inactive color
              if (override.dimColor) tw.vars.color = override.dimColor;
            } else {
              // This tween targets the active/spoken color
              if (override.activeColor) tw.vars.color = override.activeColor;
            }
          }

          // Set current visible color (words start in dim state)
          if (override.dimColor) {
            gsap.set(el, { color: override.dimColor });
          }
        }

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
    })
    .catch(() => {});
}
