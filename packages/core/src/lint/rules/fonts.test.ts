import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

function findByCode(html: string, code: string, isSubComposition = true) {
  const result = lintHyperframeHtml(html, { isSubComposition });
  return result.findings.filter((f) => f.code === code);
}

describe("font rules", () => {
  describe("google_fonts_import", () => {
    it("flags @import url with fonts.googleapis.com", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap');</style>
      </div>`;
      const findings = findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("warning");
    });

    it("flags <link> to fonts.googleapis.com", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      </div>`;
      const findings = findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(1);
    });

    it("does not flag local @font-face usage", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>@font-face { font-family: 'Inter'; src: url('../capture/assets/fonts/Inter.woff2'); }</style>
      </div>`;
      const findings = findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(0);
    });
  });

  describe("font_family_without_font_face", () => {
    it("flags font-family used without @font-face", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'GT Walsheim', sans-serif; }</style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("gt walsheim");
    });

    it("does not flag when @font-face is declared", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'GT Walsheim'; src: url('../fonts/gt.woff2'); }
          body { font-family: 'GT Walsheim', sans-serif; }
        </style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("does not flag generic font families", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: monospace; }</style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("reports multiple missing families in one finding", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          h1 { font-family: 'Aeonik', sans-serif; }
          code { font-family: 'Feature Deck', monospace; }
        </style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("aeonik");
      expect(findings[0]!.message).toContain("feature deck");
    });

    it("does not flag fonts the producer has pre-bundled", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          body { font-family: 'Inter', sans-serif; }
          code { font-family: 'JetBrains Mono', monospace; }
          h1 { font-family: 'Roboto', sans-serif; }
        </style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("still flags Google-Fonts-only fonts not pre-bundled", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Geist', sans-serif; }</style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("geist");
    });

    it("is case-insensitive when matching @font-face to font-family", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'Inter'; src: url('../fonts/inter.woff2'); }
          body { font-family: 'inter', sans-serif; }
        </style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("ignores font-family inside @font-face blocks", () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'CustomFont'; src: url('../fonts/custom.woff2'); }
        </style>
      </div>`;
      const findings = findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });
  });
});
