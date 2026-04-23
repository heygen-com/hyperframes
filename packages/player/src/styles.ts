export const PLAYER_STYLES = /* css */ `
  :host {
    display: block;
    position: relative;
    overflow: hidden;
    background: #000;
    contain: layout style;
  }

  .hfp-container {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }


  .hfp-iframe {
    position: absolute;
    top: 50%;
    left: 50%;
    border: none;
    pointer-events: none;
  }

  .hfp-poster {
    position: absolute;
    inset: 0;
    object-fit: contain;
    z-index: 1;
    pointer-events: none;
  }

  /* ── Theming via CSS custom properties ──
   *
   * Override from outside the shadow DOM:
   *   hyperframes-player {
   *     --hfp-controls-bg: linear-gradient(transparent, rgba(0,0,0,0.9));
   *     --hfp-accent: #ff6b6b;
   *     --hfp-font: "Inter", sans-serif;
   *   }
   */

  .hfp-controls {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: var(--hfp-controls-gap, 12px);
    padding: var(--hfp-controls-padding, 8px 16px);
    background: var(--hfp-controls-bg, linear-gradient(transparent, rgba(0, 0, 0, 0.7)));
    color: var(--hfp-color, #fff);
    font-family: var(--hfp-font, system-ui, -apple-system, sans-serif);
    font-size: var(--hfp-font-size, 13px);
    z-index: 10;
    pointer-events: auto;
    opacity: 1;
    transition: opacity 0.3s ease;
    user-select: none;
  }

  .hfp-controls.hfp-hidden {
    opacity: 0;
    pointer-events: none;
  }

  .hfp-play-btn {
    background: none;
    border: none;
    color: var(--hfp-color, #fff);
    cursor: pointer;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    z-index: 10;
  }

  .hfp-play-btn:hover {
    opacity: 0.8;
  }

  .hfp-play-btn svg,
  .hfp-play-btn svg * {
    pointer-events: none;
  }

  .hfp-scrubber {
    flex: 1;
    height: var(--hfp-scrubber-height, 4px);
    background: var(--hfp-scrubber-bg, rgba(255, 255, 255, 0.3));
    border-radius: var(--hfp-scrubber-radius, 2px);
    cursor: pointer;
    position: relative;
  }

  .hfp-scrubber:hover {
    height: var(--hfp-scrubber-height-hover, 6px);
  }

  .hfp-progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--hfp-accent, #fff);
    border-radius: var(--hfp-scrubber-radius, 2px);
    pointer-events: none;
  }

  .hfp-time {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    opacity: 0.9;
  }

  .hfp-speed-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .hfp-speed-btn {
    background: var(--hfp-speed-btn-bg, rgba(255, 255, 255, 0.15));
    border: none;
    border-radius: var(--hfp-speed-btn-radius, 4px);
    color: var(--hfp-color, #fff);
    cursor: pointer;
    font-family: var(--hfp-font, system-ui, -apple-system, sans-serif);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    padding: 4px 8px;
    min-width: 40px;
    text-align: center;
    transition: background 0.15s ease;
  }

  .hfp-speed-btn:hover {
    background: var(--hfp-speed-btn-bg-hover, rgba(255, 255, 255, 0.3));
  }

  .hfp-speed-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: var(--hfp-menu-bg, rgba(20, 20, 20, 0.95));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--hfp-menu-border, rgba(255, 255, 255, 0.1));
    border-radius: var(--hfp-menu-radius, 8px);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 80px;
    opacity: 0;
    visibility: hidden;
    transform: translateY(4px);
    transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
    box-shadow: var(--hfp-menu-shadow, 0 8px 24px rgba(0, 0, 0, 0.4));
  }

  .hfp-speed-menu.hfp-open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  .hfp-speed-option {
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--hfp-menu-color, rgba(255, 255, 255, 0.7));
    cursor: pointer;
    font-family: var(--hfp-font, system-ui, -apple-system, sans-serif);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    padding: 6px 12px;
    text-align: left;
    transition: background 0.1s ease, color 0.1s ease;
    white-space: nowrap;
  }

  .hfp-speed-option:hover {
    background: var(--hfp-menu-hover-bg, rgba(255, 255, 255, 0.1));
    color: var(--hfp-color, #fff);
  }

  .hfp-speed-option.hfp-active {
    color: var(--hfp-accent, #fff);
    font-weight: 600;
  }
`;

export const PLAY_ICON = `<svg width="24" height="24" viewBox="0 0 18 18" fill="currentColor"><polygon points="4,2 16,9 4,16"/></svg>`;
export const PAUSE_ICON = `<svg width="24" height="24" viewBox="0 0 18 18" fill="currentColor"><rect x="3" y="2" width="4" height="14"/><rect x="11" y="2" width="4" height="14"/></svg>`;

/**
 * Process-wide cache for the constructed PLAYER_STYLES sheet. Lazy so the
 * module stays SSR-safe (CSSStyleSheet is window-scoped) and so a single
 * sheet can be shared across every shadow root via `adoptedStyleSheets` —
 * the studio thumbnail grid renders dozens of players, and avoiding N
 * duplicate `<style>` parses + style-recalc invalidations is the win here.
 *
 * `null` after a failed construction attempt = "fall back forever in this
 * process" (the usual cause is a missing constructor in older runtimes;
 * retrying every call would just throw the same way).
 */
let sharedSheet: CSSStyleSheet | null | undefined;

/**
 * Returns the shared player stylesheet, or `null` if constructable
 * stylesheets aren't available in this environment.
 *
 * The result is memoized for the life of the module — every shadow root
 * adopts the same `CSSStyleSheet` instance.
 */
export function getSharedPlayerStyleSheet(): CSSStyleSheet | null {
  if (sharedSheet !== undefined) return sharedSheet;

  if (typeof CSSStyleSheet === "undefined") {
    sharedSheet = null;
    return null;
  }

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PLAYER_STYLES);
    sharedSheet = sheet;
    return sheet;
  } catch {
    sharedSheet = null;
    return null;
  }
}

/**
 * Internal hook for tests to clear the memoized sheet. Not part of the
 * public API.
 */
export function _resetSharedPlayerStyleSheet(): void {
  sharedSheet = undefined;
}

/**
 * Install PLAYER_STYLES into a player shadow root. Prefers the shared
 * constructable stylesheet (one parse, one rule tree, N adopters) and
 * falls back to a per-instance `<style>` element when the host runtime
 * lacks `adoptedStyleSheets` support.
 *
 * Idempotent: re-applying to a root that already adopts the shared sheet
 * is a no-op. Pre-existing adopted sheets are preserved (we append, never
 * replace), so callers further up the chain can keep their styles.
 */
export function applyPlayerStyles(shadow: ShadowRoot): void {
  const sheet = getSharedPlayerStyleSheet();
  const adopted = (shadow as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets;

  if (sheet && Array.isArray(adopted)) {
    if (!adopted.includes(sheet)) {
      (shadow as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [
        ...adopted,
        sheet,
      ];
    }
    return;
  }

  const style = document.createElement("style");
  style.textContent = PLAYER_STYLES;
  shadow.appendChild(style);
}
