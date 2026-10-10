import {
  SVG_REFERENCE_ALIASES_ATTR,
  readSvgReferenceAliases,
  refreshSvgSelectorAliases,
} from "../compiler/svgSelectorAliases";
import {
  planCompositionAssembly,
  extractedCompositionAssets,
} from "../compiler/compositionAssembly";
import {
  scopeCssToComposition,
  scopedModulePrelude,
  wrapScopedCompositionScript,
} from "../compiler/compositionScoping";
import { parseImportMap } from "../compiler/importMaps";
import { hasSameLink } from "../compiler/scriptRuns";
import {
  namespaceCollidingSvgIds,
  rewriteSvgIdReferencesInCss,
} from "../compiler/svgIdNamespacing";
import { waitForFonts } from "./afterFonts";
import { parseLayoutDimension } from "./compositionDimension";
import { markFlattenedInnerRoot } from "./flattenedRoot";
import {
  applyCssVariables,
  clearAppliedCssVariables,
  filterVariablesIfAbsent,
  parseHostVariableValues,
  readDeclaredDefaults,
  warnUnknownEnumValues,
  readRenderOverrides,
} from "./getVariables";
import { isElementNode, isHtmlElement, isLinkElement, isStyleElement } from "./domRealm";

type LoadCompositionsParams = {
  injectedStyles: HTMLStyleElement[];
  injectedScripts: HTMLScriptElement[];
  injectedLinks: HTMLLinkElement[];
  parseDimensionPx: (value: string | null) => string | null;
  onDiagnostic?: (payload: {
    code: string;
    details: Record<string, string | number | boolean | null | string[]>;
  }) => void;
};

type MountedSvgScope = {
  host: Element;
  namespace: string;
  styles: Array<{ element: HTMLStyleElement; authored: string; applied: string }>;
  referenceTarget?: "document";
};

type MountedComposition = MountedSvgScope & {
  isCurrent: () => boolean;
  runScripts: () => Promise<void>;
};

type PendingScript =
  | {
      kind: "inline";
      content: string;
      type: string;
      scopeCompositionId: string | null;
    }
  | {
      kind: "external";
      src: string;
      type: string;
    };

