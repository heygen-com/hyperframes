import { readFileSync, existsSync } from "fs";
import { join, resolve, isAbsolute, sep } from "path";
import { parseHTML } from "linkedom";
import { transformSync } from "esbuild";
import { compileHtml, type MediaDurationProber } from "./htmlCompiler";
import { rewriteAssetPaths, rewriteCssAssetUrls } from "./rewriteSubCompPaths";
import { scopeCssToComposition, wrapScopedCompositionScript } from "./compositionScoping";
import { validateHyperframeHtmlContract } from "./staticGuard";

/**
 * Parse an HTML string into a document. Fragments (without a full document
 * structure) are wrapped in `<!DOCTYPE html><html><head></head><body>…</body></html>`
 * so that linkedom places the content inside `document.body`.
 */
function parseHTMLContent(html: string): Document {
  const trimmed = html.trimStart().toLowerCase();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    return parseHTML(html).document;
  }
  return parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`).document;
}

/** Resolve a relative path within projectDir, rejecting traversal outside it. */
function safePath(projectDir: string, relativePath: string): string | null {
  const resolved = resolve(projectDir, relativePath);
  const normalizedBase = resolve(projectDir) + sep;
  if (!resolved.startsWith(normalizedBase) && resolved !== resolve(projectDir)) return null;
  return resolved;
}

const RUNTIME_BOOTSTRAP_ATTR = "data-hyperframes-preview-runtime";
const DEFAULT_RUNTIME_SCRIPT_URL = "";

function stripEmbeddedRuntimeScripts(html: string): string {
  if (!html) return html;
  const scriptRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  const runtimeSrcMarkers = [
    "hyperframe.runtime.iife.js",
    "hyperframe-runtime.modular-runtime.inline.js",
    RUNTIME_BOOTSTRAP_ATTR,
  ];
  const runtimeInlineMarkers = [
    "__hyperframeRuntimeBootstrapped",
    "__hyperframeRuntime",
    "__hyperframeRuntimeTeardown",
    "window.__player =",
    "window.__playerReady",
    "window.__renderReady",
  ];

  const shouldStrip = (block: string): boolean => {
    const lowered = block.toLowerCase();
    for (const marker of runtimeSrcMarkers) {
      if (lowered.includes(marker.toLowerCase())) return true;
    }
    for (const marker of runtimeInlineMarkers) {
      if (block.includes(marker)) return true;
    }
    return false;
  };

  return html.replace(scriptRe, (block) => (shouldStrip(block) ? "" : block));
}

function getRuntimeScriptUrl(): string {
  const configured = (process.env.HYPERFRAME_RUNTIME_URL || "").trim();
  return configured || DEFAULT_RUNTIME_SCRIPT_URL;
}

function injectInterceptor(html: string): string {
  const sanitized = stripEmbeddedRuntimeScripts(html);
  if (sanitized.includes(RUNTIME_BOOTSTRAP_ATTR)) return sanitized;

  const runtimeScriptUrl = getRuntimeScriptUrl().replace(/"/g, "&quot;");
  const tag = `<script ${RUNTIME_BOOTSTRAP_ATTR}="1" src="${runtimeScriptUrl}"></script>`;
  if (sanitized.includes("</head>")) {
    return sanitized.replace("</head>", `${tag}\n</head>`);
  }
  const doctypeIdx = sanitized.toLowerCase().indexOf("<!doctype");
  if (doctypeIdx >= 0) {
    const insertPos = sanitized.indexOf(">", doctypeIdx) + 1;
    return sanitized.slice(0, insertPos) + tag + sanitized.slice(insertPos);
  }
  return tag + sanitized;
}

function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  return (
    !url.startsWith("http://") &&
    !url.startsWith("https://") &&
    !url.startsWith("//") &&
    !url.startsWith("data:") &&
    !isAbsolute(url)
  );
}

function safeReadFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
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

function guessMimeType(filePath: string): string {
  const l = filePath.toLowerCase();
  if (l.endsWith(".svg")) return "image/svg+xml";
  if (l.endsWith(".json")) return "application/json";
  if (l.endsWith(".txt")) return "text/plain";
  if (l.endsWith(".xml")) return "application/xml";
  return "application/octet-stream";
}

function shouldInlineAsDataUrl(filePath: string): boolean {
  const l = filePath.toLowerCase();
  return l.endsWith(".svg") || l.endsWith(".json") || l.endsWith(".txt") || l.endsWith(".xml");
}

function maybeInlineRelativeAssetUrl(urlValue: string, projectDir: string): string | null {
  if (!urlValue || !isRelativeUrl(urlValue)) return null;
  const { basePath, suffix } = splitUrlSuffix(urlValue.trim());
  if (!basePath) return null;
  const filePath = safePath(projectDir, basePath);
  if (!filePath || !shouldInlineAsDataUrl(filePath)) return null;
  const content = safeReadFileBuffer(filePath);
  if (content == null) return null;
  const mimeType = guessMimeType(filePath);
  const dataUrl = `data:${mimeType};base64,${content.toString("base64")}`;
  return appendSuffixToUrl(dataUrl, suffix);
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
  return `[${attr}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function uniqueCompositionId(baseId: string, index: number): string {
  return `${baseId}__hf${index}`;
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
    const importRe = /@import\s+url\([^)]*\)\s*;|@import\s+["'][^"']+["']\s*;/gi;
    const imports: string[] = [];
    const cssParts: string[] = [];
    const seenImports = new Set<string>();
    for (const el of headStyleEls) {
      const raw = (el.textContent || "").trim();
      if (!raw) continue;
      const nonImportCss = raw.replace(importRe, (match) => {
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
    const src = (el.getAttribute("src") || "").trim();
    if (src) return false;
    const type = (el.getAttribute("type") || "").trim().toLowerCase();
    return !type || type === "text/javascript" || type === "application/javascript";
  });
  if (bodyInlineScripts.length > 0) {
    const mergedJs = bodyInlineScripts
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean)
      .join("\n;\n")
      .trim();
    for (const el of bodyInlineScripts) el.remove();
    if (mergedJs) {
      const stripped = stripJsCommentsParserSafe(mergedJs);
      const inlineScript = document.createElement("script");
      inlineScript.textContent = stripped;
      document.body.appendChild(inlineScript);
    }
  }
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
export async function bundleToSingleHtml(
  projectDir: string,
  options?: BundleOptions,
): Promise<string> {
  const indexPath = join(projectDir, "index.html");
  if (!existsSync(indexPath)) throw new Error("index.html not found in project directory");

  const rawHtml = readFileSync(indexPath, "utf-8");
  const compiled = await compileHtml(rawHtml, projectDir, options?.probeMediaDuration);

  const staticGuard = validateHyperframeHtmlContract(compiled);
  if (!staticGuard.isValid) {
    console.warn(
      `[StaticGuard] Invalid HyperFrame contract: ${staticGuard.missingKeys.join("; ")}`,
    );
  }

  const withInterceptor = injectInterceptor(compiled);
  const { document } = parseHTML(withInterceptor);

  // Inline local CSS
  const localCssChunks: string[] = [];
  let cssAnchorPlaced = false;
  for (const el of [...document.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = el.getAttribute("href");
    if (!href || !isRelativeUrl(href)) continue;
    const cssPath = safePath(projectDir, href);
    const css = cssPath ? safeReadFile(cssPath) : null;
    if (css == null) continue;
    localCssChunks.push(css);
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
    const jsPath = safePath(projectDir, src);
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
    if (anchor) {
      anchor.removeAttribute("data-hf-bundled-local-js");
      anchor.textContent = localJsChunks.join("\n;\n");
    } else {
      const script = document.createElement("script");
      script.textContent = localJsChunks.join("\n;\n");
      document.body.appendChild(script);
    }
  }

  // Inline sub-compositions
  const compStyleChunks: string[] = [];
  const compScriptChunks: string[] = [];
  const compExternalScriptSrcs: string[] = [];
  const subCompositionHosts = [...document.querySelectorAll("[data-composition-src]")];
  const hostCountsByCompositionId = new Map<string, number>();
  for (const hostEl of subCompositionHosts) {
    const compId = (hostEl.getAttribute("data-composition-id") || "").trim();
    if (!compId) continue;
    hostCountsByCompositionId.set(compId, (hostCountsByCompositionId.get(compId) || 0) + 1);
  }
  const hostInstanceByCompositionId = new Map<string, number>();
  for (const hostEl of subCompositionHosts) {
    const src = hostEl.getAttribute("data-composition-src");
    if (!src || !isRelativeUrl(src)) continue;
    const compPath = safePath(projectDir, src);
    const compHtml = compPath ? safeReadFile(compPath) : null;
    if (compHtml == null) {
      console.warn(`[Bundler] Composition file not found: ${src}`);
      continue;
    }

    const compDoc = parseHTMLContent(compHtml);
    const compId = hostEl.getAttribute("data-composition-id");
    const contentRoot = compDoc.querySelector("template");
    const contentHtml = contentRoot ? contentRoot.innerHTML || "" : compDoc.body.innerHTML || "";
    const contentDoc = parseHTMLContent(contentHtml);
    const innerRoot = compId
      ? contentDoc.querySelector(`[data-composition-id="${compId}"]`)
      : contentDoc.querySelector("[data-composition-id]");
    const inferredCompId = innerRoot?.getAttribute("data-composition-id")?.trim() || "";
    const scopeCompId = compId || inferredCompId;
    const duplicateInstance = scopeCompId && (hostCountsByCompositionId.get(scopeCompId) || 0) > 1;
    const instanceIndex = duplicateInstance
      ? (hostInstanceByCompositionId.get(scopeCompId) || 0) + 1
      : 0;
    if (duplicateInstance) hostInstanceByCompositionId.set(scopeCompId, instanceIndex);
    const runtimeCompId =
      duplicateInstance && scopeCompId
        ? uniqueCompositionId(scopeCompId, instanceIndex)
        : scopeCompId;
    const runtimeScope = runtimeCompId
      ? cssAttributeSelector("data-composition-id", runtimeCompId)
      : "";
    if (duplicateInstance && runtimeCompId) {
      hostEl.setAttribute("data-hf-original-composition-id", scopeCompId);
      hostEl.setAttribute("data-composition-id", runtimeCompId);
    }

    // When a sub-composition is a full HTML document (no <template>), styles
    // and scripts in <head> are not part of contentDoc (which only has body
    // content). Extract them so backgrounds, positioning, fonts, and library
    // scripts (e.g. GSAP CDN) are not silently dropped.
    if (!contentRoot && compDoc.head) {
      for (const s of [...compDoc.head.querySelectorAll("style")]) {
        const css = rewriteCssAssetUrls(s.textContent || "", src);
        compStyleChunks.push(
          scopeCompId ? scopeCssToComposition(css, scopeCompId, runtimeScope) : css,
        );
      }
      for (const s of [...compDoc.head.querySelectorAll("script")]) {
        const externalSrc = (s.getAttribute("src") || "").trim();
        if (externalSrc && !compExternalScriptSrcs.includes(externalSrc)) {
          compExternalScriptSrcs.push(externalSrc);
        }
      }
    }

    for (const s of [...contentDoc.querySelectorAll("style")]) {
      const css = rewriteCssAssetUrls(s.textContent || "", src);
      compStyleChunks.push(
        scopeCompId ? scopeCssToComposition(css, scopeCompId, runtimeScope) : css,
      );
      s.remove();
    }
    for (const s of [...contentDoc.querySelectorAll("script")]) {
      const externalSrc = (s.getAttribute("src") || "").trim();
      if (externalSrc) {
        // External CDN/remote script — collect for deduped injection into the document.
        // Do NOT try to inline the content (external scripts have no innerHTML).
        if (!compExternalScriptSrcs.includes(externalSrc)) {
          compExternalScriptSrcs.push(externalSrc);
        }
      } else {
        compScriptChunks.push(
          scopeCompId
            ? wrapScopedCompositionScript(
                s.textContent || "",
                scopeCompId,
                "[HyperFrames] composition script error:",
                runtimeScope,
                runtimeCompId || scopeCompId,
              )
            : `(function(){ try { ${s.textContent || ""} } catch (_err) { console.error('[HyperFrames] composition script error:', _err); } })();`,
        );
      }
      s.remove();
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
    );

    if (innerRoot) {
      const innerW = innerRoot.getAttribute("data-width");
      const innerH = innerRoot.getAttribute("data-height");
      if (innerW && !hostEl.getAttribute("data-width")) hostEl.setAttribute("data-width", innerW);
      if (innerH && !hostEl.getAttribute("data-height")) hostEl.setAttribute("data-height", innerH);
      for (const child of [...innerRoot.querySelectorAll("style, script")]) child.remove();
      hostEl.innerHTML = compId ? innerRoot.innerHTML || "" : innerRoot.outerHTML || "";
    } else {
      for (const child of [...contentDoc.querySelectorAll("style, script")]) child.remove();
      hostEl.innerHTML = contentDoc.body.innerHTML || "";
    }
    hostEl.removeAttribute("data-composition-src");
  }

  // Inline template compositions: inject <template id="X-template"> content into
  // matching empty host elements with data-composition-id="X" (no data-composition-src)
  for (const templateEl of [...document.querySelectorAll("template[id]")]) {
    const templateId = templateEl.getAttribute("id") || "";
    const match = templateId.match(/^(.+)-template$/);
    if (!match) continue;
    const compId = match[1];

    // Find the matching host element (must have data-composition-id, no data-composition-src,
    // and must NOT be inside a <template> element).
    const hostSelector = `[data-composition-id="${compId}"]:not([data-composition-src])`;
    // linkedom follows the DOM spec: querySelectorAll does not reach inside <template>
    // content, so no isInsideTemplate filter is needed.
    const host = document.querySelector(hostSelector);
    if (!host) continue;
    if (host.children.length > 0) continue; // already has content

    // Get template content and inject into host
    const templateHtml = templateEl.innerHTML || "";
    const innerDoc = parseHTMLContent(templateHtml);
    const innerRoot = innerDoc.querySelector(`[data-composition-id="${compId}"]`);

    if (innerRoot) {
      // Hoist styles into the collected style chunks
      for (const styleEl of [...innerRoot.querySelectorAll("style")]) {
        const css = styleEl.textContent || "";
        compStyleChunks.push(compId ? scopeCssToComposition(css, compId) : css);
        styleEl.remove();
      }
      // Hoist scripts into the collected script chunks
      for (const scriptEl of [...innerRoot.querySelectorAll("script")]) {
        const externalSrc = (scriptEl.getAttribute("src") || "").trim();
        if (externalSrc) {
          if (!compExternalScriptSrcs.includes(externalSrc)) {
            compExternalScriptSrcs.push(externalSrc);
          }
        } else {
          compScriptChunks.push(
            compId
              ? wrapScopedCompositionScript(
                  scriptEl.textContent || "",
                  compId,
                  "[HyperFrames] composition script error:",
                )
              : `(function(){ try { ${scriptEl.textContent || ""} } catch (_err) { console.error('[HyperFrames] composition script error:', _err); } })();`,
          );
        }
        scriptEl.remove();
      }

      // Copy dimension attributes from inner root to host if not already set
      const innerW = innerRoot.getAttribute("data-width");
      const innerH = innerRoot.getAttribute("data-height");
      if (innerW && !host.getAttribute("data-width")) host.setAttribute("data-width", innerW);
      if (innerH && !host.getAttribute("data-height")) host.setAttribute("data-height", innerH);

      host.innerHTML = innerRoot.innerHTML || "";
    } else {
      // No matching inner root — inject all template content directly
      for (const styleEl of [...innerDoc.querySelectorAll("style")]) {
        const css = styleEl.textContent || "";
        compStyleChunks.push(compId ? scopeCssToComposition(css, compId) : css);
        styleEl.remove();
      }
      for (const scriptEl of [...innerDoc.querySelectorAll("script")]) {
        const externalSrc = (scriptEl.getAttribute("src") || "").trim();
        if (externalSrc) {
          if (!compExternalScriptSrcs.includes(externalSrc)) {
            compExternalScriptSrcs.push(externalSrc);
          }
        } else {
          compScriptChunks.push(
            compId
              ? wrapScopedCompositionScript(
                  scriptEl.textContent || "",
                  compId,
                  "[HyperFrames] composition script error:",
                )
              : `(function(){ try { ${scriptEl.textContent || ""} } catch (_err) { console.error('[HyperFrames] composition script error:', _err); } })();`,
          );
        }
        scriptEl.remove();
      }
      host.innerHTML = innerDoc.body.innerHTML || "";
    }

    // Remove the template element from the document
    templateEl.remove();
  }

  // Inject external scripts from sub-compositions (e.g., Lottie CDN)
  // that aren't already present in the main document.
  for (const extSrc of compExternalScriptSrcs) {
    if (!document.querySelector(`script[src="${extSrc}"]`)) {
      const extScript = document.createElement("script");
      extScript.setAttribute("src", extSrc);
      document.body.appendChild(extScript);
    }
  }

  if (compStyleChunks.length) {
    const style = document.createElement("style");
    style.textContent = compStyleChunks.join("\n\n");
    document.head.appendChild(style);
  }
  if (compScriptChunks.length) {
    const compScript = document.createElement("script");
    compScript.textContent = compScriptChunks.join("\n;\n");
    document.body.appendChild(compScript);
  }

  enforceCompositionPixelSizing(document);
  autoHealMissingCompositionIds(document);
  coalesceHeadStylesAndBodyScripts(document);

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

  return document.toString();
}
