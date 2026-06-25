/**
 * Temporary strategic logging for the position-commit path investigation:
 * which commits go through the GSAP code path (writes `tl.set`/keyframes/`gsap.set`)
 * vs. the deprecated CSS-var path (`applyStudioPathOffset` → `--hf-studio-offset`).
 *
 * Gated on `window.__hfDebug || import.meta.env.DEV`, prefix `[hf-pos:<scope>]`.
 * Remove once the CSS-var path is eliminated.
 */
declare global {
  interface Window {
    __hfDebug?: boolean;
  }
}

export function logPos(scope: string, data?: unknown): void {
  if (typeof window === "undefined") return;
  if (!window.__hfDebug && !import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[hf-pos:${scope}]`, data === undefined ? "" : JSON.stringify(data));
}
