/**
 * Caption Overrides — applies per-word style overrides from a JSON data file.
 *
 * When a project has a caption-overrides.json, the runtime loads it after all
 * timelines are registered and applies gsap.set() to each overridden word
 * element, matched by word index in DOM traversal order.
 */

export interface CaptionOverride {
  wordIndex: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  color?: string;
  opacity?: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
}

interface GsapStatic {
  set: (target: Element, vars: Record<string, unknown>) => void;
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
      if (wordEls.length === 0) return;

      for (const override of data) {
        const el = wordEls[override.wordIndex];
        if (!el) continue;

        const props: Record<string, unknown> = {};
        if (override.x !== undefined) props.x = override.x;
        if (override.y !== undefined) props.y = override.y;
        if (override.scale !== undefined) props.scale = override.scale;
        if (override.rotation !== undefined) props.rotation = override.rotation;
        if (override.color !== undefined) props.color = override.color;
        if (override.opacity !== undefined) props.opacity = override.opacity;
        if (override.fontSize !== undefined) props.fontSize = `${override.fontSize}px`;
        if (override.fontWeight !== undefined) props.fontWeight = override.fontWeight;
        if (override.fontFamily !== undefined) props.fontFamily = override.fontFamily;

        if (Object.keys(props).length > 0) {
          gsap.set(el, props);
        }
      }
    })
    .catch(() => {});
}
