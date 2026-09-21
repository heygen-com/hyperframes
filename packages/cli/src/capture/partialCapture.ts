import { mkdirSync } from "node:fs";
import { writeCaptureFileSync } from "./captureFile.js";
import { join } from "node:path";
import { noDrops } from "./assetDownloader.js";
import type {
  CaptureOptions,
  CaptureResult,
  DesignStyles,
  DesignTokens,
  ExtractedHtml,
} from "./types.js";

export function serializeTokensForCapture(tokens: DesignTokens): string {
  const tokensForDisk = {
    ...tokens,
    svgs: tokens.svgs.map(({ outerHTML: _, ...rest }) => rest),
  };
  return JSON.stringify(tokensForDisk, null, 2);
}

export interface PartialCaptureState {
  tokens: DesignTokens;
  designStyles: DesignStyles;
  extracted: ExtractedHtml;
  pageHtml: string;
  screenshots: string[];
  assets: CaptureResult["assets"];
  dropped: CaptureResult["dropped"];
  warnings: string[];
}

export function createPartialCaptureState(opts: CaptureOptions): PartialCaptureState {
  return {
    tokens: {
      title: "",
      description: "",
      cssVariables: {},
      fonts: [],
      colors: [],
      headings: [],
      ctas: [],
      svgs: [],
      sections: [],
    },
    designStyles: {
      typography: [],
      spacing: { observed: [], baseUnit: 0 },
      radius: [],
      shadows: [],
      buttons: [],
      cards: [],
      nav: null,
    },
    extracted: {
      headHtml: "",
      bodyHtml: "",
      cssomRules: "",
      htmlAttrs: "",
      viewportWidth: opts.viewportWidth ?? 1920,
      viewportHeight: opts.viewportHeight ?? 1080,
      fullPageHeight: 0,
    },
    pageHtml: "<!doctype html>\n<html><head></head><body></body></html>\n",
    screenshots: [],
    assets: [],
    dropped: noDrops(),
    warnings: [],
  };
}

export function writePartialCaptureBundle(
  opts: CaptureOptions,
  state: PartialCaptureState,
  lastPhase: CaptureResult["lastPhase"],
): CaptureResult {
  const hostname = new URL(opts.url).hostname.replace(/^www\./, "");
  mkdirSync(opts.outputDir, { recursive: true });
  const extractedDir = join(opts.outputDir, "extracted");
  mkdirSync(extractedDir, { recursive: true });
  writeCaptureFileSync(join(extractedDir, "tokens.json"), serializeTokensForCapture(state.tokens));
  writeCaptureFileSync(
    join(extractedDir, "design-styles.json"),
    JSON.stringify(state.designStyles, null, 2),
  );
  writeCaptureFileSync(join(extractedDir, "page.html"), state.pageHtml);
  const metaPath = join(opts.outputDir, "meta.json");
  try {
    writeCaptureFileSync(
      metaPath,
      JSON.stringify({ id: hostname + "-video", name: hostname, partial: true }, null, 2),
      { flag: "wx" },
    );
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code !== "EEXIST") throw err;
  }
  return {
    ok: false,
    projectDir: opts.outputDir,
    url: opts.url,
    httpStatus: null,
    title: state.tokens.title,
    extracted: state.extracted,
    screenshots: state.screenshots,
    tokens: state.tokens,
    assets: state.assets,
    dropped: state.dropped,
    warnings: [
      ...state.warnings,
      "Capture deadline reached; returning the partial capture bundle.",
    ],
    lastPhase,
  };
}
