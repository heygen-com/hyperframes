/**
 * Native SVG url()/href references resolve by document order, bypassing JS scoping.
 * Rename only colliding, natively referenced SVG ids; leave JS-only ids reachable
 * by libraries that bypass the scoped selector shim. The first unrenamable element
 * keeps the authored id (otherwise the first element does). Renamed elements retain
 * data-hf-authored-id for script lookup compatibility.
 */

import postcss from "postcss";
import { escapeCssIdentifier } from "./selectorIdTokens";
import {
  SVG_REFERENCE_ALIASES_ATTR,
  readSvgReferenceAliases,
  rewriteSvgSelectors,
  type SvgReferenceAlias,
} from "./svgSelectorAliases";

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
  if (!value || !value.toLowerCase().includes("url(")) return value;
  return value.replace(URL_HASH_REF_RE, (full, pre, quote, id: string, post) => {
    const mapped = idMap.get(id);
    return mapped ? `${pre}${quote}#${mapped}${quote}${post}` : full;
  });
}

type ReferenceDecision =
  | { kind: "skip" }
  | { kind: "retain"; alias: SvgReferenceAlias }
  | { kind: "managed"; before: string; after: string };

function nativeReferenceValue(
  name: string,
  value: string,
  idMap: ReadonlyMap<string, string>,
): string | null {
  if (isHrefAttrName(name) && value.startsWith("#")) {
    const mapped = idMap.get(value.slice(1));
    return mapped ? `#${mapped}` : value;
  }
  URL_HASH_REF_RE.lastIndex = 0;
  const hasUrl = URL_HASH_REF_RE.test(value);
  URL_HASH_REF_RE.lastIndex = 0;
  return hasUrl ? rewriteUrlHashRefs(value, idMap) : null;
}

function decideReferenceWrite(
  attr: Attr,
  previous: SvgReferenceAlias | undefined,
  idMap: ReadonlyMap<string, string>,
): ReferenceDecision {
  if (attr.name === SVG_REFERENCE_ALIASES_ATTR || attr.name === ID_ATTR) return { kind: "skip" };
  const before = previous && attr.value === previous.after ? previous.before : attr.value;
  const after = nativeReferenceValue(attr.name, before, idMap);
  if (after !== null) return { kind: "managed", before, after };
  return previous ? { kind: "retain", alias: previous } : { kind: "skip" };
}

function referenceAlias(
  attr: Attr,
  before: string,
  after: string,
  inSvg: boolean,
): SvgReferenceAlias {
  // The compiler DOM omits Attr namespace APIs; serialized SVG restores XLink.
  const serializedXlink = attr.namespaceURI === undefined && attr.name === "xlink:href" && inSvg;
  return {
    name: attr.name,
    localName: serializedXlink ? "href" : attr.localName,
    namespaceURI: serializedXlink ? "http://www.w3.org/1999/xlink" : (attr.namespaceURI ?? null),
    before,
    after,
  };
}

