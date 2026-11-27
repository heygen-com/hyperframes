import { ensureHfIds, isCompositionTemplate } from "@hyperframes/parsers/hf-ids";
import { templateContent } from "@hyperframes/parsers/sub-composition-validity";
import {
  authoredKey,
  TIMING_ATTRIBUTES,
  type SavedTiming,
} from "@hyperframes/core/runtime/soft-reload";
import {
  PREVIEW_ONLY_ATTRS,
  PREVIEW_VIDEO_CANVAS_ATTR,
  STUDIO_PREVIEW_LAZY_ATTR,
} from "@hyperframes/core/studio-preview-mark";

// Stamped as the preview stamps the files it serves, so a live element's hf-id finds its source.
export function parseSavedSource(html: string): Document {
  return new DOMParser().parseFromString(ensureHfIds(html), "text/html");
}

const rootsByDoc = new WeakMap<Document, ParentNode[]>();

// A plain template is a runtime clone source, so ids inside it repeat across clones.
function searchRoots(root: ParentNode): ParentNode[] {
  const templates = Array.from(root.querySelectorAll("template")).filter(isCompositionTemplate);
  return [
    root,
    ...templates.flatMap((template) => {
      const content = templateContent(template);
      return content ? searchRoots(content) : [];
    }),
  ];
}

function findByAttribute(doc: Document, name: string, value: string): Element | null {
  let roots = rootsByDoc.get(doc);
  if (!roots) rootsByDoc.set(doc, (roots = searchRoots(doc)));
  const selector = `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
  for (const root of roots) {
    const match = root.querySelector(selector);
    if (match) return match;
  }
  return null;
}

export function findAuthoredElement(doc: Document, live: Element): Element | null {
  const hfId = live.getAttribute("data-hf-id");
  if (hfId) return findByAttribute(doc, "data-hf-id", hfId);
  return live.id ? findByAttribute(doc, "id", live.id) : null;
}

// Both keys an element's style is filed under: its hf-id and its id.
function styleKeys(el: Element): string[] {
  const hfId = el.getAttribute("data-hf-id");
  return [hfId ? `hf:${hfId}` : "", el.id ? `#${el.id}` : ""].filter(Boolean);
}

export function authoredStyles(html: string): Array<[string, string]> {
  const styles = new Map<string, string>();
  const elements = searchRoots(parseSavedSource(html)).flatMap((root) => [
    ...root.querySelectorAll("[data-hf-id], [id]"),
  ]);
  for (const el of elements) {
    for (const key of styleKeys(el)) {
      if (!styles.has(key)) styles.set(key, el.getAttribute("style") ?? "");
    }
  }
  return [...styles];
}

export function savedTiming(html: string): SavedTiming {
  const timing: SavedTiming = [];
  for (const el of parseSavedSource(html).querySelectorAll("[data-hf-id], [id]")) {
    const key = authoredKey(el);
    const attributes = [...TIMING_ATTRIBUTES].flatMap((name): Array<[string, string]> => {
      const value = el.getAttribute(name);
      return value === null ? [] : [[name, value]];
    });
    if (key && attributes.length > 0) timing.push([key, attributes]);
  }
  return timing;
}

function findAuthoredElementById(doc: Document, live: Element): Element | null {
  return live.id ? findByAttribute(doc, "id", live.id) : null;
}

const PATH_ATTRS = ["src", "href"];
const CSS_URL = /\burl\(\s*(["']?)([^)"'\s](?:[^)"']*[^)"'\s])?)\1\s*\)/g;

function isRelative(path: string): boolean {
  return !!path && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(path);
}

function toProjectPath(sourceFile: string, path: string): string {
  const parts = sourceFile.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

function livePathsOf(live: Element): Set<string> {
  const paths = new Set<string>();
  for (const el of [live, ...Array.from(live.querySelectorAll("*"))]) {
    for (const attr of PATH_ATTRS) paths.add(el.getAttribute(attr) ?? "");
    for (const match of (el.getAttribute("style") ?? "").matchAll(CSS_URL)) paths.add(match[2]);
  }
  return paths;
}

// The preview inlines a sub-composition with its relative asset paths rebased to the project
// root (rewriteAssetPath in @hyperframes/parsers, which is not browser-safe); copy does the same.
function authoredMarkup(authored: Element, live: Element, sourceFile: string): string {
  if (!sourceFile.includes("/")) return authored.outerHTML;
  const livePaths = livePathsOf(live);
  const rebase = (path: string): string => {
    if (!isRelative(path)) return path;
    const cut = path.search(/[?#]/);
    const suffix = cut < 0 ? "" : path.slice(cut);
    const rebased = toProjectPath(sourceFile, cut < 0 ? path : path.slice(0, cut)) + suffix;
    return path.startsWith("../") || livePaths.has(rebased) ? rebased : path;
  };
  const copy = authored.cloneNode(true) as Element;
  for (const el of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
    for (const attr of PATH_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, rebase(value.trim()));
    }
    const style = el.getAttribute("style");
    if (style) {
      el.setAttribute(
        "style",
        style.replace(
          CSS_URL,
          (_, quote: string, url: string) => `url(${quote}${rebase(url)}${quote})`,
        ),
      );
    }
  }
  return copy.outerHTML;
}

export function liveMarkupWithoutPreviewMarks(live: Element): string {
  const copy = live.cloneNode(true) as Element;
  for (const canvas of copy.querySelectorAll(`[${PREVIEW_VIDEO_CANVAS_ATTR}]`)) canvas.remove();
  for (const el of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
    if (el.hasAttribute(STUDIO_PREVIEW_LAZY_ATTR)) el.removeAttribute("loading");
    for (const attr of PREVIEW_ONLY_ATTRS) el.removeAttribute(attr);
  }
  return copy.outerHTML;
}

export type MarkedMarkup = { html: string; readFrom: string | null };

export function savedMarkupElseLive(
  saved: Document,
  live: Element,
  sourceFile: string,
): MarkedMarkup {
  const authored = findAuthoredElement(saved, live) ?? findAuthoredElementById(saved, live);
  return authored
    ? { html: authoredMarkup(authored, live, sourceFile), readFrom: sourceFile }
    : { html: liveMarkupWithoutPreviewMarks(live), readFrom: null };
}

export async function readSavedMarkup(
  readSaved: (path: string) => Promise<string>,
  paths: string[],
  lives: Element[],
): Promise<MarkedMarkup[]> {
  const sources = new Map<string, Promise<Document>>();
  return Promise.all(
    paths.map(async (path, index) => {
      if (!sources.has(path)) sources.set(path, readSaved(path).then(parseSavedSource));
      const saved = await (sources.get(path) as Promise<Document>);
      return savedMarkupElseLive(saved, lives[index] as Element, path);
    }),
  );
}
