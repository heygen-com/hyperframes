/**
 * Content extraction helpers for the website capture pipeline.
 *
 * Handles library detection, visible text extraction, vision captioning,
 * and asset description generation.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Page } from "puppeteer-core";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type sharpType from "sharp";
import type { CatalogedAsset } from "./assetCataloger.js";
import type { DesignTokens } from "./types.js";

const DEFAULT_VISION_REQUEST_TIMEOUT_MS = 30_000;

export interface VisionCaptionOutcome {
  timedOutRequests: number;
  failedRequests: number;
  budgetExhausted: boolean;
  /** Failure outside provider request handling (filesystem, module, or programming error). */
  internalError?: boolean;
}

interface VisionCaptionOptions {
  skipVision?: boolean;
  remainingMs?: () => number;
  onOutcome?: (outcome: VisionCaptionOutcome) => void;
}

export function resolveVisionPhaseCompletion(
  outcome: VisionCaptionOutcome,
  remainingMs: number,
):
  | { status: "completed" }
  | {
      status: "degraded";
      reason: "budget-exhausted" | "request-timeout" | "provider-error" | "internal-error";
    } {
  if (outcome.budgetExhausted || remainingMs <= 0) {
    return { status: "degraded", reason: "budget-exhausted" };
  }
  if (outcome.internalError) {
    return { status: "degraded", reason: "internal-error" };
  }
  if (outcome.timedOutRequests > 0) {
    return { status: "degraded", reason: "request-timeout" };
  }
  if (outcome.failedRequests > 0) {
    return { status: "degraded", reason: "provider-error" };
  }
  return { status: "completed" };
}

class VisionRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Vision request timed out after ${timeoutMs}ms`);
    this.name = "VisionRequestTimeoutError";
  }
}

function resolveVisionRequestTimeoutMs(): number {
  const configured = Number(process.env.HYPERFRAMES_VISION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_VISION_REQUEST_TIMEOUT_MS;
}

async function runBoundedVisionRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new VisionRequestTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([request(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Detect JS libraries via window globals, DOM fingerprints, script URLs,
 * and WebGL shader analysis.
 *
 * Returns a deduplicated list of detected library names.
 */
export async function detectLibraries(
  page: Page,
  capturedShaders?: Array<{ type: string; source: string }>,
): Promise<string[]> {
  let detectedLibraries: string[] = [];
  try {
    detectedLibraries = (await page.evaluate(`(() => {
      var libs = [];
      function add(name) { if (libs.indexOf(name) === -1) libs.push(name); }

      // 1. Window globals (works for CDN-loaded / non-bundled libraries)
      if (typeof window.gsap !== 'undefined' || typeof window.TweenMax !== 'undefined') add('GSAP');
      if (typeof window.ScrollTrigger !== 'undefined') add('GSAP ScrollTrigger');
      if (typeof window.THREE !== 'undefined') add('Three.js');
      if (typeof window.PIXI !== 'undefined') add('PixiJS');
      if (typeof window.BABYLON !== 'undefined') add('Babylon.js');
      if (typeof window.Lottie !== 'undefined' || typeof window.lottie !== 'undefined') add('Lottie');
      if (typeof window.__NEXT_DATA__ !== 'undefined') add('Next.js');
      if (typeof window.__NUXT__ !== 'undefined') add('Nuxt');
      if (typeof window.Webflow !== 'undefined') add('Webflow');

      // 2. DOM fingerprints (survive bundling — most reliable for modern sites)
      // Three.js sets data-engine on every canvas it creates
      var threeCanvas = document.querySelector('canvas[data-engine*="three"]');
      if (threeCanvas) add('Three.js (' + (threeCanvas.getAttribute('data-engine') || '') + ')');
      // Babylon.js also sets data-engine
      var babylonCanvas = document.querySelector('canvas[data-engine*="Babylon"]');
      if (babylonCanvas) add('Babylon.js');
      // Lottie web components
      if (document.querySelector('dotlottie-wc, lottie-player, dotlottie-player')) add('Lottie');
      // Rive
      if (document.querySelector('canvas[class*="rive"], rive-canvas')) add('Rive');
      // React/Next.js
      if (document.getElementById('__next')) add('Next.js');
      if (document.getElementById('__nuxt')) add('Nuxt');
      if (document.querySelector('[data-reactroot], [data-react-helmet]')) add('React');
      // Svelte
      if (document.querySelector('[class*="svelte-"]')) add('Svelte');
      // Tailwind (utility class detection)
      if (document.querySelector('[class*="flex "], [class*="grid "], [class*="px-"], [class*="py-"]')) add('Tailwind CSS');
      // Framer Motion
      if (document.querySelector('[style*="--framer-"], [data-framer-component-type]')) add('Framer Motion');

      // 3. Script URL patterns
      document.querySelectorAll('script[src]').forEach(function(s) {
        var src = s.src.toLowerCase();
        if (src.includes('gsap') || src.includes('tweenmax') || src.includes('greensock')) add('GSAP');
        if (src.includes('scrolltrigger')) add('GSAP ScrollTrigger');
        if (src.includes('three.module') || src.includes('three.min')) add('Three.js');
        if (src.includes('pixi')) add('PixiJS');
        if (src.includes('lottie') || src.includes('bodymovin')) add('Lottie');
        if (src.includes('framer-motion')) add('Framer Motion');
        if (src.includes('anime.min') || src.includes('animejs')) add('Anime.js');
        if (src.includes('matter.min') || src.includes('matter-js')) add('Matter.js');
        if (src.includes('lenis')) add('Lenis (smooth scroll)');
      });

      return libs;
    })()`)) as string[];
  } catch {
    // Non-blocking
  }

  // 4. Shader fingerprinting — infer WebGL framework from captured GLSL
  try {
    const shaders = capturedShaders || [];
    if (shaders.length > 0) {
      const allSource = shaders.map((s) => s.source).join("\n");
      const add = (name: string) => {
        if (!detectedLibraries.includes(name)) detectedLibraries.push(name);
      };
      add("WebGL");
      // Three.js shader fingerprints (built-in uniforms that survive bundling)
      if (allSource.includes("modelViewMatrix") && allSource.includes("projectionMatrix"))
        add("Three.js (confirmed via shaders)");
      // PixiJS shader fingerprints
      else if (
        allSource.includes("vTextureCoord") &&
        allSource.includes("uSampler") &&
        !allSource.includes("modelViewMatrix")
      )
        add("PixiJS (confirmed via shaders)");
      // Babylon.js shader fingerprints
      else if (allSource.includes("viewProjection") && allSource.includes("world"))
        add("Babylon.js (confirmed via shaders)");
    }
  } catch {
    /* non-blocking */
  }

  return detectedLibraries;
}

/**
 * Extract all visible text from the page in DOM order using a TreeWalker.
 * Truncates to ~30K chars to avoid blowing up downstream prompts.
 */
export async function extractVisibleText(page: Page): Promise<string> {
  let visibleTextContent = "";
  try {
    visibleTextContent = (await page.evaluate(`(() => {
      var cookieRe = /^(accept|cookie|privacy|that's fine|got it|i agree|reject all|accept all|manage cookies|consent)$/i;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var texts = [];
      var node;
      while (node = walker.nextNode()) {
        var text = (node.textContent || '').trim();
        if (text.length < 3) continue;
        var el = node.parentElement;
        if (!el) continue;
        var style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        var tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
        // Skip very short text inside nav/footer (catches single-word nav links)
        // Threshold is 8 chars to preserve footer copy like "© 2026 Stripe" (16 chars)
        var inNavOrFooter = el.closest('nav, footer, [role="navigation"]');
        if (inNavOrFooter && text.length < 8) continue;
        // Skip common cookie/consent patterns
        if (cookieRe.test(text)) continue;
        texts.push('[' + tag + '] ' + text);
      }
      return texts.join('\\n');
    })()`)) as string;
    // Truncate to ~30K chars to avoid blowing up the prompt
    if (visibleTextContent.length > 30000) {
      visibleTextContent = visibleTextContent.slice(0, 30000) + "\n[...truncated]";
    }
  } catch {
    // Non-blocking
  }
  return visibleTextContent;
}

/**
 * Caption downloaded images using a vision model.
 *
 * Provider is chosen by which API key is present: OPENROUTER_API_KEY → OpenRouter
 * (any vision model via its OpenAI-style API), else GEMINI_API_KEY/GOOGLE_API_KEY
 * → Google Gemini, else no captioning. OpenRouter wins if both are set.
 *
 * Batches requests to stay under free-tier rate limits.
 * Returns a map of filename -> caption string.
 */
// fallow-ignore-next-line complexity
export async function captionImagesWithGemini(
  outputDir: string,
  progress: (stage: string, detail?: string) => void,
  warnings: string[],
  options: VisionCaptionOptions = {},
): Promise<Record<string, string>> {
  const geminiCaptions: Record<string, string> = {};
  let timedOutCount = 0;
  let failedRequestCount = 0;
  let budgetExhausted = false;
  let internalError = false;
  const reportOutcome = (): void => {
    const outcome: VisionCaptionOutcome = {
      timedOutRequests: timedOutCount,
      failedRequests: failedRequestCount,
      budgetExhausted,
    };
    if (internalError) outcome.internalError = true;
    options.onOutcome?.(outcome);
  };
  if (options.skipVision) {
    reportOutcome();
    return geminiCaptions;
  }
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  // Vertex authenticates with a service account and a project instead of an API key. Server
  // deployments have those; they often do not have a working Gemini API key, and a rejected
  // key is indistinguishable from an unset one in the output — every request simply returns
  // nothing and the capture reports "0 images captioned".
  const vertexProject = process.env.HYPERFRAMES_VERTEX_PROJECT_ID;
  const vertexServiceAccount = process.env.HYPERFRAMES_VERTEX_SERVICE_ACCOUNT;
  const useVertex = Boolean(vertexProject && vertexServiceAccount);
  if (!openRouterKey && !useVertex && !geminiKey) {
    reportOutcome();
    return geminiCaptions;
  }

  // OpenRouter takes priority — it's the explicit opt-in for users without Google access.
  // Vertex outranks the bare API key because it is the credential a deployment actually
  // holds. All three satisfy the same single-image → one-line-caption contract
  // (`captionOne`), so the batching and SVG-rasterization loops stay provider-agnostic.
  const provider: "openrouter" | "vertex" | "gemini" = openRouterKey
    ? "openrouter"
    : useVertex
      ? "vertex"
      : "gemini";
  const providerName = { openrouter: "OpenRouter", vertex: "Vertex AI", gemini: "Gemini" }[
    provider
  ];
  // Override per provider via HYPERFRAMES_OPENROUTER_MODEL / HYPERFRAMES_VERTEX_MODEL /
  // HYPERFRAMES_GEMINI_MODEL. Vertex publishes a different model set than the Gemini API —
  // the API's flash-lite preview id is not resolvable there — so it carries its own default.
  const model = {
    openrouter: process.env.HYPERFRAMES_OPENROUTER_MODEL || "google/gemini-3.1-flash-lite",
    vertex: process.env.HYPERFRAMES_VERTEX_MODEL || "gemini-2.5-flash",
    gemini: process.env.HYPERFRAMES_GEMINI_MODEL || "gemini-3.1-flash-lite-preview",
  }[provider];
  const requestTimeoutMs = resolveVisionRequestTimeoutMs();

  progress("design", `Captioning images with ${providerName} vision...`);
  try {
    // One image → one short caption. Each provider implements this contract;
    // everything below is provider-agnostic.
    type CaptionOne = (args: {
      mimeType: string;
      base64: string;
      prompt: string;
      maxTokens: number;
      timeoutMs: number;
    }) => Promise<string>;

    let captionOne: CaptionOne;
    if (provider === "openrouter") {
      captionOne = async ({ mimeType, base64, prompt, maxTokens, timeoutMs }) => {
        return runBoundedVisionRequest(async (signal) => {
          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openRouterKey}`,
              "Content-Type": "application/json",
            },
            signal,
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    {
                      type: "image_url",
                      image_url: { url: `data:${mimeType};base64,${base64}` },
                    },
                  ],
                },
              ],
              max_tokens: maxTokens,
            }),
          });
          if (!res.ok) {
            await res.text();
            throw new Error(`OpenRouter request failed with HTTP ${res.status}`);
          }
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          return data.choices?.[0]?.message?.content?.trim() || "";
        }, timeoutMs);
      };
    } else {
      const { GoogleGenAI } = await import("@google/genai");
      let ai: InstanceType<typeof GoogleGenAI>;
      if (provider === "vertex") {
        // Re-narrow for TS; `useVertex` already guaranteed both are set.
        if (!vertexProject || !vertexServiceAccount) return geminiCaptions;
        let credentials: Record<string, unknown>;
        try {
          credentials = JSON.parse(vertexServiceAccount) as Record<string, unknown>;
        } catch {
          warnings.push(
            "HYPERFRAMES_VERTEX_SERVICE_ACCOUNT is not valid JSON; skipped vision captioning.",
          );
          internalError = true;
          reportOutcome();
          return geminiCaptions;
        }
        ai = new GoogleGenAI({
          vertexai: true,
          project: vertexProject,
          location: process.env.HYPERFRAMES_VERTEX_LOCATION || "us-central1",
          googleAuthOptions: { credentials },
        });
      } else {
        // Unreachable when geminiKey is unset (guarded above); re-narrow for TS.
        if (!geminiKey) return geminiCaptions;
        ai = new GoogleGenAI({ apiKey: geminiKey });
      }
      captionOne = async ({ mimeType, base64, prompt, maxTokens, timeoutMs }) => {
        const response = await runBoundedVisionRequest(
          (signal) =>
            ai.models.generateContent({
              model,
              contents: [
                {
                  role: "user",
                  parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }],
                },
              ],
              config: {
                maxOutputTokens: maxTokens,
                // A one-line factual caption needs no reasoning, and leaving thinking on is
                // not merely wasteful: thinking tokens are drawn from maxOutputTokens, so the
                // model can spend the whole budget and return empty text. That surfaces as a
                // successful request with no caption — the capture then logs "Captioned N/N
                // images" followed by "0 images captioned", which is what production shows.
                thinkingConfig: { thinkingBudget: 0 },
                abortSignal: signal,
                httpOptions: { timeout: timeoutMs },
              },
            }),
          timeoutMs,
        );
        return response.text?.trim() || "";
      };
    }

    const imageFiles = readdirSync(join(outputDir, "assets")).filter((f: string) =>
      /\.(png|jpg|jpeg|webp|gif)$/i.test(f),
    );

    // Caption in parallel batches. Gemini free tier is ~5 RPM (slow but $0),
    // paid/OpenRouter ~2000 RPM. We batch 20 with a 2s inter-batch pause and rely
    // on Promise.allSettled so one rate-limited image does not fail its siblings;
    // rejected requests are aggregated into a sanitized warning below.
    const BATCH_SIZE = 20;
    const collectCaptionResults = (
      results: PromiseSettledResult<{ file: string; caption: string }>[],
    ): { timeouts: number; failures: number } => {
      let timeouts = 0;
      let failures = 0;
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.caption) {
          geminiCaptions[result.value.file] = result.value.caption;
        } else if (
          result.status === "rejected" &&
          result.reason instanceof VisionRequestTimeoutError
        ) {
          timeouts++;
        } else if (result.status === "rejected") {
          failures++;
        }
      }
      return { timeouts, failures };
    };
    for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
      const remainingMs = options.remainingMs?.() ?? Number.POSITIVE_INFINITY;
      if (remainingMs <= 0) {
        budgetExhausted = true;
        break;
      }
      const timeoutMs = Math.max(1, Math.min(requestTimeoutMs, remainingMs));
      const batch = imageFiles.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (file: string) => {
          const filePath = join(outputDir, "assets", file);
          const stat = statSync(filePath);
          if (stat.size > 4_000_000) return { file, caption: "" }; // skip images > 4 MB (provider inline limit)
          const buffer = readFileSync(filePath);
          const base64 = buffer.toString("base64");
          const ext = file.split(".").pop()?.toLowerCase() || "png";
          const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          const caption = await captionOne({
            mimeType,
            base64,
            prompt:
              "Describe this website image in ONE short sentence for a video storyboard. Focus on: what it shows, dominant colors, whether background is light or dark. Be factual, not creative.",
            maxTokens: 500,
            timeoutMs,
          });
          return { file, caption };
        }),
      );
      const counts = collectCaptionResults(results);
      timedOutCount += counts.timeouts;
      failedRequestCount += counts.failures;
      // Pace requests between batches (paid tier: 2000+ RPM, free tier: rate-limited)
      if (i + BATCH_SIZE < imageFiles.length) {
        await new Promise((r) => setTimeout(r, 2000)); // 2s pause between batches — paid tier handles 2000 RPM, free tier retries via Promise.allSettled
      }
      progress(
        "design",
        `Captioned ${Math.min(i + BATCH_SIZE, imageFiles.length)}/${imageFiles.length} images...`,
      );
    }
    progress(
      "design",
      `${Object.keys(geminiCaptions).length} images captioned with ${providerName}`,
    );

    // Rasterize SVGs to PNG before captioning — Vision hallucinates wordmarks when reading SVG path text.
    const svgFiles: Array<{ file: string; relPath: string }> = [];
    const assetsDir = join(outputDir, "assets");
    for (const f of readdirSync(assetsDir)) {
      if (/\.svg$/i.test(f)) svgFiles.push({ file: f, relPath: f });
    }
    const svgsSubdir = join(assetsDir, "svgs");
    if (existsSync(svgsSubdir)) {
      for (const f of readdirSync(svgsSubdir)) {
        if (/\.svg$/i.test(f)) svgFiles.push({ file: f, relPath: `svgs/${f}` });
      }
    }

    if (svgFiles.length > 0) {
      // sharp is an optional native module; its platform binary fails to load
      // on some installs (omit-optional, musl/glibc, monorepo hoisting, broken
      // cache). Load it lazily and degrade to skipping SVG captioning rather
      // than crashing the whole capture command on import.
      let sharp: typeof sharpType;
      try {
        sharp = (await import("sharp")).default as typeof sharpType;
      } catch (err) {
        warnings.push(
          `Skipped ${svgFiles.length} SVG caption(s): sharp could not load (${(err as Error).message}). ` +
            `Reinstall with optional dependencies enabled (e.g. \`npm i sharp\`) to caption SVG assets.`,
        );
        reportOutcome();
        return geminiCaptions;
      }
      // libvips' worker pool sizes itself to the host's core count, and several concurrent SVG
      // renders then multiply that — the combination corrupted the heap in production (see the
      // serialized rasterize loop below). `sharp.concurrency` is process-global and outlives this
      // function, so remember the host's value and bound the pool only around the renders that
      // need it: captioning must not leave every later sharp caller in this process — none of
      // which asked for captioning — pinned to a single thread for the rest of its life.
      const hostConcurrency = sharp.concurrency();
      progress("design", `Rasterizing + captioning ${svgFiles.length} SVGs via vision API...`);
      const SVG_BATCH = 20;
      const SVG_RENDER_SIZE = 256; // px — enough resolution for Gemini to read wordmarks, small enough to keep payload sub-MB
      let svgsSkipped = 0;
      for (let i = 0; i < svgFiles.length; i += SVG_BATCH) {
        const remainingMs = options.remainingMs?.() ?? Number.POSITIVE_INFINITY;
        if (remainingMs <= 0) {
          budgetExhausted = true;
          break;
        }
        const timeoutMs = Math.max(1, Math.min(requestTimeoutMs, remainingMs));
        const batch = svgFiles.slice(i, i + SVG_BATCH);
        // Rasterize the batch one file at a time, then caption it in parallel.
        //
        // Rasterizing the whole batch concurrently drove up to SVG_BATCH simultaneous librsvg
        // renders through libvips, and that corrupts the heap: production captures aborted
        // with `free(): unaligned chunk detected in tcache 2` (SIGABRT) during this phase and
        // lost the entire capture. A native abort cannot be caught by the try/catch below, so
        // the concurrency has to go rather than be handled. Rasterizing is local and cheap;
        // the vision request is the slow leg and stays parallel, so throughput barely moves.
        const rasterized: { relPath: string; pngBase64: string | null }[] = [];
        sharp.concurrency(1);
        try {
          for (const { relPath } of batch) {
            const filePath = join(assetsDir, relPath);
            try {
              // Flatten against a contrasting background — white-on-white SVGs render invisible to Vision.
              const svgSource = readFileSync(filePath, "utf-8");
              const lightFillHits = (
                svgSource.match(/fill\s*=\s*["'](#fff(fff)?|white|#[ef][ef][ef]|#[ef]{6})["']/gi) ||
                []
              ).length;
              const darkFillHits = (
                svgSource.match(/fill\s*=\s*["'](#000(000)?|black|#[0-3]{6}|#[0-3]{3})["']/gi) || []
              ).length;
              const bg =
                lightFillHits > darkFillHits
                  ? { r: 32, g: 32, b: 32 } // dark slate behind light glyphs
                  : { r: 255, g: 255, b: 255 }; // white behind dark glyphs (default)
              const pngBuffer = await sharp(filePath)
                .resize({
                  width: SVG_RENDER_SIZE,
                  height: SVG_RENDER_SIZE,
                  fit: "inside",
                  withoutEnlargement: false,
                })
                .flatten({ background: bg })
                .png()
                .toBuffer();
              rasterized.push({ relPath, pngBase64: pngBuffer.toString("base64") });
            } catch {
              // exotic SVG features may break sharp; skip caption rather than block
              svgsSkipped++;
              rasterized.push({ relPath, pngBase64: null });
            }
          }
        } finally {
          // Hand the pool back even if a rasterize threw: the vision requests below are network
          // work that gains nothing from a pinned pool, and the process outlives this capture.
          sharp.concurrency(hostConcurrency);
        }
        const results = await Promise.allSettled(
          rasterized.map(async ({ relPath, pngBase64 }) => {
            if (pngBase64 === null) return { file: relPath, caption: "" };
            const caption = await captionOne({
              mimeType: "image/png",
              base64: pngBase64,
              prompt:
                "Describe this SVG asset rendered from a website in ONE short sentence for a video storyboard. " +
                "Focus on: what shape/icon/illustration/wordmark it is, its colors, any text it contains. " +
                "If you see a wordmark, READ THE LETTERS LITERALLY — do not guess a brand from context. " +
                "Be factual.",
              maxTokens: 300,
              timeoutMs,
            });
            return { file: relPath, caption };
          }),
        );
        const counts = collectCaptionResults(results);
        timedOutCount += counts.timeouts;
        failedRequestCount += counts.failures;
        if (i + SVG_BATCH < svgFiles.length) {
          await new Promise((r) => setTimeout(r, 2000));
        }
        progress(
          "design",
          `Captioned ${Math.min(i + SVG_BATCH, svgFiles.length)}/${svgFiles.length} SVGs...`,
        );
      }
      progress("design", `${Object.keys(geminiCaptions).length} total assets captioned`);
      if (svgsSkipped > 0) {
        progress(
          "design",
          `skipped rasterizing ${svgsSkipped} SVG(s) — fell back to label-derived`,
        );
      }
    }
    if (timedOutCount > 0) {
      warnings.push(
        `${providerName} vision timed out for ${timedOutCount} asset(s); captions omitted.`,
      );
    }
    if (failedRequestCount > 0) {
      warnings.push(
        `${providerName} vision failed for ${failedRequestCount} asset(s); captions omitted.`,
      );
    }
  } catch {
    internalError = true;
    warnings.push(`${providerName} captioning failed internally; captions omitted.`);
  }

  reportOutcome();
  return geminiCaptions;
}

/**
 * Generate asset-descriptions.md — one-line descriptions for each downloaded asset.
 *
 * Returns the description lines (without the markdown header).
 */
export function generateAssetDescriptions(
  outputDir: string,
  tokens: DesignTokens,
  catalogedAssets: CatalogedAsset[],
  geminiCaptions: Record<string, string>,
): string[] {
  // Sort: Gemini-captioned images first (richest descriptions), then uncaptioned, then SVGs, then fonts
  const captionedLines: string[] = [];
  const uncaptionedLines: string[] = [];
  const svgLines: string[] = [];
  const fontLines: string[] = [];

  // Describe downloaded images
  const assetsPath = join(outputDir, "assets");
  try {
    for (const file of readdirSync(assetsPath)) {
      if (file === "svgs" || file === "fonts" || file === "lottie" || file === "videos") continue;
      const filePath = join(assetsPath, file);
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
      const sizeKb = Math.round(stat.size / 1024);
      const catalogMatch = catalogedAssets.find(
        (a) => a.url && file.includes(a.url.split("/").pop()?.split("?")[0]?.slice(0, 20) || "___"),
      );
      const desc = catalogMatch?.description || catalogMatch?.notes || "";
      const heading = catalogMatch?.nearestHeading || "";
      const section = catalogMatch?.sectionClasses || "";
      const aboveFold = catalogMatch?.aboveFold ? "above fold" : "";
      const geminiCaption = geminiCaptions[file];
      const cleanName = file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const parts = [`${file} — ${sizeKb}KB`];
      if (geminiCaption) {
        parts.push(geminiCaption);
        captionedLines.push(parts.join(", "));
      } else {
        if (desc) parts.push(`"${desc.slice(0, 80)}"`);
        if (heading) parts.push(`section: "${heading.slice(0, 60)}"`);
        else if (section) parts.push(`in: ${section.split(" ").slice(0, 3).join(" ")}`);
        if (aboveFold) parts.push(aboveFold);
        if (!desc && !heading) parts.push(cleanName);
        uncaptionedLines.push(parts.join(", "));
      }
    }
  } catch {
    /* no assets dir */
  }

  // Describe SVGs
  try {
    const svgsPath = join(assetsPath, "svgs");
    for (const file of readdirSync(svgsPath)) {
      if (!file.endsWith(".svg")) continue;
      const svgMatch = tokens.svgs.find(
        (s) =>
          s.label &&
          file.includes(
            s.label
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "-")
              .slice(0, 15),
          ),
      );
      const geminiCaption = geminiCaptions[`svgs/${file}`];
      if (geminiCaption) {
        svgLines.push(`svgs/${file} — ${geminiCaption}`);
        continue;
      }
      const label = svgMatch?.label || file.replace(".svg", "").replace(/-/g, " ");
      svgLines.push(`svgs/${file} — ${label}`);
    }
  } catch {
    /* no svgs dir */
  }

  // Describe fonts
  try {
    const fontsPath = join(assetsPath, "fonts");
    for (const file of readdirSync(fontsPath)) {
      fontLines.push(`fonts/${file} — font file`);
    }
  } catch {
    /* no fonts dir */
  }

  // Describe videos — high-value motion clips. The video-manifest.json (written
  // earlier by captureVideoManifest) carries each clip's DOM heading/caption +
  // dims. Surfaced FIRST and tagged `[video]`: for a product/demo these moving
  // clips are usually the strongest hero material, and downstream planners key off
  // the `[video]` marker. (The `videos/` dir is skipped in the image walk above —
  // its entries come from the manifest, which has the captions the bare files lack.)
  const videoLines: string[] = [];
  try {
    const manifest = JSON.parse(
      readFileSync(join(outputDir, "extracted", "video-manifest.json"), "utf-8"),
    ) as Array<{
      filename?: string;
      localPath?: string;
      caption?: string;
      heading?: string;
      width?: number;
      height?: number;
      sourceWidth?: number;
      sourceHeight?: number;
    }>;
    for (const v of manifest) {
      if (!v.localPath) continue; // only describe clips that actually downloaded
      const base = basename(v.localPath) || v.filename || "";
      if (!base) continue;
      const desc =
        (v.caption || v.heading || "").trim().replace(/\s+/g, " ").slice(0, 140) || "motion clip";
      const dimW = v.sourceWidth || v.width;
      const dimH = v.sourceHeight || v.height;
      const dims = dimW && dimH ? `, ~${dimW}×${dimH}` : "";
      videoLines.push(`${base} — [video] ${desc}${dims}`);
    }
  } catch {
    /* no video manifest */
  }

  return [...videoLines, ...captionedLines, ...uncaptionedLines, ...svgLines, ...fontLines];
}
