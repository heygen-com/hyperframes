import { resolve } from "node:path";
import { STUDIO_SIGNATURE_MANIFEST_PATHS } from "./projectSignature.js";

const ALWAYS_AFFECTS = ["hyperframes.json", ...STUDIO_SIGNATURE_MANIFEST_PATHS];
const REFERENCE =
  /\b(?:src|href|poster|data-composition-src)\s*=\s*(["'])(.*?)\1|url\(\s*(["']?)([^"')]+)\3\s*\)/gi;
// macOS and Windows volumes ignore letter case by default, so it is not part of a path's identity there.
const pathKey =
  process.platform === "darwin" || process.platform === "win32"
    ? (path: string) => resolve(path).toLowerCase()
    : (path: string) => resolve(path);
// ponytail: grows until restart, so a file a film stopped using still reloads; reset per build if that matters.
const readsByProject = new Map<string, Set<string>>();
const builtProjects = new Set<string>();

/** Note a project file the preview loaded, served or looked for; a later write to it reloads the preview. */
export function recordPreviewRead(projectDir: string, filePath: string): void {
  const key = pathKey(projectDir);
  let reads = readsByProject.get(key);
  if (!reads) readsByProject.set(key, (reads = new Set()));
  reads.add(pathKey(resolve(projectDir, filePath)));
}

/** Note every project file a built document names, before a host transform swaps one for a derived copy. */
export function recordPreviewReferences(projectDir: string, html: string): void {
  for (const match of html.matchAll(REFERENCE)) {
    const url = (match[2] ?? match[4] ?? "").trim();
    if (!url || /^(?:[a-z][a-z0-9+.-]*:|[/#])/i.test(url)) continue;
    const path = url.split(/[?#]/)[0] ?? "";
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // A malformed escape names the file literally.
    }
    if (decoded) recordPreviewRead(projectDir, decoded);
  }
}

/** This process built the project's preview, so its reads are known from here on. */
export function recordPreviewBuilt(projectDir: string): void {
  builtProjects.add(pathKey(projectDir));
}

/**
 * Whether a write at `changedPath` (absolute, or relative to `projectDir`) can change what the preview shows.
 * Until this process has built the preview, as after a restart under an open tab, every write counts.
 */
export function affectsPreview(projectDir: string, changedPath: string): boolean {
  const key = pathKey(projectDir);
  if (!builtProjects.has(key)) return true;
  const changed = pathKey(resolve(projectDir, changedPath));
  if (readsByProject.get(key)?.has(changed)) return true;
  return ALWAYS_AFFECTS.some((path) => pathKey(resolve(projectDir, path)) === changed);
}
