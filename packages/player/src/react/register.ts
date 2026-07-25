let registration: Promise<CustomElementConstructor> | null = null;

/**
 * Register the `<hyperframes-player>` custom element by loading the package
 * root on demand. The import is deferred so the `./react` subpath stays
 * SSR-safe: the player module touches `HTMLElement` at module scope and can
 * only be evaluated in a DOM environment.
 *
 * Safe to call multiple times — the import runs once and the returned promise
 * resolves when the element is defined. Call it early (e.g. at app startup)
 * to have the element ready before the first `<HyperframesPlayer>` mounts.
 */
export function ensurePlayerDefined(): Promise<CustomElementConstructor> {
  if (typeof window === "undefined" || typeof customElements === "undefined") {
    throw new Error(
      "@hyperframes/player/react: ensurePlayerDefined() requires a DOM environment (browser); it cannot run during server-side rendering.",
    );
  }
  registration ??= import("@hyperframes/player").then(() =>
    customElements.whenDefined("hyperframes-player"),
  );
  return registration;
}
