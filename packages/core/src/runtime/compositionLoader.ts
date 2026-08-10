import { planCompositionAssembly } from "../compiler/compositionAssembly";
import { scopeCssToComposition, wrapScopedCompositionScript } from "../compiler/compositionScoping";
import { markFlattenedInnerRoot } from "./flattenedRoot";
import {
  applyCssVariables,
  clearAppliedCssVariables,
  filterVariablesIfAbsent,
  parseHostVariableValues,
  readDeclaredDefaults,
  readRenderOverrides,
} from "./getVariables";

type LoadExternalCompositionsParams = {
  injectedStyles: HTMLStyleElement[];
  injectedScripts: HTMLScriptElement[];
  injectedLinks: HTMLLinkElement[];
  parseDimensionPx: (value: string | null) => string | null;
  onDiagnostic?: (payload: {
    code: string;
    details: Record<string, string | number | boolean | null | string[]>;
  }) => void;
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
  for (const el of Array.from(node.querySelectorAll("style, script"))) {
    el.remove();
  }
}

function prepareFlattenedInnerRoot(innerRoot: HTMLElement): HTMLElement {
  const prepared = document.importNode(innerRoot, true) as HTMLElement;
  markFlattenedInnerRoot(prepared);
  const w = prepared.getAttribute("data-width");
  const h = prepared.getAttribute("data-height");
  prepared.style.width = w ? `${w}px` : "100%";
  prepared.style.height = h ? `${h}px` : "100%";
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
  hostCountsByCompositionId: Map<string, number> = countAuthoredCompositionIds(hosts),
): Map<Element, HostCompositionIdentity> {
  const hostInstanceByCompositionId = new Map<string, number>();
  const hostIdentityByElement = new Map<Element, HostCompositionIdentity>();

  for (const host of hosts) {
    const { authoredCompositionId, runtimeCompositionId: previousRuntimeCompositionId } =
      getHostCompositionIdentity(host);
    const shouldAssign = shouldAssignRuntimeCompositionId(host);
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
      const instanceIndex = duplicateInstance
        ? (hostInstanceByCompositionId.get(authoredCompositionId) || 0) + 1
        : 0;
      if (duplicateInstance) {
        hostInstanceByCompositionId.set(authoredCompositionId, instanceIndex);
      }

      runtimeCompositionId = duplicateInstance
        ? uniqueCompositionId(authoredCompositionId, instanceIndex)
        : authoredCompositionId;

      if (duplicateInstance) {
        host.setAttribute("data-hf-original-composition-id", authoredCompositionId);
      } else {
        host.removeAttribute("data-hf-original-composition-id");
      }
      host.setAttribute("data-composition-id", runtimeCompositionId);
      if (
        previousRuntimeCompositionId &&
        previousRuntimeCompositionId !== runtimeCompositionId &&
        window.__hfVariablesByComp
      ) {
        delete window.__hfVariablesByComp[previousRuntimeCompositionId];
      }
    }

    hostIdentityByElement.set(host, {
      authoredCompositionId,
      runtimeCompositionId,
    });
  }

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
   * Populated only by `loadExternalCompositions`; inline templates have no
   * separate document root so no declared defaults are passed.
   */
  declaredVariableDefaults?: Record<string, unknown>;
  onDiagnostic?: (payload: {
    code: string;
    details: Record<string, string | number | boolean | null | string[]>;
  }) => void;
}): Promise<void> {
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
  const innerRoot = plan.innerRoot instanceof HTMLElement ? plan.innerRoot : null;
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
    if (document.head.querySelector(`link[href="${CSS.escape(href)}"]`)) continue;
    const clonedLink = link.cloneNode(true);
    if (!(clonedLink instanceof HTMLLinkElement)) continue;
    clonedLink.href = href;
    document.head.appendChild(clonedLink);
    params.injectedLinks.push(clonedLink);
  }

  const injectScopedStyles = (styleEls: Iterable<Element>): void => {
    for (const style of styleEls) {
      const clonedStyle = style.cloneNode(true);
      if (!(clonedStyle instanceof HTMLStyleElement)) continue;
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
    if (widthPx && params.host instanceof HTMLElement) params.host.style.width = widthPx;
    if (heightPx && params.host instanceof HTMLElement) params.host.style.height = heightPx;
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
  }

  // Stash the per-instance variables BEFORE running scripts. The scoped
  // `getVariables()` injected by `compositionScoping.ts` reads from
  // `window.__hfVariablesByComp[compId]`, so this table must be populated
  // before the wrapped IIFE evaluates.
  if (runtimeScopeCompositionId) {
    stashInstanceVariables(params, contentNode, runtimeScopeCompositionId);
  }

  for (const scriptPayload of scriptPayloads) {
    const injectedScript = document.createElement("script");
    if (scriptPayload.type) {
      injectedScript.type = scriptPayload.type;
    }
    // Preserve deterministic script execution order across injected composition scripts.
    injectedScript.async = false;
    if (scriptPayload.kind === "external") {
      injectedScript.src = scriptPayload.src;
    } else if (scriptPayload.type.toLowerCase() === "module") {
      injectedScript.textContent = scriptPayload.content;
    } else if (scriptPayload.scopeCompositionId) {
      injectedScript.textContent = wrapScopedCompositionScript(
        scriptPayload.content,
        scriptPayload.scopeCompositionId,
        "[HyperFrames] composition script error:",
        runtimeScopeSelector,
        runtimeScopeCompositionId || scriptPayload.scopeCompositionId,
        authoredRootId,
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
}

export async function loadInlineTemplateCompositions(
  params: LoadExternalCompositionsParams,
): Promise<void> {
  const trackedHosts = getTrackedCompositionHosts();
  cleanupDetachedScopedVariables();
  if (trackedHosts.length === 0) return;
  const hostIdentityByElement = assignRuntimeCompositionIds(trackedHosts);
  const hosts = trackedHosts.filter((host) => {
    if (host.hasAttribute("data-composition-src")) return false;
    if (host.children.length > 0) return false;
    const compId = hostIdentityByElement.get(host)?.authoredCompositionId;
    if (!compId) return false;
    return !!document.querySelector(`template#${CSS.escape(compId)}-template`);
  });

  if (hosts.length === 0) return;

  for (const host of hosts) {
    const hostIdentity = hostIdentityByElement.get(host);
    const compId = hostIdentity?.authoredCompositionId;
    if (!compId) continue;
    const template = document.querySelector<HTMLTemplateElement>(
      `template#${CSS.escape(compId)}-template`,
    )!;

    resetCompositionHost(host);
    await mountCompositionContent({
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
  }
}

export async function loadExternalCompositions(
  params: LoadExternalCompositionsParams,
): Promise<void> {
  const trackedHosts = getTrackedCompositionHosts();
  cleanupDetachedScopedVariables();
  if (trackedHosts.length === 0) return;
  const hostIdentityByElement = assignRuntimeCompositionIds(trackedHosts);
  const hosts = trackedHosts.filter((host) => host.hasAttribute("data-composition-src"));
  if (hosts.length === 0) return;

  await Promise.all(
    hosts.map(async (host) => {
      const src = host.getAttribute("data-composition-src");
      if (!src) return;
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
      try {
        const localTemplate =
          authoredCompositionId != null
            ? document.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(authoredCompositionId)}-template`,
              )
            : null;
        if (localTemplate) {
          await mountCompositionContent({
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
          return;
        }
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        // Rewrite project-root-traversing (`../`) asset paths against the
        // sub-composition's URL before extracting any nodes. Without this,
        // `<video src="../../assets/x.mp4">` authored from
        // `compositions/frames/scene.html` resolves against the main
        // document's base (the project preview root) and climbs above it
        // to 404 — the Studio-preview-vs-render divergence reported by
        // OSS users. The server-side bundler already does this for the
        // baked render via `inlineSubCompositions`; this is the runtime
        // mirror so live preview matches.
        rewriteSubCompositionAssetPaths(doc, compositionUrl);
        const template =
          (authoredCompositionId
            ? doc.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(authoredCompositionId)}-template`,
              )
            : null) ?? doc.querySelector<HTMLTemplateElement>("template");
        const sourceNode = template ? template.content : doc.body;
        await mountCompositionContent({
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
          onDiagnostic: params.onDiagnostic,
        });
      } catch (error) {
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
      }
    }),
  );
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
  params: { host: Element; declaredVariableDefaults?: Record<string, unknown> },
  contentNode: Node,
  runtimeScopeCompositionId: string,
): void {
  const declaredDefaults =
    params.declaredVariableDefaults ??
    (contentNode instanceof Element ? readDeclaredDefaults(contentNode) : {});
  const merged = {
    ...declaredDefaults,
    ...parseHostVariableValues(params.host),
  };
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
