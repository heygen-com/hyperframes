import { closeSync, openSync, readSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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

interface RenderGraph {
  assets: Set<string>;
  compositions: Set<string>;
  received: string[];
}

function recordReferences(graph: RenderGraph, file: string, projectDir: string): string[] {
  const next: string[] = [];
  for (const ref of referencedFiles(file, projectDir)) {
    if (!linksOutside(projectDir, ref.path)) {
      if (isPageOrStylesheet(ref.path)) next.push(ref.path);
    } else if (ref.composition) graph.compositions.add(ref.raw);
    else graph.assets.add(ref.raw);
  }
  return next;
}

// Walks the entry and the compositions and stylesheets it pulls in: which of them came from someone else, and which references reach existing files outside the project.
function walkRenderGraph(
  projectDir: string,
  entryFile: string,
  isReceived: (path: string) => boolean,
): RenderGraph {
  const graph: RenderGraph = { assets: new Set(), compositions: new Set(), received: [] };
  const visited = new Set<string>();
  const unvisited = (file: string) =>
    !visited.has(file) && isPathInside(file, projectDir) && isFile(file);
  const pending = [resolve(projectDir, entryFile)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (!unvisited(file)) continue;
    visited.add(file);
    const path = relative(projectDir, file).split(sep).join("/");
    if (isReceived(path)) graph.received.push(path);
    pending.push(...recordReferences(graph, file, projectDir));
  }
  return graph;
}

function refusedReferences(graph: RenderGraph): string {
  const parts: string[] = [];
  if (graph.assets.size > 0) parts.push(` It leaves out ${[...graph.assets].join(", ")}.`);
  if (graph.compositions.size > 0) {
    parts.push(
      ` It stops on the compositions ${[...graph.compositions].join(", ")}; move them into the project to render them.`,
    );
  }
  return parts.join("");
}

function receivedNotice(graph: RenderGraph): string | null {
  const refused = refusedReferences(graph);
  if (refused === "") return null;
  const [first, ...others] = graph.received;
  const who = others.length === 0 ? first : `${first} and ${others.length} more file(s)`;
  return `${who} came from someone else, so the render reads nothing outside the project.${refused}`;
}

/** False when the composition a local render opens, or any composition or stylesheet it pulls in, came from someone else, or when the received-files record cannot be read; `warn` then says why and names the references outside the project it refuses. */
export function outsideAssetsAllowed(
  projectDir: string,
  entryFile: string | undefined,
  warn: (line: string) => void,
): boolean {
  const absProjectDir = resolve(projectDir);
  const graph = walkRenderGraph(
    absProjectDir,
    entryFile ?? "index.html",
    receivedFiles(absProjectDir),
  );
  const unreadable = unreadableReceivedRecord(absProjectDir);
  if (unreadable !== null) {
    warn(
      `Could not read ${unreadable}, so the render treats the project as received and reads nothing outside it.${refusedReferences(graph)}`,
    );
    return false;
  }
  if (graph.received.length === 0) return true;
  const notice = receivedNotice(graph);
  if (notice !== null) warn(notice);
  return false;
}
