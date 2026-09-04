/**
 * Namespace SVG element ids during sub-composition inline.
 *
 * An element `id` is only unique within one composition FILE. The assembled
 * render/preview document is the inlined union of every file, so two nested
 * scenes that each declare their own `<clipPath id="clip">`, `<symbol
 * id="shape">` or `<filter id="fx">` — legal per file, and invisible to
 * `hyperframes check` — collide once inlined. Catalog blocks make this easy
 * to hit by accident: a block's markup hardcodes ids like
 * `url(#tracing-beam-glow)`, so using the SAME block twice collides without
 * the author duplicating anything by hand.
 *
 * `getElementById` was already scoped per composition in #646 (see
 * `compositionScoping.ts`'s `__hfGetElementById` shim) and media pipeline ids
 * were disambiguated with a parallel `data-hf-render-id` attribute in #3340
 * (`mediaRenderIds.ts`). Neither covers `url(#id)` funcrefs (`clip-path`,
 * `filter`, `mask`, `fill`, `stroke`, `marker-start/mid/end`, `cursor`,
 * `mask-image`, …) or bare `#id` fragment refs (`<use href="#id">`, `<a
 * href="#id">`, `<pattern>`/`<textPath>` `href`): those are resolved by the
 * BROWSER'S NATIVE SVG/CSS engine, which always binds to the first element in
 * DOCUMENT ORDER carrying that literal `id` attribute. No JS proxy can
 * intercept native resolution, so unlike the two fixes above, this one
 * actually renames the `id` attribute.
 *
 * Renaming a real `id` would break an inline script's own
 * `document.getElementById(originalId)` or a same-composition CSS `#id`
 * selector, so every renamed element keeps its original id on
 * `data-hf-authored-id` — the exact attribute `__hfGetElementById`'s fallback
 * already checks (introduced in #646 for the composition ROOT's own id;
 * reused here for any descendant), and `rewriteSvgIdReferencesInCss` below
 * rewrites the composition's own `<style>` text to match.
 */

import postcss from "postcss";
import { replaceSelectorIdTokens } from "./selectorIdTokens";

const ID_ATTR = "id";

/** Reused from `compositionScoping.ts`'s `AUTHORED_ROOT_ID_ATTR` in spirit —
 *  same purpose (let a renamed id still resolve by its authored name), now
 *  generalized from "the composition root" to any renamed descendant. */
export const SVG_AUTHORED_ID_ATTR = "data-hf-authored-id";

/**
 * Matches a `url(#id)` funcref value — quoted or bare — as used by
 * `clip-path`, `filter`, `mask`, `fill`, `stroke`, `marker-start/mid/end`,
 * `cursor`, `mask-image`, and equally by any of those written into an inline
 * `style` attribute or a `<style>` declaration value. One pattern covers all
 * of them because CSS only ever spells an id reference this way in a
 * property VALUE — a bare `#id` (no `url()`) is exclusively a *selector*.
 */
