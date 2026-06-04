import { parseHTML } from "linkedom";

export interface SourceMutationTarget {
  id?: string | null;
  selector?: string;
  selectorIndex?: number;
}

function parseSourceDocument(source: string): { document: Document; wrappedFragment: boolean } {
  const hasDocumentShell = /<!doctype|<html[\s>]/i.test(source);
  if (hasDocumentShell) {
    return { document: parseHTML(source).document, wrappedFragment: false };
  }
  return {
    document: parseHTML(`<!DOCTYPE html><html><head></head><body>${source}</body></html>`).document,
    wrappedFragment: true,
  };
}

function querySelectorAllWithTemplates(root: Document | Element, selector: string): Element[] {
  const matches = Array.from(root.querySelectorAll(selector));
  if (matches.length > 0) return matches;
  // querySelectorAll doesn't traverse <template> content in linkedom.
  // Search directly on each template element (NOT .content — removing from
  // .content's DocumentFragment doesn't update the serialized output).
  const templates = Array.from(root.querySelectorAll("template"));
  for (const tmpl of templates) {
    const inner = tmpl.querySelectorAll(selector);
    if (inner.length > 0) return Array.from(inner);
  }
  return [];
}

function findTargetElement(document: Document, target: SourceMutationTarget): Element | null {
  if (target.id) {
    const byId = document.getElementById(target.id);
    if (byId) return byId;
  }

  if (!target.selector) return null;
  try {
    const matches = querySelectorAllWithTemplates(document, target.selector);
    return matches[target.selectorIndex ?? 0] ?? null;
  } catch {
    return null;
  }
}

export function removeElementFromHtml(source: string, target: SourceMutationTarget): string {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const element = findTargetElement(document, target);
  if (!element) return source;

  element.remove();
  return wrappedFragment ? document.body.innerHTML || "" : document.toString();
}

function isHTMLElement(el: Element): boolean {
  const HTMLEl = el.ownerDocument.defaultView?.HTMLElement;
  return HTMLEl ? el instanceof HTMLEl : "style" in el;
}

export interface PatchOperation {
  type: "inline-style" | "attribute" | "html-attribute" | "text-content";
  property: string;
  value: string | null;
}

const ALLOWED_HTML_ATTRS = new Set([
  // Identity & structure
  "id",
  "class",
  "style",
  "title",
  "name",
  "for",
  "type",
  // Internationalization
  "lang",
  "dir",
  "translate",
  // Interaction
  "hidden",
  "tabindex",
  "draggable",
  "contenteditable",
  // Accessibility
  "role",
  "slot",
  // Links & navigation
  "href",
  "target",
  "rel",
  // Media
  "src",
  "srcset",
  "sizes",
  "alt",
  "poster",
  "loading",
  "decoding",
  "crossorigin",
  "preload",
  "autoplay",
  "loop",
  "muted",
  "controls",
  "playsinline",
  // Layout
  "width",
  "height",
  "colspan",
  "rowspan",
  "scope",
  // Form
  "placeholder",
  "value",
  "min",
  "max",
  "step",
  "pattern",
  "required",
  "disabled",
  "readonly",
  "checked",
  "selected",
  "multiple",
  "accept",
  "maxlength",
  "minlength",
  "rows",
  "cols",
  "wrap",
]);

const DANGEROUS_URI_SCHEMES = /^(?:javascript|vbscript):/i;
const DANGEROUS_DATA_URI = /^data\s*:\s*text\/html/i;

function isAllowedHtmlAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) return false;
  if (ALLOWED_HTML_ATTRS.has(lower)) return true;
  if (lower.startsWith("data-")) return true;
  if (lower.startsWith("aria-")) return true;
  return false;
}

const URI_ATTRS = new Set(["src", "href", "action", "formaction", "poster", "srcset"]);

function isSafeAttributeValue(name: string, value: string): boolean {
  if (URI_ATTRS.has(name.toLowerCase())) {
    const trimmed = value.trim();
    if (DANGEROUS_URI_SCHEMES.test(trimmed)) return false;
    if (DANGEROUS_DATA_URI.test(trimmed)) return false;
  }
  return true;
}

export function patchElementInHtml(
  source: string,
  target: SourceMutationTarget,
  operations: PatchOperation[],
): { html: string; matched: boolean } {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  if (!el || !isHTMLElement(el)) return { html: source, matched: false };
  const htmlEl = el as unknown as HTMLElement;

  for (const op of operations) {
    switch (op.type) {
      case "inline-style":
        if (op.value != null) {
          htmlEl.style.setProperty(op.property, op.value);
        } else {
          htmlEl.style.removeProperty(op.property);
        }
        break;
      case "attribute":
        {
          const fullAttr = op.property.startsWith("data-") ? op.property : `data-${op.property}`;
          if (op.value != null) {
            htmlEl.setAttribute(fullAttr, op.value);
          } else {
            htmlEl.removeAttribute(fullAttr);
          }
        }
        break;
      case "html-attribute":
        if (!isAllowedHtmlAttribute(op.property)) break;
        if (op.value != null) {
          if (!isSafeAttributeValue(op.property, op.value)) break;
          htmlEl.setAttribute(op.property, op.value);
        } else {
          htmlEl.removeAttribute(op.property);
        }
        break;
      case "text-content":
        if (op.value != null) htmlEl.textContent = op.value;
        break;
    }
  }

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    matched: true,
  };
}

export function probeElementInSource(source: string, target: SourceMutationTarget): boolean {
  if (!target.id && !target.selector) return false;
  const { document } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  return el != null && isHTMLElement(el);
}

export interface SplitElementResult {
  html: string;
  matched: boolean;
  newId: string | null;
}

export function splitElementInHtml(
  source: string,
  target: SourceMutationTarget,
  splitTime: number,
  newId: string,
): SplitElementResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  if (!el || !isHTMLElement(el)) return { html: source, matched: false, newId: null };

  const start = parseFloat(el.getAttribute("data-start") ?? "0") || 0;
  const duration = parseFloat(el.getAttribute("data-duration") ?? "0") || 0;
  if (duration <= 0 || splitTime <= start || splitTime >= start + duration) {
    return { html: source, matched: false, newId: null };
  }

  const firstDuration = splitTime - start;
  const secondDuration = duration - firstDuration;

  const clone = el.cloneNode(true) as HTMLElement;
  clone.setAttribute("id", newId);
  clone.setAttribute("data-start", String(Math.round(splitTime * 1000) / 1000));
  clone.setAttribute("data-duration", String(Math.round(secondDuration * 1000) / 1000));

  // Adjust media trim offset for the second half
  const playbackStartAttr = el.hasAttribute("data-playback-start")
    ? "data-playback-start"
    : el.hasAttribute("data-media-start")
      ? "data-media-start"
      : null;
  if (playbackStartAttr) {
    const currentTrim = parseFloat(el.getAttribute(playbackStartAttr) ?? "0") || 0;
    const rate = parseFloat(el.getAttribute("data-playback-rate") ?? "1") || 1;
    clone.setAttribute(
      playbackStartAttr,
      String(Math.round((currentTrim + firstDuration * rate) * 1000) / 1000),
    );
  }

  // Trim the original element's duration
  el.setAttribute("data-duration", String(Math.round(firstDuration * 1000) / 1000));

  // Insert clone after original
  if (el.nextSibling) {
    el.parentElement!.insertBefore(clone, el.nextSibling);
  } else {
    el.parentElement!.appendChild(clone);
  }

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    matched: true,
    newId,
  };
}
