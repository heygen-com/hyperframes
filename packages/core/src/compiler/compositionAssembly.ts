/**
 * Composition assembly decisions — the questions both assembly paths answer.
 *
 * A composition is assembled twice in this repo: `compiler/inlineSubCompositions.ts`
 * assembles it for rendering (Node, linkedom, synchronous, emits strings) and
 * `runtime/compositionLoader.ts` assembles it for mounting (browser, fetch, live
 * DOM, executes scripts). Their I/O is genuinely different; their *decisions* are
 * not. This module owns the decisions:
 *
 * - which nodes are a composition's asset sources, and in what order
 * - which `<head>` elements hoist into the host document
 * - the composition's scope identity (CSS scope, script scope, authored root id)
 * - which nodes carry the composition's declared variable defaults
 * - how nested `data-composition-src` hosts are enumerated
 *
 * It is deliberately DOM-free, filesystem-free and network-free: the runtime is
 * bundled by esbuild into the IIFE published to a CDN, so anything reachable
 * from `runtime/entry.ts` ships to every viewer. It takes narrow structural
 * types instead of `Document`/`Element` for the same reason `compositionScoping.ts`
 * takes strings — so both a linkedom document and a live browser document
 * satisfy it without an `as T` cast at either call site.
 */

const COMPOSITION_ID_ATTR = "data-composition-id";
const COMPOSITION_SRC_ATTR = "data-composition-src";
const COMPOSITION_ROOT_SELECTOR = `[${COMPOSITION_ID_ATTR}]`;
const COMPOSITION_HOST_SELECTOR = `[${COMPOSITION_SRC_ATTR}]`;
const STYLE_SELECTOR = "style";
const SCRIPT_SELECTOR = "script";

/**
 * Links both paths hoist into the host document. Stylesheets carry
 * webfonts a composition's CSS depends on; preconnects are their latency hint.
 */
const HOISTED_LINK_SELECTOR = 'link[rel="stylesheet"], link[rel="preconnect"]';