const EXTERNAL_SCRIPT_LOAD_TIMEOUT_MS = 8000;
const BARE_RELATIVE_PATH_RE = /^(?![a-zA-Z][a-zA-Z\d+\-.]*:)(?!\/\/)(?!\/)(?!\.\.?\/).+/;
const CSS_URL_RE = /\burl\(\s*(["']?)([^)"']+)\1\s*\)/g;
const PATH_ATTRS = ["src", "href"] as const;

/**
 * Return true for URLs/prefixes that should never be rewritten — absolute
 * URLs, protocol-relative, data:, hash fragments, root-relative. Mirrors
 * the compiler's `isNonRelativeUrl` so server-side bundling and client-side
 * runtime rewrite use the same rules.
 */
function isNonRelativeRuntimeUrl(value: string): boolean {
  return (
    !value ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("//") ||
    value.startsWith("data:") ||
    value.startsWith("#") ||
    value.startsWith("/")
  );
}

/**
 * Resolve a relative asset path from a sub-composition's URL to one that
 * works in the live document.
 *
 * Server-side `inlineSubCompositions` rewrites `../foo.svg` from
 * `compositions/scene.html` to `foo.svg` (project root). When the runtime
 * mounts a sub-composition by fetching its HTML and importing its nodes
 * into the main document, no such rewriting happens — so a `<video
 * src="../../assets/x.mp4">` authored from `compositions/frames/*.html`
 * resolves against the main document's base, climbing **above** the
 * project root (e.g. `/api/projects/assets/x.mp4`) and 404s. This is the
 * Studio-preview-vs-render divergence noted in the bug report.
 *
 * For each path that traverses up with `../`, resolve against the
 * sub-composition's URL and return an absolute URL the browser can use
 * directly. Plain relative paths (`assets/x.mp4`) and absolute / special
 * URLs are returned unchanged — they already resolve correctly via the
 * main document's base.
 */
function rewriteRuntimeAssetPath(value: string, compositionUrl: URL | null): string {
  if (!compositionUrl) return value;
  const trimmed = value.trim();
  if (isNonRelativeRuntimeUrl(trimmed)) return value;
  if (!trimmed.startsWith("../") && trimmed !== "..") return value;
  try {
    return new URL(trimmed, compositionUrl).href;
  } catch {
    return value;
  }
}

function rewriteRuntimeCssAssetUrls(cssText: string, compositionUrl: URL | null): string {
  if (!compositionUrl || !cssText) return cssText;
  return cssText.replace(CSS_URL_RE, (full, quote: string, rawUrl: string) => {
    const rewritten = rewriteRuntimeAssetPath(rawUrl || "", compositionUrl);
    if (rewritten === rawUrl) return full;
    return `url(${quote || ""}${rewritten}${quote || ""})`;
  });
}

function rewritePathAttrsInTree(root: ParentNode, compositionUrl: URL): void {
  for (const el of Array.from(root.querySelectorAll<Element>("[src], [href]"))) {
    for (const attr of PATH_ATTRS) {
      const value = el.getAttribute(attr);
      if (value == null) continue;
      const rewritten = rewriteRuntimeAssetPath(value, compositionUrl);
      if (rewritten !== value) el.setAttribute(attr, rewritten);
    }
  }
}

function rewriteInlineStyleUrlsInTree(root: ParentNode, compositionUrl: URL): void {
  for (const el of Array.from(root.querySelectorAll<Element>("[style]"))) {
    const value = el.getAttribute("style");
    if (value == null) continue;
    const rewritten = rewriteRuntimeCssAssetUrls(value, compositionUrl);
    if (rewritten !== value) el.setAttribute("style", rewritten);
  }
}

function rewriteStyleElementUrlsInTree(root: ParentNode, compositionUrl: URL): void {
  for (const styleEl of Array.from(root.querySelectorAll<HTMLStyleElement>("style"))) {
    const text = styleEl.textContent || "";
    const rewritten = rewriteRuntimeCssAssetUrls(text, compositionUrl);
    if (rewritten !== text) styleEl.textContent = rewritten;
  }
}

/**
 * Rewrite relative asset paths in a parsed sub-composition document so
 * that `../`-traversing paths resolve against the sub-composition's URL
 * rather than the main document's base. Touches `[src]`, `[href]`,
 * `[style]` url(...) references, and `<style>` element CSS — the same
 * surface the server-side `inlineSubCompositions` rewrites.
 *
 * Recurses into `<template>` content because authored compositions wrap
 * their rendered body in a `<template>` and querySelectorAll does not
 * enter template content (it lives in a detached DocumentFragment).
 * Without recursion, the rewrite would miss every `<video>` and
 * `<img>` that an author placed inside the canonical template wrapper.
 */
function rewriteSubCompositionAssetPaths(root: ParentNode, compositionUrl: URL | null): void {
  if (!compositionUrl) return;
  rewritePathAttrsInTree(root, compositionUrl);
  rewriteInlineStyleUrlsInTree(root, compositionUrl);
  rewriteStyleElementUrlsInTree(root, compositionUrl);
  for (const templateEl of Array.from(root.querySelectorAll<HTMLTemplateElement>("template"))) {
    rewriteSubCompositionAssetPaths(templateEl.content, compositionUrl);
  }
}

function uniqueCompositionId(baseId: string, index: number): string {
  return `${baseId}__hf${index}`;
}

const waitForExternalScriptLoad = (
  scriptEl: HTMLScriptElement,
): Promise<{ status: "load" | "error" | "timeout"; elapsedMs: number }> =>
  new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    let timeoutId: number | null = null;
    const settle = (status: "load" | "error" | "timeout") => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      resolve({
        status,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    };
    scriptEl.addEventListener("load", () => settle("load"), { once: true });
    scriptEl.addEventListener("error", () => settle("error"), { once: true });
    timeoutId = window.setTimeout(() => settle("timeout"), EXTERNAL_SCRIPT_LOAD_TIMEOUT_MS);
  });

function resetCompositionHost(host: Element) {
  while (host.firstChild) {
    host.removeChild(host.firstChild);
  }
  host.textContent = "";
}

/**
 * A composition's `<style>`/`<script>` are extracted and re-injected into the
 * host document (scoped), so strip them from the copy that gets mounted —
 * otherwise the mount re-declares the same CSS unscoped and re-runs the script.
 *
 * Strips the CLONE, never the source: `sourceNode` is a live `<template>` on the
 * inline-template path, and mutating it would leave a remount with no styles.
 */
function stripExtractedCompositionAssets(node: ParentNode): void {
  for (const el of extractedCompositionAssets(node)) {
    el.remove();
  }
}

function prepareFlattenedInnerRoot(innerRoot: HTMLElement): HTMLElement {
  const prepared = document.importNode(innerRoot, true) as HTMLElement;
  markFlattenedInnerRoot(prepared);
  const w = parseLayoutDimension(prepared.getAttribute("data-width"));
  const h = parseLayoutDimension(prepared.getAttribute("data-height"));
  prepared.style.width = w === null ? "100%" : `${w}px`;
  prepared.style.height = h === null ? "100%" : `${h}px`;
  return prepared;
}

function resolveScriptSourceUrl(scriptSrc: string, compositionUrl: URL | null): string {
  const trimmedSrc = scriptSrc.trim();
  if (!trimmedSrc) return scriptSrc;
  try {
    if (
      BARE_RELATIVE_PATH_RE.test(trimmedSrc) &&
      !trimmedSrc.startsWith("#") &&
      !trimmedSrc.startsWith("?")
    ) {
      // Composition payloads may use root-relative semantics without a leading slash.
      return new URL(trimmedSrc, document.baseURI).toString();
    }
    if (compositionUrl) {
      return new URL(trimmedSrc, compositionUrl).toString();
    }
    return new URL(trimmedSrc, document.baseURI).toString();
  } catch {
    return scriptSrc;
  }
}

function isSameDocumentUrl(candidate: string | URL, compositionUrl: URL): boolean {
  try {
    const candidateDocumentUrl = new URL(candidate);
    const compositionDocumentUrl = new URL(compositionUrl);
    candidateDocumentUrl.search = "";
    candidateDocumentUrl.hash = "";
    compositionDocumentUrl.search = "";
    compositionDocumentUrl.hash = "";
    return candidateDocumentUrl.href === compositionDocumentUrl.href;
  } catch {
    // Invalid authored URLs are not self-references. Preserve the existing
    // browser-load path so its failure remains isolated to the script itself.
    return false;
  }
}

type HostCompositionIdentity = {
  authoredCompositionId: string | null;
  runtimeCompositionId: string | null;
};

function getHostCompositionIdentity(host: Element): HostCompositionIdentity {
  const currentCompositionId = (host.getAttribute("data-composition-id") || "").trim() || null;
  const authoredCompositionId =
    (host.getAttribute("data-hf-original-composition-id") || currentCompositionId || "").trim() ||
    null;
  return {
    authoredCompositionId,
    runtimeCompositionId: currentCompositionId,
  };
}

function countAuthoredCompositionIds(hosts: Element[]): Map<string, number> {
  const hostCountsByCompositionId = new Map<string, number>();
  for (const host of hosts) {
    const compId = getHostCompositionIdentity(host).authoredCompositionId || "";
    if (!compId) continue;
    hostCountsByCompositionId.set(compId, (hostCountsByCompositionId.get(compId) || 0) + 1);
  }
  return hostCountsByCompositionId;
}

function hasMatchingInlineTemplate(host: Element): boolean {
  const authoredCompositionId = getHostCompositionIdentity(host).authoredCompositionId;
  if (!authoredCompositionId) return false;
  return !!document.querySelector(`template#${CSS.escape(authoredCompositionId)}-template`);
}

function isMountedInlineCompositionHost(host: Element): boolean {
  return !!host.querySelector('[data-hf-inner-root="true"]');
}

function shouldAssignRuntimeCompositionId(host: Element): boolean {
  if (host.hasAttribute("data-composition-src")) return true;
  if (!hasMatchingInlineTemplate(host)) return false;
  if (host.children.length === 0) return true;
  if (host.hasAttribute("data-hf-original-composition-id")) return true;
  return isMountedInlineCompositionHost(host);
}

function getTrackedCompositionHosts(): Element[] {
  const hosts = Array.from(
    document.querySelectorAll<Element>("[data-composition-src], [data-composition-id]"),
  );
  return hosts.filter((host) => {
    if (host.hasAttribute("data-composition-src")) return true;
    return hasMatchingInlineTemplate(host);
  });
}

function cleanupDetachedScopedVariables() {
  const byComp = window.__hfVariablesByComp;
  if (!byComp) return;

  const activeRuntimeCompositionIds = new Set(
    getTrackedCompositionHosts()
      .map((host) => getHostCompositionIdentity(host).runtimeCompositionId)
      .filter((compositionId): compositionId is string => !!compositionId),
  );

  for (const runtimeCompositionId of Object.keys(byComp)) {
    if (!activeRuntimeCompositionIds.has(runtimeCompositionId)) {
      delete byComp[runtimeCompositionId];
    }
  }
}

function assignRuntimeCompositionIds(
  hosts: Element[],
  mountedHosts: ReadonlySet<Element>,
): Map<Element, HostCompositionIdentity> {
  const hostCountsByCompositionId = countAuthoredCompositionIds(hosts);
  const reserved = new Set(
    hosts.flatMap((host) => {
      const identity = getHostCompositionIdentity(host);
      const ids = identity.authoredCompositionId ? [identity.authoredCompositionId] : [];
      if (
        (mountedHosts.has(host) || !shouldAssignRuntimeCompositionId(host)) &&
        identity.runtimeCompositionId
      )
        ids.push(identity.runtimeCompositionId);
      return ids;
    }),
  );
  const hostInstanceByCompositionId = new Map<string, number>();
  const hostIdentityByElement = new Map<Element, HostCompositionIdentity>();

  for (const host of hosts) {
    const { authoredCompositionId, runtimeCompositionId: previousRuntimeCompositionId } =
      getHostCompositionIdentity(host);
    const shouldAssign = !mountedHosts.has(host) && shouldAssignRuntimeCompositionId(host);
    if (!authoredCompositionId) {
      hostIdentityByElement.set(host, {
        authoredCompositionId: null,
        runtimeCompositionId: previousRuntimeCompositionId,
      });
      continue;
    }

    const duplicateInstance = (hostCountsByCompositionId.get(authoredCompositionId) || 0) > 1;
    let runtimeCompositionId = previousRuntimeCompositionId || authoredCompositionId;
    if (shouldAssign) {
      let instanceIndex = duplicateInstance
        ? (hostInstanceByCompositionId.get(authoredCompositionId) || 0) + 1
        : 0;
      if (duplicateInstance) {
        while (reserved.has(uniqueCompositionId(authoredCompositionId, instanceIndex)))
          instanceIndex += 1;
        hostInstanceByCompositionId.set(authoredCompositionId, instanceIndex);
      }
      runtimeCompositionId = duplicateInstance
        ? uniqueCompositionId(authoredCompositionId, instanceIndex)
        : authoredCompositionId;
      reserved.add(runtimeCompositionId);

      if (duplicateInstance) {
        host.setAttribute("data-hf-original-composition-id", authoredCompositionId);
      } else {
        host.removeAttribute("data-hf-original-composition-id");
      }
      host.setAttribute("data-composition-id", runtimeCompositionId);
    }

    hostIdentityByElement.set(host, {
      authoredCompositionId,
      runtimeCompositionId,
    });
  }

  cleanupDetachedScopedVariables();
  return hostIdentityByElement;
}

async function mountCompositionContent(params: {
  host: Element;
  authoredCompositionId: string | null;
  runtimeCompositionId: string | null;
  hostCompositionSrc: string;
  sourceNode: ParentNode;
  hasTemplate: boolean;
  fallbackBodyInnerHtml: string;
  compositionUrl: URL | null;
  injectedStyles: HTMLStyleElement[];
  injectedScripts: HTMLScriptElement[];
  injectedLinks: HTMLLinkElement[];
  parseDimensionPx: (value: string | null) => string | null;
  /**
   * The parsed document's `<head>`, when the composition was loaded as a full
   * HTML document. What comes out of it is the shared assembly module's call:
   * styles and scripts only for a non-templated composition, links always.
   */
  head?: ParentNode | null;
  /**
   * Defaults extracted from the sub-composition's own
   * `<html data-composition-variables="...">` attribute. Layered under the
   * host element's `data-variable-values` to produce the per-instance
   * variables visible inside the sub-comp's scoped `getVariables()`.
   * Populated only by `loadCompositions`; inline templates have no
   * separate document root so no declared defaults are passed.
   */
  declaredVariableDefaults?: Record<string, unknown>;
  /**
   * The element `declaredVariableDefaults` was read from. Carries the full
   * declaration (option sets, not just defaults) so the out-of-set enum guard
   * can run on the same merge. Same population rule as the defaults above.
   */
  variableDeclarer?: Element;
  onDiagnostic?: (payload: {
    code: string;
    details: Record<string, string | number | boolean | null | string[]>;
  }) => void;
}): Promise<MountedComposition> {
  // Which node is the composition root, which id its CSS scopes to, which id
  // its scripts scope to, where its assets come from and in what order: the
  // shared assembly module answers all of it, so this path and the compiler's
  // inlineSubCompositions agree by construction. Notably, an ANONYMOUS host
  // (one naming no composition id) now falls back to the first root declared
  // in the content and mounts scoped to it — mounting the content whole left
  // its CSS unscoped and leaking into the host document.
  const plan = planCompositionAssembly<Element>({
    contentNode: params.sourceNode,
    head: params.head,
    hasTemplate: params.hasTemplate,
    compositionId: params.authoredCompositionId,
  });
  // The mount sizes and flattens the root, which needs an HTMLElement; a root
  // that is not one mounts as plain content, exactly as before.
  const innerRoot = isHtmlElement(plan.innerRoot) ? plan.innerRoot : null;
  const contentNode = innerRoot ?? params.sourceNode;
  const authoredScopeCompositionId = plan.authoredCompositionId;
  // Scripts follow the id the CONTENT declares, CSS the id the HOST asked for.
  // They differ only when a host names an id no root in the content declares,
  // where collapsing them breaks a script's own
  // `querySelector('[data-composition-id="..."]')`.
  const scriptScopeCompositionId = plan.scriptCompositionId;
  // No fallback to the authored id: an anonymous host has no runtime id, and
  // the compiler emits no runtime scope selector and no variable table for one.
  const runtimeScopeCompositionId = params.runtimeCompositionId || null;
  const authoredRootId = plan.authoredRootId;
  const runtimeScopeSelector = runtimeScopeCompositionId
    ? `[data-composition-id="${CSS.escape(runtimeScopeCompositionId)}"]`
    : undefined;

  for (const link of plan.linkSources) {
    const rawHref = (link.getAttribute("href") || "").trim();
    if (!rawHref) continue;
    const href = params.compositionUrl ? new URL(rawHref, params.compositionUrl).href : rawHref;
    if (params.compositionUrl && isSameDocumentUrl(href, params.compositionUrl)) continue;
    const clonedLink = link.cloneNode(true);
    if (!isLinkElement(clonedLink)) continue;
    clonedLink.href = href;
    if (hasSameLink(document.head, clonedLink)) continue;
    document.head.appendChild(clonedLink);
    params.injectedLinks.push(clonedLink);
  }

  const styles: MountedComposition["styles"] = [];
  const injectScopedStyles = (styleEls: Iterable<Element>): void => {
    for (const style of styleEls) {
      const clonedStyle = style.cloneNode(true);
      if (!isStyleElement(clonedStyle)) continue;
      if (authoredScopeCompositionId) {
        clonedStyle.textContent = scopeCssToComposition(
          clonedStyle.textContent || "",
          authoredScopeCompositionId,
          runtimeScopeSelector,
          authoredRootId,
          // Sub-comp styles are injected into the PARENT preview document, so
          // remap html/body/:root to the composition box — otherwise a sub-comp
          // `body { width/height/overflow }` clobbers the host body and clips
          // the preview to the last-mounted sub-comp's size.
          { scopeRootSelectors: true },
        );
      }
      document.head.appendChild(clonedStyle);
      params.injectedStyles.push(clonedStyle);
      const authored = clonedStyle.textContent || "";
      styles.push({ element: clonedStyle, authored, applied: authored });
    }
  };
  // Already in injection order: <head> styles from a non-template composition
  // first (they define backgrounds and positioning the composition needs), then
  // the content's — including the ones authored as SIBLINGS of the composition
  // root, the shape whose omission dropped a mounted composition's stylesheet.
  injectScopedStyles(plan.styleSources);

  const toPendingScript = (script: Element): PendingScript | null => {
    const type = script.getAttribute("type")?.trim() ?? "";
    const src = script.getAttribute("src")?.trim() ?? "";
    if (src) {
      const resolvedSrc = resolveScriptSourceUrl(src, params.compositionUrl);
      // A sub-comp that <script src>s itself would re-enter the mount; skip it.
      if (params.compositionUrl && isSameDocumentUrl(resolvedSrc, params.compositionUrl)) {
        return null;
      }
      return { kind: "external", src: resolvedSrc, type };
    }
    const content = script.textContent?.trim() ?? "";
    if (!content) return null;
    return { kind: "inline", content, type, scopeCompositionId: scriptScopeCompositionId };
  };

  // Already in execution order: <head> scripts first (a GSAP CDN tag in a
  // non-template sub-comp) so they run before the content scripts calling in.
  const scriptPayloads = plan.scriptSources
    .map(toPendingScript)
    .filter((payload): payload is PendingScript => payload !== null);

  if (innerRoot) {
    const widthRaw = innerRoot.getAttribute("data-width");
    const heightRaw = innerRoot.getAttribute("data-height");
    const widthPx = params.parseDimensionPx(widthRaw);
    const heightPx = params.parseDimensionPx(heightRaw);
    if (widthRaw) params.host.setAttribute("data-width", widthRaw);
    if (heightRaw) params.host.setAttribute("data-height", heightRaw);
    if (widthPx && isHtmlElement(params.host)) params.host.style.width = widthPx;
    if (heightPx && isHtmlElement(params.host)) params.host.style.height = heightPx;
    if (innerRoot.hasAttribute("data-timeline-locked")) {
      params.host.setAttribute("data-timeline-locked", "");
    }
    const flattenedRoot = prepareFlattenedInnerRoot(innerRoot);
    if (!params.authoredCompositionId && authoredScopeCompositionId) {
      // Flattening strips data-composition-id on the assumption the host
      // carries the composition's identity. An anonymous host does not, so
      // restore it or nothing in the mounted DOM matches the composition's own
      // scoped CSS. Mirrors the identical restore in inlineSubCompositions.
      flattenedRoot.setAttribute("data-composition-id", authoredScopeCompositionId);
    }
    stripExtractedCompositionAssets(flattenedRoot);
    params.host.appendChild(flattenedRoot);
  } else if (params.hasTemplate) {
    const mountedContent = document.importNode(contentNode, true);
    stripExtractedCompositionAssets(mountedContent);
    params.host.appendChild(mountedContent);
  } else {
    params.host.innerHTML = params.fallbackBodyInnerHtml;
    stripExtractedCompositionAssets(params.host);
  }
  for (const el of plan.inertScriptsOutsideRoot)
    params.host.appendChild(document.importNode(el, true));

  // Stash the per-instance variables BEFORE running scripts. The scoped
  // `getVariables()` injected by `compositionScoping.ts` reads from
  // `window.__hfVariablesByComp[compId]`, so this table must be populated
  // before the wrapped IIFE evaluates.
  if (runtimeScopeCompositionId) {
    stashInstanceVariables(params, contentNode, runtimeScopeCompositionId);
  }

  const mountedNodes = Array.from(params.host.childNodes);
  const isCurrent = () =>
    params.host.isConnected &&
    (mountedNodes.length > 0 || params.host.childNodes.length === 0) &&
    mountedNodes.every((node) => node.parentNode === params.host);
  return {
    host: params.host,
    namespace: runtimeScopeCompositionId || authoredScopeCompositionId || "",
    styles,
    isCurrent,
    runScripts: async () => {
      if (scriptPayloads.length > 0) await waitForFonts();
      if (!isCurrent()) return;
      for (const scriptPayload of scriptPayloads) {
        const injectedScript = document.createElement("script");
        if (scriptPayload.type) {
          injectedScript.type = scriptPayload.type;
        }
        // Preserve deterministic script execution order across injected composition scripts.
        injectedScript.async = false;
        if (scriptPayload.kind === "external") {
          injectedScript.src = scriptPayload.src;
        } else if (scriptPayload.type.toLowerCase() === "importmap") {
          const map = parseImportMap(scriptPayload.content, (url) =>
            resolveScriptSourceUrl(url, params.compositionUrl),
          );
          injectedScript.textContent = map ? JSON.stringify(map) : scriptPayload.content;
        } else if (scriptPayload.type.toLowerCase() === "module") {
          const prelude = scriptPayload.scopeCompositionId
            ? scopedModulePrelude(
                runtimeScopeCompositionId || scriptPayload.scopeCompositionId,
                params.compositionUrl?.href,
              )
            : "";
          injectedScript.textContent = prelude + scriptPayload.content;
        } else if (scriptPayload.scopeCompositionId) {
          injectedScript.textContent = wrapScopedCompositionScript(
            scriptPayload.content,
            scriptPayload.scopeCompositionId,
            "[HyperFrames] composition script error:",
            runtimeScopeSelector,
            runtimeScopeCompositionId || scriptPayload.scopeCompositionId,
            authoredRootId,
            params.compositionUrl?.href,
          );
        } else {
          injectedScript.textContent = `(function(){${scriptPayload.content}})();`;
        }
        document.body.appendChild(injectedScript);
        params.injectedScripts.push(injectedScript);
        if (scriptPayload.kind === "external") {
          const loadResult = await waitForExternalScriptLoad(injectedScript);
          if (loadResult.status !== "load") {
            params.onDiagnostic?.({
              code: "external_composition_script_load_issue",
              details: {
                hostCompositionId: params.authoredCompositionId,
                runtimeCompositionId: params.runtimeCompositionId,
                hostCompositionSrc: params.hostCompositionSrc,
                resolvedScriptSrc: scriptPayload.src,
                loadStatus: loadResult.status,
                elapsedMs: loadResult.elapsedMs,
              },
            });
          }
        }
      }
    },
  };
}

async function mountInlineTemplateCompositions(
  params: LoadCompositionsParams,
  mountedHosts: ReadonlySet<Element>,
): Promise<MountedComposition[]> {
  const trackedHosts = getTrackedCompositionHosts();
  cleanupDetachedScopedVariables();
  if (trackedHosts.length === 0) return [];
  const hostIdentityByElement = assignRuntimeCompositionIds(trackedHosts, mountedHosts);
  const hosts = trackedHosts.filter((host) => {
    if (mountedHosts.has(host)) return false;
    if (host.hasAttribute("data-composition-src")) return false;
    if (host.children.length > 0) return false;
    const compId = hostIdentityByElement.get(host)?.authoredCompositionId;
    if (!compId) return false;
    return !!document.querySelector(`template#${CSS.escape(compId)}-template`);
  });

  const mounted: MountedComposition[] = [];
  for (const host of hosts) {
    const hostIdentity = hostIdentityByElement.get(host);
    const compId = hostIdentity?.authoredCompositionId;
    if (!compId) continue;
    const template = document.querySelector<HTMLTemplateElement>(
      `template#${CSS.escape(compId)}-template`,
    )!;

    resetCompositionHost(host);
    const composition = await mountCompositionContent({
      host,
      authoredCompositionId: compId,
      runtimeCompositionId: hostIdentity?.runtimeCompositionId || compId,
      hostCompositionSrc: `template#${compId}-template`,
      sourceNode: template.content,
      hasTemplate: true,
      fallbackBodyInnerHtml: "",
      compositionUrl: null,
      injectedStyles: params.injectedStyles,
      injectedScripts: params.injectedScripts,
      injectedLinks: params.injectedLinks,
      parseDimensionPx: params.parseDimensionPx,
      onDiagnostic: params.onDiagnostic,
    });
    mounted.push(composition);
  }
  return mounted;
}

async function mountExternalCompositions(
  params: LoadCompositionsParams,
): Promise<MountedComposition[]> {
  const trackedHosts = getTrackedCompositionHosts();
  cleanupDetachedScopedVariables();
  if (trackedHosts.length === 0) return [];
  const hostIdentityByElement = assignRuntimeCompositionIds(trackedHosts, new Set());
  const hosts = trackedHosts.filter((host) => host.hasAttribute("data-composition-src"));

  const mounted = await Promise.all(
    hosts.map(async (host): Promise<MountedComposition | null> => {
      const src = host.getAttribute("data-composition-src");
      if (!src) return null;
      const hostIdentity = hostIdentityByElement.get(host);
      const authoredCompositionId = hostIdentity?.authoredCompositionId || null;
      const runtimeCompositionId =
        hostIdentity?.runtimeCompositionId || authoredCompositionId || null;
      let compositionUrl: URL | null = null;
      try {
        compositionUrl = new URL(src, document.baseURI);
      } catch {
        compositionUrl = null;
      }
      resetCompositionHost(host);
      const failed = (error: unknown) => {
        params.onDiagnostic?.({
          code: "external_composition_load_failed",
          details: {
            hostCompositionId: authoredCompositionId,
            runtimeCompositionId,
            hostCompositionSrc: src,
            errorMessage: error instanceof Error ? error.message : "unknown_error",
          },
        });
        // Keep host empty on load failures to avoid rendering escaped fallback HTML.
        resetCompositionHost(host);
      };
      const mount = async (mountParams: Parameters<typeof mountCompositionContent>[0]) => {
        const composition = await mountCompositionContent(mountParams);
        const runScripts = composition.runScripts;
        composition.runScripts = async () => {
          try {
            await runScripts();
          } catch (error) {
            failed(error);
          }
        };
        return composition;
      };
      try {
        const localTemplate =
          authoredCompositionId != null
            ? document.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(authoredCompositionId)}-template`,
              )
            : null;
        if (localTemplate) {
          return await mount({
            host,
            authoredCompositionId,
            runtimeCompositionId,
            hostCompositionSrc: src,
            sourceNode: localTemplate.content,
            hasTemplate: true,
            fallbackBodyInnerHtml: "",
            compositionUrl,
            injectedStyles: params.injectedStyles,
            injectedScripts: params.injectedScripts,
            injectedLinks: params.injectedLinks,
            parseDimensionPx: params.parseDimensionPx,
            onDiagnostic: params.onDiagnostic,
          });
        }
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        // Resolve parent-relative assets against the fetched composition before mounting.
        rewriteSubCompositionAssetPaths(doc, compositionUrl);
        const template =
          (authoredCompositionId
            ? doc.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(authoredCompositionId)}-template`,
              )
            : null) ?? doc.querySelector<HTMLTemplateElement>("template");
        const sourceNode = template ? template.content : doc.body;
        return await mount({
          host,
          authoredCompositionId,
          runtimeCompositionId,
          hostCompositionSrc: src,
          sourceNode,
          hasTemplate: Boolean(template),
          fallbackBodyInnerHtml: doc.body.innerHTML,
          compositionUrl,
          injectedStyles: params.injectedStyles,
          injectedScripts: params.injectedScripts,
          injectedLinks: params.injectedLinks,
          parseDimensionPx: params.parseDimensionPx,
          // A non-templated composition's <head> carries critical CSS
          // (backgrounds, positioning, fonts) and library scripts; every
          // composition's <head> can carry a webfont <link>. The shared
          // assembly module decides which of those apply.
          head: doc.head,
          // TODO(template-var-carriers): reads `<html>` only. A template/fragment
          // sub-comp that declares on its `[data-composition-id]` root div (the
          // dual-carrier contract from #2081) loses its defaults on this lazy
          // external-load path — see inlineSubCompositions for the fixed path.
          declaredVariableDefaults: readDeclaredDefaults(doc.documentElement),
          variableDeclarer: doc.documentElement,
          onDiagnostic: params.onDiagnostic,
        });
      } catch (error) {
        failed(error);
        return null;
      }
    }),
  );
  return mounted.filter((composition): composition is MountedComposition => composition !== null);
}

