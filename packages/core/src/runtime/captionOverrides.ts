/**
 * Caption Overrides — applies per-word style overrides from a JSON data file.
 *
 * Strategy: wrap each overridden word span in an inline-block wrapper span,
 * then apply transforms to the wrapper. The inner span keeps all its original
 * GSAP animations (entrance, karaoke, exit) untouched. No tweens are killed.
 *
 * Matching: `wordIndex` — positional index across all .caption-group > span
 * elements in DOM order. Stable for the lifetime of a transcript.
 */

export interface CaptionOverride {
  wordIndex: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  activeColor?: string;
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

      const wordEls: Element[] = [];
      const groups = document.querySelectorAll(".caption-group");
      for (const group of groups) {
        const spans = group.querySelectorAll(":scope > span");
        for (const span of spans) {
          wordEls.push(span);
        }
      }

      for (const override of data) {
        const el = wordEls[override.wordIndex];
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

        // Replace color values in existing GSAP tweens by timeline order
        if (override.activeColor || override.dimColor) {
          const allTweens = gsap.getTweensOf(el);
          const colorTweens = allTweens
            .filter((tw) => tw.vars.color !== undefined)
            .sort((a, b) => a.startTime() - b.startTime());

          for (let i = 0; i < colorTweens.length; i++) {
            if (i === 0 && override.dimColor) {
              colorTweens[i].vars.color = override.dimColor;
            } else if (i === 1 && override.activeColor) {
              colorTweens[i].vars.color = override.activeColor;
            } else if (i >= 2 && override.dimColor) {
              colorTweens[i].vars.color = override.dimColor;
            }
          }

          if (override.dimColor) {
            gsap.set(el, { color: override.dimColor });
          }
        }

        if (Object.keys(styleProps).length > 0) {
          gsap.set(el, styleProps);
        }

        // Wrap in inline-block span and apply transforms to the wrapper
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
