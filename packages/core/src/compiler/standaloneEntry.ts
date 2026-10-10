import { parseHTML } from "linkedom";

function normalizeCompositionSrcPath(srcPath: string): string {
  return srcPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Read the `data-duration` off a scene file's `<template>` root — the scene's
 * own authored length. linkedom does not implement inert `<template>` content,
 * so we re-parse `template.innerHTML` (the pattern htmlBundler uses) to reach
 * the composition root inside it. Returns null when the file has no template
 * or the root declares no duration.
 */
function readSceneRootDuration(entryHtml: string | undefined): string | null {
  if (!entryHtml) return null;
  const { document } = parseHTML(entryHtml);
  const template = document.querySelector("template");
  const scope = template ? parseHTML(template.innerHTML).document : document;
  const root = scope.querySelector("[data-composition-id]") as Element | null;
  return root?.getAttribute("data-duration") ?? null;
}

function createStandaloneEntryRenderClone(
  root: Element,
  host: Element,
  sceneDuration: string | null,
): Element {
  // linkedom's cloneNode returns `any` (not `Node`), so the Element cast
  // is needed to access setAttribute/appendChild without losing type safety.
  const hostClone = host.cloneNode(true) as Element;
  hostClone.setAttribute("data-start", "0");

  if (root === host) return hostClone;

  const rootClone = root.cloneNode(false) as Element;
  // The standalone composition IS the mounted scene, not the master shell that
  // wraps it. A shallow clone of the master root otherwise keeps the master's
  // data-duration (the whole project's length), so `render -c <scene>` rendered
  // the scene for the entire project duration — or threw "Composition has zero
  // duration" when the master derived its length from siblings now removed.
  // Re-point the wrapper's duration at the scene's own; drop it (derive from the
  // single child) only when the scene declared none.
  if (sceneDuration != null) {
    rootClone.setAttribute("data-duration", sceneDuration);
  } else {
    rootClone.removeAttribute("data-duration");
  }
  rootClone.appendChild(hostClone);
  return rootClone;
}

function replaceBodyWithRenderClone(body: HTMLElement, renderClone: Element): void {
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }
  body.appendChild(renderClone);
}

export function extractStandaloneEntryFromIndex(
  indexHtml: string,
  entryFile: string,
  entryHtml?: string,
): string | null {
  const normalizedEntryFile = normalizeCompositionSrcPath(entryFile);
  const { document } = parseHTML(indexHtml);
  const body = document.querySelector("body");
  if (!body) return null;

  // linkedom's querySelectorAll returns `any` on Document and `NodeList` on
  // the ParentNode mixin. Neither types the elements as `Element`, so the
  // cast is required to call getAttribute / hasAttribute without `any`.
  const hosts = Array.from(document.querySelectorAll("[data-composition-src]")) as Element[];
  const host = hosts.find(
    (candidate) =>
      normalizeCompositionSrcPath(candidate.getAttribute("data-composition-src") || "") ===
      normalizedEntryFile,
  );
  if (!host) return null;

  // linkedom's `children` is typed as `NodeList` (not `HTMLCollection<Element>`),
  // so the Element[] cast is needed.
  const root =
    (Array.from(body.children) as Element[]).find((candidate) =>
      candidate.hasAttribute("data-composition-id"),
    ) ?? null;
  if (!root) return null;

  // The scene file is the source of truth for its own duration; fall back to the
  // mount's data-duration (its window in the master timeline) when the scene
  // file content isn't supplied.
  const sceneDuration = readSceneRootDuration(entryHtml) ?? host.getAttribute("data-duration");

  const renderClone = createStandaloneEntryRenderClone(root, host, sceneDuration);
  replaceBodyWithRenderClone(body, renderClone);

  return document.toString();
}
