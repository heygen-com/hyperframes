import { readFileSync, existsSync } from "fs";
import { join, resolve, isAbsolute, sep } from "path";
import * as cheerio from "cheerio";
import { transformSync } from "esbuild";
import { compileHtml, type MediaDurationProber } from "./htmlCompiler";
import { rewriteAssetPaths } from "./rewriteSubCompPaths";
import { validateHyperframeHtmlContract } from "./staticGuard";

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

function enforceCompositionPixelSizing($: cheerio.CheerioAPI): void {
  const compositionEls = $("[data-composition-id][data-width][data-height]").toArray();
  if (compositionEls.length === 0) return;
  const sizeMap = new Map<string, { w: number; h: number }>();
  for (const el of compositionEls) {
    const compId = $(el).attr("data-composition-id");
    const w = Number($(el).attr("data-width"));
    const h = Number($(el).attr("data-height"));
    if (compId && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      sizeMap.set(compId, { w, h });
    }
  }
  if (sizeMap.size === 0) return;
  $("style").each((_, styleEl) => {
    let css = $(styleEl).html() || "";
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
    if (modified) $(styleEl).text(css);
  });
}

function autoHealMissingCompositionIds($: cheerio.CheerioAPI): void {
  const compositionIdRe = /data-composition-id=["']([^"']+)["']/gi;
  const referencedIds = new Set<string>();
  $("style, script").each((_, el) => {
    const text = ($(el).html() || "").trim();
    if (!text) return;
    let match: RegExpExecArray | null;
    while ((match = compositionIdRe.exec(text)) !== null) {
      const compId = (match[1] || "").trim();
      if (compId) referencedIds.add(compId);
    }
  });
  if (referencedIds.size === 0) return;

  const existingIds = new Set<string>();
  $("[data-composition-id]").each((_, el) => {
    const id = ($(el).attr("data-composition-id") || "").trim();
    if (id) existingIds.add(id);
  });

  for (const compId of referencedIds) {
    if (compId === "root" || existingIds.has(compId)) continue;
    const candidates = [`${compId}-layer`, `${compId}-comp`, compId];
    for (const targetId of candidates) {
      const match = $(`#${targetId}`).first();
      if (match.length > 0 && !match.attr("data-composition-id")) {
        match.attr("data-composition-id", compId);
        break;
      }
    }
  }
}

