/**
 * Shared sub-composition inlining logic.
 *
 * Both the core bundler (preview) and the producer compiler (render) need to
 * inline sub-composition HTML referenced via `data-composition-src`. This
 * module is the single source of truth for that transformation, eliminating
 * divergence that previously caused bugs (e.g. producer not setting
 * `data-composition-file`).
 */

import {
  rewriteAssetPath,
  rewriteAssetPaths,
  rewriteCssAssetUrls,
  rewriteInlineStyleAssetUrls,
  type AssetExists,
} from "./rewriteSubCompPaths";
import {
  scopeCssToComposition,
  wrapInlineScriptWithErrorBoundary,
  wrapScopedCompositionScript,
} from "./compositionScoping";
import { checkSubCompositionUsability } from "@hyperframes/parsers/sub-composition-validity";
import { enumerateNestedCompositionHosts, planCompositionAssembly } from "./compositionAssembly";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface InlineSubCompositionsOptions {
  /**
   * Resolve the HTML content for a sub-composition given its `data-composition-src` value.
   * Return `null` when the file cannot be found.
   */
  resolveHtml: (srcPath: string) => string | null;

  /**
   * Parse an HTML string into a Document. The returned object must expose
   * standard DOM APIs (querySelector, querySelectorAll, body, head, etc.).
   * Both linkedom's `parseHTML(...).document` and the core bundler's
   * `parseHTMLContent(...)` satisfy this contract.
   */
  parseHtml: (html: string) => Document;

  /**
   * Identity map produced by `assignBundledRuntimeCompositionIds`.
   * When provided, authoredCompositionId and runtimeCompositionId are read
   * from this map instead of from the host element's attributes directly.
   * The bundler uses this; the producer can omit it.
   */
  hostIdentityMap?: Map<
    Element,
    { authoredCompositionId: string | null; runtimeCompositionId: string | null }
  >;

  /**
   * When true, rewrite `url(...)` references in inline `style` attributes
   * on sub-composition elements. The bundler enables this; the producer
   * can skip it.
   */
  rewriteInlineStyles?: boolean;

  /**
   * Prepare the inner root element before injecting it into the host.
   * The bundler's `prepareFlattenedInnerRoot` clones the element, strips
   * timing attributes, and adds `data-hf-inner-root`. When omitted, the
   * inner root's outerHTML is injected as-is.
   */
  flattenInnerRoot?: (innerRoot: Element) => Element;

  /**
   * When true, CSS selectors targeting the authored root use a compound
   * selector (`[scope][root]`) instead of a descendant (`[scope] [root]`).
   * Enable this in the producer path where the inner root merges onto
   * the host element via innerHTML — both attributes end up on the same
   * element and a descendant selector won't match.
   */
  compoundAuthoredRoot?: boolean;

  /**
   * Read declared variable defaults from a sub-composition's `<html>` element.
   * The bundler passes `readDeclaredDefaults`; the producer can omit this.
   */
  readVariableDefaults?: (docElement: Element) => Record<string, unknown>;

  /**
   * Parse host-level variable overrides from `data-variable-values`.
   * The bundler passes `parseHostVariableValues`; the producer can omit this.
   */
  parseHostVariables?: (host: Element) => Record<string, unknown>;

  /**
   * Build a CSS attribute selector for scoping, e.g.
   * `[data-composition-id="my-comp"]`. Defaults to a simple implementation
   * when not provided. The bundler passes `cssAttributeSelector` which
   * handles escaping.
   */
  buildScopeSelector?: (compId: string) => string;

  /**
   * Error label prefix used in wrapped composition scripts.
   * Defaults to `"[HyperFrames] composition script error:"`.
   */
  scriptErrorLabel?: string;

  /**
   * Probe for "does this project-root-relative path exist?". Supplied by
   * callers that can see the filesystem so a sub-composition's SIBLING asset
   * refs (`<link href="_shared.css">` next to the composition) resolve against
   * its own directory instead of 404ing at the project root. Omit it and plain
   * relative paths pass through unchanged. See `AssetExists`.
   */
  assetExists?: AssetExists;

  /**
   * Log a warning when a composition file cannot be resolved. `reason` is a
   * short, human-readable explanation (e.g. "the file is empty (0 bytes or
   * whitespace-only)") from `checkSubCompositionUsability` — present for
   * every skip except when `resolveHtml` returns `null` (file not found,
   * which callers detect themselves before calling `resolveHtml`).
   * Defaults to `console.warn`.
   */
  onMissingComposition?: (srcPath: string, reason?: string) => void;
}

