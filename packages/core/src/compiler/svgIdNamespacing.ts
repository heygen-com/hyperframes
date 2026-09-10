/**
 * Namespace COLLIDING SVG element ids after sub-composition inline.
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
 * Renaming is deliberately narrow, because a renamed id also disappears from
 * every author-side lookup (`svg.querySelector("#shape")`, `gsap.to("#shape")`)
 * that used to find it. Two independent gates decide whether an element is
 * renamed:
 *
 * 1. COLLISION-DRIVEN. An id is only renamed when the merged document would
 *    otherwise carry it more than once. A composition whose ids are already
 *    document-unique — including every single-composition project — comes
 *    out with its ids byte-for-byte unchanged. Among the colliding elements
 *    ONE keeps the original id (the "keeper"): the first element in document
 *    order that this module cannot rename (outside every inlined scope, or
 *    not natively referenced — see gate 2), or else simply the first element
 *    in document order. Native resolution binds to the first match in
 *    document order, so the keeper's own references keep resolving to it;
 *    every other renamable duplicate gets a document-unique id and has its
 *    references rewritten to match.
 *
 * 2. DEMAND-DRIVEN. Only ids that have a native `url(#id)` / `href="#id"`
 *    reference inside their own composition are renamable. An id referenced
 *    exclusively by JavaScript (e.g. GSAP's `tl.to("#cut-1")`) is never
 *    renamed: global libraries reach `document.querySelector` directly and
 *    bypass the composition-scoped Proxy, so a renamed JS-only id becomes
 *    unreachable. The residual cost of this gate is documented in
 *    `collectNativelyReferencedIds`.
 *
 * Every renamed element keeps its original id on `data-hf-authored-id` — the
 * attribute `__hfGetElementById`'s fallback already checks (introduced in
 * #646 for the composition ROOT's own id; reused here for any descendant).
 * The composition-scoped script runtime in `compositionScoping.ts` reads the
 * same attribute to keep `#authoredId` selectors resolving through the scoped
 * `document` proxy, the GSAP proxy and `Element.prototype.querySelector*`,
 * and `rewriteSvgIdReferencesInCss` below rewrites the composition's own
 * `<style>` text to match.
 */

import postcss from "postcss";
import { escapeCssIdentifier, replaceSelectorIdTokens } from "./selectorIdTokens";

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
 *
 * The captured id is the literal fragment text. A fragment is a URL, not a
 * CSS identifier, so it carries no CSS escapes; the replacement keeps the
 * original quoting and only swaps the id, which stays a valid fragment
 * because the namespace prefix is restricted to `[A-Za-z0-9_-]`.
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
interface SvgIdQueryable {
  querySelectorAll(selector: string): Iterable<Element>;
}

/** One inlined composition instance, as seen in the ASSEMBLED document. */
export interface SvgIdScope {
  /** The element whose subtree holds this instance's content (the host). */
  root: Element;
  /**
   * Document-unique prefix for ids renamed in this scope — the instance's
   * runtime composition id. An empty namespace makes the scope read-only:
   * an anonymous host has no identity to prefix with, the same guard
   * `scopeCssToComposition` and `wrapScopedCompositionScript` apply.
   */
  namespace: string;
  /**
   * Nested composition hosts inside `root` whose content belongs to their
   * OWN scope. Their subtrees are skipped both when collecting this scope's
   * ids and when rewriting its references.
   */
  exclude?: readonly Element[];
  /**
   * This instance's extracted `<style>` text (already removed from the DOM
   * by the inline pipeline). Scanned for `url(#id)` references so a filter
   * that is only applied from a stylesheet still counts as natively
   * referenced. The caller rewrites these strings afterwards via
   * `rewriteSvgIdReferencesInCss` with the returned map.
   */
  cssTexts?: readonly string[];
}

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

function collectHrefFragmentRef(attr: Attr, filter: ReadonlySet<string>, out: Set<string>): void {
  if (isHrefAttrName(attr.name) && attr.value.startsWith("#")) {
    const id = attr.value.slice(1);
    if (filter.has(id)) out.add(id);
  }
}

/**
 * Ids referenced by native browser resolution — `url(#id)` funcrefs and
 * bare `href="#id"` fragment refs — as opposed to JavaScript-only refs
 * (e.g. GSAP's `tl.to("#cut-1")`). Global libraries access `document`
 * directly and bypass the composition-scoped querySelector Proxy, so only
 * natively-referenced ids are safe to rename.
 *
 * RESIDUAL, BY DESIGN: two instances that both animate the same JS-ONLY id
 * (two catalog scenes each doing `tl.to("#cut-1")`) both keep `id="cut-1"`.
 * Scripts wrapped by `wrapScopedCompositionScript` still find their own
 * element (the scoped `document`/GSAP proxies filter to the instance root),
 * but an UNSCOPED lookup — a third-party library reading `document` directly
 * — binds to the first instance in document order, exactly as it did before
 * this module existed. Broadening this pre-scan to JS-only ids would trade
 * that residual for breaking every such library lookup outright (the
 * regression that motivated the gate), so the residual stays.
 *
 * Also not pre-scanned: references a script injects at runtime
 * (`el.setAttribute("clip-path", "url(#foo)")` as the ONLY reference to
 * `#foo`). Static markup and stylesheets are the contract.
 */
