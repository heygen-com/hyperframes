import { readFileSync, existsSync } from "fs";
import { join, resolve, relative, dirname, isAbsolute, sep } from "path";
import { CSS_URL_RE, isNonRelativeUrl } from "./assetPaths.js";
import { transformSync } from "esbuild";
import { compileHtml, type MediaDurationProber } from "./htmlCompiler";
import {
  RUNTIME_BOOTSTRAP_ATTR,
  parseHTMLContent,
  stripEmbeddedRuntimeScripts,
} from "./htmlDocument";
// rewriteSubCompPaths functions are used by inlineSubCompositions (shared module)
import {
  scopeCssToComposition,
  wrapInlineScriptWithErrorBoundary,
  wrapScopedCompositionScript,
} from "./compositionScoping";
import { validateHyperframeHtmlContract } from "./staticGuard";
import { getHyperframeRuntimeScript } from "../generated/runtime-inline";
import { readDeclaredDefaults } from "../runtime/getVariables";
import { inlineSubCompositions } from "./inlineSubCompositions";
import { queryByAttr } from "../utils/cssSelector";
import { isSafePath, resolveWithinProject } from "../safePath.js";
import { HF_COLOR_GRADING_ATTR } from "../colorGrading";

const DEFAULT_RUNTIME_SCRIPT_URL = "";

function getRuntimeScriptUrl(): string {
  const configured = (process.env.HYPERFRAME_RUNTIME_URL || "").trim();
  return configured || DEFAULT_RUNTIME_SCRIPT_URL;
}

function injectInterceptor(html: string, runtimeMode: "inline" | "placeholder" = "inline"): string {
  const sanitized = stripEmbeddedRuntimeScripts(html);
  if (sanitized.includes(RUNTIME_BOOTSTRAP_ATTR)) return sanitized;

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
  if (sanitized.includes("</head>")) {
    // Use a function replacer so `String.prototype.replace`'s substitution
    // patterns (`$&`, `$$`, `$'`, `` $` ``, `$1`–`$99`) inside the inlined
    // runtime IIFE are passed through verbatim. The minified runtime
    // contains the literal sequence `$&` as part of legitimate JS, and
    // the older `(pattern, string)` form would expand it to the matched
    // `</head>`, silently corrupting the runtime and breaking every
    // timeline in the bundle with a parse-time SyntaxError.
    return sanitized.replace("</head>", () => `${tag}\n</head>`);
  }
  const htmlOpenMatch = sanitized.match(/<html\b[^>]*>/i);
  if (htmlOpenMatch?.index != null) {
    const insertPos = htmlOpenMatch.index + htmlOpenMatch[0].length;
    return `${sanitized.slice(0, insertPos)}<head>${tag}</head>${sanitized.slice(insertPos)}`;
  }
  const doctypeIdx = sanitized.toLowerCase().indexOf("<!doctype");
  if (doctypeIdx >= 0) {
    const insertPos = sanitized.indexOf(">", doctypeIdx) + 1;
    return sanitized.slice(0, insertPos) + tag + sanitized.slice(insertPos);
  }
  return tag + sanitized;
}

function isRelativeUrl(url: string): boolean {
  return !isNonRelativeUrl(url) && !isAbsolute(url);
}

