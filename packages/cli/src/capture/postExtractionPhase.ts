import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  downloadAssets,
  downloadAndRewriteFonts,
  mergeDrops,
  noDrops,
  totalDrops,
} from "./assetDownloader.js";
import { extractFontMetadata } from "./fontMetadataExtractor.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { diag } from "../ui/diagnostics.js";
import { serializeTokensForCapture } from "./partialCapture.js";
import type { PartialCaptureState } from "./partialCapture.js";
import type {
  CapturePhase,
  CapturePhaseProgress,
  CaptureResult,
  DesignTokens,
  ExtractedHtml,
} from "./types.js";
import type { CatalogedAsset } from "./assetCataloger.js";
import type { IconCandidate } from "./faviconRanker.js";
import { createCaptureDownloadBudget } from "./readBoundedResponse.js";
import {
  captionImagesWithGemini,
  generateAssetDescriptions,
  resolveVisionPhaseCompletion,
} from "./contentExtractor.js";
import type { VisionCaptionOutcome } from "./contentExtractor.js";

function hasVisionCredentials(skipVision: boolean): boolean {
  return Boolean(
    !skipVision &&
    (process.env.OPENROUTER_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      (process.env.HYPERFRAMES_VERTEX_PROJECT_ID &&
        process.env.HYPERFRAMES_VERTEX_SERVICE_ACCOUNT)),
  );
}

function writeAssetDescriptionsFile(outputDir: string, lines: string[], header: string): void {
  writeFileSync(
    join(outputDir, "extracted", "asset-descriptions.md"),
    header + lines.map((line) => `- ${line}`).join("\n") + "\n",
    "utf-8",
  );
}

export interface PostExtractionInput {
  state: PartialCaptureState;
  outputDir: string;
  warnings: string[];
  progress: (stage: string, detail?: string) => void;
  remainingMs: () => number;
  phase: (
    name: CapturePhase,
    status: CapturePhaseProgress["status"],
    reason?: CapturePhaseProgress["reason"],
  ) => void;
  animationCatalog: CaptureResult["animationCatalog"];
  catalogedAssets: CatalogedAsset[];
  visibleTextContent: string;
  faviconLinks: IconCandidate[];
  tokens: DesignTokens;
  extracted: ExtractedHtml;
  skipAssets: boolean;
  skipVision: boolean;
  downloadByteBudget: ReturnType<typeof createCaptureDownloadBudget>;
  assets: CaptureResult["assets"];
  dropped: CaptureResult["dropped"];
  fontDrops: CaptureResult["dropped"];
  canWrite: () => boolean;
}

export interface PostExtractionResult {
  assets: CaptureResult["assets"];
  dropped: CaptureResult["dropped"];
  fontDrops: CaptureResult["dropped"];
  extracted: ExtractedHtml;
  tokens: DesignTokens;
  animationCatalog: CaptureResult["animationCatalog"];
}

