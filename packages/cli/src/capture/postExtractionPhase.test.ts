import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { noDrops } from "./assetDownloader.js";
import { createPartialCaptureState } from "./partialCapture.js";
import { runPostExtraction, withoutCompositionMarker } from "./postExtractionPhase.js";
import { createCaptureDownloadBudget } from "./readBoundedResponse.js";

// Only a test that sets `fonts.read` replaces the font reading; the others get the real one.
const fonts = vi.hoisted(() => ({ read: undefined as (() => unknown) | undefined }));
vi.mock("./fontMetadataExtractor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fontMetadataExtractor.js")>();
  return {
    ...actual,
    extractFontMetadata: (...args: Parameters<typeof actual.extractFontMetadata>) =>
      fonts.read ? (fonts.read() as never) : actual.extractFontMetadata(...args),
  };
});

afterEach(() => {
  fonts.read = undefined;
  vi.restoreAllMocks();
});

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

  async function runWithFonts(
    read: () => unknown,
    bodyHtml?: string,
  ): Promise<{ outputDir: string }> {
    const root = mkdtempSync(join(tmpdir(), "hyperframes-post-extraction-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const outputDir = join(root, "capture");
    for (const dir of ["extracted", "screenshots", "assets"]) {
      mkdirSync(join(outputDir, dir), { recursive: true });
    }
    const state = createPartialCaptureState({ url: "https://example.com", outputDir });
    if (bodyHtml !== undefined) state.extracted.bodyHtml = bodyHtml;
    fonts.read = read;
    await runPostExtraction({
      state,
      outputDir,
      warnings: [],
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
    return { outputDir };
  }

  // fails without the fix: a captured site that carries the composition marker was saved with it, so Studio listed
  // extracted/page.html as a composition and ran its scripts on its own origin
  it("saves the captured page without the composition marker", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { outputDir } = await runWithFonts(
      () => ({ files: [], families: [], unidentified: [] }),
      `<div data-composition-id="x"><script>fetch("/api/projects")</script></div><i DATA-COMPOSITION-ID = 'y'></i>`,
    );

    const saved = readFileSync(join(outputDir, "extracted", "page.html"), "utf-8");
    expect(saved).toContain(`<script>fetch("/api/projects")</script>`);
    expect(saved).not.toMatch(/data-composition-id/i);
  });

  const printed = (spy: { mock: { calls: unknown[][] } }): string =>
    spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");

  // fails without the fix: a family name read from a font file was printed as stored in the file
  it("shows control characters in a font family name as text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runWithFonts(() => ({
      files: [],
      families: [{ family: "Inter\u0007", variable: true, fileCount: 2 }],
      unidentified: [],
    }));

    expect(printed(error)).toContain("Font metadata extracted: Inter\\x07 (variable) × 2");
    expect(printed(error)).not.toContain("\u0007");
  });

  // fails without the fix: the reason the fonts could not be read was printed as it arrived
  it("shows control characters in a font reading failure as text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runWithFonts(() => {
      throw new Error("bad name table in a\u0007.woff2\nsecond line");
    });

    expect(printed(warn)).toContain(
      "Font metadata extraction failed (non-fatal): bad name table in a\\x07.woff2\nsecond line",
    );
    expect(printed(warn)).not.toContain("\u0007");
  });
});

describe("withoutCompositionMarker", () => {
  // fails without the fix: the old replacement ended in "d", which joined the page text after it into the marker again.
  it.each([
    '<div data-composition-id="x"></div>',
    '<div data-composition-idata-composition-id="x"></div>',
    '<div data-composition-iddata-composition-idata-composition-id="x"></div>',
    '<div DATA-Composition-IData-composition-ID="x"></div>',
    `<div data-composition-id${"ata-composition-id".repeat(50)}="x"></div>`,
    '<div data-composition-data-composition-idid="x"></div>',
  ])("leaves no marker in any letter case: %s", (html) => {
    const saved = withoutCompositionMarker(html);
    expect(saved.toLowerCase()).not.toContain("data-composition-id");
    expect(withoutCompositionMarker(saved)).toBe(saved);
  });

  it("changes nothing else on the page", () => {
    expect(withoutCompositionMarker('<p id="a">data-composition</p>')).toBe(
      '<p id="a">data-composition</p>',
    );
  });
});
