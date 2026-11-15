import { closeSync, openSync, readSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { isNonRelativeUrl, isPathInside } from "@hyperframes/core";
import { linksOutside, receivedFiles, unreadableReceivedRecord } from "./privateProjectFile.js";

const REFERENCE_ATTRS = ["src", "href", "poster"];
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;

interface Reference {
  raw: string;
  composition: boolean;
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
    if (raw) refs.push({ raw, composition: false });
    at = css.indexOf("url(", close + 1);
  }
  return refs;
}

function htmlReferences(html: string): Reference[] {
  const { document } = parseHTML(html);
  const refs: Reference[] = [];
  for (const el of document.querySelectorAll("[src], [href], [poster], [data-composition-src]")) {
    for (const attr of REFERENCE_ATTRS) {
      const raw = el.getAttribute(attr)?.trim();
      if (raw) refs.push({ raw, composition: false });
    }
    const composition = el.getAttribute("data-composition-src")?.trim();
    if (composition) refs.push({ raw: composition, composition: true });
  }
  for (const style of document.querySelectorAll("style")) {
    refs.push(...cssReferences(style.textContent ?? ""));
  }
  for (const el of document.querySelectorAll("[style]")) {
    refs.push(...cssReferences(el.getAttribute("style") ?? ""));
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

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

function readHead(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(statSync(file).size, MAX_SCANNED_BYTES));
    return buffer.toString("utf-8", 0, readSync(fd, buffer, 0, buffer.length, 0));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function referencedFiles(file: string, projectDir: string) {
  const text = readHead(file);
  if (text === null) return [];
  const refs = /\.css$/i.test(file) ? cssReferences(text) : htmlReferences(text);
  return refs.flatMap(({ raw, composition }) => {
    const path = localPath(raw, composition ? projectDir : dirname(file));
    return path !== null && isFile(path) ? [{ raw, path, composition }] : [];
  });
}

const isPageOrStylesheet = (path: string) => /\.(?:html?|css)$/i.test(path);

interface OutsideReferences {
  assets: Set<string>;
  compositions: Set<string>;
}

// References from the entry, and the compositions and stylesheets it pulls in, that reach existing files outside the project.
function outsideReferences(projectDir: string, entryFile: string): OutsideReferences {
  const found: OutsideReferences = { assets: new Set(), compositions: new Set() };
  const visited = new Set<string>();
  const pending = [resolve(projectDir, entryFile)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (visited.has(file) || !isPathInside(file, projectDir) || !isFile(file)) continue;
    visited.add(file);
    for (const { raw, path, composition } of referencedFiles(file, projectDir)) {
      if (linksOutside(projectDir, path))
        (composition ? found.compositions : found.assets).add(raw);
      else if (isPageOrStylesheet(path)) pending.push(path);
    }
  }
  return found;
}

function receivedEntryNotice(entry: string, refs: OutsideReferences): string | null {
  const parts: string[] = [];
  if (refs.assets.size > 0) parts.push(`It leaves out ${[...refs.assets].join(", ")}.`);
  if (refs.compositions.size > 0) {
    parts.push(
      `It stops on the compositions ${[...refs.compositions].join(", ")}; move them into the project to render them.`,
    );
  }
  if (parts.length === 0) return null;
  return `${entry} came from someone else, so the render reads nothing outside the project. ${parts.join(" ")}`;
}

/** False when the composition a local render opens came from someone else; `warn` then names the references outside the project it refuses. */
export function outsideAssetsAllowed(
  projectDir: string,
  entryFile: string | undefined,
  warn: (line: string) => void,
): boolean {
  const absProjectDir = resolve(projectDir);
  const entry = entryFile ?? "index.html";
  const unreadable = unreadableReceivedRecord(absProjectDir);
  if (unreadable !== null) {
    warn(`Could not read ${unreadable}; the render brings in files outside the project as usual.`);
    return true;
  }
  if (!receivedFiles(absProjectDir)(entry)) return true;
  const notice = receivedEntryNotice(entry, outsideReferences(absProjectDir, entry));
  if (notice !== null) warn(notice);
  return false;
}
