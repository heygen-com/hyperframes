import { parseHTML } from "linkedom";
import { analyzeFontStylesheets, parseCssRoot, parseStylesheetImport } from "./fontStylesheets.js";
import { resolveFontMediaContext, type FontMediaContext } from "./fontMediaContext.js";

function googleStylesheetFamilies(urlText: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    return [];
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "fonts.googleapis.com") return [];
  return parsed.searchParams
    .getAll("family")
    .flatMap((family) => family.split("|"))
    .map((family) => family.split(":")[0]?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

function importUrls(css: string): string[] {
  if (!/@import/i.test(css)) return [];
  const root = parseCssRoot(css);
  if (!root) return [];
  const urls: string[] = [];
  for (const node of root.nodes) {
    if (node.type !== "atrule" || node.name.toLowerCase() !== "import") continue;
    const url = parseStylesheetImport(node.params)?.url;
    if (url) urls.push(url);
  }
  return urls;
}

type StylesheetElement = Pick<
  Element,
  "getAttribute" | "hasAttribute" | "localName" | "textContent"
>;

function stylesheetUrls(element: StylesheetElement): string[] {
  if (element.localName !== "link") return importUrls(element.textContent ?? "");
  const rel = (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
  if (!rel.includes("stylesheet") || rel.includes("alternate")) return [];
  const href = element.getAttribute("href");
  return href ? [href] : [];
}

export function authoredGoogleFontStylesheets(
  html: string,
  mediaContext?: FontMediaContext,
): Map<string, string[]> {
  const byFamily = new Map<string, string[]>();
  const { document } = parseHTML(
    analyzeFontStylesheets(html, resolveFontMediaContext(html, mediaContext)),
  );
  for (const element of document.querySelectorAll("link, style")) {
    for (const url of stylesheetUrls(element)) {
      for (const family of googleStylesheetFamilies(url)) {
        const previous = byFamily.get(family) ?? [];
        byFamily.set(family, [...previous.filter((existing) => existing !== url), url]);
      }
    }
  }
  return byFamily;
}

export function withPageText(url: string, fontText: string | undefined): string {
  const parsed = new URL(url);
  if (!fontText || parsed.searchParams.has("text")) return url;
  const withoutFragment = url.split("#")[0] ?? url;
  const joiner = parsed.search ? "&" : "?";
  return `${withoutFragment}${joiner}text=${encodeURIComponent(fontText)}${parsed.hash}`;
}
