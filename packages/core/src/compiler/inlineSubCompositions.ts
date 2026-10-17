import { SVG_REFERENCE_ALIASES_ATTR, readSvgReferenceAliases } from "./svgSelectorAliases";
import { readExternalScriptAttributes, type ExternalScriptAttributes } from "./externalScripts";
import { parseImportMap, type ImportMap } from "./importMaps";
import {
  compositionStyle,
  cssStyleMergeKey,
  hasSameLink,
  type CompositionStyle,
} from "./scriptRuns";
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
import { warnUnknownEnumValues } from "../runtime/getVariables";
import {
  scopeCssToComposition,
  wrapInlineScriptWithErrorBoundary,
  scopedModulePrelude,
  wrapScopedCompositionScript,
} from "./compositionScoping";
import {
  namespaceCollidingSvgIds,
  rewriteSvgIdReferencesInCss,
  type SvgIdScope,
} from "./svgIdNamespacing";
import {
  checkSubCompositionUsability,
  resolveSubCompositionContent,
} from "@hyperframes/parsers/sub-composition-validity";
import {
  enumerateNestedCompositionHosts,
  planCompositionAssembly,
  extractedCompositionAssets,
} from "./compositionAssembly";
import { SCENE_EAGER_ATTR, SCENE_NO_SWAP_ATTR, SCENE_PART_ATTR } from "../sceneParts";