function coalesceHeadStylesAndBodyScripts($: cheerio.CheerioAPI): void {
  const headStyleEls = $("head style").toArray();
  if (headStyleEls.length > 1) {
    const importRe = /@import\s+url\([^)]*\)\s*;|@import\s+["'][^"']+["']\s*;/gi;
    const imports: string[] = [];
    const cssParts: string[] = [];
    const seenImports = new Set<string>();
    for (const el of headStyleEls) {
      const raw = ($(el).html() || "").trim();
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
      $(headStyleEls[0]).text(merged);
      for (let i = 1; i < headStyleEls.length; i++) $(headStyleEls[i]).remove();
    }
  }

  const bodyInlineScripts = $("body script")
    .toArray()
    .filter((el) => {
      const src = ($(el).attr("src") || "").trim();
      if (src) return false;
      const type = ($(el).attr("type") || "").trim().toLowerCase();
      return !type || type === "text/javascript" || type === "application/javascript";
    });
  if (bodyInlineScripts.length > 0) {
    const mergedJs = bodyInlineScripts
      .map((el) => ($(el).html() || "").trim())
      .filter(Boolean)
      .join("\n;\n")
      .trim();
    for (const el of bodyInlineScripts) $(el).remove();
    if (mergedJs) {
      const stripped = stripJsCommentsParserSafe(mergedJs);
      $("body").append(`<script>${stripped}</script>`);
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
  const $ = cheerio.load(withInterceptor);

  // Inline local CSS
  const localCssChunks: string[] = [];
  let cssAnchorPlaced = false;
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !isRelativeUrl(href)) return;
    const cssPath = safePath(projectDir, href);
    const css = cssPath ? safeReadFile(cssPath) : null;
    if (css == null) return;
    localCssChunks.push(css);
    if (!cssAnchorPlaced) {
      $(el).replaceWith('<style data-hf-bundled-local-css="1"></style>');
      cssAnchorPlaced = true;
    } else {
      $(el).remove();
    }
  });
  if (localCssChunks.length > 0) {
    const $anchor = $('style[data-hf-bundled-local-css="1"]').first();
    if ($anchor.length)
      $anchor.removeAttr("data-hf-bundled-local-css").text(localCssChunks.join("\n\n"));
    else $("head").append(`<style>${localCssChunks.join("\n\n")}</style>`);
  }

  // Inline local JS
  const localJsChunks: string[] = [];
  let jsAnchorPlaced = false;
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src || !isRelativeUrl(src)) return;
    const jsPath = safePath(projectDir, src);
    const js = jsPath ? safeReadFile(jsPath) : null;
    if (js == null) return;
    localJsChunks.push(js);
    if (!jsAnchorPlaced) {
      $(el).replaceWith('<script data-hf-bundled-local-js="1"></script>');
      jsAnchorPlaced = true;
    } else {
      $(el).remove();
    }
  });
  if (localJsChunks.length > 0) {
    const $anchor = $('script[data-hf-bundled-local-js="1"]').first();
    if ($anchor.length)
      $anchor.removeAttr("data-hf-bundled-local-js").text(localJsChunks.join("\n;\n"));
    else $("body").append(`<script>${localJsChunks.join("\n;\n")}</script>`);
  }

  // Inline sub-compositions
  const compStyleChunks: string[] = [];
  const compScriptChunks: string[] = [];
  const compExternalScriptSrcs: string[] = [];
  $("[data-composition-src]").each((_, hostEl) => {
    const src = $(hostEl).attr("data-composition-src");
    if (!src || !isRelativeUrl(src)) return;
    const compPath = safePath(projectDir, src);
    const compHtml = compPath ? safeReadFile(compPath) : null;
    if (compHtml == null) {
      console.warn(`[Bundler] Composition file not found: ${src}`);
      return;
    }

    const $comp = cheerio.load(compHtml);
    const compId = $(hostEl).attr("data-composition-id");
    const $contentRoot = $comp("template").first();
    const contentHtml = $contentRoot.length
      ? $contentRoot.html() || ""
      : $comp("body").html() || "";
    const $content = cheerio.load(contentHtml);
    const $innerRoot = compId
      ? $content(`[data-composition-id="${compId}"]`).first()
      : $content("[data-composition-id]").first();

    $content("style").each((_, s) => {
      compStyleChunks.push($content(s).html() || "");
      $content(s).remove();
    });
    $content("script").each((_, s) => {
      const externalSrc = ($content(s).attr("src") || "").trim();
      if (externalSrc) {
        // External CDN/remote script — collect for deduped injection into the document.
        // Do NOT try to inline the content (external scripts have no innerHTML).
        if (!compExternalScriptSrcs.includes(externalSrc)) {
          compExternalScriptSrcs.push(externalSrc);
        }
      } else {
        compScriptChunks.push(
          `(function(){ try { ${$content(s).html() || ""} } catch (_err) { console.error('[HyperFrames] composition script error:', _err); } })();`,
        );
      }
      $content(s).remove();
    });

    // Rewrite relative asset paths before inlining so ../foo.svg from
    // compositions/ resolves correctly when the content moves to root.
    const $assetEls = $innerRoot.length
      ? $innerRoot.find("[src], [href]")
      : $content("[src], [href]");
    rewriteAssetPaths(
      $assetEls.toArray(),
      src,
      (el, attr) => $content(el).attr(attr),
      (el, attr, val) => {
        $content(el).attr(attr, val);
      },
    );

    if ($innerRoot.length) {
      const innerCompId = $innerRoot.attr("data-composition-id");
      const innerW = $innerRoot.attr("data-width");
      const innerH = $innerRoot.attr("data-height");
      if (innerCompId && !$(hostEl).attr("data-composition-id"))
        $(hostEl).attr("data-composition-id", innerCompId);
      if (innerW && !$(hostEl).attr("data-width")) $(hostEl).attr("data-width", innerW);
      if (innerH && !$(hostEl).attr("data-height")) $(hostEl).attr("data-height", innerH);
      $innerRoot.find("style, script").remove();
      $(hostEl).html($innerRoot.html() || "");
    } else {
      $content("style, script").remove();
      $(hostEl).html($content.html() || "");
    }
    $(hostEl).removeAttr("data-composition-src");
  });

  // Inline template compositions: inject <template id="X-template"> content into
  // matching empty host elements with data-composition-id="X" (no data-composition-src)
  $("template[id]").each((_, templateEl) => {
    const templateId = $(templateEl).attr("id") || "";
    const match = templateId.match(/^(.+)-template$/);
    if (!match) return;
    const compId = match[1];

    // Find the matching host element (must have data-composition-id, no data-composition-src,
    // and must NOT be inside a <template> element). In cheerio, elements inside <template>
    // have a detached parent chain (parents().length === 0), so we filter those out.
    const hostSelector = `[data-composition-id="${compId}"]:not([data-composition-src])`;
    const $candidates = $(hostSelector).filter((__, el) => $(el).parents().length > 0);
    const $host = $candidates.first();
    if ($host.length === 0) return;
    if ($host.children().length > 0) return; // already has content

    // Get template content and inject into host
    const templateHtml = $(templateEl).html() || "";
    const $inner = cheerio.load(templateHtml, { xml: false });
    const $innerRoot = $inner(`[data-composition-id="${compId}"]`).first();

    if ($innerRoot.length > 0) {
      // Hoist styles into the collected style chunks
      $innerRoot.find("style").each((__, styleEl) => {
        compStyleChunks.push($inner(styleEl).html() || "");
        $inner(styleEl).remove();
      });
      // Hoist scripts into the collected script chunks
      $innerRoot.find("script").each((__, scriptEl) => {
        const externalSrc = ($inner(scriptEl).attr("src") || "").trim();
        if (externalSrc) {
          if (!compExternalScriptSrcs.includes(externalSrc)) {
            compExternalScriptSrcs.push(externalSrc);
          }
        } else {
          compScriptChunks.push(
            `(function(){ try { ${$inner(scriptEl).html() || ""} } catch (_err) { console.error('[HyperFrames] composition script error:', _err); } })();`,
          );
        }
        $inner(scriptEl).remove();
      });

      // Copy dimension attributes from inner root to host if not already set
      const innerW = $innerRoot.attr("data-width");
      const innerH = $innerRoot.attr("data-height");
      if (innerW && !$host.attr("data-width")) $host.attr("data-width", innerW);
      if (innerH && !$host.attr("data-height")) $host.attr("data-height", innerH);

      // Set host content from inner root
      $host.html($innerRoot.html() || "");
    } else {
      // No matching inner root — inject all template content directly
      $inner("style").each((__, styleEl) => {
        compStyleChunks.push($inner(styleEl).html() || "");
        $inner(styleEl).remove();
      });
      $inner("script").each((__, scriptEl) => {
        const externalSrc = ($inner(scriptEl).attr("src") || "").trim();
        if (externalSrc) {
          if (!compExternalScriptSrcs.includes(externalSrc)) {
            compExternalScriptSrcs.push(externalSrc);
          }
        } else {
          compScriptChunks.push(
            `(function(){ try { ${$inner(scriptEl).html() || ""} } catch (_err) { console.error('[HyperFrames] composition script error:', _err); } })();`,
          );
        }
        $inner(scriptEl).remove();
      });
      $host.html($inner.html() || "");
    }

    // Remove the template element from the document
    $(templateEl).remove();
  });

  // Inject external scripts from sub-compositions (e.g., Lottie CDN)
  // that aren't already present in the main document.
  for (const extSrc of compExternalScriptSrcs) {
    if (!$(`script[src="${extSrc}"]`).length) {
      $("body").append(`<script src="${extSrc}"></script>`);
    }
  }

  if (compStyleChunks.length) $("head").append(`<style>${compStyleChunks.join("\n\n")}</style>`);
  if (compScriptChunks.length)
    $("body").append(`<script>${compScriptChunks.join("\n;\n")}</script>`);

  enforceCompositionPixelSizing($);
  autoHealMissingCompositionIds($);
  coalesceHeadStylesAndBodyScripts($);

  // Inline textual assets
  $("[src], [href], [poster], [xlink\\:href]").each((_, el) => {
    for (const attr of ["src", "href", "poster", "xlink:href"] as const) {
      const value = $(el).attr(attr);
      if (!value) continue;
      const inlined = maybeInlineRelativeAssetUrl(value, projectDir);
      if (inlined) $(el).attr(attr, inlined);
    }
  });
  $("[srcset]").each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (srcset) $(el).attr("srcset", rewriteSrcsetWithInlinedAssets(srcset, projectDir));
  });
  $("style").each((_, el) => {
    $(el).text(rewriteCssUrlsWithInlinedAssets($(el).html() || "", projectDir));
  });
  $("[style]").each((_, el) => {
    $(el).attr("style", rewriteCssUrlsWithInlinedAssets($(el).attr("style") || "", projectDir));
  });

  return $.html();
}
