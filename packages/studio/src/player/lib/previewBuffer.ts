/**
 * Double-buffering for the preview.
 *
 * Reloading the preview used to hide the iframe, navigate it, and reveal it
 * again once the runtime had seeked — a deliberate blank of however long the
 * reload took (~200ms), chosen over the worse alternative of showing the raw
 * document with every clip stacked and visible. An agent editing a composition
 * makes that blank happen on every edit, which is exactly when the user is
 * watching.
 *
 * So a reload now builds its replacement beside the live one and swaps at the
 * moment the new document has rendered the right frame. The two ends of that
 * swap live in different files — the mount belongs to the Player, the reveal to
 * the timeline's init — so they meet on the iframe element itself, which is the
 * one thing both sides already hold.
 */

/** Called with the URL to load; the Player builds the buffer. */
export type PreviewReloader = (nextSrc: string) => void;

interface BufferedIframe extends HTMLIFrameElement {
  __hfReloadIntoBuffer?: PreviewReloader;
  /** Retires the player this buffer replaces. Runs once, when it is revealed. */
  __hfRetirePrevious?: () => void;
}

/** Let the timeline ask for a buffered reload instead of navigating in place. */
export function markPreviewReloader(iframe: HTMLIFrameElement, reload: PreviewReloader): void {
  (iframe as BufferedIframe).__hfReloadIntoBuffer = reload;
}

/** Carry the reloader across a swap, so the next reload can buffer too. */
export function inheritPreviewReloader(from: HTMLIFrameElement, to: HTMLIFrameElement): void {
  const reload = (from as BufferedIframe).__hfReloadIntoBuffer;
  if (reload) markPreviewReloader(to, reload);
}

/** What to run when this buffer becomes the visible one. */
export function markPreviewBuffer(iframe: HTMLIFrameElement, retire: () => void): void {
  (iframe as BufferedIframe).__hfRetirePrevious = retire;
}

/**
 * Ask for a buffered reload. Returns false when this preview has no buffering
 * (a standalone player mount, or a test double), so the caller can fall back to
 * navigating in place rather than not reloading at all.
 */
export function requestBufferedReload(iframe: HTMLIFrameElement, nextSrc: string): boolean {
  const reload = (iframe as BufferedIframe).__hfReloadIntoBuffer;
  if (!reload) return false;
  reload(nextSrc);
  return true;
}

/**
 * Show a buffer and retire what it replaced, in one step: the swap has to be a
 * single frame or it reintroduces the blank it exists to remove.
 */
export function promotePreviewBuffer(iframe: HTMLIFrameElement | null): void {
  const buffered = iframe as BufferedIframe | null;
  const retire = buffered?.__hfRetirePrevious;
  if (!buffered || !retire) return;
  buffered.__hfRetirePrevious = undefined;
  buffered.style.visibility = "";
  retire();
}
