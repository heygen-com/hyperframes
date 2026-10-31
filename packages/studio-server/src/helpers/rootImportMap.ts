import { findStartTags, injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import { underBase } from "./rootPaths.js";

type Entries = Record<string, string>;
type ImportMap = { imports?: Entries; scopes?: Record<string, Entries> };

const IMPORT_MAP_TYPE = /\btype\s*=\s*["']?importmap["']?(?=[\s/>])/i;

/** The first import map's JSON and where it sits; templates, comments and raw text are skipped. */
function findImportMap(html: string): { start: number; end: number; json: string } | null {
  for (const at of findStartTags(html, "script")) {
    const open = /^<script\b[^>]*>/i.exec(html.slice(at));
    if (!open || !IMPORT_MAP_TYPE.test(open[0])) continue;
    const start = at + open[0].length;
    const end = html.toLowerCase().indexOf("</script", start);
    if (end !== -1) return { start, end, json: html.slice(start, end) };
  }
  return null;
}

/** Root module paths ("/assets/x.js") go under `base`, as render serves them from the project; `base` maps to itself
 * because a relative import resolves under it first. A composition's own map takes the entries, keeping one map. */
export function withRootImportMap(html: string, base: string): string {
  const ours = { "/": base, [base]: base };
  const own = findImportMap(html);
  if (!own)
    return injectTagsAtHeadStart(
      html,
      `<script type="importmap">${JSON.stringify({ imports: ours })}</script>`,
    );
  let map: ImportMap;
  try {
    map = JSON.parse(own.json);
  } catch {
    return html;
  }
  if (!map || typeof map !== "object") return html;
  const under = (path: string) => underBase(path, base);
  const moved = (entries: Entries = {}) =>
    Object.fromEntries(
      Object.entries(entries).map(([key, target]) => [key, under(String(target))]),
    );
  const merged: ImportMap = { ...map, imports: { ...ours, ...moved(map.imports) } };
  if (map.scopes)
    merged.scopes = Object.fromEntries(
      Object.entries(map.scopes).map(([scope, entries]) => [under(scope), moved(entries)]),
    );
  return html.slice(0, own.start) + JSON.stringify(merged) + html.slice(own.end);
}