/** Finalize authored DOM before scripts observe ids, then retain script-created inline discovery. */
export async function loadCompositions(params: LoadCompositionsParams): Promise<void> {
  const finalizedIds = new Set<Element>();
  const rootScope: MountedSvgScope = {
    host: document.documentElement,
    namespace: "",
    referenceTarget: "document",
    styles: [...document.querySelectorAll("style")].map((element) => ({
      element,
      authored: element.textContent ?? "",
      applied: element.textContent ?? "",
    })),
  };
  const external = await mountExternalCompositions(params);
  const inline = await mountInlineTemplateCompositions(
    params,
    new Set(external.map(({ host }) => host)),
  );
  const initial = [...external, ...inline];
  namespaceMountedSvgIds([...initial, rootScope], finalizedIds);
  await Promise.all(external.map((composition) => composition.runScripts()));

  const activeInline = inline.filter((composition) => {
    if (composition.isCurrent()) return true;
    for (const style of composition.styles) style.element.remove();
    if (window.__hfVariablesByComp) delete window.__hfVariablesByComp[composition.namespace];
    return false;
  });
  const live = [...external.filter((composition) => composition.host.isConnected), ...activeInline];
  const discovered = await mountInlineTemplateCompositions(
    params,
    new Set(live.map(({ host }) => host)),
  );
  if (discovered.length) {
    namespaceMountedSvgIds([...live, ...discovered, rootScope], finalizedIds);
  }
  const byHost = new Map(
    [...activeInline, ...discovered].map((composition) => [composition.host, composition]),
  );
  for (const host of getTrackedCompositionHosts()) {
    const composition = byHost.get(host);
    if (composition) await composition.runScripts();
  }
  // Newly referenced IDs retain the initial-script repair; earlier eligible IDs stay final.
  const finalScopes = [...live, ...discovered].filter(
    (composition) => composition.host.isConnected,
  );
  namespaceMountedSvgIds([...finalScopes, rootScope], finalizedIds);
}