function safeReadFile(filePath: string): string | null {
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

function rebaseCssUrls(css: string, cssFileDir: string, projectDir: string): string {
  const resolvedRoot = resolve(projectDir);
  const resolvedDir = resolve(cssFileDir);
  if (resolvedDir === resolvedRoot) return css;
  return css.replace(CSS_URL_RE, (full, quote: string, urlValue: string) => {
    if (!urlValue || !isRelativeUrl(urlValue)) return full;
    const { basePath, suffix } = splitUrlSuffix(urlValue.trim());
    if (!basePath) return full;
    const absolutePath = resolve(resolvedDir, basePath);
    const rebased = relative(resolvedRoot, absolutePath).split(sep).join("/");
    if (rebased === basePath) return full;
    return `url(${quote || ""}${rebased}${suffix}${quote || ""})`;
  });
}

function inlineCssFile(
  css: string,
  cssFileDir: string,
  projectDir: string,
  visited: Set<string> = new Set(),
): string {
  const { result: strippedCss, restore: restoreComments } = withCommentsStripped(css, (s) => s);
  const importPlaceholders: string[] = [];
  const withPlaceholders = strippedCss.replace(
    CSS_IMPORT_RE,
    (full, _q1, urlPath, _q2, barePath, mediaQuery) => {
      const importPath = urlPath ?? barePath;
      if (!importPath || !isRelativeUrl(importPath)) return full;
      const resolved = resolve(cssFileDir, importPath);
      // @import is resolved relative to the CSS file, but must stay within the
      // project root; isSafePath also blocks symlink escapes (content is inlined).
      if (!isSafePath(projectDir, resolved)) return full;
      if (visited.has(resolved)) return "";
      const content = safeReadFile(resolved);
      if (content == null) return full;
      visited.add(resolved);
      const inlined = inlineCssFile(content, dirname(resolved), projectDir, visited);
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
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath);
  } catch {
    return null;
  }
}

function splitUrlSuffix(urlValue: string): { basePath: string; suffix: string } {
  const queryIdx = urlValue.indexOf("?");
  const hashIdx = urlValue.indexOf("#");
  if (queryIdx < 0 && hashIdx < 0) return { basePath: urlValue, suffix: "" };
  const cutIdx = queryIdx < 0 ? hashIdx : hashIdx < 0 ? queryIdx : Math.min(queryIdx, hashIdx);
  return { basePath: urlValue.slice(0, cutIdx), suffix: urlValue.slice(cutIdx) };
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
};

function maybeInlineRelativeAssetUrl(urlValue: string, projectDir: string): string | null {
  if (!urlValue || !isRelativeUrl(urlValue)) return null;
  const { basePath, suffix } = splitUrlSuffix(urlValue.trim());
  if (!basePath) return null;
  const filePath = resolveWithinProject(projectDir, basePath);
  if (!filePath) return null;
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const mimeType = INLINE_MIME[ext];
  if (!mimeType) return null;
  const content = safeReadFileBuffer(filePath);
  if (content == null) return null;
  const dataUrl = `data:${mimeType};base64,${content.toString("base64")}`;
  return appendSuffixToUrl(dataUrl, suffix);
}

// fallow-ignore-next-line complexity
function rewriteColorGradingLutWithInlinedAssets(value: string, projectDir: string): string {
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
    const inlined = maybeInlineRelativeAssetUrl(lut, projectDir);
    if (!inlined) return value;
    Reflect.set(parsed, "lut", inlined);
    return JSON.stringify(parsed);
  }
  if (typeof lut !== "object" || lut === null || Array.isArray(lut)) return value;
  const lutSrc = Reflect.get(lut, "src");
  if (typeof lutSrc !== "string") return value;
  const inlined = maybeInlineRelativeAssetUrl(lutSrc, projectDir);
  if (!inlined) return value;
  Reflect.set(lut, "src", inlined);
  return JSON.stringify(parsed);
}

function rewriteSrcsetWithInlinedAssets(srcsetValue: string, projectDir: string): string {
  if (!srcsetValue) return srcsetValue;
  return srcsetValue
    .split(",")
    .map((rawCandidate) => {
      const candidate = rawCandidate.trim();
      if (!candidate) return candidate;
      const parts = candidate.split(/\s+/);
      if (parts.length === 0) return candidate;
      const maybeInlined = maybeInlineRelativeAssetUrl(parts[0] ?? "", projectDir);
      if (maybeInlined) parts[0] = maybeInlined;
      return parts.join(" ");
    })
    .join(", ");
}

