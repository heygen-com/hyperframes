/**
 * Resolves a path the calling composition wrote relative to its own file. At the top level, and
 * for a composition opened on its own, that file is the page. Inside a mounted sub-composition
 * the scoped wrapper (compiler/compositionScoping.ts) replaces this with one bound to that file.
 */
export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}
