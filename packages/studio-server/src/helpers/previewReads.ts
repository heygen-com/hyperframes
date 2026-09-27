import { resolve, sep } from "node:path";
import { STUDIO_SIGNATURE_MANIFEST_PATHS } from "./projectSignature.js";

const ALWAYS_AFFECTS = ["hyperframes.json", ...STUDIO_SIGNATURE_MANIFEST_PATHS];
const REFERENCE =
  /\b(?:src|href|poster|data-composition-src)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')|url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^"'\s)]+))/gi;
// macOS and Windows volumes ignore letter case by default, so it is not part of a path's identity there.
const pathKey =
  process.platform === "darwin" || process.platform === "win32"
    ? (path: string) => resolve(path).toLowerCase()
    : (path: string) => resolve(path);
// ponytail: grows until restart, so a file a film stopped using still reloads; reset per build if that matters.
const readsByProject = new Map<string, Set<string>>();
const builtProjects = new Set<string>();

export function recordPreviewRead(projectDir: string, filePath: string): void {
  const key = pathKey(projectDir);
  let reads = readsByProject.get(key);
  if (!reads) readsByProject.set(key, (reads = new Set()));
  reads.add(pathKey(resolve(projectDir, filePath)));
}

export function recordPreviewReferences(projectDir: string, html: string): void {
  for (const match of html.matchAll(REFERENCE)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim();
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

export function recordPreviewBuilt(projectDir: string): void {
  builtProjects.add(pathKey(projectDir));
}

// Every write counts until this process built the preview; a folder event counts when a loaded file is inside it.
export function affectsPreview(projectDir: string, changedPath: string): boolean {
  const key = pathKey(projectDir);
  if (!builtProjects.has(key)) return true;
  const changed = pathKey(resolve(projectDir, changedPath));
  const loaded = [
    ...(readsByProject.get(key) ?? []),
    ...ALWAYS_AFFECTS.map((path) => pathKey(resolve(projectDir, path))),
  ];
  return loaded.some((path) => path === changed || path.startsWith(changed + sep));
}
