/**
 * Caption Overrides — applies per-word style overrides from a JSON data file.
 *
 * Matching strategy (in priority order):
 * 1. `wordId` — matches by element ID (e.g. document.getElementById("w0"))
 * 2. `wordIndex` — fallback, matches by DOM traversal order across .caption-group > span
 *
 * Using wordId is preferred because it's stable across grouping changes.
 * wordIndex is supported for backwards compat with older override files.
 */

export interface CaptionOverride {
  /** Stable word ID from transcript.json (e.g. "w0", "w42"). Preferred lookup key. */
  wordId?: string;
  /** Fallback: positional index across all .caption-group > span elements. */
  wordIndex?: number;
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
  killTweensOf: (target: Element, props: string) => void;
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
        // Resolve element: prefer wordId, fall back to wordIndex
        let el: Element | null = null;
        if (override.wordId) {
          el = document.getElementById(override.wordId);
        }
        if (!el && override.wordIndex !== undefined) {
          el = wordEls[override.wordIndex] ?? null;
        }
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

        if (Object.keys(props).length === 0) continue;

        // Kill conflicting transform tweens before applying overrides
        const killProps: string[] = [];
        if (props.x !== undefined) killProps.push("x");
        if (props.y !== undefined) killProps.push("y");
        if (props.scale !== undefined) killProps.push("scale");
        if (props.rotation !== undefined) killProps.push("rotation");
        if (killProps.length > 0) {
          gsap.killTweensOf(el, killProps.join(","));
        }

        gsap.set(el, props);
      }
    })
    .catch(() => {});
}
