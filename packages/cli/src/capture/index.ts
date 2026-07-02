/**
 * Website capture orchestrator.
 *
 * Two-pass capture approach:
 * Pass 1: Full page load (all JS) → catalog animations + snapshot canvases
 * Pass 2: Framework scripts blocked → extract stable HTML/CSS
 *
 * This ensures we get both:
 * - Rich animation metadata for Claude Code to recreate
 * - Stable, renderable HTML that won't crash in Puppeteer
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractHtml } from "./htmlExtractor.js";
// captureScreenshots removed — full-page screenshot replaces per-section shots
import { extractTokens } from "./tokenExtractor.js";
import { extractDesignStyles } from "./designStyleExtractor.js";
import { downloadAssets, downloadAndRewriteFonts } from "./assetDownloader.js";
import { extractFontMetadata } from "./fontMetadataExtractor.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
// briefGenerator.ts, visual-style, capture-summary removed — DESIGN.md replaces them
import {
  setupAnimationCapture,
  startCdpAnimationCapture,
  collectAnimationCatalog,
} from "./animationCataloger.js";
import {
  saveLottieAnimations,
  renderLottiePreviews,
  captureVideoManifest,
} from "./mediaCapture.js";
import type { DiscoveredLottie } from "./mediaCapture.js";
import {
  detectLibraries,
  extractVisibleText,
  captionImagesWithGemini,
  generateAssetDescriptions,
} from "./contentExtractor.js";
import { loadEnvFile, generateProjectScaffold } from "./scaffolding.js";
import type { CaptureOptions, CaptureResult } from "./types.js";

export type { CaptureOptions, CaptureResult } from "./types.js";

// fallow-ignore-next-line complexity
export async function captureWebsite(
  opts: CaptureOptions,
  onProgress?: (stage: string, detail?: string) => void,
): Promise<CaptureResult> {
  const {
    url,
    outputDir,
    viewportWidth = 1920,
    viewportHeight = 1080,
    timeout = 120000,
    settleTime = 3000,
    maxScreenshots: _maxScreenshots = 24,
    skipAssets = false,
  } = opts;

  const warnings: string[] = [];
  const progress = (stage: string, detail?: string) => {
    onProgress?.(stage, detail);
  };

  // Load .env file from repo root if it exists (for GEMINI_API_KEY, etc.)
  loadEnvFile(outputDir);

  // Create output directories
  mkdirSync(join(outputDir, "extracted"), { recursive: true });
  mkdirSync(join(outputDir, "screenshots"), { recursive: true });
  mkdirSync(join(outputDir, "assets"), { recursive: true });

  // Launch browser
  progress("browser", "Launching headless Chrome...");
  const { ensureBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser();
  const puppeteer = await import("puppeteer-core");
  const chromeBrowser = await puppeteer.default.launch({
    headless: true,
    executablePath: browser.executablePath,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--window-size=${viewportWidth},${viewportHeight}`,
    ],
  });

  let animationCatalog: CaptureResult["animationCatalog"];

  try {
    // ═══════════════════════════════════════════════════════════════
    // PASS 1: Full page load — all JS runs
    // Goal: Catalog animations + take screenshots (with JS rendering)
    // ═══════════════════════════════════════════════════════════════

    progress("animations", "Cataloging animations (full JS)...");

    const page1 = await chromeBrowser.newPage();
    await page1.setViewport({ width: viewportWidth, height: viewportHeight });
    await page1.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );

    // Set up hooks BEFORE navigation
    await setupAnimationCapture(page1);
    const { cdp, animations: cdpAnims } = await startCdpAnimationCapture(page1);

    // Hook WebGL to capture shader source code (GLSL)
    // Captured shaders inform Claude Code about the site's visual effects
    // and enable reliable library detection (Three.js/PixiJS/Babylon.js uniforms survive bundling)
    await page1.evaluateOnNewDocument(`
      var origGetContext = HTMLCanvasElement.prototype.getContext;
      window.__capturedShaders = [];
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        var ctx = origGetContext.call(this, type, attrs);
        if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
          if (ctx.shaderSource && !ctx.__hfHooked) {
            var origShaderSource = ctx.shaderSource.bind(ctx);
            ctx.shaderSource = function(shader, source) {
              try {
                var shaderType = ctx.getShaderParameter(shader, ctx.SHADER_TYPE);
                window.__capturedShaders.push({
                  type: shaderType === ctx.VERTEX_SHADER ? 'vertex' : 'fragment',
                  source: source.slice(0, 5000)
                });
              } catch(e) {}
              return origShaderSource(shader, source);
            };
            ctx.__hfHooked = true;
          }
        }
        return ctx;
      };
    `);

    // Intercept network responses to detect Lottie JSON files
    const discoveredLotties: DiscoveredLottie[] = [];
    // Layer 1 (passive video discovery): every direct-video URL the page fetches
    // over the whole session (load / scroll / carousel rotation), independent of
    // whether a <video> for it exists at snapshot time. captureVideoManifest
    // downloads these (guarded) and merges them into the manifest.
    const discoveredVideoUrls = new Set<string>();
    // fallow-ignore-next-line complexity
    page1.on("response", async (response) => {
      try {
        const responseUrl = response.url();
        if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(responseUrl)) {
          discoveredVideoUrls.add(responseUrl);
        }
        const contentType = response.headers()["content-type"] || "";
        const isJsonUrl = responseUrl.endsWith(".json");
        const isLottieUrl = responseUrl.endsWith(".lottie");
        const isJson =
          contentType.includes("application/json") || contentType.includes("text/plain");

        if (isLottieUrl) {
          discoveredLotties.push({ url: responseUrl });
          return;
        }

        if (isJsonUrl || isJson) {
          // Check Content-Length before downloading to avoid OOM on huge responses
          const cl = parseInt(response.headers()["content-length"] || "0", 10);
          if (cl > 5_000_000) return;
          const buffer = await response.buffer();
          if (buffer.length < 100 || buffer.length > 5_000_000) return; // Skip tiny or huge
          const text = buffer.toString("utf-8");
          const json = JSON.parse(text);
          // Validate Lottie structure: must have version, in/out points, layers, dimensions, framerate
          if (
            json &&
            typeof json === "object" &&
            ["v", "ip", "op", "layers", "w", "h", "fr"].every((k: string) => k in json)
          ) {
            discoveredLotties.push({
              url: responseUrl,
              data: json,
              dimensions: { w: json.w, h: json.h },
              frameRate: json.fr,
            });
          }
        }
      } catch {
        /* not JSON or parse error — skip */
      }
    });

    // Use networkidle2 (allows 2 ongoing connections) instead of networkidle0 —
    // modern SPAs often have persistent WebSocket/analytics connections that
    // prevent networkidle0 from ever resolving.
    await page1.goto(url, { waitUntil: "networkidle2", timeout });
    await new Promise((r) => setTimeout(r, settleTime));

    // Check if the page loaded real content or an anti-bot challenge
    // Use structural detection (DOM elements + cookies), not text regex matching —
    // text matching causes false positives on sites that mention "blocked" or "verify" in copy
    const pageContentCheck = (await page1.evaluate(`(() => {
      var text = (document.body.innerText || "").trim();
      var title = document.title || "";
      // Structural: Cloudflare Turnstile widget or challenge iframe
      var hasCfTurnstile = !!document.querySelector('.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], #challenge-running, #challenge-form');
      // Structural: page is almost empty (challenge pages have minimal DOM)
      var bodyChildCount = document.body.children.length;
      var isMinimalDom = bodyChildCount <= 5 && text.length < 500;
      // Title-based: only check title on near-empty pages
      var hasChallengeTitle = isMinimalDom && /just a moment|attention required|access denied/i.test(title);
      var isChallenged = hasCfTurnstile || hasChallengeTitle;
      return { textLength: text.length, title: title, isChallenged: isChallenged, bodyChildCount: bodyChildCount };
    })()`)) as { textLength: number; title: string; isChallenged: boolean; bodyChildCount: number };

    if (pageContentCheck.isChallenged || pageContentCheck.textLength < 100) {
      const reason = pageContentCheck.isChallenged
        ? "Anti-bot protection detected (Cloudflare challenge or similar)"
        : "Page has very little text content (" +
          pageContentCheck.textLength +
          " chars) — may be blocked or a client-rendered SPA that needs more time";
      warnings.push(reason);
      progress("warn", reason);
    }

    // Scroll through page to trigger lazy-loaded images and Lottie animations
    // Framer and other modern sites use IntersectionObserver — images only load
    // when scrolled into view. We scroll the full page, then wait for all images
    // to finish loading before proceeding.
    await page1.evaluate(`(async () => {
      var h = document.body.scrollHeight;
      for (var y = 0; y < h; y += window.innerHeight * 0.7) {
        window.scrollTo(0, y);
        await new Promise(function(r) { setTimeout(r, 400); });
      }
      // Scroll to very bottom to catch footer lazy-loads
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(function(r) { setTimeout(r, 800); });
      // Wait for all images to finish loading
      var imgs = Array.from(document.querySelectorAll('img'));
      var pending = imgs.filter(function(img) { return !img.complete; });
      if (pending.length > 0) {
        await Promise.race([
          Promise.all(pending.map(function(img) {
            return new Promise(function(r) { img.onload = r; img.onerror = r; });
          })),
          new Promise(function(r) { setTimeout(r, 5000); })
        ]);
      }
      window.scrollTo(0, 0);
      await new Promise(function(r) { setTimeout(r, 500); });
    })()`);

    await page1.evaluate(`window.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 300));

    // Save discovered Lottie animations
    // Also scan DOM for Lottie web components not caught by network interception
    try {
      const domLotties = await page1.evaluate(`(() => {
        var urls = [];
        document.querySelectorAll('dotlottie-wc, lottie-player, dotlottie-player').forEach(function(el) {
          var src = el.getAttribute('src');
          if (src) urls.push(src);
        });
        // Also check lottie-web registered animations
        if (window.lottie && window.lottie.getRegisteredAnimations) {
          window.lottie.getRegisteredAnimations().forEach(function(anim) {
            if (anim.path) urls.push(anim.path);
          });
        }
        return urls;
      })()`);
      if (Array.isArray(domLotties)) {
        for (const lottieUrl of domLotties) {
          if (
            typeof lottieUrl === "string" &&
            !discoveredLotties.some((l) => l.url === lottieUrl)
          ) {
            discoveredLotties.push({ url: lottieUrl });
          }
        }
      }
    } catch {
      /* DOM scan failed — non-critical */
    }

    if (discoveredLotties.length > 0) {
      const lottieDir = join(outputDir, "assets", "lottie");
      mkdirSync(lottieDir, { recursive: true });
      const savedCount = await saveLottieAnimations(discoveredLotties, lottieDir);
      // Generate manifest + preview thumbnails so the agent can SEE what each animation is
      if (savedCount > 0) {
        await renderLottiePreviews(chromeBrowser, lottieDir, outputDir);
        progress("lottie", `${savedCount} Lottie animation(s) saved`);
      }
    }

    // Save captured WebGL shaders (useful context for shader transitions + library detection)
    let capturedShaders: Array<{ type: string; source: string }> | undefined;
    try {
      const shaders = await page1.evaluate(`window.__capturedShaders || []`);
      if (Array.isArray(shaders) && shaders.length > 0) {
        const seen = new Set<string>();
        const unique = (shaders as Array<{ type: string; source: string }>).filter((s) => {
          if (seen.has(s.source)) return false;
          seen.add(s.source);
          return true;
        });
        capturedShaders = unique;
        writeFileSync(
          join(outputDir, "extracted", "shaders.json"),
          JSON.stringify(unique, null, 2),
          "utf-8",
        );
        progress("shaders", `${unique.length} WebGL shader(s) captured`);
      }
    } catch {
      /* shader extraction failed — non-critical */
    }

    // ── READ-ONLY phase: extract data from the live DOM before any mutations ──
    // extractHtml (below) converts image src to data URLs and removes scripts —
    // all read-only operations must run BEFORE it to see the original DOM.

    // Extract design tokens
    progress("tokens", "Extracting design tokens...");
    const tokens = await extractTokens(page1);
    // Save tokens.json without SVG outerHTML (kept in memory for asset downloader)
    const tokensForDisk = {
      ...tokens,
      svgs: tokens.svgs.map(({ outerHTML: _, ...rest }) => rest),
    };
    writeFileSync(
      join(outputDir, "extracted", "tokens.json"),
      JSON.stringify(tokensForDisk, null, 2),
      "utf-8",
    );

    // Extract computed design styles (typography, buttons, cards, spacing, shadows)
    progress("style", "Extracting design styles...");
    try {
      const designStyles = await extractDesignStyles(page1);
      writeFileSync(
        join(outputDir, "extracted", "design-styles.json"),
        JSON.stringify(designStyles, null, 2),
        "utf-8",
      );
      progress(
        "tokens",
        `${designStyles.typography.length} typography roles, ${designStyles.buttons.length} button styles, ${designStyles.shadows.length} shadow values extracted`,
      );
    } catch (err) {
      const errMsg =
        err instanceof Error ? `${err.message}\n${err.stack}` : normalizeErrorMessage(err);
      console.error(`  ⚠ Design style extraction failed: ${errMsg}`);
      warnings.push(`Design style extraction failed: ${errMsg}`);
    }

    // Collect animation catalog
    progress("animations", "Cataloging animations...");
    animationCatalog = await collectAnimationCatalog(page1, cdpAnims, cdp);

    // Capture scroll-position viewport screenshots
    progress("screenshots", "Capturing scroll screenshots...");
    const { captureScrollScreenshots } = await import("./screenshotCapture.js");
    const screenshots = await captureScrollScreenshots(page1, outputDir);
    progress("screenshots", `${screenshots.length} scroll screenshots captured`);

    // Catalog all assets (must run before extractHtml which converts img src to data URLs)
    progress("design", "Cataloging assets...");
    let catalogedAssets: import("./assetCataloger.js").CatalogedAsset[] = [];
    try {
      const { catalogAssets } = await import("./assetCataloger.js");
      catalogedAssets = await catalogAssets(page1);
      progress("design", `${catalogedAssets.length} assets cataloged`);
      if (catalogedAssets.length === 0) {
        warnings.push(
          "Asset catalog is empty — no images will be downloaded. The page may use non-standard image loading.",
        );
      }
    } catch (err) {
      warnings.push(`Asset cataloging failed (no images will be downloaded): ${err}`);
    }

    // ── MUTATION phase: extractHtml modifies the live DOM (converts images to data URLs) ──
    progress("extract", "Extracting HTML & CSS...");
    const extracted = await extractHtml(page1, { settleTime: 1000 });

    // Strip framework scripts from the extracted body — keep visual library scripts
    // IMPORTANT: Use non-greedy matching within individual script tags only
    extracted.bodyHtml = extracted.bodyHtml
      // Remove __NEXT_DATA__ (has its own ID so safe to target)
      .replace(/<script\s+id="__NEXT_DATA__"[^>]*>[\s\S]*?<\/script>/gi, "")
      // Remove React hydration markers
      .replace(/\s*data-reactroot="[^"]*"/g, "")
      .replace(/\s*data-reactroot/g, "");

    // Remove Next.js bootstrap scripts individually (match each script tag separately)
    extracted.bodyHtml = extracted.bodyHtml.replace(
      /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
      // fallow-ignore-next-line complexity
      (match: string, content: string) => {
        // Only remove if this specific script contains Next.js bootstrap code
        if (
          content.includes("__next_f") ||
          content.includes("self.__next_f") ||
          content.includes("__NEXT_LOADED_PAGES__") ||
          content.includes("_N_E") ||
          content.includes("__NEXT_P")
        ) {
          return "";
        }
        return match;
      },
    );

    // Strip framework script tags from head (keep styles + visual library scripts)
    const FRAMEWORK_SRC_PATTERNS = [
      /_next\/static\/chunks\/(main|framework|webpack|pages\/)/,
      /_next\/static\/chunks\/app\//,
      /_buildManifest\.js/,
      /_ssgManifest\.js/,
    ];
    extracted.headHtml = extracted.headHtml.replace(
      /<script[^>]*src="([^"]*)"[^>]*><\/script>/gi,
      (match: string, src: string) => {
        if (FRAMEWORK_SRC_PATTERNS.some((p) => p.test(src))) return "";
        return match;
      },
    );

    // Generate video manifest — screenshot each <video> element + extract surrounding context
    // so Claude Code can SEE what each video shows and WHERE it was used on the page.
    try {
      await captureVideoManifest(page1, outputDir, progress, {
        networkVideoUrls: discoveredVideoUrls, // Layer 1 (live Set, read after sampling)
        sampleMs: 12000, // Layer 2: poll DOM ≤12s so auto-rotating carousels reveal each slide
      });
    } catch {
      /* non-blocking — video manifest is best-effort */
    }

    // Detect JS libraries via globals, DOM fingerprints, script URLs, and shaders
    const detectedLibraries = await detectLibraries(page1, capturedShaders);

    // Extract all visible text in DOM order
    const visibleTextContent = await extractVisibleText(page1);

    // Extract favicon links before closing page (removed from tokens to reduce noise)
    const faviconLinks = (await page1.evaluate(`(() => {
      var iconEls = Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]'));
      return iconEls.map(function(l) { return { rel: l.rel, href: l.href }; });
    })()`)) as Array<{ rel: string; href: string }>;

    await page1.close();

    // Download fonts and rewrite URLs to local paths
    extracted.headHtml = await downloadAndRewriteFonts(extracted.headHtml, outputDir);

    // Identify each downloaded font by reading its OpenType name table.
    // Modern frameworks hash font filenames; this manifest tells the
    // downstream pipeline (DESIGN.md authoring, beat sub-agents) which file
    // belongs to which family without guessing from filename patterns.
    try {
      const fontsManifest = extractFontMetadata(
        join(outputDir, "assets", "fonts"),
        join(outputDir, "extracted", "fonts-manifest.json"),
      );
      if (fontsManifest.families.length > 0) {
        const summary = fontsManifest.families
          .map((f) => `${f.family}${f.variable ? " (variable)" : ""} × ${f.fileCount}`)
          .join(", ");
        console.log(`Font metadata extracted: ${summary}`);
        if (fontsManifest.unidentified.length > 0) {
          console.warn(
            `  ${fontsManifest.unidentified.length} font file(s) could not be identified — DESIGN.md should flag these explicitly.`,
          );
        }
      }
    } catch (err) {
      console.warn("Font metadata extraction failed (non-fatal):", normalizeErrorMessage(err));
    }

    // Save animation catalog — lean version for the agent (not 745 raw CSS declarations)
    if (animationCatalog) {
      // Extract just what's useful: counts, named animations, a few representative keyframed entries
      const uniqueAnimNames = new Set<string>();
      for (const d of animationCatalog.cssDeclarations || []) {
        if (d.animation?.name) uniqueAnimNames.add(d.animation.name);
      }

      // Keep up to 10 Web Animations that have actual keyframe data (most useful for recreation)
      const representativeAnims = (animationCatalog.webAnimations || [])
        .filter((a) => a.keyframes && a.keyframes.length > 0)
        .slice(0, 10);

      const leanCatalog = {
        summary: animationCatalog.summary,
        namedAnimations: Array.from(uniqueAnimNames),
        scrollTriggeredElements: (animationCatalog.scrollTargets || []).length,
        representativeAnimations: representativeAnims,
      };

      writeFileSync(
        join(outputDir, "extracted", "animations.json"),
        JSON.stringify(leanCatalog, null, 2),
        "utf-8",
      );
    }

    // Download assets — single pass using the catalog for best image quality
    let assets: CaptureResult["assets"] = [];
    if (!skipAssets) {
      progress("assets", "Downloading assets...");
      assets = await downloadAssets(tokens, outputDir, catalogedAssets, faviconLinks);
    }

    // Join in-section media URLs → downloaded local paths, then re-write
    // tokens.json. Downstream page recreation MUST reference local files:
    // remote URLs fail at render time (hotlink/CORS 403, no egress in
    // Docker/Lambda, frame-timing blanks for not-yet-loaded images).
    if (assets.length && Array.isArray(tokens.sections)) {
      const base = (u: string): string => u.split(/[#?]/)[0] ?? u;
      const localByUrl = new Map<string, string>();
      for (const a of assets) {
        if (!a.url || !a.localPath) continue;
        localByUrl.set(a.url, a.localPath);
        localByUrl.set(base(a.url), a.localPath);
      }
      for (const sec of tokens.sections) {
        const local: string[] = [];
        for (const u of sec.assetUrls || []) {
          const hit = localByUrl.get(u) || localByUrl.get(base(u));
          if (hit && !local.includes(hit)) local.push(hit);
        }
        if (local.length) sec.assets = local;
      }
      const tokensForDisk2 = {
        ...tokens,
        svgs: tokens.svgs.map(({ outerHTML: _, ...rest }) => rest),
      };
      writeFileSync(
        join(outputDir, "extracted", "tokens.json"),
        JSON.stringify(tokensForDisk2, null, 2),
        "utf-8",
      );
    }

    // Persist a self-contained page recreation (extracted/page.html) as the
    // high-fidelity structural reference for the page-card rebuild. NOT a
    // composition — kept under extracted/ so the producer (which discovers
    // compositions by index.html) never picks it up. Images are already inlined
    // as data URLs by extractHtml, so it renders standalone.
    try {
      const pageHtml = `<!doctype html>\n<html ${extracted.htmlAttrs || ""}>\n<head>\n${extracted.headHtml}\n</head>\n<body>\n${extracted.bodyHtml}\n</body>\n</html>\n`;
      writeFileSync(join(outputDir, "extracted", "page.html"), pageHtml, "utf-8");
    } catch (err) {
      warnings.push(`page.html write failed: ${err}`);
    }

    // Save visible text content for AI agent to use
    if (visibleTextContent) {
      writeFileSync(join(outputDir, "extracted", "visible-text.txt"), visibleTextContent, "utf-8");
    }

    // detected-libraries and assets-catalog removed — 0/8 agents read them in v6 testing

    // AI-powered image captioning via Gemini (optional — enriches asset descriptions)
    const geminiCaptions = await captionImagesWithGemini(outputDir, progress, warnings);

    // Generate asset descriptions for the AI agent
    progress("design", "Generating asset descriptions...");
    try {
      const lines = generateAssetDescriptions(outputDir, tokens, catalogedAssets, geminiCaptions);

      if (lines.length > 0) {
        const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
        const header = hasGeminiKey
          ? "# Asset Descriptions\n\nOne line per file. Read this instead of opening every image individually.\n\nTo find a specific brand or icon, **grep this file for the brand name in the description text** (e.g. `grep -i 'autodesk' asset-descriptions.md`). The Gemini Vision captions identify what's actually in each file — that's the agent's selector.\n\nThe `logo-<hash>.svg` filename prefix is a cheap structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). It is NOT a content claim — many `logo-*` files are nav icons or decorative shapes. Trust the captions, not the filename prefix.\n\n"
          : "# Asset Descriptions\n\n⚠️  GEMINI_API_KEY not set — descriptions below are catalog-derived (alt text, headings, section context, filename) instead of Vision-generated. To get richer Vision descriptions on the next capture, set GEMINI_API_KEY (or GOOGLE_API_KEY) and re-run.\n\nThe `logo-<hash>.svg` filename prefix is a structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). To pick the actual brand logo without Vision, open the `logo-*` candidates in a previewer or rasterize them with `sharp` before referencing — composing a fake logo ships off-brand in the final video.\n\n";
        writeFileSync(
          join(outputDir, "extracted", "asset-descriptions.md"),
          header + lines.map((l) => "- " + l).join("\n") + "\n",
          "utf-8",
        );
        progress(
          "design",
          `${lines.length} asset descriptions written${hasGeminiKey ? "" : " (no Gemini key — catalog-fallback mode)"}`,
        );
      }
    } catch {
      /* non-critical */
    }

    progress("design", "DESIGN.md will be created by your AI agent");

    // Generate contact sheets (saves AI agents 50-65% tokens vs reading images individually)
    // All functions return string[] — paginated so every image is covered
    try {
      const { createScrollContactSheet, createAssetContactSheet, createSvgContactSheet } =
        await import("./contactSheet.js");

      const scrollSheets = await createScrollContactSheet(
        join(outputDir, "screenshots"),
        join(outputDir, "screenshots", "contact-sheet.jpg"),
      );
      if (scrollSheets.length > 0)
        progress(
          "design",
          `Screenshot contact sheet generated (${scrollSheets.length} page${scrollSheets.length > 1 ? "s" : ""})`,
        );

      const assetsImgDir = join(outputDir, "assets");
      if (existsSync(assetsImgDir)) {
        const assetSheets = await createAssetContactSheet(
          assetsImgDir,
          join(outputDir, "assets", "contact-sheet.jpg"),
        );
        if (assetSheets.length > 0)
          progress(
            "design",
            `Asset contact sheet generated (${assetSheets.length} page${assetSheets.length > 1 ? "s" : ""})`,
          );
      }

      // Scan assets/svgs/ (inline SVGs) AND assets/ root (external SVGs from <img src="*.svg">)
      // so sites like huly.io that only use external SVGs still get a grid
      const svgsDir = join(outputDir, "assets", "svgs");
      const assetsRootDir = join(outputDir, "assets");
      const svgOutputPath = existsSync(svgsDir)
        ? join(outputDir, "assets", "svgs", "contact-sheet.jpg")
        : join(outputDir, "assets", "contact-sheet-svgs.jpg");
      const svgSheets = await createSvgContactSheet(svgsDir, svgOutputPath, assetsRootDir);
      if (svgSheets.length > 0)
        progress(
          "design",
          `SVG contact sheet generated (${svgSheets.length} page${svgSheets.length > 1 ? "s" : ""})`,
        );
    } catch {
      /* contact sheets are non-critical — agent can still read images individually */
    }

    // Generate project scaffold (index.html, meta.json, CLAUDE.md)
    await generateProjectScaffold(
      outputDir,
      url,
      tokens,
      animationCatalog,
      screenshots.length > 0,
      discoveredLotties.length > 0,
      existsSync(join(outputDir, "extracted", "shaders.json")),
      catalogedAssets,
      progress,
      warnings,
      detectedLibraries,
    );

    progress("done", "Capture complete");

    return {
      ok: true,
      projectDir: outputDir,
      url,
      title: tokens.title,
      extracted,
      screenshots,
      tokens,
      assets,
      animationCatalog,
      warnings,
    };
  } finally {
    await chromeBrowser.close();
  }
}

// visual-style.md and capture-summary.md generators removed — DESIGN.md replaces them
