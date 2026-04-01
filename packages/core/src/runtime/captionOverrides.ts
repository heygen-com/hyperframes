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

        // Replace color values in existing GSAP tweens by timeline order.
        // For any word, color tweens follow: dim (setup) → active (spoken) → after.
        // Sort by startTime and assign by position, not by content heuristics.
        if (override.activeColor || override.dimColor) {
          const allTweens = gsap.getTweensOf(el);
          const colorTweens = allTweens
            .filter((tw) => tw.vars.color !== undefined)
            .sort((a, b) => a.startTime() - b.startTime());

          for (let i = 0; i < colorTweens.length; i++) {
            if (i === 0 && override.dimColor) {
              // First color tween = dim setup
              colorTweens[i].vars.color = override.dimColor;
            } else if (i === 1 && override.activeColor) {
              // Second color tween = active/spoken
              colorTweens[i].vars.color = override.activeColor;
            } else if (i >= 2 && override.dimColor) {
              // Third+ = after/deactivate (use dim color)
              colorTweens[i].vars.color = override.dimColor;
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
          const wrapper = document.createElement("span");
          wrapper.style.display = "inline-block";
          wrapper.dataset.captionWrapper = "true";
          el.parentNode?.insertBefore(wrapper, el);
          wrapper.appendChild(el);
          gsap.set(wrapper, transformProps);
        }
      }
    })
    .catch(() => {});
}
