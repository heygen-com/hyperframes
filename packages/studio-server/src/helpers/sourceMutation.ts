import { parseHTML } from "linkedom";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { isAllowedHtmlAttribute, isSafeAttributeValue } from "@hyperframes/core/html-attr-safety";
import { parseStyleDecls, patchStyleAttrString } from "./sourceStyleMutation.js";

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

export function isHTMLElement(el: Node): el is HTMLElement {
  const HTMLEl = el.ownerDocument?.defaultView?.HTMLElement;
  return HTMLEl ? el instanceof HTMLEl : el.nodeType === 1 && "style" in el;
}

export interface PatchOperation {
  type: "inline-style" | "attribute" | "html-attribute" | "text-content";
  property: string;
  value: string | null;
  childSelector?: string;
  childIndex?: number;
}

interface ResolvedPatchOperation {
  op: PatchOperation;
  target: HTMLElement;
}

function resolveOperationTarget(parent: HTMLElement, op: PatchOperation): HTMLElement | null {
  if (op.childSelector === undefined) return parent;
  try {
    const child = parent.querySelectorAll(op.childSelector)[op.childIndex ?? 0] ?? null;
    return child && isHTMLElement(child) ? child : null;
  } catch {
    return null;
  }
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
  const htmlEl = el;

  const resolved: ResolvedPatchOperation[] = [];
  for (const op of operations) {
    const opTarget = resolveOperationTarget(htmlEl, op);
    if (!opTarget) return { html: source, matched: false };
    resolved.push({ op, target: opTarget });
  }

  for (const { op, target: opTarget } of resolved) {
    switch (op.type) {
      case "inline-style":
        // linkedom's CSSStyleDeclaration does not support CSS custom properties
        // (--foo) or newer individual transform properties (translate, rotate,
        // scale) via style.setProperty(). Manipulate the style attribute string
        // directly so all property names survive the round-trip.
        {
          const raw = opTarget.getAttribute("style") ?? "";
          const patched = patchStyleAttrString(raw, op.property, op.value);
          opTarget.setAttribute("style", patched);
        }
        break;
      case "attribute":
        {
          const fullAttr = op.property.startsWith("data-") ? op.property : `data-${op.property}`;
          if (op.value != null) {
            opTarget.setAttribute(fullAttr, op.value);
          } else {
            opTarget.removeAttribute(fullAttr);
          }
        }
        break;
      case "html-attribute":
        if (!isAllowedHtmlAttribute(op.property)) break;
        if (op.value != null) {
          if (!isSafeAttributeValue(op.property, op.value)) break;
          opTarget.setAttribute(op.property, op.value);
        } else {
          opTarget.removeAttribute(op.property);
        }
        break;
      case "text-content":
        if (op.value != null) {
          const inner = opTarget.children.length === 1 ? opTarget.firstElementChild : null;
          const textTarget = inner && isHTMLElement(inner) ? inner : opTarget;
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
  fallbackTiming?: { start: number; duration: number },
): SplitElementResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  if (!el || !isHTMLElement(el)) return { html: source, matched: false, newId: null };

  const timing = resolveElementTiming(el);
  const { usesDataEnd } = timing;
  let { start, duration } = timing;
  // GSAP-animated elements carry their timing in the script, not in data-* attrs,
  // so the source has no authored duration. Fall back to the store's (GSAP-derived)
  // range — the runtime windows visibility off data-start/data-duration regardless
  // of class, so stamping both halves below makes each half show only in its window.
  if (duration <= 0 && fallbackTiming && fallbackTiming.duration > 0) {
    start = fallbackTiming.start;
    duration = fallbackTiming.duration;
  }
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

  const clone = el.cloneNode(true);
  if (!isHTMLElement(clone)) return { html: source, matched: false, newId: null };
  clone.setAttribute("id", newId);
  clone.removeAttribute("data-hf-id");
  // Descendants carry their own data-hf-id; leaving them duplicates the id of
  // every nested node (e.g. an inner <span>), so strip them on the clone too.
  for (const node of clone.querySelectorAll("[data-hf-id]")) node.removeAttribute("data-hf-id");
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

  // Trim the original element's duration. A GSAP element had no data-start; stamp
  // it so the runtime windows the first half (visibility selects on [data-start]).
  el.setAttribute("data-start", String(Math.round(start * 1000) / 1000));
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

// --- Element grouping -------------------------------------------------------
// A group is a real `<div data-hf-group="…">` wrapping its members in the DOM.
// Wrapping rebases each member's left/top so its absolute position is unchanged:
// the wrapper sits at the selection bbox top-left, and each child's new left/top
// is its old left/top minus the wrapper origin (computed client-side, where live
// layout is available, and passed in via `rebases`). GSAP x/y, CSS translate and
// --hf-studio-offset vars are deltas relative to flow position and stay untouched.

export interface WrapElementsResult {
  html: string;
  matched: boolean;
  groupId: string | null;
  error?: string;
}

export interface UnwrapElementsResult {
  html: string;
  unwrapped: boolean;
  /** The unwrapped wrapper's id, so callers can strip GSAP that targeted it
   *  (the wrapper is gone; a leftover `gsap.set("#id")` would throw at runtime). */
  unwrappedGroupId?: string;
  /** Members (id'd children) with their absolute layout centres (post un-rebase),
   *  so the caller can BAKE the group's GSAP transform into each member before
   *  stripping it — otherwise the group's moves are lost on ungroup. */
  members?: Array<{ id: string; cx: number; cy: number }>;
  /** The wrapper's layout centre — the pivot for baking the group's rotation/scale. */
  groupCenter?: { cx: number; cy: number };
}

export interface ElementRebase {
  target: SourceMutationTarget;
  left: number;
  top: number;
}

function getInlineStylePx(el: Element, property: string): number {
  const style = (isHTMLElement(el) ? el.getAttribute("style") : null) ?? "";
  const { props } = parseStyleDecls(style);
  const raw = props.get(property);
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function setInlineLeftTop(el: HTMLElement, left: number, top: number): void {
  let style = el.getAttribute("style") ?? "";
  style = patchStyleAttrString(style, "left", `${left}px`);
  style = patchStyleAttrString(style, "top", `${top}px`);
  el.setAttribute("style", style);
}

// Slug the group name ("Group 1" → "group-1") into a unique, valid element id.
function uniqueGroupDomId(document: Document, groupId: string): string {
  const base =
    groupId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group";
  let id = base;
  let n = 2;
  while (document.getElementById(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

// fallow-ignore-next-line complexity
export function wrapElementsInHtml(
  source: string,
  targets: SourceMutationTarget[],
  groupId: string,
  bbox: { left: number; top: number; width: number; height: number },
  rebases: ElementRebase[],
): WrapElementsResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  if (targets.length === 0) {
    return { html: source, matched: false, groupId: null, error: "no targets" };
  }

  // Resolve + dedupe by element ref (two targets may point at the same node).
  const els: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const target of targets) {
    const el = findTargetElement(document, target);
    if (!el || !isHTMLElement(el) || seen.has(el)) continue;
    seen.add(el);
    els.push(el);
  }
  if (els.length === 0) {
    return { html: source, matched: false, groupId: null, error: "no targets matched" };
  }

  // P1: require a single common parent (LCA multi-parent wrapping is P2).
  const parent = els[0]?.parentElement;
  if (!parent || els.some((el) => el.parentElement !== parent)) {
    return {
      html: source,
      matched: false,
      groupId: null,
      error: "grouped elements must share a single parent",
    };
  }

  // Order members by their position in the parent (= z-order / stacking order).
  const memberSet = new Set<Element>(els);
  const ordered = Array.from(parent.children).filter((c): c is HTMLElement => memberSet.has(c));

  // Map each member to its rebased left/top (resolved against the same document).
  const rebaseByEl = new Map<Element, { left: number; top: number }>();
  for (const rebase of rebases) {
    const el = findTargetElement(document, rebase.target);
    if (el) rebaseByEl.set(el, { left: rebase.left, top: rebase.top });
  }

  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-hf-group", groupId);
  // A real `id` (slug of the group name) makes the wrapper a first-class node in the
  // clip manifest / timeline parent-map (both keyed by id) and a clean GSAP target —
  // without it the wrapper is invisible to the timeline and breaks child enumeration.
  wrapper.setAttribute("id", uniqueGroupDomId(document, groupId));
  // Adopt the topmost member's stacking level. A group is one stacking unit, so a
  // non-member interleaved between two selected members can't stay "between" them
  // once they unify. Matching Figma/Sketch, the group lifts to the topmost selected
  // layer: the wrapper goes at the LAST member's slot and carries the max member
  // z-index — so an interleaved non-member falls below the group instead of hoisting
  // above it, and explicit member z-indexes are honored.
  const memberZIndexes = ordered
    .map((el) =>
      Number.parseInt(
        parseStyleDecls(el.getAttribute("style") ?? "").props.get("z-index") ?? "",
        10,
      ),
    )
    .filter((z) => Number.isFinite(z));
  const maxZ = memberZIndexes.length > 0 ? Math.max(...memberZIndexes) : null;
  wrapper.setAttribute(
    "style",
    `position: absolute; left: ${bbox.left}px; top: ${bbox.top}px; width: ${bbox.width}px; height: ${bbox.height}px` +
      (maxZ !== null ? `; z-index: ${maxZ}` : ""),
  );

  // Insert the wrapper at the topmost member's slot, then move members into it.
  parent.insertBefore(wrapper, ordered[ordered.length - 1] ?? null);
  for (const el of ordered) {
    const rebase = rebaseByEl.get(el);
    if (rebase) setInlineLeftTop(el, rebase.left, rebase.top);
    wrapper.appendChild(el); // appendChild moves the node, preserving order
  }

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    matched: true,
    groupId,
  };
}

export function unwrapElementsFromHtml(
  source: string,
  groupTarget: SourceMutationTarget,
): UnwrapElementsResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const group = findTargetElement(document, groupTarget);
  if (!group || !isHTMLElement(group)) return { html: source, unwrapped: false };
  // Shape guard mirroring the wrap-side contract: only ever dissolve an actual
  // group wrapper. A stale/desynced selection that resolves to a plain <div>
  // would otherwise be unwrapped — rebasing its children by the parent's origin
  // (silent corruption). Wrap enforces invariants; unwrap must too.
  if (!group.hasAttribute("data-hf-group")) return { html: source, unwrapped: false };

  const parent = group.parentElement;
  if (!parent) return { html: source, unwrapped: false };

  // Undo the rebase: child absolute position = child (rebased) + wrapper origin.
  const wLeft = getInlineStylePx(group, "left");
  const wTop = getInlineStylePx(group, "top");
  const groupCenter = {
    cx: wLeft + getInlineStylePx(group, "width") / 2,
    cy: wTop + getInlineStylePx(group, "height") / 2,
  };

  // Move children back to the wrapper's slot, preserving order.
  const members: Array<{ id: string; cx: number; cy: number }> = [];
  for (const child of Array.from(group.children)) {
    if (isHTMLElement(child)) {
      const newLeft = getInlineStylePx(child, "left") + wLeft;
      const newTop = getInlineStylePx(child, "top") + wTop;
      setInlineLeftTop(child, newLeft, newTop);
      if (child.id) {
        members.push({
          id: child.id,
          cx: newLeft + getInlineStylePx(child, "width") / 2,
          cy: newTop + getInlineStylePx(child, "height") / 2,
        });
      }
    }
    parent.insertBefore(child, group);
  }
  const groupId = group.id || undefined;
  group.remove();

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    unwrapped: true,
    unwrappedGroupId: groupId,
    members,
    groupCenter,
  };
}