/** Apply managed reference writes while retaining provenance for later assembly phases. */
function rewriteElementIdReferences(el: Element, idMap: ReadonlyMap<string, string>): void {
  const prior = new Map(
    readSvgReferenceAliases(el, SVG_REFERENCE_ALIASES_ATTR, false).map((alias) => [
      alias.name,
      alias,
    ]),
  );
  const aliases = [...prior.values()].filter((alias) => alias.name === ID_ATTR);
  const inSvg = !!el.closest("svg");
  for (const attr of el.attributes ? Array.from(el.attributes) : []) {
    const decision = decideReferenceWrite(attr, prior.get(attr.name), idMap);
    if (decision.kind === "skip") continue;
    if (decision.kind === "retain") {
      aliases.push(decision.alias);
      continue;
    }
    if (decision.after !== attr.value) {
      if (attr.namespaceURI) el.setAttributeNS(attr.namespaceURI, attr.name, decision.after);
      else el.setAttribute(attr.name, decision.after);
    }
    aliases.push(referenceAlias(attr, decision.before, decision.after, inSvg));
  }
  if (aliases.length) el.setAttribute(SVG_REFERENCE_ALIASES_ATTR, JSON.stringify(aliases));
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
   * runtime composition id. An empty namespace freezes IDs while still repairing references:
   * an anonymous host has no identity to prefix with, the same guard
   * `scopeCssToComposition` and `wrapScopedCompositionScript` apply.
   */
  namespace: string;
  /** Root document references follow document order; instances prefer local definitions. */
  referenceTarget?: "document";
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
      if (!attr.value || attr.name === SVG_REFERENCE_ALIASES_ATTR) continue;
      collectHrefFragmentRef(attr, svgIds, referenced);
      if (attr.value.toLowerCase().includes("url("))
        collectUrlHashRefsFromText(attr.value, svgIds, referenced);
    }
  }
  for (const text of cssTexts) {
    if (text.toLowerCase().includes("url(")) collectUrlHashRefsFromText(text, svgIds, referenced);
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

function currentAuthoredSvgId(el: Element): string | null {
  if (!el.closest("svg")) return null;
  const idWrite = readSvgReferenceAliases(el, SVG_REFERENCE_ALIASES_ATTR, false).find(
    (alias) => alias.name === ID_ATTR,
  );
  if (idWrite) return el.getAttribute(ID_ATTR) === idWrite.after ? idWrite.before : null;
  return el.getAttribute(SVG_AUTHORED_ID_ATTR);
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
    const authored = currentAuthoredSvgId(el);
    if (authored && authored !== id) {
      const aliases = elementsById.get(authored);
      if (aliases) aliases.push(el);
      else elementsById.set(authored, [el]);
    }
  }
  return { elementsById, usedIds };
}

/** A namespaced id that is not already taken anywhere in the document. */
function mintNamespacedId(namespace: string, originalId: string, usedIds: Set<string>): string {
  const base = `${sanitizeNamespaceSegment(namespace)}--${originalId}`;
  let candidate = base;
  for (let n = 2; usedIds.has(candidate); n += 1) candidate = `${base}-${n}`;
  usedIds.add(candidate);
  return candidate;
}

function collisionScopes(
  id: string,
  elements: readonly Element[],
  scopeIndexByRenamable: ReadonlyMap<Element, number>,
): Set<number> {
  const keeper = elements.find((el) => !scopeIndexByRenamable.has(el)) ?? elements[0];
  const candidates = elements.filter((el) => el !== keeper && el.getAttribute(ID_ATTR) === id);
  const indices = candidates.map((el) => scopeIndexByRenamable.get(el));
  return new Set(indices.filter((index): index is number => index !== undefined));
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
    for (const index of collisionScopes(id, elements, scopeIndexByRenamable)) {
      idMaps[index]!.set(id, mintNamespacedId(scopes[index]!.namespace, id, census.usedIds));
    }
  }
  return idMaps;
}

function documentReferenceTargets(
  census: IdCensus,
  idMaps: readonly ReadonlyMap<string, string>[],
  scopeIndexByRenamable: ReadonlyMap<Element, number>,
): Map<string, string> {
  const targets = new Map<string, string>();
  for (const [id, elements] of census.elementsById) {
    const target = elements[0]!;
    const actual = target.getAttribute(ID_ATTR)!;
    if (actual !== id) {
      targets.set(id, actual);
      continue;
    }
    const index = scopeIndexByRenamable.get(target);
    const renamed = index === undefined ? undefined : idMaps[index]!.get(id);
    if (renamed) targets.set(id, renamed);
  }
  return targets;
}

function localReferenceBindings(elements: readonly Element[]) {
  const ids = new Set(elements.map((el) => el.getAttribute(ID_ATTR)));
  const renamed = new Map<string, string>();
  for (const el of elements) {
    const authored = currentAuthoredSvgId(el);
    const current = el.getAttribute(ID_ATTR);
    if (!authored || !current) continue;
    ids.add(authored);
    renamed.set(authored, current);
  }
  return { ids, renamed };
}

