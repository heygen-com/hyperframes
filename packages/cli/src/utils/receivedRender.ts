import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { CSS_URL_RE, isNonRelativeUrl, isPathInside } from "@hyperframes/core";
import { linksOutside, receivedFiles } from "./privateProjectFile.js";

const REFERENCE_ATTRS = ["src", "href", "poster"];

interface Reference {
  raw: string;
  fromRoot: boolean;
}

function cssReferences(css: string): Reference[] {
  return [...css.matchAll(CSS_URL_RE)].map((match) => ({
    raw: (match[2] ?? "").trim(),
    fromRoot: false,
  }));
}

function htmlReferences(html: string): Reference[] {
  const { document } = parseHTML(html);
  const refs: Reference[] = [];
  for (const el of document.querySelectorAll("[src], [href], [poster], [data-composition-src]")) {
    for (const attr of REFERENCE_ATTRS) {
      const raw = el.getAttribute(attr)?.trim();
      if (raw) refs.push({ raw, fromRoot: false });
    }
    const composition = el.getAttribute("data-composition-src")?.trim();
    if (composition) refs.push({ raw: composition, fromRoot: true });
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

function referencedFiles(file: string, projectDir: string): Array<{ raw: string; path: string }> {
  const text = readFileSync(file, "utf-8");
  const refs = /\.css$/i.test(file) ? cssReferences(text) : htmlReferences(text);
  return refs.flatMap(({ raw, fromRoot }) => {
    const path = localPath(raw, fromRoot ? projectDir : dirname(file));
    return path !== null && isFile(path) ? [{ raw, path }] : [];
  });
}

const isPageOrStylesheet = (path: string) => /\.(?:html?|css)$/i.test(path);

// References from the entry, and the compositions and stylesheets it pulls in, that reach existing files outside the project.
function outsideReferences(projectDir: string, entryFile: string): string[] {
  const found = new Set<string>();
  const visited = new Set<string>();
  const pending = [resolve(projectDir, entryFile)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (visited.has(file) || !isPathInside(file, projectDir) || !isFile(file)) continue;
    visited.add(file);
    for (const { raw, path } of referencedFiles(file, projectDir)) {
      if (linksOutside(projectDir, path)) found.add(raw);
      else if (isPageOrStylesheet(path)) pending.push(path);
    }
  }
  return [...found];
}

/** False when the composition a local render opens came from someone else; `warn` then names the references outside the project it leaves out. */
export function outsideAssetsAllowed(
  projectDir: string,
  entryFile: string | undefined,
  warn: (line: string) => void,
): boolean {
  const absProjectDir = resolve(projectDir);
  const entry = entryFile ?? "index.html";
  if (!receivedFiles(absProjectDir)(entry)) return true;
  const refs = outsideReferences(absProjectDir, entry);
  if (refs.length > 0) {
    warn(
      `${entry} came from someone else, so the render leaves out what it references outside the project: ${refs.join(", ")}`,
    );
  }
  return false;
}