export async function runPostExtraction(input: PostExtractionInput): Promise<PostExtractionResult> {
  let {
    state,
    outputDir,
    warnings,
    progress,
    remainingMs,
    phase,
    animationCatalog,
    catalogedAssets,
    visibleTextContent,
    faviconLinks,
    tokens,
    extracted,
    skipAssets,
    skipVision,
    downloadByteBudget,
    assets,
    dropped,
    fontDrops,
    canWrite,
  } = input;
  const runFontExtraction = async (): Promise<void> => {
    if (!canWrite()) return;
    // Download fonts and preserve per-font budget exhaustion in the capture tally.
    phase("fonts", "started");
    const fontPass = await downloadAndRewriteFonts(extracted.headHtml, outputDir, {
      remainingMs,
      byteBudget: downloadByteBudget,
    });
    fontDrops = fontPass.drops;
    extracted.headHtml = fontPass.css;
    phase(
      "fonts",
      remainingMs() > 0 ? "completed" : "degraded",
      remainingMs() > 0 ? undefined : "budget-exhausted",
    );

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
  };
  await runFontExtraction();

  const runAnimationCatalog = async (): Promise<void> => {
    // Save animation catalog — lean version for the agent (not 745 raw CSS declarations)
    if (animationCatalog) {
      // Extract just what's useful: counts, named animations, a few representative keyframed entries
      const uniqueAnimNames = new Set<string>();
      for (const d of animationCatalog.cssDeclarations || []) {
        if (d.animation?.name) uniqueAnimNames.add(d.animation.name);
      }

      // Keep up to 10 Web Animations that have actual keyframe data (most useful for recreation)
      const representativeAnims = (animationCatalog.webAnimations || [])
        .filter((a: { keyframes?: unknown[] }) => a.keyframes && a.keyframes.length > 0)
        .slice(0, 10);

      const leanCatalog = {
        summary: animationCatalog.summary,
        namedAnimations: Array.from(uniqueAnimNames),
        scrollTriggeredElements: (animationCatalog.scrollTargets || []).length,
        representativeAnimations: representativeAnims,
      };

      if (canWrite()) {
        writeFileSync(
          join(outputDir, "extracted", "animations.json"),
          JSON.stringify(leanCatalog, null, 2),
          "utf-8",
        );
      }
    }
  };
  await runAnimationCatalog();

  const runAssetDownload = async (): Promise<void> => {
    // Download assets — single pass using the catalog for best image quality
    let assetDrops = noDrops();
    const runAssetFetch = async (): Promise<void> => {
      if (!skipAssets && canWrite()) {
        // Called even with the budget already gone, for the reason the font pass is: the loop that
        // skips an asset is the only thing that can say how many it skipped.
        phase("assets", "started");
        progress("assets", "Downloading assets...");
        const assetPass = await downloadAssets(tokens, outputDir, catalogedAssets, faviconLinks, {
          remainingMs,
          byteBudget: downloadByteBudget,
        });
        assets = assetPass.assets;
        assetDrops = assetPass.drops;
        state.assets = assets;
        // Which icons the site declared, what each one is, and why one became favicon.<ext>.
        // The brand-kit consumer needs the shape to decide which tile an icon belongs in; the
        // reason is what stops a substituted headline from being silent again.
        if (canWrite()) {
          writeFileSync(
            join(outputDir, "extracted", "icons-manifest.json"),
            JSON.stringify(assetPass.icons, null, 2),
            "utf-8",
          );
        }
        phase(
          "assets",
          remainingMs() > 0 ? "completed" : "degraded",
          remainingMs() > 0 ? undefined : "budget-exhausted",
        );
      } else {
        phase("assets", "degraded", "disabled");
      }
    };
    await runAssetFetch();

    const recordAssetDrops = (): void => {
      // One capture-wide tally, summed from the two passes that own the drops. The warning is
      // DERIVED from it rather than written alongside it, so the prose and the number cannot
      // disagree the way two separately-authored budget strings could.
      dropped = mergeDrops(fontDrops, assetDrops);
      state.dropped = dropped;
      const droppedTotal = totalDrops(dropped);
      if (droppedTotal > 0) {
        const breakdown = Object.entries(dropped)
          .filter(([, n]) => typeof n === "number" && n > 0)
          .map(([reason, n]) => `${n} ${reason}`)
          .join(", ");
        warnings.push(
          `${droppedTotal} referenced asset(s) are not in this capture (${breakdown}). ` +
            "A thin capture with no drops is a thin page; this one was truncated.",
        );
      }
    };
    recordAssetDrops();

    const rewriteTokenAssets = (): void => {
      // Join in-section media URLs → downloaded local paths, then re-write
      // tokens.json. Downstream page recreation MUST reference local files:
      // remote URLs fail at render time (hotlink/CORS 403, no egress in
      // Docker/Lambda, frame-timing blanks for not-yet-loaded images).
      const base = (u: string): string => u.split(/[#?]/)[0] ?? u;
      const localByUrl = new Map<string, string>();
      const collectLocalAssetPaths = (): void => {
        for (const a of assets) {
          if (!a.url || !a.localPath) continue;
          localByUrl.set(a.url, a.localPath);
          localByUrl.set(base(a.url), a.localPath);
        }
      };
      collectLocalAssetPaths();
      const applyLocalAssetPaths = (): void => {
        for (const sec of tokens.sections || []) {
          const local: string[] = [];
          for (const u of sec.assetUrls || []) {
            const hit = localByUrl.get(u) || localByUrl.get(base(u));
            if (hit && !local.includes(hit)) local.push(hit);
          }
          if (local.length) sec.assets = local;
        }
      };
      applyLocalAssetPaths();
      if (assets.length && Array.isArray(tokens.sections)) {
        if (canWrite()) {
          writeFileSync(
            join(outputDir, "extracted", "tokens.json"),
            serializeTokensForCapture(tokens),
            "utf-8",
          );
        }
      }
    };
    await rewriteTokenAssets();
  };
  await runAssetDownload();

  // Persist a self-contained page recreation under extracted/, with images already inlined.
  try {
    const pageHtml = `<!doctype html>\n<html ${extracted.htmlAttrs || ""}>\n<head>\n${extracted.headHtml}\n</head>\n<body>\n${extracted.bodyHtml}\n</body>\n</html>\n`;
    state.pageHtml = pageHtml;
    if (canWrite()) writeFileSync(join(outputDir, "extracted", "page.html"), pageHtml, "utf-8");
  } catch (err) {
    warnings.push(`page.html write failed: ${err}`);
  }
  // Save visible text content for AI agent to use
  if (visibleTextContent) {
    if (canWrite()) {
      writeFileSync(join(outputDir, "extracted", "visible-text.txt"), visibleTextContent, "utf-8");
    }
  }

  // detected-libraries and assets-catalog removed — 0/8 agents read them in v6 testing

  // AI-powered image captioning via Gemini (optional — enriches asset descriptions)
  let geminiCaptions: Record<string, string> = {};
  const runVision = async (): Promise<void> => {
    if (skipVision) {
      phase("vision", "degraded", "disabled");
    } else if (remainingMs() <= 0 || !canWrite()) {
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
  };
  await runVision();

  // Generate asset descriptions for the AI agent
  const runAssetDescriptions = (): void => {
    progress("design", "Generating asset descriptions...");
    try {
      const lines = generateAssetDescriptions(outputDir, tokens, catalogedAssets, geminiCaptions);
      if (lines.length === 0 || !canWrite()) return;
      const hasVisionKey = hasVisionCredentials(skipVision);
      const header = hasVisionKey
        ? "# Asset Descriptions\n\nOne line per file. Read this instead of opening every image individually.\n\nTo find a specific brand or icon, **grep this file for the brand name in the description text** (e.g. `grep -i 'autodesk' asset-descriptions.md`). The Gemini Vision captions identify what's actually in each file — that's the agent's selector.\n\nThe `logo-<hash>.svg` filename prefix is a cheap structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). It is NOT a content claim — many `logo-*` files are nav icons or decorative shapes. Trust the captions, not the filename prefix.\n\n"
        : "# Asset Descriptions\n\n⚠️  No vision credentials — descriptions below are catalog-derived (alt text, headings, section context, filename) instead of Vision-generated. To get richer Vision descriptions on the next capture, set GEMINI_API_KEY (or GOOGLE_API_KEY), or HYPERFRAMES_VERTEX_PROJECT_ID plus HYPERFRAMES_VERTEX_SERVICE_ACCOUNT for Vertex service-account auth, and re-run.\n\nThe `logo-<hash>.svg` filename prefix is a structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). To pick the actual brand logo without Vision, open the `logo-*` candidates in a previewer or rasterize them with `sharp` before referencing — composing a fake logo ships off-brand in the final video.\n\n";
      writeAssetDescriptionsFile(outputDir, lines, header);
      progress(
        "design",
        `${lines.length} asset descriptions written${hasVisionKey ? "" : " (no vision provider — catalog-fallback mode)"}`,
      );
    } catch {
      /* non-critical */
    }
  };
  runAssetDescriptions();

  progress("design", "DESIGN.md will be created by your AI agent");

  // Generate contact sheets (saves AI agents 50-65% tokens vs reading images individually)
  // All functions return string[] — paginated so every image is covered
  const runContactSheets = async (): Promise<void> => {
    if (remainingMs() > 0 && canWrite()) {
      phase("contact-sheets", "started");
      try {
        const { createScrollContactSheet, createAssetContactSheet, createSvgContactSheet } =
          await import("./contactSheet.js");

        const contactSheetBudget = { remainingMs };

        const runScrollContactSheet = async (): Promise<void> => {
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
        };
        await runScrollContactSheet();

        const runAssetContactSheet = async (): Promise<void> => {
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
        };
        await runAssetContactSheet();

        const runSvgContactSheet = async (): Promise<void> => {
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
        };
        await runSvgContactSheet();
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
  };
  await runContactSheets();

  return { assets, dropped, fontDrops, extracted, tokens, animationCatalog };
}
