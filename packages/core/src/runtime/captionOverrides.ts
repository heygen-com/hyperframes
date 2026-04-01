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
}

interface GsapStatic {
  set: (target: Element, vars: Record<string, unknown>) => void;
  killTweensOf: (target: Element, props: string) => void;
  getTweensOf: (target: Element) => GsapTween[];
}

export function applyCaptionOverrides(): void {
  const gsap = (window as unknown as { gsap?: GsapStatic }).gsap;
  if (!gsap) return;

  fetch("caption-overrides.json")
    .then((r) => {
      if (!r.ok) return null;
      return r.json();
    })
    .then((data: CaptionOverride[] | null) => {
      if (!data || !Array.isArray(data) || data.length === 0) return;

      // Build word element index for wordIndex fallback
      const wordEls: Element[] = [];
      const groups = document.querySelectorAll(".caption-group");
      for (const group of groups) {
        const spans = group.querySelectorAll(":scope > span");
        for (const span of spans) {
          wordEls.push(span);
        }
      }

      for (const override of data) {
        let el: Element | null = null;
        if (override.wordId) {
          el = document.getElementById(override.wordId);
        }
        if (!el && override.wordIndex !== undefined) {
          el = wordEls[override.wordIndex] ?? null;
        }
        if (!el || !(el instanceof HTMLElement)) continue;

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

        // Replace color values in existing GSAP tweens for this element.
        // Tweens that set color to dim/spoken/after states get their values swapped.
        if (override.activeColor || override.dimColor) {
          const tweens = gsap.getTweensOf(el);
          for (const tw of tweens) {
            if (tw.vars.color === undefined) continue;
            const colorVal = String(tw.vars.color);
            // Heuristic: dim colors have low alpha or match common dim patterns
            const isDim = colorVal.includes("0.25") || colorVal.includes("0.3") || colorVal.includes("0.2");
            if (isDim && override.dimColor) {
              tw.vars.color = override.dimColor;
            } else if (!isDim && override.activeColor) {
              tw.vars.color = override.activeColor;
            }
          }
          // Also set the current inline color
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
          const wrapper = document.createElement("span");
          wrapper.style.display = "inline-block";
          el.parentNode?.insertBefore(wrapper, el);
          wrapper.appendChild(el);
          gsap.set(wrapper, transformProps);
        }
      }
    })
    .catch(() => {});
}
