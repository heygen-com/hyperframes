import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { isNonRelativeUrl, isPathInside } from "@hyperframes/core";
import { resolveCompositionSrc } from "@hyperframes/parsers/asset-resolution";
import { linksOutside, receivedRecordStatus } from "./privateProjectFile.js";

const REFERENCE_ATTRS = ["src", "href", "poster"];
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;
const MAX_SCANNED_FILES = 500;

interface Reference {
  raw: string;
  composition: boolean;
  follow: boolean;
}

function unquote(value: string): string {
  const first = value[0];
  return value.length >= 2 && (first === '"' || first === "'") && value.at(-1) === first
    ? value.slice(1, -1).trim()
    : value;
}

function cssReferences(css: string): Reference[] {
  const refs: Reference[] = [];
  for (let at = css.indexOf("url("); at !== -1; ) {
    const close = css.indexOf(")", at + 4);
    if (close === -1) break;
    const raw = unquote(css.slice(at + 4, close).trim());
    if (raw) refs.push({ raw, composition: false, follow: true });
    at = css.indexOf("url(", close + 1);
  }
  return refs;
}

function elementReferences(el: Element): Reference[] {
  const follow = el.localName === "link";
  const refs: Reference[] = REFERENCE_ATTRS.flatMap((attr) => {
    const raw = el.getAttribute(attr)?.trim();
    return raw ? [{ raw, composition: false, follow }] : [];
  });
  const composition = el.getAttribute("data-composition-src")?.trim();
  if (composition) refs.push({ raw: composition, composition: true, follow: true });
  return refs;
}

function htmlReferences(html: string): Reference[] {
  const { document } = parseHTML(html);
  const hosts = document.querySelectorAll("[src], [href], [poster], [data-composition-src]");
  const refs = [...hosts].flatMap(elementReferences);
  for (const style of document.querySelectorAll("style")) {
    refs.push(...cssReferences(style.textContent ?? ""));
  }
  for (const el of document.querySelectorAll("[style]")) {
    refs.push(...cssReferences(el.getAttribute("style") ?? ""));
  }
  for (const template of document.querySelectorAll("template")) {
    refs.push(...htmlReferences(template.innerHTML));
  }
  return refs;
}