function collectNativelyReferencedIds(
  elements: readonly Element[],
  cssTexts: readonly string[],
  svgIds: ReadonlySet<string>,
): Set<string> {
  const referenced = new Set<string>();
  for (const el of elements) {
    for (const attr of el.attributes ? Array.from(el.attributes) : []) {
      if (!attr.value) continue;
      collectHrefFragmentRef(attr, svgIds, referenced);
      if (attr.value.includes("url(")) collectUrlHashRefsFromText(attr.value, svgIds, referenced);
    }
  }
  for (const text of cssTexts) {
    if (text.includes("url(")) collectUrlHashRefsFromText(text, svgIds, referenced);
  }
  return referenced;
}

function isExcluded(el: Element, exclude: readonly Element[]): boolean {
  return exclude.some((excluded) => excluded === el || excluded.contains(el));
}

/** `root` plus every descendant that is not inside an excluded subtree. */
function collectScopeElements(scope: SvgIdScope): Element[] {
  const exclude = scope.exclude ?? [];
  const descendants = [...scope.root.querySelectorAll("*")];
  const own = exclude.length ? descendants.filter((el) => !isExcluded(el, exclude)) : descendants;
  return [scope.root, ...own];
}

interface ResolvedScope {
  elements: Element[];
  /** Elements this scope may rename: inside an `<svg>` subtree, carrying an
   *  id that something in this same scope references natively. */
  renamable: Set<Element>;
}

/** Every `<svg>`-subtree element in the scope that carries an id. */
function collectSvgIdElements(scope: SvgIdScope): Element[] {
  const exclude = scope.exclude ?? [];
  const matches = [...scope.root.querySelectorAll("svg [id], svg[id]")];
  return exclude.length ? matches.filter((el) => !isExcluded(el, exclude)) : matches;
}

function resolveScope(scope: SvgIdScope): ResolvedScope {
  const elements = collectScopeElements(scope);
  const renamable = new Set<Element>();
  if (!scope.namespace) return { elements, renamable };

  const svgIdElements = collectSvgIdElements(scope);
  const svgIds = new Set<string>();
  for (const el of svgIdElements) {
    const id = el.getAttribute(ID_ATTR);
    if (id) svgIds.add(id);
  }
  if (svgIds.size === 0) return { elements, renamable };

  const nativelyReferenced = collectNativelyReferencedIds(elements, scope.cssTexts ?? [], svgIds);
  for (const el of svgIdElements) {
    const id = el.getAttribute(ID_ATTR);
    if (id && nativelyReferenced.has(id)) renamable.add(el);
  }
  return { elements, renamable };
}

interface IdCensus {
  /** Every element carrying each id, in document order — the order native
   *  resolution uses. */
  elementsById: Map<string, Element[]>;
  /** Every id in the document, extended with each minted id so no two
   *  renames (or a rename and an authored id) can ever coincide. */
  usedIds: Set<string>;
}

function buildIdCensus(document: SvgIdQueryable): IdCensus {
  const elementsById = new Map<string, Element[]>();
  const usedIds = new Set<string>();
  for (const el of document.querySelectorAll("[id]")) {
    const id = el.getAttribute(ID_ATTR);
    if (!id) continue;
    usedIds.add(id);
    const list = elementsById.get(id);
    if (list) list.push(el);
    else elementsById.set(id, [el]);
  }
  return { elementsById, usedIds };
}

function hasAnyCollision(census: IdCensus): boolean {
  for (const elements of census.elementsById.values()) {
    if (elements.length > 1) return true;
  }
  return false;
}

/** A namespaced id that is not already taken anywhere in the document. */
function mintNamespacedId(namespace: string, originalId: string, usedIds: Set<string>): string {
  const base = `${sanitizeNamespaceSegment(namespace)}--${originalId}`;
  let candidate = base;
  for (let n = 2; usedIds.has(candidate); n += 1) candidate = `${base}-${n}`;
  usedIds.add(candidate);
  return candidate;
}

/**
 * Decide, per scope, which ids get renamed and to what. For every colliding
 * id the keeper is the first element in document order that no scope can
 * rename, else simply the first element; every other renamable element's
 * scope receives a mapping for that id.
 */
