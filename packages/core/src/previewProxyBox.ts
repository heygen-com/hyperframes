/** Query parameter carrying the largest box, in device pixels, a preview shows a proxied video at. */
export const PREVIEW_PROXY_BOX_PARAM = "hf-proxy-box";

export type PreviewProxyBox = { width: number; height: number };

// 256 * 2^(k/2), even: nearby boxes share one cached copy, and a rung overshoots by at most ~41%.
const RUNGS = [256, 362, 512, 724, 1024, 1448, 2048, 2896, 4096, 5792, 8192];

function rungAtLeast(pixels: number): number | null {
  if (!(pixels > 0)) return null;
  return RUNGS.find((rung) => rung >= pixels) ?? null;
}

/** Rounds a shown box up to the size ladder; null when it is empty or larger than any rung. */
export function quantizePreviewProxyBox(width: number, height: number): PreviewProxyBox | null {
  const w = rungAtLeast(width);
  const h = rungAtLeast(height);
  return w && h ? { width: w, height: h } : null;
}

export function formatPreviewProxyBox(box: PreviewProxyBox): string {
  return `${box.width}x${box.height}`;
}

/** Accepts only ladder rungs, so a client cannot make one cached copy per pixel. */
export function parsePreviewProxyBox(raw: string): PreviewProxyBox | null {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(raw);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return RUNGS.includes(width) && RUNGS.includes(height) ? { width, height } : null;
}