export interface InlineSubCompositionsResult {
  styles: string[];
  scripts: string[];
  externalScriptSrcs: string[];
  scriptItems: Array<{ kind: "inline"; content: string } | { kind: "external"; src: string }>;
  externalLinks: { href: string; rel: string; crossorigin?: string }[];
  variablesByComp: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Default helpers
// ---------------------------------------------------------------------------

function defaultBuildScopeSelector(compId: string): string {
  const escaped = compId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[data-composition-id="${escaped}"]`;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Inline sub-compositions into a document. For each host element in `hosts`:
 *
 * 1. Resolve the sub-composition HTML via `options.resolveHtml`
 * 2. Parse it, find `<template>` or `<body>` content
 * 3. Find the inner `[data-composition-id]` root
 * 4. Extract `<style>` elements, scope CSS, collect them
 * 5. Extract `<script>` elements, wrap inline scripts, collect them
 * 6. Collect external script `src` URLs for deduplication
 * 7. Rewrite asset paths (and optionally inline-style asset URLs)
 * 8. Copy dimension attrs from inner root to host if missing
 * 9. Set `data-composition-file` on host
 * 10. Remove `data-composition-src` from host
 * 11. Inject the content into the host element
 */
// fallow-ignore-next-line complexity
export function inlineSubCompositions(
  document: Document,
  hosts: Element[],
  options: InlineSubCompositionsOptions,
): InlineSubCompositionsResult {
  const {
    resolveHtml,
    parseHtml,
    hostIdentityMap,
    rewriteInlineStyles = false,
    flattenInnerRoot,
    compoundAuthoredRoot,
    readVariableDefaults,
    parseHostVariables,
    buildScopeSelector = defaultBuildScopeSelector,
    scriptErrorLabel = "[HyperFrames] composition script error:",
    onMissingComposition,
    assetExists,
  } = options;

  const styles: string[] = [];
  const scripts: string[] = [];
  const externalScriptSrcs: string[] = [];
  const scriptItems: InlineSubCompositionsResult["scriptItems"] = [];
  const externalLinks: { href: string; rel: string; crossorigin?: string }[] = [];
  const seenLinkHrefs = new Set<string>();
  const variablesByComp: Record<string, Record<string, unknown>> = {};

  const queue = hosts.map((element) => ({ element, ancestry: [] as string[] }));
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const { element: hostEl, ancestry } = queue[queueIndex]!;
    const src = hostEl.getAttribute("data-composition-src");
    if (!src) continue;

    const compHtml = resolveHtml(src);
    // Shared with lint + render pre-flight (@hyperframes/parsers'
    // subCompositionValidity.ts) so all three callers agree on what counts
    // as a usable sub-composition file. This path stays intentionally
    // tolerant (skip, don't throw) — preview and studio must keep bundling
    // around a scene that's still being authored. Lint and the render
    // pre-flight check use the same helper to fail loudly instead.
    const validity = checkSubCompositionUsability(compHtml, parseHtml);
    if (!validity.ok) {
      onMissingComposition?.(src, validity.detail);
      continue;
    }
    if (compHtml == null) {
      // Unreachable in practice — checkSubCompositionUsability's "empty"
      // reason already covers null/undefined — but this lets TypeScript
      // narrow compHtml to `string` below without an `as T` assertion.
      onMissingComposition?.(src);
      continue;
    }

    const compDoc = parseHtml(compHtml);

    // Determine composition IDs
    let compId: string | null;
    let runtimeCompId: string;
    if (hostIdentityMap) {
      const identity = hostIdentityMap.get(hostEl);
      compId = identity?.authoredCompositionId || null;
      runtimeCompId = identity?.runtimeCompositionId || compId || "";
    } else {
      compId = hostEl.getAttribute("data-composition-id") || null;
      runtimeCompId = compId || "";
    }

    // Find content: prefer <template>, fall back to <body>
    const contentRoot = compDoc.querySelector("template");
    const contentHtml = contentRoot ? contentRoot.innerHTML || "" : compDoc.body?.innerHTML || "";
    if (!contentHtml.trim()) {
      onMissingComposition?.(src);
      continue;
    }
    const contentDoc = parseHtml(contentHtml);
    if (!contentDoc.documentElement) {
      onMissingComposition?.(src);
      continue;
    }

    // Which node is the composition root, which id its CSS scopes to, which
    // id its scripts scope to, where its assets come from and in what order —
    // every one of those is decided by the shared assembly module, so the mount
    // path in runtime/compositionLoader.ts decides them the same way.
    const plan = planCompositionAssembly<Element>({
      contentNode: contentDoc,
      head: compDoc.head,
      documentElement: compDoc.documentElement,
      hasTemplate: Boolean(contentRoot),
      compositionId: compId,
    });
    const innerRoot = plan.innerRoot;
    const authoredRootId = plan.authoredRootId;
    const scopeCompId = plan.authoredCompositionId || "";
    const scriptCompositionId = plan.scriptCompositionId || "";
    const runtimeScope = runtimeCompId ? buildScopeSelector(runtimeCompId) : "";

    // Variable merging (bundler feature). Read declared defaults from the
    // document element (full-document sub-comps) AND the inner composition root
    // (template/fragment sub-comps store their schema on the root div, not a
    // synthetic <html>), then let per-instance host values override.
    if (readVariableDefaults && parseHostVariables && runtimeCompId) {
      const mergedVariables: Record<string, unknown> = {};
      for (const carrier of plan.variableDefaultCarriers) {
        Object.assign(mergedVariables, readVariableDefaults(carrier));
      }
      Object.assign(mergedVariables, parseHostVariables(hostEl));
      if (Object.keys(mergedVariables).length > 0) {
        variablesByComp[runtimeCompId] = mergedVariables;
      }
    }

    // `<head>` <link>/<script src> are hoisted into the ROOT document, so they
    // need the same directory rewrite the body's [src]/[href] pass applies —
    // without it even the documented `../` form escapes the project and 404s.
    const resolveSubAssetPath = (raw: string | null): string =>
      rewriteAssetPath(src, (raw || "").trim(), assetExists);

    // Scope one sub-composition <style> body. scopeRootSelectors keeps the
    // sub-comp's html/body/:root rules from clobbering the host document (they
    // are remapped to the composition box); see compositionScoping.
    const scopeSubStyle = (raw: string): string => {
      const css = rewriteCssAssetUrls(raw, src, assetExists);
      return scopeCompId
        ? scopeCssToComposition(css, scopeCompId, runtimeScope || undefined, authoredRootId, {
            compoundAuthoredRoot: compoundAuthoredRoot === true,
            scopeRootSelectors: true,
          })
        : css;
    };

    // <link> hoisting is unconditional. A templated sub-composition's webfont
    // link is as load-bearing as a non-templated one's, and the mount path has
    // always hoisted both; gating this on `!contentRoot` dropped a templated
    // composition's font from the render while preview kept it.
    for (const link of plan.linkSources) {
      const href = resolveSubAssetPath(link.getAttribute("href"));
      if (href && !seenLinkHrefs.has(href)) {
        seenLinkHrefs.add(href);
        const rel = (link.getAttribute("rel") || "").trim();
        const crossorigin = link.hasAttribute("crossorigin")
          ? link.getAttribute("crossorigin") || ""
          : undefined;
        externalLinks.push({ href, rel, crossorigin });
      }
    }

    // Head-sourced assets come first: a non-templated sub-composition's <head>
    // carries its backgrounds, positioning and fonts, and a <head> library tag
    // (GSAP from a CDN) has to run before the content scripts calling into it.
    for (const styleEl of plan.styleSources) {
      styles.push(scopeSubStyle(styleEl.textContent || ""));
      styleEl.remove();
    }

    // Head- and content-sourced scripts take the same branch. The head loop
    // used to handle only `src`, so an inline <head> script was silently
    // discarded on render while the mount path executed it.
    for (const scriptEl of plan.scriptSources) {
      const externalSrc = resolveSubAssetPath(scriptEl.getAttribute("src"));
      if (externalSrc) {
        if (!externalScriptSrcs.includes(externalSrc)) {
          externalScriptSrcs.push(externalSrc);
        }
        scriptItems.push({ kind: "external", src: externalSrc });
      } else {
        const wrappedScript = scriptCompositionId
          ? wrapScopedCompositionScript(
              scriptEl.textContent || "",
              scriptCompositionId,
              scriptErrorLabel,
              runtimeScope || undefined,
              runtimeCompId || scopeCompId || scriptCompositionId,
              authoredRootId,
            )
          : wrapInlineScriptWithErrorBoundary(scriptEl.textContent || "", scriptErrorLabel);
        scripts.push(wrappedScript);
        scriptItems.push({ kind: "inline", content: wrappedScript });
      }
      scriptEl.remove();
    }

    // Rewrite relative asset paths before inlining so ../foo.svg from
    // compositions/ resolves correctly when the content moves to root.
    const assetEls = innerRoot
      ? innerRoot.querySelectorAll("[src], [href]")
      : contentDoc.querySelectorAll("[src], [href]");
    rewriteAssetPaths(
      assetEls,
      src,
      (el: Element, attr: string) => el.getAttribute(attr),
      (el: Element, attr: string, val: string) => {
        el.setAttribute(attr, val);
      },
      assetExists,
    );

    if (rewriteInlineStyles) {
      const styledEls = innerRoot
        ? innerRoot.querySelectorAll("[style]")
        : contentDoc.querySelectorAll("[style]");
      rewriteInlineStyleAssetUrls(
        styledEls,
        src,
        (el: Element) => el.getAttribute("style"),
        (el: Element, val: string) => {
          el.setAttribute("style", val);
        },
        assetExists,
      );
    }

    if (innerRoot?.hasAttribute("data-timeline-locked")) {
      hostEl.setAttribute("data-timeline-locked", "");
    }

    // Copy dimension attributes from inner root to host if missing
    if (innerRoot) {
      const innerW = innerRoot.getAttribute("data-width");
      const innerH = innerRoot.getAttribute("data-height");
      if (innerW && !hostEl.getAttribute("data-width")) hostEl.setAttribute("data-width", innerW);
      if (innerH && !hostEl.getAttribute("data-height")) {
        hostEl.setAttribute("data-height", innerH);
      }
    }

    // Inject content into the host element
    if (innerRoot) {
      innerRoot.setAttribute("data-composition-file", src);
      for (const child of [...innerRoot.querySelectorAll("style, script")]) child.remove();
      if (flattenInnerRoot) {
        const prepared = flattenInnerRoot(innerRoot);
        if (!compId && scopeCompId) {
          // Anonymous host: flattenInnerRoot strips data-composition-id,
          // assuming the host already carries the composition's identity.
          // When the host has none, nothing in the render DOM matches the
          // composition's own root-styling CSS or self-referencing scripts
          // (e.g. document.querySelector('[data-composition-id="X"]')).
          // Restore it on the wrapper so both keep resolving, same as
          // before flattening preserved it via outerHTML.
          prepared.setAttribute("data-composition-id", scopeCompId);
        }
        hostEl.innerHTML = prepared.outerHTML || "";
      } else {
        hostEl.innerHTML = compId ? innerRoot.innerHTML || "" : innerRoot.outerHTML || "";
        // When the producer path strips the inner root (innerHTML), the
        // authored id attribute is lost. Propagate it to the host so that
        // rewritten #ID selectors ([data-hf-authored-id="X"]) still resolve.
        if (compId && authoredRootId) {
          hostEl.setAttribute("data-hf-authored-id", authoredRootId);
        }
      }
    } else {
      for (const child of [...contentDoc.querySelectorAll("style, script")]) child.remove();
      // linkedom fragment parsing: when content is `<div data-composition-id="X">...</div>`,
      // the div becomes documentElement and body is empty. Fall back to documentElement.outerHTML
      // to preserve the composition wrapper.
      const bodyHtml = contentDoc.body?.innerHTML || "";
      hostEl.innerHTML = bodyHtml || contentDoc.documentElement?.outerHTML || "";
    }

    hostEl.setAttribute("data-composition-file", src);
    hostEl.removeAttribute("data-composition-src");

    const nestedAncestry = [...ancestry, src];
    const nested = enumerateNestedCompositionHosts(hostEl, nestedAncestry);
    for (const skipped of nested.skipped) {
      onMissingComposition?.(skipped.src, skipped.reason);
    }
    for (const nestedHost of nested.hosts) {
      queue.push({ element: nestedHost.host, ancestry: nestedAncestry });
    }
  }

  return { styles, scripts, externalScriptSrcs, scriptItems, externalLinks, variablesByComp };
}