/** Reuse one finalization set across authored mounting and initial-script discovery. */
function namespaceMountedSvgIds(
  mounted: readonly MountedSvgScope[],
  finalizedIds: Set<Element>,
): void {
  for (const { styles } of mounted) {
    for (const style of styles) {
      const current = style.element.textContent ?? "";
      if (current !== style.applied) {
        style.authored = current;
        style.applied = current;
      }
    }
  }
  const idMaps = namespaceCollidingSvgIds(
    document,
    mounted.map(({ host, namespace, styles, referenceTarget }) => ({
      root: host,
      namespace,
      referenceTarget,
      exclude: mounted
        .filter((nested) => nested.host !== host && host.contains(nested.host))
        .map((nested) => nested.host),
      cssTexts: styles.map((style) => style.authored),
    })),
    finalizedIds,
  );
  idMaps.forEach((idMap, index) => {
    const references = readSvgReferenceAliases(mounted[index]!.host, SVG_REFERENCE_ALIASES_ATTR);
    if (idMap.size === 0 && references.length === 0) return;
    for (const style of mounted[index]!.styles) {
      const rewritten = rewriteSvgIdReferencesInCss(style.authored, idMap, references);
      if (rewritten !== style.applied) style.element.textContent = rewritten;
      style.applied = rewritten;
    }
  });
  refreshSvgSelectorAliases();
}