function rewriteCssUrlsWithInlinedAssets(cssText: string, projectDir: string): string {
  if (!cssText) return cssText;
  return cssText.replace(
    /\burl\(\s*(["']?)([^)"']+)\1\s*\)/g,
    (_full, quote: string, rawUrl: string) => {
      const maybeInlined = maybeInlineRelativeAssetUrl((rawUrl || "").trim(), projectDir);
      if (!maybeInlined) return _full;
      return `url(${quote || ""}${maybeInlined}${quote || ""})`;
    },
  );
}

function cssAttributeSelector(attr: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[${attr}="${escaped}"]`;
}

function uniqueCompositionId(baseId: string, index: number): string {
  return `${baseId}__hf${index}`;
}

type BundledHostCompositionIdentity = {
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
  return counts;
}

function assignBundledRuntimeCompositionIds(
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

function parseHostVariableValues(host: Element): Record<string, unknown> {
  const raw = host.getAttribute("data-variable-values");
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export const FLATTENED_INNER_ROOT_STRIP_ATTRS = [
  "data-composition-id",
  "data-composition-file",
  "data-start",
  "data-duration",
  "data-end",
  "data-track-index",
  "data-track",
  "data-composition-src",
  "data-hf-authored-duration",
  "data-hf-authored-end",
];

export function prepareFlattenedInnerRoot(innerRoot: Element): Element {
  const prepared = innerRoot.cloneNode(true) as Element;
  const authoredRootId = prepared.getAttribute("id")?.trim();
  for (const attrName of FLATTENED_INNER_ROOT_STRIP_ATTRS) {
    prepared.removeAttribute(attrName);
  }
  if (authoredRootId) {
    prepared.removeAttribute("id");
    prepared.setAttribute("data-hf-authored-id", authoredRootId);
  }
  prepared.setAttribute("data-hf-inner-root", "true");
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

function coalesceHeadStylesAndBodyScripts(document: Document): void {
  const headStyleEls = [...document.querySelectorAll("head style")];
  if (headStyleEls.length > 1) {
    const imports: string[] = [];
    const cssParts: string[] = [];
    const seenImports = new Set<string>();
    for (const el of headStyleEls) {
      const raw = (el.textContent || "").trim();
      if (!raw) continue;
      const nonImportCss = raw.replace(CSS_IMPORT_RE, (match) => {
        const cleaned = match.trim();
        if (!seenImports.has(cleaned)) {
          seenImports.add(cleaned);
          imports.push(cleaned);
        }
        return "";
      });
      const trimmed = nonImportCss.trim();
      if (trimmed) cssParts.push(trimmed);
    }
    const merged = [...imports, ...cssParts].join("\n\n").trim();
    if (merged) {
      headStyleEls[0]!.textContent = merged;
      for (let i = 1; i < headStyleEls.length; i++) headStyleEls[i]!.remove();
    }
  }

  const bodyInlineScripts = [...document.querySelectorAll("body script")].filter((el) => {
    if (el.hasAttribute(RUNTIME_BOOTSTRAP_ATTR) || el.hasAttribute("src")) return false;
    const type = (el.getAttribute("type") || "").trim().toLowerCase();
    return !type || type === "text/javascript" || type === "application/javascript";
  });
  if (bodyInlineScripts.length > 0) {
    const mergedJs = joinJsChunks(bodyInlineScripts.map((el) => el.textContent || ""));
    for (const el of bodyInlineScripts) el.remove();
    if (mergedJs) {
      const stripped = stripJsCommentsParserSafe(mergedJs);
      const inlineScript = document.createElement("script");
      inlineScript.textContent = stripped;
      document.body.appendChild(inlineScript);
    }
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

function stripJsCommentsParserSafe(source: string): string {
  if (!source) return source;
  try {
    const result = transformSync(source, { loader: "js", minify: false, legalComments: "none" });
    return result.code.trim();
  } catch {
    return source;
  }
}

export interface BundleOptions {
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
}

/**
 * Bundle a project's index.html into a single self-contained HTML file.
 *
 * - Compiles timing attributes and optionally resolves media durations
 * - Injects the HyperFrames runtime script
 * - Inlines local CSS and JS files
 * - Inlines sub-composition HTML fragments (data-composition-src)
 * - Inlines small textual assets as data URLs
 */

function ensureExternalScriptTag(doc: Document, src: string): void {
  if (queryByAttr(doc, "src", src, "script")) return;
  const el = doc.createElement("script");
  el.setAttribute("src", src);
  doc.body.appendChild(el);
}

function hoistExternalScript(
  src: string,
  projectDir: string,
  doc: Document,
  seenSrcs: Set<string>,
  chunks: string[],
): void {
  if (seenSrcs.has(src)) return;
  seenSrcs.add(src);
  if (!isNonRelativeUrl(src) && !isAbsolute(src)) {
    const jsPath = resolveWithinProject(projectDir, src);
    const js = jsPath ? safeReadFile(jsPath) : null;
    if (js != null) {
      chunks.push(js);
      return;
    }
  }
  ensureExternalScriptTag(doc, src);
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
    compScriptChunks: string[];
  },
): void {
  for (const scriptEl of [...container.querySelectorAll("script")]) {
    const externalSrc = (scriptEl.getAttribute("src") || "").trim();
    if (externalSrc) {
      hoistExternalScript(
        externalSrc,
        opts.projectDir,
        opts.document,
        opts.seenCompScriptSrcs,
        opts.compScriptChunks,
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

export async function bundleToSingleHtml(
  projectDir: string,
  options?: BundleOptions,
): Promise<string> {
  const indexPath = join(projectDir, "index.html");
  if (!existsSync(indexPath)) throw new Error("index.html not found in project directory");

  const rawHtml = readFileSync(indexPath, "utf-8");
  const compiled = await compileHtml(rawHtml, projectDir, options?.probeMediaDuration);

  const staticGuard = await validateHyperframeHtmlContract(compiled);
  if (!staticGuard.isValid) {
    console.warn(
      `[StaticGuard] Invalid HyperFrame contract: ${staticGuard.missingKeys.join("; ")}`,
    );
  }

  const withInterceptor = injectInterceptor(compiled, options?.runtime ?? "inline");
  const document = parseHTMLContent(withInterceptor);

  // Inline local CSS
  const localCssChunks: string[] = [];
  let cssAnchorPlaced = false;
  for (const el of [...document.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = el.getAttribute("href");
    if (!href || !isRelativeUrl(href)) continue;
    const cssPath = resolveWithinProject(projectDir, href);
    if (!cssPath) continue;
    const css = safeReadFile(cssPath);
    if (css == null) continue;
    localCssChunks.push(inlineCssFile(css, dirname(cssPath), projectDir));
    if (!cssAnchorPlaced) {
      const anchor = document.createElement("style");
      anchor.setAttribute("data-hf-bundled-local-css", "1");
      el.replaceWith(anchor);
      cssAnchorPlaced = true;
    } else {
      el.remove();
    }
  }
  if (localCssChunks.length > 0) {
    const anchor = document.querySelector('style[data-hf-bundled-local-css="1"]');
    if (anchor) {
      anchor.removeAttribute("data-hf-bundled-local-css");
      anchor.textContent = localCssChunks.join("\n\n");
    } else {
      const style = document.createElement("style");
      style.textContent = localCssChunks.join("\n\n");
      document.head.appendChild(style);
    }
  }

  // Inline local JS
  const localJsChunks: string[] = [];
  let jsAnchorPlaced = false;
  for (const el of [...document.querySelectorAll("script[src]")]) {
    const src = el.getAttribute("src");
    if (!src || !isRelativeUrl(src)) continue;
    const jsPath = resolveWithinProject(projectDir, src);
    const js = jsPath ? safeReadFile(jsPath) : null;
    if (js == null) continue;
    localJsChunks.push(js);
    if (!jsAnchorPlaced) {
      const anchor = document.createElement("script");
      anchor.setAttribute("data-hf-bundled-local-js", "1");
      el.replaceWith(anchor);
      jsAnchorPlaced = true;
    } else {
      el.remove();
    }
  }
  if (localJsChunks.length > 0) {
    const anchor = document.querySelector('script[data-hf-bundled-local-js="1"]');
    const joinedJs = joinJsChunks(localJsChunks);
    if (anchor) {
      anchor.removeAttribute("data-hf-bundled-local-js");
      anchor.textContent = joinedJs;
    } else {
      const script = document.createElement("script");
      script.textContent = joinedJs;
      document.body.appendChild(script);
    }
  }

  // Inline sub-compositions (via shared function)
  const trackedCompositionHosts = getBundledTrackedCompositionHosts(document);
  const hostIdentityByElement = assignBundledRuntimeCompositionIds(trackedCompositionHosts);
  const subCompositionHosts = trackedCompositionHosts.filter((host) =>
    host.hasAttribute("data-composition-src"),
  );
  const subCompResult = inlineSubCompositions(document, subCompositionHosts, {
    resolveHtml: (srcPath: string) => {
      if (!isRelativeUrl(srcPath)) return null;
      const compPath = resolveWithinProject(projectDir, srcPath);
      return compPath ? safeReadFile(compPath) : null;
    },
    parseHtml: parseHTMLContent,
    hostIdentityMap: hostIdentityByElement,
    rewriteInlineStyles: true,
    flattenInnerRoot: prepareFlattenedInnerRoot,
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
  const compStyleChunks: string[] = [...subCompResult.styles];
  const compScriptChunks: string[] = [];
  const compExternalLinks = [...subCompResult.externalLinks];
  const compVariablesByComp: Record<string, Record<string, unknown>> = {
    ...subCompResult.variablesByComp,
  };
  const seenCompScriptSrcs = new Set<string>();
  for (const scriptItem of subCompResult.scriptItems) {
    if (scriptItem.kind === "inline") {
      compScriptChunks.push(scriptItem.content);
      continue;
    }
    const extSrc = scriptItem.src;
    if (seenCompScriptSrcs.has(extSrc)) continue;
    seenCompScriptSrcs.add(extSrc);
    if (isRelativeUrl(extSrc)) {
      const jsPath = resolveWithinProject(projectDir, extSrc);
      const js = jsPath ? safeReadFile(jsPath) : null;
      if (js != null) {
        compScriptChunks.push(js);
        continue;
      }
    }
    if (!queryByAttr(document, "src", extSrc, "script")) {
      const extScript = document.createElement("script");
      extScript.setAttribute("src", extSrc);
      document.body.appendChild(extScript);
    }
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
      const innerRoot = queryByAttr(innerDoc, "data-composition-id", compId);
      const authoredRootId = innerRoot?.getAttribute("id")?.trim() || null;
      const runtimeScope = runtimeCompId
        ? cssAttributeSelector("data-composition-id", runtimeCompId)
        : "";
      const mergedVariables = runtimeCompId ? parseHostVariableValues(host) : {};
      if (runtimeCompId && Object.keys(mergedVariables).length > 0) {
        compVariablesByComp[runtimeCompId] = mergedVariables;
      }

      if (innerRoot) {
        // Hoist styles into the collected style chunks
        for (const styleEl of [...innerRoot.querySelectorAll("style")]) {
          const css = styleEl.textContent || "";
          compStyleChunks.push(
            compId ? scopeCssToComposition(css, compId, runtimeScope, authoredRootId) : css,
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
          const css = styleEl.textContent || "";
          compStyleChunks.push(compId ? scopeCssToComposition(css, compId, runtimeScope) : css);
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
        });

        host.innerHTML = innerDoc.body.innerHTML || "";
      }
    }

    // Remove the template element from the document
    templateEl.remove();
  }

  // Inject external scripts from sub-compositions (e.g., Lottie CDN)
  // that aren't already present in the main document.
  for (const link of compExternalLinks) {
    const escapedHref = link.href.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    if (!document.querySelector(`link[href="${escapedHref}"]`)) {
      const linkEl = document.createElement("link");
      linkEl.setAttribute("rel", link.rel);
      linkEl.setAttribute("href", link.href);
      if (link.crossorigin != null) linkEl.setAttribute("crossorigin", link.crossorigin);
      document.head.appendChild(linkEl);
    }
  }

  if (compStyleChunks.length) {
    const style = document.createElement("style");
    style.textContent = compStyleChunks.join("\n\n");
    document.head.appendChild(style);
  }
  if (Object.keys(compVariablesByComp).length > 0) {
    compScriptChunks.unshift(
      `window.__hfVariablesByComp = Object.assign({}, window.__hfVariablesByComp || {}, ${JSON.stringify(compVariablesByComp)});`,
    );
  }
  if (compScriptChunks.length) {
    const compScript = document.createElement("script");
    compScript.textContent = joinJsChunks(compScriptChunks);
    document.body.appendChild(compScript);
  }

  enforceCompositionPixelSizing(document);
  autoHealMissingCompositionIds(document);
  coalesceHeadStylesAndBodyScripts(document);
  injectTextRenderingRule(document);

  // Inline textual assets
  for (const el of [...document.querySelectorAll("[src], [href], [poster], [xlink\\:href]")]) {
    for (const attr of ["src", "href", "poster", "xlink:href"] as const) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const inlined = maybeInlineRelativeAssetUrl(value, projectDir);
      if (inlined) el.setAttribute(attr, inlined);
    }
  }
  for (const el of [...document.querySelectorAll("[srcset]")]) {
    const srcset = el.getAttribute("srcset");
    if (srcset) el.setAttribute("srcset", rewriteSrcsetWithInlinedAssets(srcset, projectDir));
  }
  for (const styleEl of document.querySelectorAll("style")) {
    styleEl.textContent = rewriteCssUrlsWithInlinedAssets(styleEl.textContent || "", projectDir);
  }
  for (const el of [...document.querySelectorAll("[style]")]) {
    el.setAttribute(
      "style",
      rewriteCssUrlsWithInlinedAssets(el.getAttribute("style") || "", projectDir),
    );
  }
  for (const el of [...document.querySelectorAll(`[${HF_COLOR_GRADING_ATTR}]`)]) {
    const value = el.getAttribute(HF_COLOR_GRADING_ATTR);
    if (value) {
      el.setAttribute(
        HF_COLOR_GRADING_ATTR,
        rewriteColorGradingLutWithInlinedAssets(value, projectDir),
      );
    }
  }

  return document.toString();
}
