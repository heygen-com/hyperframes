import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

async function findByCode(html: string, code: string, isSubComposition = true) {
  const result = await lintHyperframeHtml(html, { isSubComposition });
  return result.findings.filter((f) => f.code === code);
}

describe("font rules", () => {
  describe("google_fonts_import", () => {
    it("flags @import url with fonts.googleapis.com", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap');</style>
      </div>`;
      const findings = await findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("error");
    });

    it("flags <link> to fonts.googleapis.com", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      </div>`;
      const findings = await findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(1);
    });

    it("does not flag local @font-face usage", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>@font-face { font-family: 'Inter'; src: url('../capture/assets/fonts/Inter.woff2'); }</style>
      </div>`;
      const findings = await findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(0);
    });

    it("does not flag installed registry blocks that bundle Google Fonts", async () => {
      const html =
        `<!-- hyperframes-registry-item: my-block -->\n` +
        `<div data-composition-id="test" data-width="1920" data-height="1080">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      </div>`;
      const findings = await findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(0);
    });
  });

  describe("system_font_will_alias", () => {
    it("flags SF Mono as aliased to JetBrains Mono", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>code { font-family: 'SF Mono', monospace; }</style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("info");
      expect(findings[0]!.message).toContain("JetBrains Mono");
    });

    it("flags Helvetica Neue as aliased to Inter", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Helvetica Neue', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("Inter");
    });

    it("does not flag canonical font names", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Inter', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(0);
    });

    it("does not flag Roboto (canonical name)", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Roboto', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(0);
    });

    it("does not flag unknown fonts (handled by font_family_without_font_face)", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Comic Sans MS', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(0);
    });

    it("does not flag aliased fonts that have explicit @font-face", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'Menlo'; src: url('../fonts/menlo.woff2'); }
          code { font-family: 'Menlo', monospace; }
        </style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(0);
    });

    it("handles case-insensitive font names", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'VERDANA', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("Inter");
    });

    it("reports multiple aliased fonts in one finding", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          body { font-family: 'Verdana', sans-serif; }
          code { font-family: 'Consolas', monospace; }
        </style>
      </div>`;
      const findings = await findByCode(html, "system_font_will_alias");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("Inter");
      expect(findings[0]!.message).toContain("JetBrains Mono");
    });
  });

  describe("font_family_without_font_face", () => {
    it("flags font-family used without @font-face", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'GT Walsheim', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("gt walsheim");
    });

    it("does not flag when @font-face is declared", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'GT Walsheim'; src: url('../fonts/gt.woff2'); }
          body { font-family: 'GT Walsheim', sans-serif; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("does not flag generic font families", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: monospace; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("reports multiple missing families in one finding", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          h1 { font-family: 'Aeonik', sans-serif; }
          code { font-family: 'Feature Deck', monospace; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("aeonik");
      expect(findings[0]!.message).toContain("feature deck");
    });

    it("does not flag fonts the producer has pre-bundled", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          body { font-family: 'Inter', sans-serif; }
          code { font-family: 'JetBrains Mono', monospace; }
          h1 { font-family: 'Roboto', sans-serif; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("still flags Google-Fonts-only fonts not pre-bundled", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Geist', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("geist");
    });

    it("is case-insensitive when matching @font-face to font-family", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'Inter'; src: url('../fonts/inter.woff2'); }
          body { font-family: 'inter', sans-serif; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("ignores font-family inside @font-face blocks", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'CustomFont'; src: url('../fonts/custom.woff2'); }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("does not flag installed registry blocks that declare fonts via Google Fonts", async () => {
      const html =
        `<!-- hyperframes-registry-item: my-block -->\n` +
        `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Poppins', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });
  });
});
