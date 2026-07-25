import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

async function findByCode(html: string, code: string, isSubComposition = true) {
  const result = await lintHyperframeHtml(html, { isSubComposition });
  return result.findings.filter((f) => f.code === code);
}

describe("font rules", () => {
  describe("google_fonts_import", () => {
    it("warns on @import url with fonts.googleapis.com without failing lint", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap');</style>
      </div>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      const findings = result.findings.filter((f) => f.code === "google_fonts_import");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("warning");
      expect(result.errorCount).toBe(0);
    });

    it("warns on <link> to fonts.googleapis.com", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      </div>`;
      const findings = await findByCode(html, "google_fonts_import");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("warning");
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

    it("does not flag a system font declared via @font-face src: local()", async () => {
      // Regression: two independent reports of this rule hard-erroring on OS
      // system fonts (Hiragino Sans, Microsoft YaHei) that have no downloadable
      // file. src: local(...) already satisfies the check (extractFontFaceFamilies
      // only looks at the font-family declaration, not the src value) — the gap
      // was that the fixHint didn't mention this as an option.
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { font-family: 'Microsoft YaHei'; src: local('Microsoft YaHei'); }
          body { font-family: 'Microsoft YaHei', sans-serif; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("fixHint mentions the local() pattern for system fonts", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'GT Walsheim', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings[0]!.fixHint).toContain("local(");
    });

    it("does not flag generic font families", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: monospace; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("does not treat !important as part of a generic font family", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Inter', cursive !important; }</style>
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

    for (const family of [
      "FredericktheGreat",
      "Pretendard",
      "Pyidaungsu",
      "Yantra Manav",
      "Noto Serif Arabic",
      "Noto Serif Urdu",
      "Noto Serif VI",
      "Noto Sans Greek",
      "Noto Sans Odia",
      "Noto Sans Urdu",
    ]) {
      it(`does not flag the producer-resolved Google family alias ${family}`, async () => {
        const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
          <style>body { font-family: '${family}', sans-serif; }</style>
        </div>`;
        const findings = await findByCode(html, "font_family_without_font_face");
        expect(findings).toHaveLength(0);
      });
    }

    it("still flags Google-Fonts-only fonts not pre-bundled", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Geist', sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("geist");
    });

    it("does not flag a non-bundled family when a Google Fonts link loads it", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;700&display=swap">
        <style>body { font-family: 'Geist', sans-serif; }</style>
      </div>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      expect(result.findings.filter((f) => f.code === "google_fonts_import")).toHaveLength(1);
      expect(
        result.findings.filter((f) => f.code === "font_family_without_font_face"),
      ).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it("parses unquoted Google Fonts link href values", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <link rel=stylesheet href=https://fonts.googleapis.com/css2?family=Geist:wght@400;700&display=swap>
        <style>body { font-family: 'Geist', sans-serif; }</style>
      </div>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      expect(result.findings.filter((f) => f.code === "google_fonts_import")).toHaveLength(1);
      expect(
        result.findings.filter((f) => f.code === "font_family_without_font_face"),
      ).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it("parses multiple Google Fonts family parameters and URL-encoded spaces", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @import url("https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=DM+Sans:ital,wght@0,400;1,700&display=swap");
          h1 { font-family: 'Libre Baskerville', serif; }
          body { font-family: 'DM Sans', sans-serif; }
        </style>
      </div>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      expect(result.findings.filter((f) => f.code === "google_fonts_import")).toHaveLength(1);
      expect(
        result.findings.filter((f) => f.code === "font_family_without_font_face"),
      ).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it("accepts a URL-style plus alias used literally as the CSS family", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @import url("https://fonts.googleapis.com/css2?family=DM+Mono&family=IBM+Plex+Mono&display=swap");
          h1 { font-family: 'DM+Mono', monospace; }
          code { font-family: 'IBM+Plex+Mono', monospace; }
        </style>
      </div>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      expect(
        result.findings.filter((f) => f.code === "font_family_without_font_face"),
      ).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it("does not decode percent escapes in a literal CSS family", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @import url("https://fonts.googleapis.com/css2?family=DM+Mono&display=swap");
          h1 { font-family: 'DM%20Mono', monospace; }
        </style>
      </div>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      expect(
        result.findings.filter((f) => f.code === "font_family_without_font_face"),
      ).toHaveLength(1);
    });

    it("still flags non-bundled families not covered by the Google Fonts URL", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
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

    it("does not flag vendor-prefixed system-font keywords (-apple-system, BlinkMacSystemFont)", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
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

    it("matches @font-face even when a CSS comment inside the block contains a brace (#1534)", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          @font-face { /* weight 400 } regular */ font-family: 'Noto Sans SC'; src: url('../fonts/noto-400.woff2'); }
          .title { font-family: 'Noto Sans SC'; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("does not flag the -apple-system / BlinkMacSystemFont system-ui stack", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("does not flag a var() font-family indirection it cannot resolve", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>:root { --heading: 'Inter'; } h1 { font-family: var(--heading); }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("flags a concrete undeclared var() fallback without a close-paren artifact", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>h1 { font-family: var(--heading, 'Geist'), sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("geist");
      expect(findings[0]!.message).not.toContain("geist')");
    });

    it("does not manufacture production close-paren family artifacts from var() fallbacks", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          h1 { font-family: var(--heading, "Montserrat Bold"), var(--body, serif); }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("montserrat bold");
      expect(findings[0]!.message).not.toContain(`montserrat bold")`);
      expect(findings[0]!.message).not.toContain("serif)");
    });

    it("does not guess scoped or cyclic custom-property values", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          :root { --heading: "Inter"; --cycle-a: var(--cycle-b); --cycle-b: var(--cycle-a); }
          .card { --heading: "Geist"; }
          h1 { font-family: var(--heading); }
          h2 { font-family: var(--cycle-a); }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("ignores CSS-wide keywords explicitly", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          body { font-family: inherit; }
          h1 { font-family: revert-layer; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(0);
    });

    it("treats quoted generic and CSS-wide names as real families through root resolution", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          :root { --display: "system-ui"; }
          body { font-family: var(--display), sans-serif; }
          h1 { font-family: "inherit"; }
          h2 { font-family: "serif"; }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("system-ui");
      expect(findings[0]!.message).toContain("inherit");
      expect(findings[0]!.message).toContain("serif");
    });

    it("keeps quoted commas and no-space function-shaped names as families", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>
          h1 {
            font-family: "ACME, Inc", "ACME(Display)", "var(--Display)",
              var(--runtime), env(font-name), sans-serif;
          }
        </style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("acme, inc");
      expect(findings[0]!.message).toContain("acme(display)");
      expect(findings[0]!.message).toContain("var(--display)");
      expect(findings[0]!.message).not.toContain("var(--runtime)");
      expect(findings[0]!.message).not.toContain("env(font-name)");
    });

    it("malformed CSS invalidates only matching static aliases", async () => {
      const differentName = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>:root { --heading: "Geist"; }</style>
        <style>.broken { --other: "Outfit";</style>
        <style>h1 { font-family: var(--heading); }</style>
      </div>`;
      const retainedFindings = await findByCode(differentName, "font_family_without_font_face");
      expect(retainedFindings).toHaveLength(1);
      expect(retainedFindings[0]!.message).toContain("geist");

      const sameName = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>:root { --heading: "Geist"; }</style>
        <style>.broken { --heading: "Outfit";</style>
        <style>h1 { font-family: var(--heading); }</style>
      </div>`;
      const unresolvedFindings = await findByCode(sameName, "font_family_without_font_face");
      expect(unresolvedFindings).toHaveLength(0);
    });

    it("still flags a real undeclared font sitting next to a system stack", async () => {
      const html = `<div data-composition-id="test" data-width="1920" data-height="1080">
        <style>body { font-family: 'Aeonik', -apple-system, BlinkMacSystemFont, sans-serif; }</style>
      </div>`;
      const findings = await findByCode(html, "font_family_without_font_face");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("aeonik");
      expect(findings[0]!.message).not.toContain("apple-system");
    });
  });
});
