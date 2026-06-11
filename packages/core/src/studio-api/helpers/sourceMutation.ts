import { parseHTML } from "linkedom";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export interface SourceMutationTarget {
  id?: string | null;
  hfId?: string;
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

function duplicateCssRulesForId(document: Document, originalId: string, newId: string): void {
  const idToken = `#${originalId}`;
  const transform = selectorParser((selectors) => {
    selectors.walkIds((node) => {
      if (node.value === originalId) node.value = newId;
    });
  });
  for (const styleEl of document.querySelectorAll("style")) {
    const css = styleEl.textContent ?? "";
    let root: postcss.Root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    const clones: postcss.Rule[] = [];
    root.walkRules((rule) => {
      if (!rule.selector.includes(idToken)) return;
      const newSelector = transform.processSync(rule.selector);
      if (newSelector === rule.selector) return;
      const clone = rule.clone({ selector: newSelector });
      clones.push(clone);
    });
    if (clones.length > 0) {
      for (const c of clones) root.append(c);
      styleEl.textContent = root.toString();
    }
  }
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

// Prevent CSS attribute-selector injection via a crafted hfId: escape
// backslashes first, then double-quotes. Keeps a malformed/hostile value from
// breaking out of the `[data-hf-id="…"]` selector once callers beyond the
// internal mint contract (R2+ user flows) pass values here.
function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findByHfId(document: Document, hfId: string): Element | null {
  try {
    const matches = querySelectorAllWithTemplates(
      document,
      `[data-hf-id="${escapeCssAttrValue(hfId)}"]`,
    );
    if (matches.length > 1) {
      // The mint contract guarantees uniqueness; a duplicate means upstream
      // id drift. Don't silently patch an arbitrary one — surface it.
      // eslint-disable-next-line no-console
      console.warn(
        `sourceMutation: data-hf-id "${hfId}" matched ${matches.length} elements; using the first. ids must be unique per document.`,
      );
    }
    return matches[0] ?? null;
  } catch {
    // Malformed selector despite escaping — let the caller fall back.
    return null;
  }
}

function findTargetElement(document: Document, target: SourceMutationTarget): Element | null {
  if (target.hfId) {
    const el = findByHfId(document, target.hfId);
    if (el) return el;
  }

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

// fallow-ignore-next-line complexity
function patchStyleAttrString(style: string, property: string, value: string | null): string {
  const props = new Map<string, string>();
  const order: string[] = [];
  // Tokenize declarations robustly: values can contain ';' inside quoted strings
  // (e.g. content: ';') and ':' inside values (data URIs, url(), etc.).
  // Split on ';' only when outside quotes and balanced parens; the first ':' in
  // the resulting segment is the property/value separator (property names never
  // contain ':').
  let i = 0;
  while (i < style.length) {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    const start = i;
    while (i < style.length) {
      const ch = style[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (ch === ";" && depth === 0) break;
      }
      i++;
    }
    const decl = style.slice(start, i).trim();
    i++; // advance past ';'
    if (!decl) continue;
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const key = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (!key) continue;
    if (!props.has(key)) order.push(key);
    props.set(key, val);
  }
  if (value === null) {
    props.delete(property);
    const idx = order.indexOf(property);
    if (idx >= 0) order.splice(idx, 1);
  } else {
    if (!props.has(property)) order.push(property);
    props.set(property, value);
  }
  return order
    .map((k) => `${k}: ${props.get(k) ?? ""}`)
    .filter((d) => d.trim())
    .join("; ");
}

// fallow-ignore-next-line complexity
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
        // linkedom's CSSStyleDeclaration does not support CSS custom properties
        // (--foo) or newer individual transform properties (translate, rotate,
        // scale) via style.setProperty(). Manipulate the style attribute string
        // directly so all property names survive the round-trip.
        {
          const raw = htmlEl.getAttribute("style") ?? "";
          const patched = patchStyleAttrString(raw, op.property, op.value);
          htmlEl.setAttribute("style", patched);
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
        if (op.value != null) {
          const inner = htmlEl.children.length === 1 ? htmlEl.firstElementChild : null;
          const textTarget = inner ? (inner as unknown as HTMLElement) : htmlEl;
          textTarget.textContent = op.value;
        }
        break;
    }
  }

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    matched: true,
  };
}

export function probeElementInSource(source: string, target: SourceMutationTarget): boolean {
  if (!target.id && !target.hfId && !target.selector) return false;
  const { document } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  return el != null && isHTMLElement(el);
}

export interface SplitElementResult {
  html: string;
  matched: boolean;
  newId: string | null;
}

function resolveElementTiming(el: Element): {
  start: number;
  duration: number;
  usesDataEnd: boolean;
} {
  const start = parseFloat(el.getAttribute("data-start") ?? "0") || 0;
  const usesDataEnd = el.hasAttribute("data-end");
  const duration = usesDataEnd
    ? parseFloat(el.getAttribute("data-end") ?? "") - start || 0
    : parseFloat(el.getAttribute("data-duration") ?? "0") || 0;
  return { start, duration, usesDataEnd };
}

function setElementDuration(
  el: Element,
  start: number,
  duration: number,
  usesDataEnd: boolean,
): void {
  if (usesDataEnd) {
    const endTime = String(Math.round((start + duration) * 1000) / 1000);
    el.setAttribute("data-end", endTime);
    el.removeAttribute("data-duration");
  } else {
    el.setAttribute("data-duration", String(Math.round(duration * 1000) / 1000));
    el.removeAttribute("data-end");
  }
}

// fallow-ignore-next-line complexity
export function splitElementInHtml(
  source: string,
  target: SourceMutationTarget,
  splitTime: number,
  newId: string,
): SplitElementResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  if (!el || !isHTMLElement(el)) return { html: source, matched: false, newId: null };

  const { start, duration, usesDataEnd } = resolveElementTiming(el);
  if (duration <= 0 || splitTime <= start || splitTime >= start + duration) {
    return { html: source, matched: false, newId: null };
  }

  if (document.getElementById(newId)) {
    let suffix = 2;
    const base = newId;
    while (document.getElementById(newId)) {
      newId = `${base}-${suffix++}`;
    }
  }

  const firstDuration = splitTime - start;
  const secondDuration = duration - firstDuration;

  const clone = el.cloneNode(true) as HTMLElement;
  clone.setAttribute("id", newId);
  clone.removeAttribute("data-hf-id");
  clone.setAttribute("data-start", String(Math.round(splitTime * 1000) / 1000));
  setElementDuration(clone, splitTime, secondDuration, usesDataEnd);

  // Keep the "clip" class — the runtime uses it to control visibility
  // based on data-start/data-duration timing.

  // Adjust media trim offset for the second half
  const playbackStartAttr = el.hasAttribute("data-playback-start")
    ? "data-playback-start"
    : el.hasAttribute("data-media-start")
      ? "data-media-start"
      : null;
  if (playbackStartAttr) {
    const currentTrim = parseFloat(el.getAttribute(playbackStartAttr) ?? "0") || 0;
    const rateRaw = parseFloat(el.getAttribute("data-playback-rate") ?? "");
    const rate = Number.isFinite(rateRaw) ? rateRaw : 1;
    clone.setAttribute(
      playbackStartAttr,
      String(Math.round((currentTrim + firstDuration * rate) * 1000) / 1000),
    );
  }

  // Duplicate CSS rules targeting the original ID so the clone inherits the same styles.
  const originalId = el.getAttribute("id");
  if (originalId) {
    duplicateCssRulesForId(document, originalId, newId);
  }

  // Trim the original element's duration
  setElementDuration(el, start, firstDuration, usesDataEnd);

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
