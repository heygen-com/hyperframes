/**
 * Extract full-page HTML from a website using Puppeteer CDP.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Page } from "puppeteer-core";
import type { ExtractedHtml } from "./types.js";
import { safeFetch } from "./assetDownloader.js";
import { CAPTURE_USER_AGENT } from "./userAgent.js";

const DEFAULT_SETTLE_TIME = 3000;
// page.html inlines images up to this many data-URL characters; the rest keep their absolute URL.
// Unbounded, an image-heavy page returned a 368 MB body over CDP and the capture timed out.
const PAGE_HTML_INLINE_IMAGE_BUDGET_CHARS = 25 * 1024 * 1024;
// Stylesheet and image inlining stop here; the final DOM read always runs, so a slow page
// still yields its HTML.
const HTML_EXTRACT_TIME_BUDGET_MS = 20_000;

// Pre-existing capture pipeline size — surfaced by a one-line escape fix, not new logic.
// fallow-ignore-next-line complexity
export async function extractHtml(
  page: Page,
  opts: {
    settleTime?: number;
    inlineImageBudgetChars?: number;
    timeBudgetMs?: number;
    onWarning?: (message: string) => void;
  } = {},
): Promise<ExtractedHtml> {
  const settleTime = opts.settleTime ?? DEFAULT_SETTLE_TIME;
  const inlineImageBudgetChars = opts.inlineImageBudgetChars ?? PAGE_HTML_INLINE_IMAGE_BUDGET_CHARS;
  const deadline = Date.now() + (opts.timeBudgetMs ?? HTML_EXTRACT_TIME_BUDGET_MS);
  const msLeft = (): number => Math.max(0, deadline - Date.now());

  // Lazy-load scroll removed — index.ts already scrolls before calling extractHtml.
  // Images are loaded by the time we get here.
  // Settle wait kept as buffer before DOM extraction.
  await new Promise((r) => setTimeout(r, Math.min(settleTime, msLeft())));

  // Step 2: Inline external stylesheets
  // Fetch CSS from Node.js (bypasses CORS) then inject into page
  const stylesheetUrls = (await page.evaluate(`(() => {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).map(function(l) { return l.href; });
  })()`)) as string[];

  for (const [index, href] of stylesheetUrls.entries()) {
    if (msLeft() <= 0) {
      opts.onWarning?.(
        `page.html: ${stylesheetUrls.length - index} stylesheet(s) left as links; the HTML time budget ran out`,
      );
      break;
    }
    try {
      const res = await safeFetch(href, {
        signal: AbortSignal.timeout(Math.min(10000, msLeft())),
        headers: { "User-Agent": CAPTURE_USER_AGENT },
      });
      if (!res?.ok) {
        await res?.body?.cancel().catch(() => {});
        continue;
      }
      let css = await res.text();
      // Fix relative url() references
      // fallow-ignore-next-line complexity
      css = css.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g, (match: string, url: string) => {
        if (url.startsWith("data:") || url.startsWith("http") || url.startsWith("//")) return match;
        try {
          return `url('${new URL(url, href).href}')`;
        } catch {
          return match;
        }
      });
      // Add the CSS as a <style> tag in <head> via Puppeteer's addStyleTag
      await page.addStyleTag({ content: css });
      // Remove the original <link> tag (use parameterized evaluate to avoid injection)
      await page.evaluate((targetHref: string) => {
        const links = document.querySelectorAll('link[rel="stylesheet"]');
        for (const link of links) {
          if ((link as HTMLLinkElement).href === targetHref) {
            link.remove();
            break;
          }
        }
      }, href);
    } catch {
      /* network error — skip */
    }
  }

  // Step 3: Make URLs absolute and fix HTML entity encoding in src attributes
  await page.evaluate(`(() => {
    document.querySelectorAll("img[src]").forEach(function(el) {
      try {
        // getAttribute returns the raw HTML attribute (with &amp;)
        // .src returns the resolved URL (with &) — use .src for the correct value
        var resolved = el.src;
        if (resolved) el.setAttribute("src", resolved);
      } catch(e) {}
    });
    // Fix srcset attributes too (Next.js image optimization)
    document.querySelectorAll("img[srcset]").forEach(function(el) {
      try {
        var srcset = el.getAttribute("srcset") || "";
        // Decode &amp; entities in srcset
        srcset = srcset.replace(/&amp;/g, "&");
        el.setAttribute("srcset", srcset);
      } catch(e) {}
    });
    document.querySelectorAll('[style*="url("]').forEach(function(el) {
      el.style.cssText = el.style.cssText.replace(/url\\(['"]?([^'"\\)\\s]+)['"]?\\)/g, function(_, url) {
        try { return "url('" + new URL(url, location.href).href + "')"; } catch(e) { return "url('" + url + "')"; }
      });
    });
    // A page's own <style> blocks too: the font download only fetches absolute urls.
    document.querySelectorAll("style").forEach(function(el) {
      var css = el.textContent || "";
      var fixed = css.replace(/url\\(\\s*['"]?([^'"\\)\\s]+)['"]?\\s*\\)/g, function(match, url) {
        if (/^(data:|https?:|\\/\\/|#)/i.test(url)) return match;
        try { return "url('" + new URL(url, document.baseURI).href + "')"; } catch(e) { return match; }
      });
      if (fixed !== css) el.textContent = fixed;
    });
  })()`);

  // Step 3b: Convert cross-origin images to data URLs
  // Some CDNs (Contentful, etc.) block direct access but images are already
  // loaded in the browser. We convert loaded images to data URLs via canvas.
  const inlining = (await page.evaluate(`(async () => {
    var imgs = Array.from(document.querySelectorAll("img"));
    var inlineBudget = ${inlineImageBudgetChars};
    var stopAt = Date.now() + ${msLeft()};
    var overBudget = 0;
    var i = 0;
    for (; i < imgs.length && inlineBudget > 100 && Date.now() < stopAt; i++) {
      var img = imgs[i];
      try {
        if (!img.src || img.src.startsWith("data:")) continue;
        if (img.naturalWidth < 10 || img.naturalHeight < 10) continue;
        // Only convert cross-origin images (same-origin ones will load fine)
        var imgUrl = new URL(img.src);
        if (imgUrl.origin === location.origin) continue;
        // Try to draw to canvas — will fail if CORS blocks it
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        var dataUrl = canvas.toDataURL("image/png");
        if (dataUrl.length > inlineBudget) overBudget++;
        else if (dataUrl.length > 100) {
          inlineBudget -= dataUrl.length;
          img.setAttribute("src", dataUrl);
          img.removeAttribute("srcset");
        }
      } catch(e) {
        // Canvas CORS failed — try fetch + blob as fallback
        try {
          var resp = await fetch(img.src, {
            mode: "cors",
            signal: AbortSignal.timeout(Math.max(1, Math.min(5000, stopAt - Date.now()))),
          });
          if (resp.ok) {
            var blob = await resp.blob();
            var reader = new FileReader();
            var dataUrl2 = await new Promise(function(resolve) {
              reader.onloadend = function() { resolve(reader.result); };
              reader.readAsDataURL(blob);
            });
            if (typeof dataUrl2 === "string" && dataUrl2.length > inlineBudget) overBudget++;
            else if (dataUrl2 && typeof dataUrl2 === "string" && dataUrl2.length > 100) {
              inlineBudget -= dataUrl2.length;
              img.setAttribute("src", dataUrl2);
              img.removeAttribute("srcset");
            }
          }
        } catch(e2) {
          // Both methods failed — image stays as original URL
        }
      }
    }
    return { left: imgs.length - i, overBudget: overBudget, outOfTime: i < imgs.length && Date.now() >= stopAt };
  })()`)) as { left: number; overBudget: number; outOfTime: boolean };
  if (inlining.outOfTime) {
    opts.onWarning?.(
      `page.html: ${inlining.left} image(s) left as URLs; the HTML time budget ran out`,
    );
  }
  if (inlining.overBudget > 0 || (inlining.left > 0 && !inlining.outOfTime)) {
    opts.onWarning?.(
      `page.html: image inlining stopped at its ${Math.round(inlineImageBudgetChars / 1024 / 1024)} MB budget; the remaining images keep their URLs`,
    );
  }

  // Step 4: Extract everything
  const result = (await page.evaluate(`(() => {
    // Capture styles AND scripts from head separately then combine
    // Scripts include Three.js, animation libraries that we want to preserve
    var styles = Array.from(document.head.querySelectorAll("style")).map(function(s) { return s.outerHTML; }).join("\\n");
    var scripts = Array.from(document.head.querySelectorAll("script")).map(function(s) { return s.outerHTML; }).join("\\n");
    var headHtml = styles + "\\n" + scripts;
    var bodyHtml = document.body.innerHTML;

    var cssomRules = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sheet = document.styleSheets[i];
      try {
        var ownerNode = sheet.ownerNode;
        if (ownerNode && ownerNode.textContent && ownerNode.textContent.trim()) continue;
        if (sheet.href) continue;
        for (var j = 0; j < sheet.cssRules.length; j++) {
          cssomRules.push(sheet.cssRules[j].cssText);
        }
      } catch(e) {}
    }

    var htmlEl = document.documentElement;
    var attrParts = [];
    for (var i = 0; i < htmlEl.attributes.length; i++) {
      var attr = htmlEl.attributes[i];
      if (attr.name === "lang" || attr.name === "class" || attr.name === "style" || attr.name === "dir" || attr.name.startsWith("data-")) {
        attrParts.push(attr.name + '="' + attr.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"');
      }
    }

    return {
      headHtml: headHtml,
      bodyHtml: bodyHtml,
      cssomRules: cssomRules.join("\\n"),
      htmlAttrs: attrParts.join(" "),
      viewportWidth: Math.max(window.innerWidth, document.documentElement.scrollWidth),
      viewportHeight: window.innerHeight,
      fullPageHeight: document.body.scrollHeight
    };
  })()`)) as ExtractedHtml;

  // Post-process in Node.js (more reliable than browser-side fixing):
  // 1. Decode &amp; in image src/srcset attributes
  // 2. Make relative image URLs absolute using the page's origin
  const pageOrigin = new URL(page.url()).origin;

  // fallow-ignore-next-line code-duplication
  result.bodyHtml = result.bodyHtml.replace(
    /(<img\b[^>]*\bsrc=")([^"]*?)(")/g,
    (_match: string, pre: string, url: string, post: string) => {
      let fixed = url.replace(/&amp;/g, "&");
      // Make relative URLs absolute
      if (fixed.startsWith("/") && !fixed.startsWith("//")) {
        fixed = pageOrigin + fixed;
      }
      return pre + fixed + post;
    },
  );
  result.bodyHtml = result.bodyHtml.replace(
    /(<img\b[^>]*\bsrcset=")([^"]*?)(")/g,
    (_match: string, pre: string, urls: string, post: string) => {
      const fixed = urls
        .replace(/&amp;/g, "&")
        .replace(
          /(^|,\s*)(\/[^\s,]+)/g,
          (_m: string, sep: string, path: string) => sep + pageOrigin + path,
        );
      return pre + fixed + post;
    },
  );

  // Also fix video src/poster URLs
  // fallow-ignore-next-line code-duplication
  result.bodyHtml = result.bodyHtml.replace(
    /(<video\b[^>]*\bsrc=")([^"]*?)(")/g,
    (_match: string, pre: string, url: string, post: string) => {
      let fixed = url.replace(/&amp;/g, "&");
      if (fixed.startsWith("/") && !fixed.startsWith("//")) fixed = pageOrigin + fixed;
      return pre + fixed + post;
    },
  );
  // fallow-ignore-next-line code-duplication
  result.bodyHtml = result.bodyHtml.replace(
    /(<video\b[^>]*\bposter=")([^"]*?)(")/g,
    (_match: string, pre: string, url: string, post: string) => {
      let fixed = url.replace(/&amp;/g, "&");
      if (fixed.startsWith("/") && !fixed.startsWith("//")) fixed = pageOrigin + fixed;
      return pre + fixed + post;
    },
  );

  return result;
}
