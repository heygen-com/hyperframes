/**
 * DOM setup helpers for the player's shadow root.
 *
 * Keeps constructor boilerplate out of the web component class body.
 */

// Cached Constructable Stylesheet shared across all player instances.
let _sharedSheet: CSSStyleSheet | null = null;

/**
 * Adopt `cssText` into `shadow` via a shared Constructable Stylesheet when the
 * browser supports it, falling back to a `<style>` element injection. The sheet
 * is cached on first creation and reused across all player instances.
 */
function adoptShadowStyles(shadow: ShadowRoot, cssText: string): void {
  if (typeof CSSStyleSheet !== "undefined") {
    try {
      if (!_sharedSheet) {
        _sharedSheet = new CSSStyleSheet();
        _sharedSheet.replaceSync(cssText);
      }
      shadow.adoptedStyleSheets = [_sharedSheet];
      return;
    } catch {
      /* fallthrough */
    }
  }
  const style = document.createElement("style");
  style.textContent = cssText;
  shadow.appendChild(style);
}

/**
 * Creates and configures the iframe element that hosts the composition, plus
 * the wrapper container div. Returns handles to both so the constructor can
 * attach them to the shadow root and track references without inlining the
 * boilerplate.
 */
function createCompositionIframe(): {
  container: HTMLDivElement;
  iframe: HTMLIFrameElement;
} {
  const container = document.createElement("div");
  container.className = "hfp-container";

  const iframe = document.createElement("iframe");
  iframe.className = "hfp-iframe";
  iframe.sandbox.add("allow-scripts", "allow-same-origin");
  iframe.allow = "autoplay; fullscreen";
  iframe.referrerPolicy = "no-referrer";
  iframe.title = "HyperFrames Composition";

  container.appendChild(iframe);
  return { container, iframe };
}

export interface PlayerShadowDomSetup {
  shadow: ShadowRoot;
  container: HTMLDivElement;
  iframe: HTMLIFrameElement;
  poster: HTMLImageElement | null;
  /** True when a server-rendered declarative shadow root was reused. */
  adopted: boolean;
}

/**
 * Build the player's shadow DOM — or ADOPT a server-rendered one.
 *
 * When the page was server-rendered with a `<template shadowrootmode="open">`
 * (see `ssr.ts`), the browser has already attached a shadow root containing
 * the container/iframe (likely mid-load) before this element upgrades.
 * Rebuilding would throw that work away and reload the composition, so when
 * the expected structure is present it is adopted as-is. A foreign or
 * malformed declarative root is cleared and rebuilt imperatively.
 */
export function setupPlayerShadowDom(host: HTMLElement, cssText: string): PlayerShadowDomSetup {
  const declarative = host.shadowRoot;
  if (declarative) {
    const container = declarative.querySelector<HTMLDivElement>("div.hfp-container");
    const iframe = container?.querySelector<HTMLIFrameElement>("iframe.hfp-iframe") ?? null;
    if (container && iframe) {
      // The serialized <style data-hfp-ssr> already carries PLAYER_STYLES
      // (adoptedStyleSheets cannot be serialized); only adopt the shared
      // sheet when the SSR payload somehow lacked it.
      if (!declarative.querySelector("style[data-hfp-ssr]")) {
        adoptShadowStyles(declarative, cssText);
      }
      return {
        shadow: declarative,
        container,
        iframe,
        poster: declarative.querySelector<HTMLImageElement>("img.hfp-poster"),
        adopted: true,
      };
    }
    declarative.replaceChildren();
  }
  const shadow = declarative ?? host.attachShadow({ mode: "open" });
  adoptShadowStyles(shadow, cssText);
  const { container, iframe } = createCompositionIframe();
  shadow.appendChild(container);
  return { shadow, container, iframe, poster: null, adopted: false };
}

/**
 * Scale the iframe so the composition fits inside the player element while
 * preserving aspect ratio. No-ops when the player has no painted size yet.
 * Returns whether the transform was actually applied, so callers can tell a
 * real no-op (still 0×0) apart from a successful rescale.
 */
export function scaleIframeToFit(
  playerElement: HTMLElement,
  iframe: HTMLIFrameElement,
  compositionWidth: number,
  compositionHeight: number,
): boolean {
  const w = playerElement.offsetWidth;
  const h = playerElement.offsetHeight;
  if (w === 0 || h === 0) return false;
  const scale = Math.min(w / compositionWidth, h / compositionHeight);
  iframe.style.width = `${compositionWidth}px`;
  iframe.style.height = `${compositionHeight}px`;
  iframe.style.transform = `translate(-50%, -50%) scale(${scale})`;
  return true;
}
