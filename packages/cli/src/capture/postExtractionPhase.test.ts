import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { noDrops } from "./assetDownloader.js";
import { createPartialCaptureState } from "./partialCapture.js";
import { runPostExtraction } from "./postExtractionPhase.js";
import { createCaptureDownloadBudget } from "./readBoundedResponse.js";

const PLANTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#abc"/></svg>`;

describe("runPostExtraction", () => {
  // Creating symlinks needs elevated rights on Windows.
  it.skipIf(process.platform === "win32")(
    "does not write the SVG contact sheet through a planted assets/svgs symlink under --skip-assets (#4304)",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "hyperframes-post-extraction-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const outputDir = join(root, "capture");
      const outside = join(root, "outside");
      for (const dir of ["extracted", "screenshots", "assets"]) {
        mkdirSync(join(outputDir, dir), { recursive: true });
      }
      mkdirSync(outside);
      writeFileSync(join(outside, "planted.svg"), PLANTED_SVG);
      symlinkSync(outside, join(outputDir, "assets", "svgs"));

      const state = createPartialCaptureState({ url: "https://example.com", outputDir });
      const warnings: string[] = [];
      await runPostExtraction({
        state,
        outputDir,
        warnings,
        progress: () => {},
        remainingMs: () => 60_000,
        phase: () => {},
        animationCatalog: undefined,
        catalogedAssets: [],
        visibleTextContent: "",
        faviconLinks: [],
        tokens: state.tokens,
        extracted: state.extracted,
        skipAssets: true,
        skipVision: true,
        downloadByteBudget: createCaptureDownloadBudget(),
        assets: [],
        dropped: noDrops(),
        fontDrops: noDrops(),
        canWrite: () => true,
      });

      expect(readdirSync(outside)).toEqual(["planted.svg"]);
      expect(warnings).toEqual([
        expect.stringMatching(/^SVG contact sheet skipped: Refusing to write/),
      ]);
    },
  );
});
