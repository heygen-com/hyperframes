import { readlinkSync } from "node:fs";
import { dirname, join, parse, relative, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { STUDIO_SIGNATURE_MANIFEST_PATHS } from "./projectSignature.js";
import { realFilePath } from "./safePath.js";

const ALWAYS_AFFECTS = ["hyperframes.json", ...STUDIO_SIGNATURE_MANIFEST_PATHS];
// A malformed inline URL must not turn ancestor tracking into an image-sized path walk.
const MAX_PREVIEW_PATH_LENGTH = 4096;
const SHOW_ELEMENT = 1;
const REFERENCE =
  /\b(?:src|href|poster|data-composition-src)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')|url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^"'\s)]+))/gi;
const REFERENCE_ATTRIBUTE = /\b(?:src|href|poster|data-composition-src)$/i;
const isElement = (node: Node): node is Element => node.nodeType === 1;
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

const readLink = (path: string): string | null => {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
};

// Walks `path` as the OS does, returning every link it passes and where it ends up.
function linksOnTheWay(path: string): string[] {
  const passed: string[] = [];
  let at = parse(path).root;
  let rest = path.slice(at.length).split(/[\\/]+/);
  for (let hops = 0; rest.length > 0; ) {
    const part = rest.shift()!;
    if (!part || part === ".") continue;
    if (part === "..") {
      at = dirname(at);
      continue;
    }
    const next = join(at, part);
    if (next.length > MAX_PREVIEW_PATH_LENGTH) return passed;
    const target = hops < 40 ? readLink(next) : null;
    if (target === null) {
      at = next;
      continue;
    }
    hops++;
    passed.push(next);
    const root = parse(target).root;
    if (root) at = root;
    rest = [...target.slice(root.length).split(/[\\/]+/), ...rest];
  }
  passed.push(at);
  return passed;
}

// A link's target can be created or retargeted later, so every read resolves it again.
export function recordPreviewRead(projectDir: string, filePath: string): void {
  if (filePath.length > MAX_PREVIEW_PATH_LENGTH) return;
  const key = projectKey(projectDir);
  let reads = readsByProject.get(key);
  if (!reads) readsByProject.set(key, (reads = new Set()));
  const read = inRealProject(projectDir, filePath);
  if (read.length > MAX_PREVIEW_PATH_LENGTH) return;
  for (const found of [read, ...linksOnTheWay(read)]) {
    for (let path = pathKey(found); !reads.has(path); path = dirname(path)) reads.add(path);
  }
}

export function recordPreviewReferences(projectDir: string, html: string): void {
  const named = new Set<string>();
  const add = (reference: string) => {
    const url = reference.trim();
    if (!url || /^(?:[a-z][a-z0-9+.-]*:|[/#])/i.test(url)) return;
    const path = url.split(/[?#]/)[0] ?? "";
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // A malformed escape names the file literally.
    }
    if (decoded && decoded.length <= MAX_PREVIEW_PATH_LENGTH) named.add(decoded);
  };
  const scan = (text: string) => {
    for (const match of text.matchAll(REFERENCE)) {
      add(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "");
    }
  };
  const scanElement = (element: Element) => {
    for (const attribute of element.attributes) {
      if (REFERENCE_ATTRIBUTE.test(attribute.name)) add(attribute.value);
    }
    const style = element.getAttribute("style");
    if (style) scan(style);
    if (element.localName === "style" || element.localName === "script") {
      scan(element.textContent ?? "");
    }
  };
  // The parser decodes attributes; walking also visits inert template descendants without cloning them.
  const { document } = parseHTML(html);
  for (const root of document.children) {
    scanElement(root);
    const elements = document.createTreeWalker(root, SHOW_ELEMENT);
    for (let node = elements.nextNode(); node; node = elements.nextNode()) {
      if (isElement(node)) scanElement(node);
    }
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