function planRenames(
  census: IdCensus,
  scopes: readonly SvgIdScope[],
  scopeIndexByRenamable: ReadonlyMap<Element, number>,
): Map<string, string>[] {
  const idMaps = scopes.map(() => new Map<string, string>());
  for (const [id, elements] of census.elementsById) {
    if (elements.length < 2) continue;
    const keeper = elements.find((el) => !scopeIndexByRenamable.has(el)) ?? elements[0]!;
    for (const el of elements) {
      if (el === keeper) continue;
      const scopeIndex = scopeIndexByRenamable.get(el);
      if (scopeIndex === undefined) continue;
      const idMap = idMaps[scopeIndex]!;
      if (!idMap.has(id)) {
        idMap.set(id, mintNamespacedId(scopes[scopeIndex]!.namespace, id, census.usedIds));
      }
    }
  }
  return idMaps;
}

/** Rename the planned elements in one scope and rewrite every reference in
 *  that scope's attributes to match. */
function applyRenames(resolved: ResolvedScope, idMap: ReadonlyMap<string, string>): void {
  for (const el of resolved.elements) {
    const currentId = el.getAttribute(ID_ATTR);
    if (currentId && resolved.renamable.has(el) && idMap.has(currentId)) {
      if (!el.hasAttribute(SVG_AUTHORED_ID_ATTR)) el.setAttribute(SVG_AUTHORED_ID_ATTR, currentId);
      el.setAttribute(ID_ATTR, idMap.get(currentId)!);
    }
    rewriteElementIdReferences(el, idMap);
  }
}

/**
 * Rename every colliding, natively-referenced SVG id across the inlined
 * composition instances in `scopes` and rewrite each instance's attribute
 * references (`href`/`xlink:href`, any `url(#id)` funcref — including inside
 * a `style` attribute) to match.
 *
 * Returns one old-id -> new-id map per scope, in the same order, so the
 * caller can apply the identical substitution to that instance's separately
 * extracted `<style>` text via `rewriteSvgIdReferencesInCss`, which this
 * function never sees. A scope whose ids never collide gets an empty map and
 * is not mutated at all.
 *
 * `document` must be the ASSEMBLED document every scope root lives in: the
 * collision census covers the whole thing, including ids the top-level
 * document declares itself, since those collide with an inlined instance's
 * ids just as two instances collide with each other.
 */
export function namespaceCollidingSvgIds(
  document: SvgIdQueryable,
  scopes: readonly SvgIdScope[],
): Map<string, string>[] {
  const untouched = scopes.map(() => new Map<string, string>());
  if (scopes.length === 0) return untouched;

  const census = buildIdCensus(document);
  if (!hasAnyCollision(census)) return untouched;

  const resolved = scopes.map(resolveScope);
  const scopeIndexByRenamable = new Map<Element, number>();
  resolved.forEach(({ renamable }, index) => {
    for (const el of renamable) scopeIndexByRenamable.set(el, index);
  });
  if (scopeIndexByRenamable.size === 0) return untouched;

  const idMaps = planRenames(census, scopes, scopeIndexByRenamable);
  idMaps.forEach((idMap, index) => {
    if (idMap.size > 0) applyRenames(resolved[index]!, idMap);
  });
  return idMaps;
}

/**
 * Whole-token `#id` replacement inside a CSS selector, generalized to many
 * ids at once and to a literal `#newId` swap instead of an attribute-selector
 * expansion (a plain descendant/id selector already resolves correctly once
 * the id itself is unique — no extra scoping needed). Shares its quote- and
 * bracket-aware scan with `compositionScoping.ts`'s
 * `replaceAuthoredRootIdSelectors` via `selectorIdTokens.ts`, rather than a
 * second copy of the same state machine. The scanner decodes CSS identifier
 * escapes before matching, so `#fx\.1` matches the raw id `fx.1`, and the
 * replacement is re-escaped so the emitted selector stays valid.
 */
function renameIdTokensInSelector(selector: string, idMap: ReadonlyMap<string, string>): string {
  return replaceSelectorIdTokens(
    selector,
    [...idMap.keys()],
    (matchedId) => `#${escapeCssIdentifier(idMap.get(matchedId)!)}`,
  );
}

/**
 * Apply the same id substitution `namespaceCollidingSvgIds` computed to a
 * composition's `<style>` text.
 *
 * `<style>` content is extracted from the DOM and carried around as a raw
 * string by the inline pipeline (see `inlineSubCompositions`'s
 * `scopeSubStyle`), so it is never visited by the attribute walk. Both a bare
 * `#id` selector (`#clip rect { fill: red }`, already scoped to the right
 * instance by #556's composition-box prefix, but still naming the PRE-rename
 * id) and a `url(#id)` declaration value need rewriting here, or a
 * same-composition stylesheet rule silently stops matching the element whose
 * id this module just changed.
 */
export function rewriteSvgIdReferencesInCss(
  css: string,
  idMap: ReadonlyMap<string, string>,
): string {
  if (!css || idMap.size === 0) return css;
  if (!css.includes("#") && !css.includes("url(")) return css;

  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    // Unparseable CSS is the caller's problem to report; leaving it untouched
    // is strictly better than dropping the whole stylesheet here.
    return css;
  }
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
