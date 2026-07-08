import { DOMParser } from "linkedom";

/**
 * Polyfill DOMParser on globalThis so @hyperframes/core's parseHtml works in Node.js.
 * Safe to call multiple times — only sets the global once.
 */
export function ensureDOMParser(): void {
  if (typeof globalThis.DOMParser === "undefined") {
    (globalThis as Record<string, unknown>).DOMParser = DOMParser;
  }
}
