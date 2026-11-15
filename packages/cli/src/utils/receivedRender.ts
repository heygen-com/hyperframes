import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { isNonRelativeUrl, isPathInside } from "@hyperframes/core";
import { resolveCompositionSrc } from "@hyperframes/parsers/asset-resolution";
import { runRenderSetupWorker } from "./cancellableProcess.js";
import { loadProducer } from "./producer.js";
import { linksOutside, receivedFiles, receivedRecordStatus } from "./privateProjectFile.js";

const REFERENCE_ATTRS = ["src", "href", "poster"];
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;
const MAX_SCANNED_FILES = 500;
const COMPILER_READS_TIMEOUT_MS = 60_000;

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
    return { text: buffer.toString("utf-8", 0, read), whole: size <= MAX_SCANNED_BYTES };
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
  const found: OutsideReferences = { assets: new Set(), compositions: new Set(), complete: true };
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

function projectRelative(projectDir: string, realProjectDir: string | null, path: string): string {
  const rel = relative(projectDir, path);
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  return (inside || realProjectDir === null ? rel : relative(realProjectDir, path))
    .split(sep)
    .join("/");
}

/** The project files a render of this composition reads: the render compiler's own composition traversal, plus every file the bundler reads or looks for. */
export async function compilerReadsInProcess(
  projectDir: string,
  entryFile: string,
): Promise<string[]> {
  const { renderCompositionFiles } = await loadProducer();
  const reads = renderCompositionFiles(projectDir, resolve(projectDir, entryFile));
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  await bundleToSingleHtml(projectDir, {
    entryFile,
    runtime: "placeholder",
    inlineAssets: false,
    staticGuard: false,
    onRead: (path) => reads.push(path),
  });
  const realProjectDir = realOrNull(projectDir);
  return reads.map((path) => projectRelative(projectDir, realProjectDir, path));
}

// Out of process with a deadline: a build that fails or runs long cannot say what it reads.
async function compilerReads(projectDir: string, entryFile: string): Promise<string[] | null> {
  try {
    const reads = await runRenderSetupWorker<unknown>(
      "render-reads",
      { projectDir, entryFile },
      { timeoutMs: COMPILER_READS_TIMEOUT_MS, maxBufferBytes: 16 * 1024 * 1024 },
    );
    return Array.isArray(reads) ? reads.map(String) : null;
  } catch {
    return null;
  }
}

function receivedAmong(projectDir: string, paths: string[]): string[] {
  const isReceived = receivedFiles(projectDir);
  return [...new Set(paths)].filter((path) => {
    try {
      return isReceived(path);
    } catch {
      return true;
    }
  });
}

/** False when the received-files record cannot be read, or the compiler reads a received file, or cannot say what it reads, to build this composition; `warn` then says why and names the references outside the project it refuses. */
export async function outsideAssetsAllowed(
  projectDir: string,
  entryFile: string | undefined,
  warn: (line: string) => void,
): Promise<boolean> {
  const absProjectDir = resolve(projectDir);
  const record = receivedRecordStatus(absProjectDir);
  if (record === null || record.listedCount === 0) return true;
  const entry = entryFile ?? "index.html";
  if (record.listedCount === null) {
    const refused = refusedReferences(outsideReferences(absProjectDir, entry));
    warn(
      `Could not read ${record.path}, so the render treats the project as received and reads nothing outside it.${refused}`,
    );
    return false;
  }
  const reads = await compilerReads(absProjectDir, entry);
  const received = reads === null ? null : receivedAmong(absProjectDir, reads);
  if (received !== null && received.length === 0) return true;
  const found = outsideReferences(absProjectDir, entry);
  const refused = refusedReferences(found);
  if (received === null) {
    warn(
      `Could not tell which files ${entry} reads, so the render reads nothing outside the project.${refused}`,
    );
  } else if (refused !== "") {
    const [first, ...others] = received;
    const who = others.length === 0 ? first : `${first} and ${others.length} more file(s)`;
    warn(
      `${who} came from someone else, so the render reads nothing outside the project.${refused}`,
    );
  }
  return false;
}