// Anything a scene script can leave running, pending or registered outside its timeline, or that
// throws when run again: only the timeline is torn down when a scene is swapped, so when unsure, refuse.
const SIDE_EFFECT_RE =
  /\b(addEventListener|requestAnimationFrame|requestIdleCallback|setTimeout|setInterval|queueMicrotask|getContext|WebGL\w*|WebGPU\w*|gpu|Worker|WebSocket|EventSource|Audio\w*|\w*Observer|fetch|import|eval|Function|Promise|async|await|delayedCall|ScrollTrigger|Draggable|anime|customElements|registerProperty|addListener|BroadcastChannel|pushState|replaceState|adoptedStyleSheets|documentElement|getElementsByTagName|lottie|THREE|__hf[A-Z]\w*)\b|\.then\s*\(|\.animate\s*\(|\.ticker\b|repeat\s*:\s*-1|\.repeat\s*\(\s*-1|defineProperty\s*\(\s*(window|globalThis|self|document)\b|\bfonts\s*\.\s*add\b|\.on[a-z]+\s*=(?!=)|\bon(resize|scroll|message|key\w+|click|pointer\w+|mouse\w+|wheel|visibilitychange|hashchange|popstate|error|load)\s*=(?!=)|\[\s*["']on[a-z]+["']\s*\]|document\s*\.\s*(head|body)\b|querySelector(All)?\(\s*["'](head|body)["']|\bgsap\s*\.\s*(?:to|from|fromTo)\s*\(|\bgsap\s*\.\s*timeline\s*\((?:[^()]|\([^()]*\))*\)\s*\.\s*(?:to|from|fromTo|set|add|call)\s*\(/;

// npm packages that only define globals when loaded; lottie-web is absent because it scans the page on load.
const SWAP_SAFE_LIBRARY_URL =
  /^https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(gsap|three|d3|d3-[a-z-]+|topojson-client|clipper-lib)(@[^/]+)?\//;
const isSwapSafeLibrary = (src: string) =>
  URL.canParse(src) && SWAP_SAFE_LIBRARY_URL.test(new URL(src).href);

/** Why an authored scene script cannot be swapped out cleanly, or null when it can. */
function sceneScriptSwapRefusal(script: string): string | null {
  const match = SIDE_EFFECT_RE.exec(script);
  return match ? `its script uses ${match[0].trim()}` : null;
}

// What ties a scene script to boot order: reaching outside its root, or leaving state on window for
// other scripts (the timeline registry aside).
const REACHES_OUTSIDE_RE =
  /\b(documentElement|getElementsBy\w+|__hf[A-Z]\w*)\b|document\s*\.\s*(head|body)\b|querySelector(All)?\(\s*["'](head|body)["']|defineProperty\s*\(\s*(window|globalThis|self|document)\b|\b(window|globalThis|self)\s*(\.\s*(?!__timelines\b)[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=(?!=)/;

/** Why an authored scene script must run at boot rather than when the playhead nears, or null. */
function sceneScriptEagerReason(script: string): string | null {
  const match = REACHES_OUTSIDE_RE.exec(script);
  return match ? `its script uses ${match[0].trim()}` : null;
}

// A quoted string in a script, in any of the three quote styles.
const STRING_LITERAL_RE = /(["'`])((?:\\.|(?!\1)[^\\\n])*?)\1/g;
// The timeline registry's own setup reads no scene: `window.__timelines = window.__timelines || {}`, ??=, ||=,
// `= {}`, and the `if (!window.__timelines)` / `typeof` guards.
const REGISTRY_SETUP_RE =
  /(?:window\.)?__timelines\s*(?:\?\?=|\|\|=|=\s*(?:(?:window\.)?__timelines\s*(?:\|\||\?\?)\s*)?\{\s*\})|!\s*(?:window\.)?__timelines\s*\)|typeof\s+(?:window\.)?__timelines\b(?!\s*(?:\?\.|\.|\[))/g;
// A registry key named outright, by string or by dot; a computed key being written reads nothing.
const REGISTRY_KEY_RE =
  /^\s*(?:(?:\?\.)?\s*\[\s*(["'`])([\w-]+)\1\s*\]|\??\.\s*([A-Za-z_$][\w$]*))/;
const REGISTRY_WRITE_RE = /^\s*\[[^\]]*\]\s*=(?!=)/;

/** The scene ids a script reads from the timeline registry; `everyScene` when a read is not to one named key. */
export function registryReads(script: string): { names: string[]; everyScene: boolean } {
  const rest = script.replace(REGISTRY_SETUP_RE, "");
  const names: string[] = [];
  for (const m of rest.matchAll(/__timelines\b/g)) {
    const after = rest.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const key = REGISTRY_KEY_RE.exec(after);
    if (key) names.push(key[2] ?? key[3] ?? "");
    else if (!REGISTRY_WRITE_RE.test(after)) return { names, everyScene: true };
  }
  return { names, everyScene: false };
}

// Text ending where createElement takes its tag: that string makes a node, it selects none.
const CREATES_ELEMENT_RE = /createElement\s*\(\s*$|createElementNS\s*\([^()]*,\s*$/;
// A "*" after a comma is a later argument, like postMessage's target origin; selector calls take it first.
const isNotASelector = (script: string, at: number, literal: string) =>
  CREATES_ELEMENT_RE.test(script.slice(Math.max(0, at - 60), at)) ||
  (literal.trim() === "*" && /,\s*$/.test(script.slice(Math.max(0, at - 20), at)));

/** Marks each scene whose nodes a script outside it names by selector, id or class: a swap would
 * strand it, and its own scripts must have run before that script does. */
export function refuseScenesReachedByRootScripts(document: Document, rootScripts: string[]): void {
  const hosts = [...document.querySelectorAll(`[${SCENE_PART_ATTR}]`)];
  const byName = new Map<string, Set<Element>>();
  for (const host of hosts) {
    for (const el of [host, ...host.querySelectorAll("*")]) {
      for (const name of [
        el.localName,
        el.id && `#${el.id}`,
        ...[...el.classList].map((c) => `.${c}`),
      ]) {
        if (name) byName.set(name, (byName.get(name) ?? new Set()).add(host));
      }
    }
  }
  // A selector naming a tag the document lacks cannot match, so it is not worth a query.
  const namesKnown = (selector: string) =>
    selector
      .split(",")
      .some((alt) =>
        alt
          .split(/[\s>+~]+/)
          .every(
            (part) =>
              !/^[a-z][\w-]*$/i.test(part) ||
              byName.has(part.toLowerCase()) ||
              document.querySelector(part) !== null,
          ),
      );
  const literals = new Set(
    rootScripts.flatMap((s) =>
      [...s.matchAll(STRING_LITERAL_RE)]
        .filter((m) => !isNotASelector(s, m.index, m[2] ?? ""))
        .map((m) => m[2] ?? ""),
    ),
  );
  for (const literal of literals) {
    const open = hosts.filter(
      (host) => !host.hasAttribute(SCENE_NO_SWAP_ATTR) || !host.hasAttribute(SCENE_EAGER_ATTR),
    );
    if (open.length === 0) return;
    // Tag names match in any case; ids and classes do not.
    const reached =
      literal.trim() === "*"
        ? open
        : /^[A-Za-z_][\w-]*$/.test(literal)
          ? [literal.toLowerCase(), `#${literal}`, `.${literal}`].flatMap((name) => [
              ...(byName.get(name) ?? []),
            ])
          : /[#.[:>]|[\w\]*] *[\s,]+ *[\w*]/.test(literal) &&
              literal.length <= 120 &&
              namesKnown(literal)
            ? open.filter((host) => reaches(host, literal))
            : [];
    for (const host of reached)
      for (const attr of [SCENE_NO_SWAP_ATTR, SCENE_EAGER_ATTR])
        if (!host.hasAttribute(attr))
          host.setAttribute(attr, `a script outside the scene selects ${literal}`);
  }
}

const reaches = (host: Element, selector: string) => {
  try {
    return host.matches(selector) || host.querySelector(selector) !== null;
  } catch {
    return false;
  }
};

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
  /** Tag each top-level host with `data-hf-scene` and report every part's scene, for preview swaps. */
  tagScenes?: boolean;
}

export interface ExternalLink {
  href: string;
  rel: string;
  crossorigin?: string;
  media?: string;
  title?: string;
  type?: string;
  disabled?: true;
}

/** Appends a hoisted link unless the document already has a live one it would duplicate. */
export function ensureExternalLinkTag(doc: Document, link: ExternalLink): void {
  const el = doc.createElement("link");
  el.setAttribute("rel", link.rel);
  el.setAttribute("href", link.href);
  for (const name of ["crossorigin", "media", "title", "type"] as const) {
    const value = link[name];
    if (value != null) el.setAttribute(name, value);
  }
  if (link.disabled) el.setAttribute("disabled", "");
  if (!hasSameLink(doc, el)) doc.head.appendChild(el);
}

export interface InlineSubCompositionsResult {
  styles: CompositionStyle[];
  /** With `tagScenes`: the scene each entry of `styles` belongs to. */
  styleScenes: string[];
  scripts: string[];
  externalScriptSrcs: string[];
  scriptItems: Array<
    | { kind: "inline"; content: string; scene?: string }
    | ({ kind: "external"; src: string; scene?: string } & ExternalScriptAttributes)
  >;
  /** May list one link more than once; `ensureExternalLinkTag` dedupes. */
  externalLinks: ExternalLink[];
  variablesByComp: Record<string, Record<string, unknown>>;
  /** Mounted files' import maps, addresses rebased; emit with `emitMountedModuleScripts`. */
  importMaps: ImportMap[];
  /** Mounted files' inline module scripts, each already carrying its scoped `__hyperframes`. */
  moduleScripts: string[];
  /** With `tagScenes`: each scene's host and the literals its scripts use; see `keepScenesReadAtBootEager`. */
  sceneReads: SceneReads;
}

export interface SceneReads {
  hosts: Map<string, Element>;
  literals: Map<string, Set<string>>;
  /** Scenes whose scripts read the timeline registry by a key no analysis can name. */
  readEveryScene: Set<string>;
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
 * 2. Parse it, resolve template, body, or bare-fragment content
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
    tagScenes = false,
  } = options;

  const rootStyles = [...document.querySelectorAll("style")];
  const styles: CompositionStyle[] = [];
  const styleScenes: string[] = [];
  const scripts: string[] = [];
  const externalScriptSrcs: string[] = [];
  const scriptItems: InlineSubCompositionsResult["scriptItems"] = [];
  const importMaps: ImportMap[] = [];
  const moduleScripts: string[] = [];
  const externalLinks: ExternalLink[] = [];
  const variablesByComp: Record<string, Record<string, unknown>> = {};
  const svgIdScopes: Array<SvgIdScope & { styleStart: number; styleEnd: number }> = [];

  const sceneHosts = new Map<string, Element>();
  const sceneLiterals = new Map<string, Set<string>>();
  const readEveryScene = new Set<string>();
  const queue = hosts.map((element) => ({
    element,
    ancestry: [] as string[],
    scene: undefined as string | undefined,
  }));
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const { element: hostEl, ancestry, scene: parentScene } = queue[queueIndex]!;
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

    const { contentHtml, hasTemplate } = resolveSubCompositionContent(compHtml, compDoc);
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
      hasTemplate,
      compositionId: compId,
    });
    const innerRoot = plan.innerRoot;
    const authoredRootId = plan.authoredRootId;
    const scopeCompId = plan.authoredCompositionId || "";
    const scriptCompositionId = plan.scriptCompositionId || "";
    const runtimeScope = runtimeCompId ? buildScopeSelector(runtimeCompId) : "";
    const scene = tagScenes ? (parentScene ?? (runtimeCompId || src)) : undefined;
    if (scene && !parentScene) {
      hostEl.setAttribute(SCENE_PART_ATTR, scene);
      sceneHosts.set(scene, hostEl);
    }
    // Lazy, so renders (no scene hosts) never run the refusal checks.
    const markScene = (attr: string, why: () => string | null) => {
      const host = scene ? sceneHosts.get(scene) : undefined;
      if (!host || host.hasAttribute(attr)) return;
      const reason = why();
      if (reason) host.setAttribute(attr, reason);
    };
    const refuseSwap = (why: () => string | null) => markScene(SCENE_NO_SWAP_ATTR, why);

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
      // Compile time is the only place this defect is visible on the sub-comp
      // path: the instance value is baked into `__hfVariablesByComp` right
      // here, and the scoped `getVariables` shim only reads that table, so the
      // runtime's identical guard never runs. Same helper, so the message and
      // the per-process dedupe set are shared with the runtime path and the
      // author sees one warning either way.
      warnUnknownEnumValues(compDoc.documentElement, mergedVariables, runtimeCompId);
      warnUnknownEnumValues(innerRoot, mergedVariables, runtimeCompId);
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
    // always hoisted both; gating this on `!hasTemplate` dropped a templated
    // composition's font from the render while preview kept it.
    for (const link of plan.linkSources) {
      const href = resolveSubAssetPath(link.getAttribute("href"));
      if (href) {
        const rel = (link.getAttribute("rel") || "").trim();
        const crossorigin = link.hasAttribute("crossorigin")
          ? link.getAttribute("crossorigin") || ""
          : undefined;
        const media = link.getAttribute("media") ?? undefined;
        const title = link.getAttribute("title") ?? undefined;
        const type = link.getAttribute("type") ?? undefined;
        const disabled = link.hasAttribute("disabled") ? true : undefined;
        externalLinks.push({ href, rel, crossorigin, media, title, type, disabled });
      }
    }

    // Head-sourced assets come first: a non-templated sub-composition's <head>
    // carries its backgrounds, positioning and fonts, and a <head> library tag
    // (GSAP from a CDN) has to run before the content scripts calling into it.
    const styleStart = styles.length;
    for (const styleEl of plan.styleSources) {
      if (cssStyleMergeKey(styleEl) === undefined) continue;
      styles.push(compositionStyle(styleEl, scopeSubStyle(styleEl.textContent || "")));
      if (scene) styleScenes.push(scene);
      styleEl.remove();
    }
    const styleEnd = styles.length;

    // Head- and content-sourced scripts take the same branch.
    for (const scriptEl of plan.scriptSources) {
      const externalSrc = resolveSubAssetPath(scriptEl.getAttribute("src"));
      const type = (scriptEl.getAttribute("type") || "").trim().toLowerCase();
      // A swap never re-runs external or module scripts: only a known library that just defines globals is safe.
      const authored = scriptEl.textContent || "";
      const unknownCode =
        type === "importmap" || type === "module"
          ? "it runs a module script or import map"
          : externalSrc && !isSwapSafeLibrary(externalSrc)
            ? "it runs a script that is not a known library"
            : null;
      refuseSwap(() => unknownCode ?? (externalSrc ? null : sceneScriptSwapRefusal(authored)));
      markScene(
        SCENE_EAGER_ATTR,
        () => unknownCode ?? (externalSrc ? null : sceneScriptEagerReason(authored)),
      );
      if (scene && !externalSrc && !unknownCode) {
        const { names, everyScene } = registryReads(authored);
        const literals = [...authored.matchAll(STRING_LITERAL_RE)].map((m) => m[2] ?? "");
        sceneLiterals.set(
          scene,
          new Set([...(sceneLiterals.get(scene) ?? []), ...literals, ...names]),
        );
        if (everyScene) readEveryScene.add(scene);
      }
      if (type === "importmap") {
        const map = parseImportMap(scriptEl.textContent || "", (url) => {
          // The rebase drops a leading "./" and a trailing "/"; an import map address needs both.
          const authored = url.trim();
          const rebased = resolveSubAssetPath(authored);
          if (rebased === authored) return rebased;
          const urlLike = /^(\/|\.\.?\/|[a-z][a-z\d+.-]*:)/i.test(rebased)
            ? rebased
            : `./${rebased}`;
          return authored.endsWith("/") && !urlLike.endsWith("/") ? `${urlLike}/` : urlLike;
        });
        if (map) importMaps.push(map);
        else console.warn(`[HyperFrames] ${src}: import map is not valid JSON, so it is skipped.`);
      } else if (type === "module" && !externalSrc) {
        const prelude = scriptCompositionId
          ? scopedModulePrelude(runtimeCompId || scopeCompId || scriptCompositionId, src)
          : "";
        moduleScripts.push(prelude + (scriptEl.textContent || ""));
      } else if (externalSrc) {
        if (!externalScriptSrcs.includes(externalSrc)) {
          externalScriptSrcs.push(externalSrc);
        }
        scriptItems.push({
          kind: "external",
          src: externalSrc,
          ...readExternalScriptAttributes(scriptEl),
          ...(scene ? { scene } : {}),
        });
      } else {
        const wrappedScript = scriptCompositionId
          ? wrapScopedCompositionScript(
              scriptEl.textContent || "",
              scriptCompositionId,
              scriptErrorLabel,
              runtimeScope || undefined,
              runtimeCompId || scopeCompId || scriptCompositionId,
              authoredRootId,
              src,
            )
          : wrapInlineScriptWithErrorBoundary(scriptEl.textContent || "", scriptErrorLabel);
        scripts.push(wrappedScript);
        scriptItems.push({ kind: "inline", content: wrappedScript, ...(scene ? { scene } : {}) });
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
      for (const child of extractedCompositionAssets(innerRoot)) child.remove();
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
      for (const child of extractedCompositionAssets(contentDoc)) child.remove();
      // linkedom fragment parsing: when content is `<div data-composition-id="X">...</div>`,
      // the div becomes documentElement and body is empty. Fall back to documentElement.outerHTML
      // to preserve the composition wrapper.
      const bodyHtml = contentDoc.body?.innerHTML || "";
      hostEl.innerHTML = bodyHtml || contentDoc.documentElement?.outerHTML || "";
    }
    for (const el of plan.inertScriptsOutsideRoot)
      hostEl.insertAdjacentHTML("beforeend", el.outerHTML);

    hostEl.setAttribute("data-composition-file", src);
    hostEl.removeAttribute("data-composition-src");

    const nestedAncestry = [...ancestry, src];
    const nested = enumerateNestedCompositionHosts(hostEl, nestedAncestry);
    for (const skipped of nested.skipped) {
      onMissingComposition?.(skipped.src, skipped.reason);
    }
    for (const nestedHost of nested.hosts) {
      queue.push({ element: nestedHost.host, ancestry: nestedAncestry, scene });
    }

    // Remember this instance for the SVG id pass below. Keyed on the
    // document-unique runtime id (falling back to the authored id for an
    // anonymous host with no duplicate instances) — the same identity CSS
    // scoping and script scoping already key on. Nested hosts are excluded
    // because each of them is recorded as its own scope when dequeued.
    svgIdScopes.push({
      root: hostEl,
      namespace: runtimeCompId || scopeCompId,
      exclude: nested.hosts.map((nestedHost) => nestedHost.host),
      styleStart,
      styleEnd,
    });
  }

  // SVG ids (`<clipPath id="clip">`, `<symbol id="shape">`, `<filter
  // id="fx">`, …) are namespaced only once EVERY instance is in the document:
  // whether an id collides is a property of the assembled document, not of one
  // composition file, and an id that stays unique must stay untouched so the
  // author's own `#id` lookups keep working. Each instance's extracted
  // `<style>` text gets the same substitution its DOM just received. See
  // svgIdNamespacing.ts for why this is a rename, unlike the sibling
  // getElementById/media-id fixes.
  const svgIdMaps = namespaceCollidingSvgIds(document, [
    ...svgIdScopes.map(({ root, namespace, exclude, styleStart, styleEnd }) => ({
      root,
      namespace,
      exclude,
      cssTexts: styles.slice(styleStart, styleEnd).map((style) => style.css),
    })),
    {
      root: document.documentElement,
      namespace: "",
      referenceTarget: "document",
      exclude: svgIdScopes.map(({ root }) => root),
      cssTexts: rootStyles.map((style) => style.textContent ?? ""),
    },
  ]);
  svgIdMaps.slice(0, svgIdScopes.length).forEach((idMap, index) => {
    const { styleStart, styleEnd } = svgIdScopes[index]!;
    const references = readSvgReferenceAliases(
      svgIdScopes[index]!.root,
      SVG_REFERENCE_ALIASES_ATTR,
    );
    for (let i = styleStart; i < styleEnd; i += 1) {
      styles[i]!.css = rewriteSvgIdReferencesInCss(styles[i]!.css, idMap, references);
    }
  });

  const rootReferences = readSvgReferenceAliases(
    document.documentElement,
    SVG_REFERENCE_ALIASES_ATTR,
  );
  for (const style of rootStyles) {
    style.textContent = rewriteSvgIdReferencesInCss(
      style.textContent ?? "",
      svgIdMaps[svgIdScopes.length]!,
      rootReferences,
    );
  }

  return {
    styles,
    styleScenes,
    scripts,
    externalScriptSrcs,
    scriptItems,
    externalLinks,
    variablesByComp,
    importMaps,
    moduleScripts,
    sceneReads: { hosts: sceneHosts, literals: sceneLiterals, readEveryScene },
  };
}

/** A script that names a scene's composition id reads what that scene's script left, so the scene runs at boot whenever
 * its reader does. Root scripts always run at boot; run this after every other eager mark. */
export function keepScenesReadAtBootEager(
  { hosts: sceneHosts, literals: sceneLiterals, readEveryScene }: SceneReads,
  rootScripts: string[],
): void {
  // A renamed duplicate (`b__hf1`) still registers under the id its author gave it.
  const idsOf = (host: Element) =>
    new Set(
      [
        host,
        ...host.querySelectorAll("[data-composition-id], [data-hf-original-composition-id]"),
      ].flatMap((el) => [
        el.getAttribute("data-composition-id") ?? "",
        el.getAttribute("data-hf-original-composition-id") ?? "",
      ]),
    );
  const ids = new Map([...sceneHosts].map(([scene, host]) => [scene, idsOf(host)]));
  const namedBy = (literals: Iterable<string>, own = new Set<string>()) => {
    const named = [...literals].filter((l) => l && !own.has(l));
    return [...ids].filter(([, other]) => named.some((l) => other.has(l))).map(([id]) => id);
  };
  const ROOT = "a root script";
  const rootReads = rootScripts.map(registryReads);
  const rootLiterals = [
    ...rootScripts.flatMap((s) => [...s.matchAll(STRING_LITERAL_RE)].map((m) => m[2] ?? "")),
    ...rootReads.flatMap(({ names }) => names),
  ];
  const rootReadsEveryScene = rootReads.some(({ everyScene }) => everyScene);
  const readsOf = (reader: string) => {
    if (reader === ROOT ? rootReadsEveryScene : readEveryScene.has(reader))
      return [...ids.keys()].filter((id) => id !== reader);
    return reader === ROOT
      ? namedBy(rootLiterals)
      : namedBy(sceneLiterals.get(reader) ?? [], ids.get(reader));
  };
  for (const [scene, host] of sceneHosts) {
    const named = readsOf(scene)[0];
    if (named && !host.hasAttribute(SCENE_EAGER_ATTR))
      host.setAttribute(SCENE_EAGER_ATTR, `its script names ${named}`);
  }
  const eager = [
    ROOT,
    ...[...sceneHosts].filter(([, host]) => host.hasAttribute(SCENE_EAGER_ATTR)).map(([s]) => s),
  ];
  for (const reader of eager) {
    for (const provider of readsOf(reader)) {
      const host = sceneHosts.get(provider);
      if (!host || host.hasAttribute(SCENE_EAGER_ATTR)) continue;
      host.setAttribute(SCENE_EAGER_ATTR, `${reader} reads it`);
      eager.push(provider);
    }
  }
}