function localPath(raw: string, fromDir: string): string | null {
  if (raw.startsWith("file:")) {
    try {
      return fileURLToPath(raw);
    } catch {
      return null;
    }
  }
  const path = raw.replace(/[?#].*$/, "");
  if (isAbsolute(path) && !path.startsWith("//")) return path;
  if (path === "" || isNonRelativeUrl(path)) return null;
  try {
    return resolve(fromDir, decodeURIComponent(path));
  } catch {
    return resolve(fromDir, path);
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function readHead(file: string): { text: string; whole: boolean } | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = statSync(file).size;
    const buffer = Buffer.alloc(Math.min(size, MAX_SCANNED_BYTES));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return {
      text: buffer.toString("utf-8", 0, read),
      whole: size <= MAX_SCANNED_BYTES,
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const isPageOrStylesheet = (path: string) => /\.(?:html?|css)$/i.test(path);

interface OutsideReferences {
  assets: Set<string>;
  compositions: Set<string>;
  complete: boolean;
}

// A composition resolves as the render compiler resolves it; one that leaves the project resolves as written.
function referencePath(ref: Reference, file: string, projectDir: string): string | null {
  if (!ref.composition) return localPath(ref.raw, dirname(file));
  try {
    return resolveCompositionSrc(projectDir, ref.raw) ?? localPath(ref.raw, projectDir);
  } catch {
    return null;
  }
}

function referencesIn(found: OutsideReferences, file: string): Reference[] {
  const read = readHead(file);
  if (read === null || !read.whole) found.complete = false;
  if (read === null) return [];
  return /\.css$/i.test(file) ? cssReferences(read.text) : htmlReferences(read.text);
}

function noteReference(
  found: OutsideReferences,
  ref: Reference,
  path: string,
  projectDir: string,
): string | null {
  try {
    if (linksOutside(projectDir, path)) {
      (ref.composition ? found.compositions : found.assets).add(ref.raw);
      return null;
    }
  } catch {
    found.complete = false;
    return null;
  }
  return ref.follow && isPageOrStylesheet(path) ? path : null;
}

function scanFile(found: OutsideReferences, file: string, projectDir: string): string[] {
  const next: string[] = [];
  for (const ref of referencesIn(found, file)) {
    const path = referencePath(ref, file, projectDir);
    if (path === null || !isFile(path)) continue;
    const follow = noteReference(found, ref, path, projectDir);
    if (follow !== null) next.push(follow);
  }
  return next;
}

// Names the references outside the project in the entry and the compositions and stylesheets it pulls in; only the notice reads it.
function outsideReferences(projectDir: string, entryFile: string): OutsideReferences {
  const found: OutsideReferences = {
    assets: new Set(),
    compositions: new Set(),
    complete: true,
  };
  const visited = new Set<string>();
  const pending = [resolve(projectDir, entryFile)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    const real = realOrNull(file);
    if (real === null || visited.has(real) || !isPathInside(file, projectDir)) continue;
    if (visited.size >= MAX_SCANNED_FILES) {
      found.complete = false;
      break;
    }
    visited.add(real);
    pending.push(...scanFile(found, file, projectDir));
  }
  return found;
}

function refusedReferences(found: OutsideReferences): string {
  const parts: string[] = [];
  if (found.assets.size > 0) parts.push(` It leaves out ${[...found.assets].join(", ")}.`);
  if (found.compositions.size > 0) {
    parts.push(
      ` It stops on the compositions ${[...found.compositions].join(", ")}; move them into the project to render them.`,
    );
  }
  if (!found.complete) parts.push(" Some files could not be checked for references.");
  return parts.join("");
}

const REFERENCING_EXTENSION = /\.(?:html?|css|[cm]?js|svg)$/i;
const SNIFFED_BYTES = 4096;

function firstBytes(path: string): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(SNIFFED_BYTES);
    return head.subarray(0, readSync(fd, head, 0, SNIFFED_BYTES, 0));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readsAsPageOrStylesheet(text: string): boolean {
  if (text.startsWith("<") || text.includes("@import") || text.includes("url(")) return true;
  return text.includes("{") && text.includes(":") && text.includes("}");
}

function sniffsAsPageOrStylesheet(path: string): boolean {
  const bytes = isFile(path) ? firstBytes(path) : null;
  if (bytes === null || bytes.includes(0)) return false;
  return readsAsPageOrStylesheet(
    bytes
      .toString("utf-8")
      .replace(/^\uFEFF/, "")
      .trimStart(),
  );
}

const canReferenceFiles = (path: string) =>
  REFERENCING_EXTENSION.test(path) || sniffsAsPageOrStylesheet(path);

/** False when the received-files record cannot be read, or lists a received page, stylesheet, script or SVG; the render then reads nothing outside the project, and `warn` says why and names the references it refuses. */
export function outsideAssetsAllowed(
  projectDir: string,
  entryFile: string | undefined,
  warn: (line: string) => void,
): boolean {
  const absProjectDir = resolve(projectDir);
  const record = receivedRecordStatus(absProjectDir);
  if (record === null) return true;
  const referencing = record.listed?.find(canReferenceFiles);
  if (record.listed !== null && referencing === undefined) return true;
  const refused = refusedReferences(outsideReferences(absProjectDir, entryFile ?? "index.html"));
  if (referencing === undefined) {
    warn(
      `Could not read ${record.path}, so the render treats the project as received and reads nothing outside it.${refused}`,
    );
  } else if (refused !== "") {
    warn(
      `${relative(realOrNull(absProjectDir) ?? absProjectDir, referencing)} came from someone else and can load other files, so the render reads nothing outside the project.${refused}`,
    );
  }
  return false;
}
