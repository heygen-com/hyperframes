import { parseHTML } from "linkedom";
import { parseCssRoot, parseStylesheetImport } from "./fontStylesheets.js";

/** The request an @import makes, or null when it is qualified or not a plain http(s) URL. */
function unconditionalImportUrl(params: string): string | null {
  const imported = parseStylesheetImport(params);
  if (
    !imported ||
    imported.hasLayer ||
    imported.hasSupportsCondition ||
    imported.media !== "" ||
    !/^https?:\/\//i.test(imported.url)
  )
    return null;
  return imported.url;
}

/** Moves the leading plain imports of one style into preload and stylesheet links before it. */
function promoteLeadingImports(document: Document, style: Element): boolean {
  const root = parseCssRoot(style.textContent ?? "");
  if (!root) return false;
  let promoted = false;
  for (const node of [...root.nodes]) {
    if (node.type === "comment") continue;
    if (node.type !== "atrule" || node.name.toLowerCase() !== "import") break;
    const url = unconditionalImportUrl(node.params);
    if (url === null) break;
    const preload = document.createElement("link");
    preload.setAttribute("rel", "preload");
    preload.setAttribute("href", url);
    preload.setAttribute("as", "style");
    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", url);
    style.before(preload, link);
    node.remove();
    promoted = true;
  }
  if (promoted) style.textContent = root.toString();
  return promoted;
}

/** Promote parser-tracked requests without changing import conditions or cascade order. */
export function promoteUnconditionalStylesheetImports(html: string): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  if (!head) return html;
  let changed = false;
  for (const style of head.querySelectorAll("style")) {
    if (style.attributes.length === 0 && promoteLeadingImports(document, style)) changed = true;
  }
  return changed ? document.toString() : html;
}
