import type { IconWeight } from "@phosphor-icons/react";

const WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"] as const;

function asWeight(value: string): IconWeight | null {
  return (WEIGHTS as readonly string[]).includes(value) ? (value as IconWeight) : null;
}

/**
 * Studio's Phosphor defaults, read off `theme.css` so the icon size and weight
 * have one owner instead of a CSS variable and a JavaScript constant that drift
 * apart. Both are SVG attributes, not styles, so `var()` cannot be handed to
 * Phosphor directly and the values are resolved once at the app root.
 *
 * A missing or unrecognized value means the stylesheet has not loaded (or the
 * token was renamed); Phosphor's own defaults are used rather than a second
 * copy of the token values.
 */
export function readIconTokens(root: Element = document.documentElement): {
  size: string;
  weight: IconWeight;
} {
  const styles = getComputedStyle(root);
  const size = styles.getPropertyValue("--icon-size").trim();
  const weight = asWeight(styles.getPropertyValue("--icon-weight").trim());
  return { size: size || "1em", weight: weight ?? "regular" };
}