// The HTML spec's JavaScript MIME type essence matches: a script with any of these types runs as classic.
const JAVASCRIPT_TYPES = new Set([
  "",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

const scriptType = (el: AssemblyAttributed) => (el.getAttribute("type") || "").trim().toLowerCase();

export function isJavaScriptType(el: AssemblyAttributed): boolean {
  return JAVASCRIPT_TYPES.has(scriptType(el));
}

/**
 * A data block (application/json, text/template, ...) or a classic nomodule script never runs,
 * so it is mounted as authored.
 */
function isExecutableScript(el: AssemblyAttributed): boolean {
  const type = scriptType(el);
  if (type === "module" || type === "importmap") return true;
  return JAVASCRIPT_TYPES.has(type) && el.getAttribute("nomodule") === null;
}

function inertScripts<TElement extends AssemblyAttributed>(
  node: AssemblyQueryable<TElement> | null | undefined,
): TElement[] {
  return toArray(node?.querySelectorAll(SCRIPT_SELECTOR)).filter((el) => !isExecutableScript(el));
}

export function executableScripts<TElement extends AssemblyAttributed>(
  node: AssemblyQueryable<TElement> | null | undefined,
): TElement[] {
  return toArray(node?.querySelectorAll(SCRIPT_SELECTOR)).filter(isExecutableScript);
}

/** The styles, scripts and links both paths extract, so the mounted copy must drop them. */
export function extractedCompositionAssets<TElement extends AssemblyAttributed>(
  node: AssemblyQueryable<TElement>,
): TElement[] {
  return [
    ...toArray(node.querySelectorAll(`${STYLE_SELECTOR}, ${HOISTED_LINK_SELECTOR}`)),
    ...executableScripts(node),
  ];
}

/**
 * The compiler's nesting cap, enforced against the ancestry chain rather than a
 * counter so a wide tree is not penalised for a deep sibling.
 */
export const MAX_SUB_COMPOSITION_DEPTH = 20;

// ---------------------------------------------------------------------------
// Structural inputs
// ---------------------------------------------------------------------------

/** An element this module only ever reads attributes from. */
export interface AssemblyAttributed {
  getAttribute(name: string): string | null;
}

/** A node this module only ever searches with a CSS selector. */
export interface AssemblyQueryable<TElement> {
  querySelectorAll(selectors: string): Iterable<TElement>;
}

export interface CompositionAssemblyInput<TElement extends AssemblyAttributed> {
  /**
   * The composition's content: a `<template>`'s content when the composition is
   * templated, the parsed document's `<body>` otherwise.
   *
   * Asset sources are collected from the WHOLE content node, never from the
   * composition root alone. The canonical authored shape puts `<style>`/`<script>`
   * as SIBLINGS of the root inside `<template>`; scanning only the root dropped a
   * composition's entire stylesheet on mount while its render stayed correct.
   */
  contentNode: AssemblyQueryable<TElement>;

  /**
   * The parsed document's `<head>`, when the composition was loaded as a full
   * HTML document. Omit it for an inline `<template>`, which has no head of its
   * own.
   */
  head?: AssemblyQueryable<TElement> | null;

  /**
   * The parsed document's `<html>` element, when there is one. It is the first
   * variable-default carrier; see `variableDefaultCarriers`.
   */
  documentElement?: TElement | null;

  /**
   * True when `contentNode` came from a `<template>`. A templated composition's
   * `<head>` styles and scripts are not part of the composition — the template
   * already carries everything it needs — so they are not collected.
   */
  hasTemplate: boolean;

  /**
   * The composition id the host asks this composition to mount as, or `null` for
   * an anonymous host.
   */
  compositionId: string | null;
}

export interface CompositionAssemblyPlan<TElement extends AssemblyAttributed> {
  /**
   * The composition root inside `contentNode`. Matched on an EXACT id when the
   * host names one — a template may intentionally use a different local id (a
   * `captions-comp` host mounting a `captions` template), and flattening that
   * fallback root changes the assembled DOM. Anonymous hosts fall back to the
   * first root in the content.
   */
  innerRoot: TElement | null;

  /**
   * The id CSS is scoped to: the host's id when it names one, otherwise the id
   * declared inside the content.
   */
  authoredCompositionId: string | null;

  /**
   * The id composition scripts are scoped to. It differs from
   * `authoredCompositionId` only when a host names an id that no root inside the
   * content declares: CSS stays on the host's id while scripts follow the id the
   * content actually declares, so a script's self-referencing
   * `querySelector('[data-composition-id="X"]')` still resolves.
   */
  scriptCompositionId: string | null;

  /** The `id` attribute authored on the composition root, if any. */
  authoredRootId: string | null;

  /** `<style>` sources in injection order: head-sourced first, then content. */
  styleSources: TElement[];

  /**
   * `<script>` sources in execution order: head-sourced first, then content. A
   * head script (a GSAP CDN tag in a non-templated composition) has to run
   * before the content scripts that call into it.
   */
  scriptSources: TElement[];

  /** Head and content links to hoist into the host document. */
  linkSources: TElement[];

  /** Inert scripts the mounted root would leave behind; both paths mount them next to it. */
  inertScriptsOutsideRoot: TElement[];

  /**
   * Nodes that may declare the composition's variable defaults, in precedence
   * order — later wins. Full-document compositions declare on `<html>`;
   * template/fragment compositions declare on the `[data-composition-id]` root
   * div, because they have no `<html>` of their own. Callers read the declared
   * defaults off each carrier and merge left to right.
   */
  variableDefaultCarriers: TElement[];
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function toArray<TElement>(items: Iterable<TElement> | null | undefined): TElement[] {
  return items ? Array.from(items) : [];
}

/**
 * Answer, for one composition, where its assets come from, in what order, and
 * how it is identified. Pure: it reads attributes and runs selectors, and does
 * not mutate, fetch, or touch a filesystem.
 */
export function planCompositionAssembly<
  TElement extends AssemblyAttributed & AssemblyQueryable<TElement>,
>(input: CompositionAssemblyInput<TElement>): CompositionAssemblyPlan<TElement> {
  const { contentNode, head, documentElement, hasTemplate, compositionId } = input;

  const compositionRoots = toArray(contentNode.querySelectorAll(COMPOSITION_ROOT_SELECTOR));
  const innerRoot = compositionId
    ? (compositionRoots.find((root) => root.getAttribute(COMPOSITION_ID_ATTR) === compositionId) ??
      null)
    : (compositionRoots[0] ?? null);

  // The id declared inside the content, even when the host asked for a
  // different one. `innerRoot` is preferred so an exact match always wins.
  const declaredCompositionId =
    (innerRoot ?? compositionRoots[0])?.getAttribute(COMPOSITION_ID_ATTR)?.trim() || "";

  // A templated composition's <head> belongs to its host page, not to it.
  const assetHead = hasTemplate ? null : (head ?? null);
  const mountedInert = innerRoot ? inertScripts(innerRoot) : [];

  return {
    innerRoot,
    authoredCompositionId: compositionId || declaredCompositionId || null,
    scriptCompositionId: declaredCompositionId || compositionId || null,
    authoredRootId: innerRoot?.getAttribute("id")?.trim() || null,
    styleSources: [
      ...toArray(assetHead?.querySelectorAll(STYLE_SELECTOR)),
      ...toArray(contentNode.querySelectorAll(STYLE_SELECTOR)),
    ],
    scriptSources: [...executableScripts(assetHead), ...executableScripts(contentNode)],
    linkSources: [
      ...toArray(head?.querySelectorAll(HOISTED_LINK_SELECTOR)),
      ...toArray(contentNode.querySelectorAll(HOISTED_LINK_SELECTOR)),
    ],
    inertScriptsOutsideRoot: [
      ...inertScripts(assetHead),
      ...(innerRoot ? inertScripts(contentNode).filter((el) => !mountedInert.includes(el)) : []),
    ],
    variableDefaultCarriers: [documentElement, innerRoot].filter(
      (carrier): carrier is TElement => carrier != null,
    ),
  };
}

// ---------------------------------------------------------------------------
// Nested hosts
// ---------------------------------------------------------------------------

export type NestedHostSkipReason = "circular composition reference" | "nesting depth exceeded";

/** One file, however its src is spelled: resolved from the project root, without query or hash. */
function compositionSourceKey(src: string): string {
  try {
    const url = new URL(src, "https://project.invalid/");
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return src;
  }
}

export function nestedCompositionRefusal(
  src: string,
  ancestry: readonly string[],
): NestedHostSkipReason | null {
  const key = compositionSourceKey(src);
  if (ancestry.some((entry) => compositionSourceKey(entry) === key))
    return "circular composition reference";
  if (ancestry.length >= MAX_SUB_COMPOSITION_DEPTH) return "nesting depth exceeded";
  return null;
}

export interface NestedCompositionHost<TElement> {
  host: TElement;
  src: string;
}

export interface NestedCompositionHosts<TElement> {
  hosts: NestedCompositionHost<TElement>[];
  skipped: { src: string; reason: NestedHostSkipReason }[];
}

/**
 * Enumerate the sub-composition hosts nested inside a composition that has just
 * been assembled, refusing the two shapes that do not terminate.
 *
 * `ancestry` is the chain down to and including the assembled composition's own
 * `src`, so a top-level host is enumerated with `[itsOwnSrc]`.
 */
export function enumerateNestedCompositionHosts<TElement extends AssemblyAttributed>(
  assembledHost: AssemblyQueryable<TElement>,
  ancestry: readonly string[],
): NestedCompositionHosts<TElement> {
  const hosts: NestedCompositionHost<TElement>[] = [];
  const skipped: { src: string; reason: NestedHostSkipReason }[] = [];

  for (const nestedHost of assembledHost.querySelectorAll(COMPOSITION_HOST_SELECTOR)) {
    const src = nestedHost.getAttribute(COMPOSITION_SRC_ATTR);
    if (!src) continue;
    const reason = nestedCompositionRefusal(src, ancestry);
    if (reason) {
      skipped.push({ src, reason });
      continue;
    }
    hosts.push({ host: nestedHost, src });
  }

  return { hosts, skipped };
}