/** Rename the planned elements in one scope and rewrite every reference in
 *  that scope's attributes to match. */
function applyRenames(resolved: ResolvedScope, idMap: ReadonlyMap<string, string>): void {
  for (const el of resolved.elements) {
    const currentId = el.getAttribute(ID_ATTR);
    if (currentId && resolved.renamable.has(el) && idMap.has(currentId)) {
      if (!el.hasAttribute(SVG_AUTHORED_ID_ATTR)) el.setAttribute(SVG_AUTHORED_ID_ATTR, currentId);
      const after = idMap.get(currentId)!;
      const aliases = readSvgReferenceAliases(el, SVG_REFERENCE_ALIASES_ATTR, false);
      aliases.push({
        name: ID_ATTR,
        localName: ID_ATTR,
        namespaceURI: null,
        before: currentId,
        after,
      });
      el.setAttribute(SVG_REFERENCE_ALIASES_ATTR, JSON.stringify(aliases));
      el.setAttribute(ID_ATTR, after);
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
 * function never sees. Maps include inherited references whose original target
 * was renamed elsewhere; scopes with local definitions keep their own mapping.
 *
 * `document` must be the ASSEMBLED document every scope root lives in: the
 * collision census covers the whole thing, including ids the top-level
 * document declares itself, since those collide with an inlined instance's
 * ids just as two instances collide with each other.
 */
export function namespaceCollidingSvgIds(
  document: SvgIdQueryable,
  scopes: readonly SvgIdScope[],
  finalizedIds?: Set<Element>,
): Map<string, string>[] {
  if (scopes.length === 0) return [];

  const census = buildIdCensus(document);

  const resolved = scopes.map(resolveScope);
  const newlyEligible = resolved.flatMap(({ renamable }) => [...renamable]);
  if (finalizedIds) {
    for (const scope of resolved) {
      for (const el of scope.renamable) if (finalizedIds.has(el)) scope.renamable.delete(el);
    }
  }
  const scopeIndexByRenamable = new Map<Element, number>();
  resolved.forEach(({ renamable }, index) => {
    for (const el of renamable) scopeIndexByRenamable.set(el, index);
  });

  const idMaps = planRenames(census, scopes, scopeIndexByRenamable);
  const documentTargets = documentReferenceTargets(census, idMaps, scopeIndexByRenamable);
  const referenceMaps = resolved.map((scope, index) => {
    const local = localReferenceBindings(
      scopes[index]!.referenceTarget === "document" ? [] : scope.elements,
    );
    const inherited = [...documentTargets].filter(([id]) => !local.ids.has(id));
    return new Map([...inherited, ...local.renamed, ...idMaps[index]!]);
  });
  referenceMaps.forEach((idMap, index) => {
    applyRenames(resolved[index]!, idMap);
  });
  for (const el of newlyEligible) finalizedIds?.add(el);
  return referenceMaps;
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
  references: readonly SvgReferenceAlias[] = [],
): string {
  if (!css || (idMap.size === 0 && references.length === 0)) return css;
  if (!css.includes("#") && !css.includes("[") && !css.toLowerCase().includes("url(")) return css;

  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    // Unparseable CSS is the caller's problem to report; leaving it untouched
    // is strictly better than dropping the whole stylesheet here.
    return css;
  }
  let mutated = false;
  const recordedIds = new Set(
    references.filter((alias) => alias.name === ID_ATTR).map((alias) => alias.before),
  );
  const ids = [...idMap]
    .filter(([id]) => !recordedIds.has(id))
    .map(([id, renamed]) => ({
      id,
      replacement: `:is(#${escapeCssIdentifier(id)}, #${escapeCssIdentifier(renamed)})`,
    }));
  root.walkRules((rule) => {
    const rewritten = rule.selectors.map((selector) =>
      rewriteSvgSelectors(selector, ids, references),
    );
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
