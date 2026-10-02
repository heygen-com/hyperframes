/** The subset of an import map a composition can declare. */
export interface ImportMap {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

const rebaseEntries = (
  entries: Record<string, string> | undefined,
  rebase: (url: string) => string,
): Record<string, string> | undefined =>
  entries &&
  Object.fromEntries(Object.entries(entries).map(([specifier, url]) => [specifier, rebase(url)]));

/**
 * Parses a mounted composition's import map, rebasing each address the way its `src`/`href`
 * attributes are rebased. Returns null for a map the browser would reject too.
 */
export function parseImportMap(json: string, rebase: (url: string) => string): ImportMap | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { imports, scopes } = parsed as ImportMap;
  return {
    imports: rebaseEntries(imports, rebase),
    scopes:
      scopes &&
      Object.fromEntries(
        Object.entries(scopes).map(([prefix, entries]) => [
          rebase(prefix),
          rebaseEntries(entries, rebase) ?? {},
        ]),
      ),
  };
}

function mergeEntries(
  into: Record<string, string>,
  from: Record<string, string> | undefined,
  where: string,
): void {
  for (const [specifier, url] of Object.entries(from ?? {})) {
    if (!(specifier in into)) into[specifier] = url;
    else if (into[specifier] !== url) {
      console.warn(
        `[HyperFrames] import map conflict for "${specifier}"${where}: keeping ${into[specifier]}, ignoring ${url}.`,
      );
    }
  }
}

/**
 * A page has one import map, and it must precede every module script. Mounted compositions'
 * maps merge into the page's own (created at the top of <head> if absent); the first mapping
 * of a specifier wins and a conflicting later one is dropped with a warning.
 */
export function mergeImportMapsIntoDocument(doc: Document, maps: ImportMap[]): void {
  if (maps.length === 0) return;
  let el = doc.querySelector('script[type="importmap"]');
  let page: ImportMap & Record<string, unknown> = {};
  try {
    page = el ? JSON.parse(el.textContent || "{}") : {};
  } catch {
    console.warn("[HyperFrames] the page's import map is not valid JSON; replacing it.");
  }
  const imports = { ...page.imports };
  const scopes = { ...page.scopes };
  for (const map of maps) {
    mergeEntries(imports, map.imports, "");
    for (const [prefix, entries] of Object.entries(map.scopes ?? {})) {
      mergeEntries((scopes[prefix] ??= {}), entries, ` in scope ${prefix}`);
    }
  }
  if (!el) {
    el = doc.createElement("script");
    el.setAttribute("type", "importmap");
    doc.head.prepend(el);
  }
  el.textContent = JSON.stringify({
    ...page,
    imports,
    ...(Object.keys(scopes).length ? { scopes } : {}),
  }).replace(/</g, "\\u003c");
}

/** Emits what inlineSubCompositions collected from mounted files' module and import-map scripts. */
export function emitMountedModuleScripts(
  doc: Document,
  importMaps: ImportMap[],
  moduleScripts: string[],
): void {
  mergeImportMapsIntoDocument(doc, importMaps);
  for (const content of moduleScripts) {
    const el = doc.createElement("script");
    el.setAttribute("type", "module");
    el.textContent = content;
    doc.body.appendChild(el);
  }
}
