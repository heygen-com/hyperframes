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
export function adoptShadowStyles(shadow: ShadowRoot, cssText: string): void {
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
export function createCompositionIframe(): {
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
  if (zoomsFramesWhole) {
    iframe.style.zoom = String(scale);
    iframe.style.transform = "translate(-50%, -50%)";
  } else {
    iframe.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  return true;
}

let zoomsFramesWhole: boolean | undefined;

export function initializeIframeScaling(iframe: HTMLIFrameElement): void {
  if (zoomsFramesWhole !== undefined) return;
  const win = iframe.contentWindow;
  if (!win || iframe.contentDocument === null) return;
  const cssText = iframe.style.cssText;
  const zoom = 0.3646;
  iframe.style.width = "1920px";
  iframe.style.height = "1080px";
  iframe.style.zoom = String(zoom);
  const hostRatio = iframe.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  const devicePixel = 1 / (zoom * hostRatio);
  zoomsFramesWhole =
    Math.abs(win.innerWidth - 1920) <= devicePixel &&
    Math.abs(win.innerHeight - 1080) <= devicePixel &&
    Math.abs(win.devicePixelRatio - hostRatio * zoom) < 0.01;
  iframe.style.cssText = cssText;
}
