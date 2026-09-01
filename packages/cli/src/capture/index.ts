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
import { diag } from "../ui/diagnostics.js";
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
  resolveVisionPhaseCompletion,
} from "./contentExtractor.js";
import type { VisionCaptionOutcome } from "./contentExtractor.js";
import { loadEnvFile, generateProjectScaffold } from "./scaffolding.js";
import { detectBlockedPage } from "./pageBlockDetection.js";
import { navigateForCapture } from "./navigateForCapture.js";
import {
  captureProtocolTimeoutMs,
  isDegradableEvaluateTimeoutError,
  withRemainingBudget,
} from "./captureTimeout.js";
import { lazyScrollForCapture } from "./lazyScrollForCapture.js";
import type { CaptureOptions, CapturePhase, CapturePhaseProgress, CaptureResult } from "./types.js";

export type { CaptureOptions, CaptureResult } from "./types.js";

const DEFAULT_POST_NAVIGATION_BUDGET_MS = 120_000;

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
    skipVision = false,
    postNavigationBudgetMs = DEFAULT_POST_NAVIGATION_BUDGET_MS,
    onPhase,
  } = opts;

  const warnings: string[] = [];
  const progress = (stage: string, detail?: string) => {
    onProgress?.(stage, detail);
  };
  const budgetMs =
    Number.isFinite(postNavigationBudgetMs) && postNavigationBudgetMs > 0
      ? postNavigationBudgetMs
      : DEFAULT_POST_NAVIGATION_BUDGET_MS;
  let postNavigationDeadline: number | undefined;
  const remainingMs = (): number =>
    postNavigationDeadline === undefined
      ? budgetMs
      : Math.max(0, postNavigationDeadline - Date.now());
  let lastPhase: CapturePhaseProgress = {
    schema: "hyperframes.capture.phase.v1",
    phase: "browser",
    status: "started",
    remainingMs: null,
  };
  const phase = (
    name: CapturePhase,
    status: CapturePhaseProgress["status"],
    reason?: CapturePhaseProgress["reason"],
  ): void => {
    const remaining = postNavigationDeadline === undefined ? null : remainingMs();
    lastPhase = reason
      ? {
          schema: "hyperframes.capture.phase.v1",
          phase: name,
          status,
          remainingMs: remaining,
          reason,
        }
      : { schema: "hyperframes.capture.phase.v1", phase: name, status, remainingMs: remaining };
    onPhase?.(lastPhase);
  };

  phase("browser", "started");

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
    protocolTimeout: captureProtocolTimeoutMs(timeout, budgetMs),
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

    phase("browser", "completed");
    phase("navigation", "started");
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

    const navigation = await navigateForCapture(page1, url, timeout);
    const navigationResponse = navigation.response;
    if (navigation.fellBackFromNetworkIdle) {
      warnings.push(
        `networkidle2 timed out after ${navigation.networkIdleTimeoutMs}ms; continued with domcontentloaded`,
      );
      progress(
        "warn",
        `networkidle2 timed out after ${navigation.networkIdleTimeoutMs}ms; continuing with domcontentloaded`,
      );
    }
    postNavigationDeadline = Date.now() + budgetMs;
    await new Promise((r) => setTimeout(r, settleTime));

    let pageContentCheck: {
      textLength: number;
      title: string;
      hasChallengeElement: boolean;
      bodyChildCount: number;
    } = {
      textLength: 0,
      title: "",
      hasChallengeElement: false,
      bodyChildCount: Number.POSITIVE_INFINITY,
    };
    let contentCheckTimedOut = false;
    try {
      pageContentCheck = (await withRemainingBudget(
        page1.evaluate(`(() => {
      var text = (document.body && document.body.innerText || "").trim();
      var title = document.title || "";
      var hasCfTurnstile = !!document.querySelector('.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], #challenge-running, #challenge-form');
      var bodyChildCount = document.body ? document.body.children.length : 0;
      return { textLength: text.length, title: title, hasChallengeElement: hasCfTurnstile, bodyChildCount: bodyChildCount };
    })()`),
        Math.min(5_000, remainingMs()),
        "content-check",
      )) as typeof pageContentCheck;
    } catch (err) {
      if (!isDegradableEvaluateTimeoutError(err)) {
        throw err;
      }
      contentCheckTimedOut = true;
      const message =
        "post-navigation content check timed out; continuing with HTTP-status blocked-page detection only";
      warnings.push(message);
      progress("warn", message);
    }

    const blockedReason = detectBlockedPage({
      httpStatus: navigationResponse?.status() ?? null,
      ...(contentCheckTimedOut
        ? {
            title: "",
            textLength: 0,
            bodyChildCount: 0,
            hasChallengeElement: false,
          }
        : pageContentCheck),
    });
    if (blockedReason) {
      phase("navigation", "degraded", "blocked");
      throw new Error(blockedReason);
    }

    phase("navigation", "completed");
    phase("core-extraction", "started");

    if (!contentCheckTimedOut && pageContentCheck.textLength < 100) {
      const reason =
        "Page has very little text content (" +
        pageContentCheck.textLength +
        " chars) — may be blocked or a client-rendered SPA that needs more time";
      warnings.push(reason);
      progress("warn", reason);
    }

    const lazyLoadBudgetMs = Math.min(15_000, remainingMs());
    const lazyScroll = await lazyScrollForCapture(page1, lazyLoadBudgetMs, {
      onWarning: (message) => {
        warnings.push(message);
        progress("warn", message);
      },
    });
    if (lazyScroll.timedOut && !lazyScroll.degraded) {
      const message = `lazy-scroll stopped after ${lazyScroll.steps} steps (budget ${lazyLoadBudgetMs}ms)`;
      warnings.push(message);
      progress("warn", message);
    }
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

    if (discoveredLotties.length > 0 && remainingMs() > 0) {
      const lottieDir = join(outputDir, "assets", "lottie");
      mkdirSync(lottieDir, { recursive: true });
      const lottieBudget = { remainingMs };
      const savedCount = await saveLottieAnimations(discoveredLotties, lottieDir, lottieBudget);
      // Generate manifest + preview thumbnails so the agent can SEE what each animation is
      if (savedCount > 0 && remainingMs() > 0) {
        await renderLottiePreviews(chromeBrowser, lottieDir, outputDir, lottieBudget);
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

    progress("animations", "Cataloging animations...");
    try {
      const animationOutcome = await collectAnimationCatalog(page1, cdpAnims, cdp, {
        scrollBudgetMs: Math.min(8_000, remainingMs()),
        evaluateBudgetMs: Math.min(15_000, remainingMs()),
      });
      animationCatalog = animationOutcome.catalog;
      if (animationOutcome.timedOut) {
        const message =
          "animation catalog evaluate timed out; continuing without animation catalog";
        warnings.push(message);
        progress("warn", message);
      }
    } catch (err) {
      if (!isDegradableEvaluateTimeoutError(err)) {
        throw err;
      }
      const message = "animation catalog evaluate timed out; continuing without animation catalog";
      warnings.push(message);
      progress("warn", message);
      try {
        await cdp.send("Animation.disable");
      } catch {
        /* ignore */
      }
    }

    progress("screenshots", "Capturing scroll screenshots...");
    const { captureScrollScreenshots } = await import("./screenshotCapture.js");
    let screenshots: string[] = [];
    try {
      screenshots = await captureScrollScreenshots(page1, outputDir, { remainingMs });
      progress("screenshots", `${screenshots.length} scroll screenshots captured`);
    } catch (err) {
      if (!isDegradableEvaluateTimeoutError(err)) {
        throw err;
      }
      const message = "scroll screenshots timed out; continuing without screenshots";
      warnings.push(message);
      progress("warn", message);
    }

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
      const videoBudgetMs = remainingMs();
      if (videoBudgetMs > 0) {
        await captureVideoManifest(page1, outputDir, progress, {
          networkVideoUrls: discoveredVideoUrls, // Layer 1 (live Set, read after sampling)
          sampleMs: Math.min(12000, videoBudgetMs), // Layer 2: poll DOM within the shared budget
          downloadBudgetMs: videoBudgetMs,
          remainingMs,
        });
      }
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

    phase("core-extraction", "completed");

    // Download fonts and rewrite URLs to local paths
    if (remainingMs() > 0) {
      phase("fonts", "started");
      extracted.headHtml = await downloadAndRewriteFonts(extracted.headHtml, outputDir, {
        remainingMs,
      });
      phase(
        "fonts",
        remainingMs() > 0 ? "completed" : "degraded",
        remainingMs() > 0 ? undefined : "budget-exhausted",
      );
    } else {
      warnings.push(
        "Capture budget exhausted before font downloads; extracted font tokens were preserved.",
      );
      phase("fonts", "degraded", "budget-exhausted");
    }

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
        // stderr (via diag): `capture --json` writes its envelope to stdout, so
        // these progress/advisory lines must not land there.
        diag.notice(`Font metadata extracted: ${summary}`);
        if (fontsManifest.unidentified.length > 0) {
          diag.warn(
            `  ${fontsManifest.unidentified.length} font file(s) could not be identified — DESIGN.md should flag these explicitly.`,
          );
        }
      }
    } catch (err) {
      diag.warn("Font metadata extraction failed (non-fatal):", normalizeErrorMessage(err));
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
      if (remainingMs() > 0) {
        phase("assets", "started");
        progress("assets", "Downloading assets...");
        assets = await downloadAssets(tokens, outputDir, catalogedAssets, faviconLinks, {
          remainingMs,
        });
        phase(
          "assets",
          remainingMs() > 0 ? "completed" : "degraded",
          remainingMs() > 0 ? undefined : "budget-exhausted",
        );
      } else {
        warnings.push("Capture budget exhausted before asset downloads; extraction continued.");
        phase("assets", "degraded", "budget-exhausted");
      }
    } else {
      phase("assets", "degraded", "disabled");
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
    let geminiCaptions: Record<string, string> = {};
    if (skipVision) {
      phase("vision", "degraded", "disabled");
    } else if (remainingMs() <= 0) {
      warnings.push(
        "Capture budget exhausted before vision captioning; catalog descriptions were preserved.",
      );
      phase("vision", "degraded", "budget-exhausted");
    } else {
      phase("vision", "started");
      let visionOutcome: VisionCaptionOutcome = {
        timedOutRequests: 0,
        failedRequests: 0,
        budgetExhausted: false,
      };
      geminiCaptions = await captionImagesWithGemini(outputDir, progress, warnings, {
        remainingMs,
        onOutcome: (outcome) => {
          visionOutcome = outcome;
        },
      });
      const completion = resolveVisionPhaseCompletion(visionOutcome, remainingMs());
      phase(
        "vision",
        completion.status,
        completion.status === "degraded" ? completion.reason : undefined,
      );
    }

    // Generate asset descriptions for the AI agent
    progress("design", "Generating asset descriptions...");
    try {
      const lines = generateAssetDescriptions(outputDir, tokens, catalogedAssets, geminiCaptions);

      if (lines.length > 0) {
        // Mirrors the provider gate in contentExtractor: Vertex needs a project AND a service
        // account, and is the configuration a server deployment actually has. Without it here the
        // header claimed "GEMINI_API_KEY not set — descriptions are catalog-derived" on a capture
        // whose captions Vertex had just generated, and that header is read downstream.
        const hasVisionKey = !!(
          !skipVision &&
          (process.env.OPENROUTER_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.GOOGLE_API_KEY ||
            (process.env.HYPERFRAMES_VERTEX_PROJECT_ID &&
              process.env.HYPERFRAMES_VERTEX_SERVICE_ACCOUNT))
        );
        const header = hasVisionKey
          ? "# Asset Descriptions\n\nOne line per file. Read this instead of opening every image individually.\n\nTo find a specific brand or icon, **grep this file for the brand name in the description text** (e.g. `grep -i 'autodesk' asset-descriptions.md`). The Gemini Vision captions identify what's actually in each file — that's the agent's selector.\n\nThe `logo-<hash>.svg` filename prefix is a cheap structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). It is NOT a content claim — many `logo-*` files are nav icons or decorative shapes. Trust the captions, not the filename prefix.\n\n"
          : "# Asset Descriptions\n\n⚠️  No vision credentials — descriptions below are catalog-derived (alt text, headings, section context, filename) instead of Vision-generated. To get richer Vision descriptions on the next capture, set GEMINI_API_KEY (or GOOGLE_API_KEY), or HYPERFRAMES_VERTEX_PROJECT_ID plus HYPERFRAMES_VERTEX_SERVICE_ACCOUNT for Vertex service-account auth, and re-run.\n\nThe `logo-<hash>.svg` filename prefix is a structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). To pick the actual brand logo without Vision, open the `logo-*` candidates in a previewer or rasterize them with `sharp` before referencing — composing a fake logo ships off-brand in the final video.\n\n";
        writeFileSync(
          join(outputDir, "extracted", "asset-descriptions.md"),
          header + lines.map((l) => "- " + l).join("\n") + "\n",
          "utf-8",
        );
        progress(
          "design",
          `${lines.length} asset descriptions written${hasVisionKey ? "" : " (no vision provider — catalog-fallback mode)"}`,
        );
      }
    } catch {
      /* non-critical */
    }

    progress("design", "DESIGN.md will be created by your AI agent");

    // Generate contact sheets (saves AI agents 50-65% tokens vs reading images individually)
    // All functions return string[] — paginated so every image is covered
    if (remainingMs() > 0) {
      phase("contact-sheets", "started");
      try {
        const { createScrollContactSheet, createAssetContactSheet, createSvgContactSheet } =
          await import("./contactSheet.js");

        const contactSheetBudget = { remainingMs };

        const scrollSheets = await createScrollContactSheet(
          join(outputDir, "screenshots"),
          join(outputDir, "screenshots", "contact-sheet.jpg"),
          contactSheetBudget,
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
            contactSheetBudget,
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
        const svgSheets = await createSvgContactSheet(
          svgsDir,
          svgOutputPath,
          assetsRootDir,
          contactSheetBudget,
        );
        if (svgSheets.length > 0)
          progress(
            "design",
            `SVG contact sheet generated (${svgSheets.length} page${svgSheets.length > 1 ? "s" : ""})`,
          );
      } catch {
        /* contact sheets are non-critical — agent can still read images individually */
      }
      phase(
        "contact-sheets",
        remainingMs() > 0 ? "completed" : "degraded",
        remainingMs() > 0 ? undefined : "budget-exhausted",
      );
    } else {
      warnings.push(
        "Capture budget exhausted before contact sheets; source images were preserved.",
      );
      phase("contact-sheets", "degraded", "budget-exhausted");
    }

    // Generate project scaffold (index.html, meta.json, CLAUDE.md)
    phase("scaffold", "started");
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
    phase("scaffold", "completed");

    progress("done", "Capture complete");
    phase("complete", "completed");

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
      lastPhase,
    };
  } finally {
    await chromeBrowser.close();
  }
}

// visual-style.md and capture-summary.md generators removed — DESIGN.md replaces them