/**
 * Stash per-instance variables BEFORE running scripts (the scoped
 * getVariables() reads window.__hfVariablesByComp[compId]) and mirror them
 * as CSS custom properties on the host so imported var(--slug, literal)
 * fills inside the sub-comp resolve per instance (cascade beats the document
 * root). Inline templates carry declared defaults on the content root;
 * external loads pass them explicitly. A composition variable, whether a
 * declared default or an explicit data-variable-values value, never
 * redefines a custom property already defined on the host. Render-time
 * overrides (--variables) remain explicit user intent and always win. Stale
 * custom properties from a previous mount are cleared before (re)applying.
 */
function stashInstanceVariables(
  params: {
    host: Element;
    declaredVariableDefaults?: Record<string, unknown>;
    variableDeclarer?: Element;
  },
  contentNode: Node,
  runtimeScopeCompositionId: string,
): void {
  const declaredDefaults =
    params.declaredVariableDefaults ??
    (isElementNode(contentNode) ? readDeclaredDefaults(contentNode) : {});
  const merged = {
    ...declaredDefaults,
    ...parseHostVariableValues(params.host),
  };
  // The sub-comp path never reaches the top-level getVariables(), so the
  // out-of-set enum guard runs here too, against the same merged values the
  // instance reads back out of __hfVariablesByComp.
  warnUnknownEnumValues(
    params.variableDeclarer ?? (isElementNode(contentNode) ? contentNode : null),
    merged,
    runtimeScopeCompositionId,
  );
  clearAppliedCssVariables(params.host);
  if (Object.keys(merged).length > 0) {
    if (!window.__hfVariablesByComp) window.__hfVariablesByComp = {};
    window.__hfVariablesByComp[runtimeScopeCompositionId] = merged;
    applyCssVariables(params.host, {
      ...filterVariablesIfAbsent(params.host, merged, window),
      ...readRenderOverrides(),
    });
  } else if (window.__hfVariablesByComp) {
    delete window.__hfVariablesByComp[runtimeScopeCompositionId];
  }
}
