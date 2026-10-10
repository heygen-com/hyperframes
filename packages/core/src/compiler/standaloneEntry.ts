import { parseHTML } from "linkedom";

export function isTemplateEntry(html: string): boolean {
  return html.trimStart().startsWith("<template");
}

function normalizeCompositionSrcPath(srcPath: string): string {
  return srcPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

// linkedom has no inert <template> content, so the template's innerHTML is re-parsed.
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
  const hostClone = host.cloneNode(true) as Element;
  hostClone.setAttribute("data-start", "0");

  if (root === host) return hostClone;

  const rootClone = root.cloneNode(false) as Element;
  // The wrapper takes the scene's length, not the whole project's; with none declared
  // it derives from its single child.
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

  // linkedom types these lists as any/NodeList, hence the Element[] casts.
  const hosts = Array.from(document.querySelectorAll("[data-composition-src]")) as Element[];
  const host = hosts.find(
    (candidate) =>
      normalizeCompositionSrcPath(candidate.getAttribute("data-composition-src") || "") ===
      normalizedEntryFile,
  );
  if (!host) return null;

  const root =
    (Array.from(body.children) as Element[]).find((candidate) =>
      candidate.hasAttribute("data-composition-id"),
    ) ?? null;
  if (!root) return null;

  // The scene file owns its duration; the mount's window is the fallback.
  const sceneDuration = readSceneRootDuration(entryHtml) ?? host.getAttribute("data-duration");

  const renderClone = createStandaloneEntryRenderClone(root, host, sceneDuration);
  replaceBodyWithRenderClone(body, renderClone);

  return document.toString();
}
