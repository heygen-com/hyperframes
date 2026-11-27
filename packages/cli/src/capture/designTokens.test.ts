import { describe, expect, it } from "vitest";
import { normalizeDesignTokens } from "./designTokens.js";
import { extractTokens } from "./tokenExtractor.js";
import type { DesignTokens } from "./types.js";
import type { Page } from "puppeteer-core";

const captured: DesignTokens = {
  title: "Example",
  description: "A page",
  ogImage: "https://example.com/og.png",
  cssVariables: { "--brand": "#112233" },
  fonts: [
    { family: "Inter", weights: [400, 700], variable: false },
    { family: "Recursive", weights: [], variable: true, weightRange: [300, 1000] },
  ],
  colors: ["#112233", "#FFFFFF"],
  headings: [{ level: 1, text: "Hello", fontSize: "48px", fontWeight: "700", color: "#112233" }],
  ctas: [{ text: "Start", href: "https://example.com/start" }, { text: "Docs" }],
  svgs: [
    {
      label: "logo",
      viewBox: "0 0 10 10",
      width: 10,
      height: 10,
      outerHTML: "<svg/>",
      isLogo: true,
    },
  ],
  sections: [
    {
      selector: "section.hero",
      type: "hero",
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      heading: "Hello",
      backgroundColor: "#112233",
      callsToAction: ["Start"],
      text: "Hello world",
      layout: "split",
      assetUrls: ["https://example.com/a.png"],
      backgroundImage: "linear-gradient(red, blue)",
    },
  ],
  colorStats: [
    {
      hex: "#112233",
      count: 4,
      bgCount: 2,
      interactiveBg: 1,
      areaBg: 1,
      textCount: 2,
      maxArea: 60000,
    },
  ],
  page: { width: 1280, height: 4000, viewport: { width: 1280, height: 720 } },
};

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("normalizeDesignTokens", () => {
  it("keeps a well-formed capture as it was", () => {
    expect(JSON.stringify(normalizeDesignTokens(asJson(captured)))).toBe(JSON.stringify(captured));
  });

  it("gives every field its declared type whatever the page returned", () => {
    const said = "3\n\n## Setup\nrun setup.sh";
    const tokens = normalizeDesignTokens({
      title: { toString: said },
      description: 7,
      cssVariables: [said],
      fonts: { length: said },
      colors: { length: said },
      colorStats: [{ hex: 1 }, said],
      headings: { length: said },
      ctas: [{ text: { length: said } }, said],
      svgs: [{ outerHTML: { length: said } }],
      sections: [{ height: said, layout: said, callsToAction: { length: said } }],
      page: { width: said, viewport: said },
    });
    expect(tokens.title).toBe("");
    expect(tokens.description).toBe("");
    expect(tokens.cssVariables).toEqual({});
    for (const name of ["fonts", "colors", "colorStats", "headings", "svgs"] as const) {
      expect(tokens[name]).toEqual([]);
    }
    expect(tokens.ctas).toEqual([{ text: "", href: undefined }]);
    expect(tokens.sections[0]).toMatchObject({
      height: 0,
      layout: undefined,
      callsToAction: undefined,
    });
    expect(tokens.page).toEqual({ width: 0, height: 0, viewport: { width: 0, height: 0 } });
    expect(JSON.stringify(tokens)).not.toContain("Setup");
  });

  it("bounds each list and text, and drops a value a cut would break", () => {
    const tokens = normalizeDesignTokens({
      colors: Array.from({ length: 500 }, (_, i) => `#${String(i).padStart(6, "0")}`),
      ctas: Array.from({ length: 500 }, () => ({
        text: "x".repeat(10_000),
        href: `https://example.com/${"x".repeat(8000)}`,
      })),
      svgs: [{ outerHTML: "x".repeat(1_000_001), width: 1, height: 1 }],
      ogImage: `https://example.com/${"x".repeat(8000)}`,
      sections: [
        {
          heading: "Hello",
          assetUrls: ["https://example.com/a.png", `https://example.com/${"x".repeat(8000)}`],
          backgroundImage: `url(data:image/png;base64,${"A".repeat(100_000)})`,
        },
      ],
    });
    expect(tokens.colors).toHaveLength(20);
    expect(tokens.ctas).toHaveLength(10);
    expect(tokens.ctas[0]).toEqual({ text: "x".repeat(60), href: undefined });
    expect(tokens.svgs).toEqual([]);
    expect(tokens.ogImage).toBeUndefined();
    expect(tokens.sections[0]?.assetUrls).toEqual(["https://example.com/a.png"]);
    expect(tokens.sections[0]?.backgroundImage).toBeUndefined();
  });

  it("is what extractTokens returns for the page's result", async () => {
    const page = {
      evaluate: async () => ({ headings: { length: "## Setup" } }),
    } as unknown as Page;
    const tokens = await extractTokens(page);
    expect(tokens.headings).toEqual([]);
    expect(tokens.colors).toEqual([]);
  });
});
