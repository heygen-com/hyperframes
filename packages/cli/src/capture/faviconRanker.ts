/**
 * Rank declared `<link rel="icon">` candidates so the capture downloads the BEST one,
 * not whichever the page happened to declare first.
 *
 * Pages routinely declare a legacy 16px `.ico` first and the good asset (an SVG, or a
 * 180x180 apple-touch PNG) after it. Downloading in DOM order therefore lands the worst
 * icon on disk, and the `sizes`/`type` attributes that say so are the only evidence —
 * the bytes are only fetched for the winner, so quality cannot be measured after the fact.
 *
 * Pure: no IO, no network. Order only.
 */

export interface IconCandidate {
  rel: string;
  href: string;
  /** `sizes` attribute verbatim, e.g. "32x32", "any", "180x180 167x167". */
  sizes?: string | null;
  /** `type` attribute verbatim, e.g. "image/svg+xml". */
  type?: string | null;
}

/** Apple's spec size for a `apple-touch-icon` that declares no `sizes`. */
const APPLE_TOUCH_DEFAULT_PX = 180;

/**
 * Largest pixel edge declared in a `sizes` attribute. `any` (used by SVG and by legacy
 * `.ico` files alike) declares no pixel size at all, so it scores 0 rather than Infinity.
 */
export function parseSizes(sizes: string | null | undefined): number {
  if (!sizes) return 0;
  let max = 0;
  for (const token of sizes.trim().split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/i.exec(token);
    if (!m) continue; // "any" and anything malformed
    max = Math.max(max, Number(m[1]), Number(m[2]));
  }
  return max;
}

function pathnameOf(href: string): string {
  try {
    return new URL(href).pathname.toLowerCase();
  } catch {
    return href.split(/[#?]/)[0]!.toLowerCase();
  }
}

function isSvg(c: IconCandidate): boolean {
  return c.type?.toLowerCase() === "image/svg+xml" || pathnameOf(c.href).endsWith(".svg");
}

/**
 * `rel="mask-icon"` is Safari's pinned-tab asset: a single-colour silhouette, drawn in whatever
 * tint the browser picks. It is not the site mark, and it is served as an SVG, so ranking by
 * format alone would promote a monochrome outline over the page's real colour favicon.
 */
function isMaskIcon(c: IconCandidate): boolean {
  return c.rel.toLowerCase().split(/\s+/).includes("mask-icon");
}

function isIco(c: IconCandidate): boolean {
  const t = c.type?.toLowerCase();
  return (
    t === "image/x-icon" || t === "image/vnd.microsoft.icon" || pathnameOf(c.href).endsWith(".ico")
  );
}

function declaredSize(c: IconCandidate): number {
  const parsed = parseSizes(c.sizes);
  if (parsed > 0) return parsed;
  return c.rel.toLowerCase().split(/\s+/).includes("apple-touch-icon") ? APPLE_TOUCH_DEFAULT_PX : 0;
}

function tierOf(c: IconCandidate): number {
  // ponytail: mask-icon is ranked last rather than filtered out, so a page that declares
  // nothing else still lands an icon instead of none.
  if (isMaskIcon(c)) return 3;
  if (isSvg(c)) return 0;
  return isIco(c) ? 2 : 1;
}

/**
 * Best-first order: SVG, then largest declared size, then `.ico`, then a pinned-tab `mask-icon`
 * as a last resort. Stable within a tier, so DOM order breaks ties.
 */
export function rankIconCandidates(candidates: IconCandidate[]): IconCandidate[] {
  return candidates
    .filter((c) => !!c.href)
    .map((c, i) => ({ c, i, tier: tierOf(c), size: declaredSize(c) }))
    .sort((a, b) => a.tier - b.tier || b.size - a.size || a.i - b.i)
    .map((e) => e.c);
}