const URL_HASH_REF_RE = /(url\(\s*)(["']?)#([^"')\s]+)\2(\s*\))/gi;

/**
 * Attributes carrying a bare `#id` fragment reference rather than a
 * `url(#id)` funcref — SVG's `<use>`, `<a>`, `<pattern>`, `<textPath>`,
 * `<feImage>`, `<mpath>`, and so on. Matching by suffix also covers
 * namespaced `xlink:href`, however a given DOM implementation exposes it.
 */
function isHrefAttrName(name: string): boolean {
  return name === "href" || name.endsWith(":href");
}

function sanitizeNamespaceSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildNamespacedId(namespace: string, originalId: string): string {
  return `${sanitizeNamespaceSegment(namespace)}--${originalId}`;
}

function rewriteUrlHashRefs(value: string, idMap: ReadonlyMap<string, string>): string {
  if (!value || !value.includes("url(")) return value;
  return value.replace(URL_HASH_REF_RE, (full, pre, quote, id: string, post) => {
    const mapped = idMap.get(id);
    return mapped ? `${pre}${quote}#${mapped}${quote}${post}` : full;
  });
}

function rewriteHrefValue(value: string, idMap: ReadonlyMap<string, string>): string | null {
  if (!value.startsWith("#")) return null;
  const mapped = idMap.get(value.slice(1));
  return mapped ? `#${mapped}` : null;
}

/** Rewrite every id reference carried on one element's attributes. CSS text
 *  inside a `<style>` element is handled separately by
 *  `rewriteSvgIdReferencesInCss` — it is extracted and scoped as a raw
 *  string elsewhere in the inline pipeline, never visited by this walk. */
function rewriteElementIdReferences(el: Element, idMap: ReadonlyMap<string, string>): void {
  const attrs = el.attributes ? Array.from(el.attributes) : [];
  for (const attr of attrs) {
    const { name, value } = attr;
    if (!value) continue;
    if (isHrefAttrName(name)) {
      const rewritten = rewriteHrefValue(value, idMap);
      if (rewritten) {
        el.setAttribute(name, rewritten);
        continue;
      }
    }
    if (value.includes("url(")) {
      const rewritten = rewriteUrlHashRefs(value, idMap);
      if (rewritten !== value) el.setAttribute(name, rewritten);
    }
  }
}

/** Structural shape both a linkedom/live-DOM `Element` and `Document`
 *  satisfy — mirrors the narrow-interface pattern `mediaRenderIds.ts` and
 *  `compositionAssembly.ts` already use so this module works unmodified
 *  across the preview bundler and the render compiler. */
interface SvgIdScopeLike {
  querySelectorAll(selector: string): Iterable<Element>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
}

/**
 * Namespace every id declared on an `<svg>`-subtree element within `root` so
 * it cannot collide with the same author's id in a sibling composition
 * instance, then rewrite every same-document attribute reference
 * (`href`/`xlink:href`, and any `url(#id)` funcref — including inside a
 * `style` attribute) to match.
 *
 * Returns the old-id -> new-id map so the caller can apply the identical
 * substitution to the composition's separately-extracted `<style>` text via
 * `rewriteSvgIdReferencesInCss`, which this function never sees.
 *
 * A no-op (empty map, no mutation) when `namespace` is empty: an anonymous
 * host has no unique identity to prefix with, the same guard
 * `scopeCssToComposition` and `wrapScopedCompositionScript` already apply.
 */
function collectUrlHashRefsFromText(
  text: string,
  filter: ReadonlySet<string>,
  out: Set<string>,
): void {
  let m: RegExpExecArray | null;
  URL_HASH_REF_RE.lastIndex = 0;
  while ((m = URL_HASH_REF_RE.exec(text))) {
    const refId = m[3]!;
    if (filter.has(refId)) out.add(refId);
  }
}

/** Ids referenced by native browser resolution — `url(#id)` funcrefs and
 *  bare `href="#id"` fragment refs — as opposed to JavaScript-only refs
 *  (e.g. GSAP's `tl.to("#cut-1")`). Global libraries access `document`
 *  directly and bypass the composition-scoped querySelector Proxy, so only
 *  natively-referenced ids are safe to rename. */
function collectHrefFragmentRef(attr: Attr, filter: ReadonlySet<string>, out: Set<string>): void {
  if (isHrefAttrName(attr.name) && attr.value.startsWith("#")) {
    const id = attr.value.slice(1);
    if (filter.has(id)) out.add(id);
  }
}

function collectNativelyReferencedIds(
  root: SvgIdScopeLike,
  candidates: readonly Element[],
  svgIds: ReadonlySet<string>,
): Set<string> {
  const referenced = new Set<string>();
  for (const el of candidates) {
    for (const attr of el.attributes ? Array.from(el.attributes) : []) {
      if (!attr.value) continue;
      collectHrefFragmentRef(attr, svgIds, referenced);
      if (attr.value.includes("url(")) collectUrlHashRefsFromText(attr.value, svgIds, referenced);
    }
  }
  for (const styleEl of root.querySelectorAll("style")) {
    const text = (styleEl as unknown as { textContent: string | null }).textContent;
    if (text && text.includes("url(")) collectUrlHashRefsFromText(text, svgIds, referenced);
  }
  return referenced;
}

export function namespaceSvgIds(root: SvgIdScopeLike, namespace: string): Map<string, string> {
  const idMap = new Map<string, string>();
  if (!namespace) return idMap;

  const svgIds = new Set<string>();
  for (const el of root.querySelectorAll("svg [id], svg[id]")) {
    const id = el.getAttribute(ID_ATTR);
    if (id) svgIds.add(id);
  }
  if (svgIds.size === 0) return idMap;

  const candidates: Element[] = [...root.querySelectorAll("*")];
  if (typeof root.getAttribute === "function" && typeof root.setAttribute === "function") {
    candidates.unshift(root as unknown as Element);
  }

  const nativelyReferenced = collectNativelyReferencedIds(root, candidates, svgIds);
  if (nativelyReferenced.size === 0) return idMap;

  for (const id of nativelyReferenced) {
    idMap.set(id, buildNamespacedId(namespace, id));
  }
  for (const el of candidates) {
    const currentId = el.getAttribute(ID_ATTR);
    if (currentId && idMap.has(currentId)) {
      el.setAttribute(SVG_AUTHORED_ID_ATTR, currentId);
      el.setAttribute(ID_ATTR, idMap.get(currentId)!);
    }
    rewriteElementIdReferences(el, idMap);
  }
  return idMap;
}

/**
 * Whole-token `#id` replacement inside a CSS selector, generalized to many
 * ids at once and to a literal `#newId` swap instead of an attribute-selector
 * expansion (a plain descendant/id selector already resolves correctly once
 * the id itself is unique — no extra scoping needed). Shares its quote- and
 * bracket-aware scan with `compositionScoping.ts`'s
 * `replaceAuthoredRootIdSelectors` via `selectorIdTokens.ts`, rather than a
 * second copy of the same state machine.
 */
function renameIdTokensInSelector(selector: string, idMap: ReadonlyMap<string, string>): string {
  return replaceSelectorIdTokens(
    selector,
    [...idMap.keys()],
    (matchedId) => `#${idMap.get(matchedId)}`,
  );
}

/**
 * Apply the same id substitution `namespaceSvgIds` computed to a
 * composition's `<style>` text.
 *
 * `<style>` content is extracted from the DOM and carried around as a raw
 * string by the inline pipeline (see `inlineSubCompositions`'s
 * `scopeSubStyle`), so it is never visited by `namespaceSvgIds`'s attribute
 * walk. Both a bare `#id` selector (`#clip rect { fill: red }`, already
 * scoped to the right instance by #556's composition-box prefix, but still
 * naming the PRE-rename id) and a `url(#id)` declaration value need
 * rewriting here, or a same-composition stylesheet rule silently stops
 * matching the element whose id this module just changed.
 */
export function rewriteSvgIdReferencesInCss(
  css: string,
  idMap: ReadonlyMap<string, string>,
): string {
  if (!css || idMap.size === 0) return css;
  if (!css.includes("#") && !css.includes("url(")) return css;

  const root = postcss.parse(css);
  let mutated = false;

  root.walkRules((rule) => {
    const rewritten = rule.selectors.map((selector) => renameIdTokensInSelector(selector, idMap));
    if (rewritten.some((selector, index) => selector !== rule.selectors[index])) {
      rule.selectors = rewritten;
      mutated = true;
    }
  });
  root.walkDecls((decl) => {
    const rewritten = rewriteUrlHashRefs(decl.value, idMap);
    if (rewritten !== decl.value) {
      decl.value = rewritten;
      mutated = true;
    }
  });
  root.walkAtRules((atRule) => {
    if (!atRule.params) return;
    const rewritten = rewriteUrlHashRefs(atRule.params, idMap);
    if (rewritten !== atRule.params) {
      atRule.params = rewritten;
      mutated = true;
    }
  });

  return mutated ? root.toResult({ map: false }).css : css;
}
