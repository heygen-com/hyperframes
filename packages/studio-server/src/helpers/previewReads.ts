import { readlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { STUDIO_SIGNATURE_MANIFEST_PATHS } from "./projectSignature.js";
import { realFilePath } from "./safePath.js";

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
const projectKey = (projectDir: string) => pathKey(realFilePath(resolve(projectDir)));
const inRealProject = (projectDir: string, path: string) =>
  join(realFilePath(resolve(projectDir)), relative(resolve(projectDir), resolve(projectDir, path)));

function linkTarget(path: string): string {
  for (let hops = 0; hops < 40; hops++) {
    try {
      path = resolve(realFilePath(dirname(path)), readlinkSync(path));
    } catch {
      break;
    }
  }
  return realFilePath(path);
}

// A link's target can be created or retargeted later, so every read resolves it again.
export function recordPreviewRead(projectDir: string, filePath: string): void {
  const key = projectKey(projectDir);
  let reads = readsByProject.get(key);
  if (!reads) readsByProject.set(key, (reads = new Set()));
  const read = inRealProject(projectDir, filePath);
  for (const found of [read, linkTarget(read)]) {
    for (let path = pathKey(found); !reads.has(path); path = dirname(path)) reads.add(path);
  }
}

export function recordPreviewReferences(projectDir: string, html: string): void {
  const named = new Set<string>();
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
    if (decoded) named.add(decoded);
  }
  for (const path of named) recordPreviewRead(projectDir, path);
}

export function recordPreviewBuilt(projectDir: string): void {
  for (const path of ALWAYS_AFFECTS) recordPreviewRead(projectDir, path);
  builtProjects.add(projectKey(projectDir));
}

// Every write counts until this process built the preview; a folder event counts when a loaded file is inside it.
export function affectsPreview(projectDir: string, changedPath: string): boolean {
  const key = projectKey(projectDir);
  if (!builtProjects.has(key)) return true;
  return readsByProject.get(key)?.has(pathKey(inRealProject(projectDir, changedPath))) ?? false;
}
