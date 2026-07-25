import { describe, expect, it } from "vitest";
import {
  collectStaticRootFontFamilyCustomProperties,
  isCssWideFontFamilyKeyword,
  parseFontFamilyValue,
  parseFontFamilyValueTokens,
  resolveFontFamilyDeclarationCandidates,
  resolveFontFamilyDeclarationFamilies,
} from "./fontFamilyValue";

describe("parseFontFamilyValue", () => {
  it("splits only top-level commas", () => {
    expect(parseFontFamilyValue(`var(--font, "Montserrat Bold"), serif`)).toEqual([
      `var(--font, "Montserrat Bold")`,
      "serif",
    ]);
  });

  it("does not manufacture the production var() close-paren artifacts", () => {
    const families = parseFontFamilyValue(`var(--font, "Montserrat Bold"), var(--body, serif)`);
    expect(families).not.toContain(`Montserrat Bold")`);
    expect(families).not.toContain("serif)");
    expect(parseFontFamilyValue(`Montserrat Bold")`)).toEqual([]);
    expect(parseFontFamilyValue("serif)")).toEqual([]);
  });

  it("preserves commas and escaped quotes inside family names", () => {
    expect(
      parseFontFamilyValue(`"ACME, Inc", "ACME (Display)", "Display \\"Quoted\\"", serif`),
    ).toEqual(["ACME, Inc", "ACME (Display)", `Display \\"Quoted\\"`, "serif"]);
    expect(parseFontFamilyValue(`ACME\\, Inc, serif`)).toEqual(["ACME\\, Inc", "serif"]);
  });

  it("preserves quote provenance for no-space function-shaped family names", () => {
    expect(
      parseFontFamilyValueTokens(
        `"ACME(Display)", "var(--Display)", var(--runtime), env(font-name)`,
      ),
    ).toEqual([
      { value: "ACME(Display)", kind: "family", quoted: true },
      { value: "var(--Display)", kind: "family", quoted: true },
      { value: "var(--runtime)", kind: "function", quoted: false },
      { value: "env(font-name)", kind: "function", quoted: false },
    ]);
  });

  it("ignores comments while respecting comment markers inside strings", () => {
    expect(parseFontFamilyValue(`"Inter" /* ignored, ) */, "/* Display */", serif`)).toEqual([
      "Inter",
      "/* Display */",
      "serif",
    ]);
    expect(parseFontFamilyValue(`"Inter", serif /* unterminated`)).toEqual([]);
  });

  it("recognizes every supported CSS-wide keyword", () => {
    for (const keyword of ["inherit", "initial", "revert", "revert-layer", "unset"]) {
      expect(isCssWideFontFamilyKeyword(keyword)).toBe(true);
      expect(isCssWideFontFamilyKeyword(keyword.toUpperCase())).toBe(true);
    }
  });
});

describe("resolveFontFamilyDeclarationFamilies", () => {
  it("retains quoted token kind through resolution candidates", () => {
    expect(
      resolveFontFamilyDeclarationCandidates(
        `var(--heading), "var(--Display)", env(font-name)`,
        new Map([["--heading", `"ACME(Display)"`]]),
      ),
    ).toEqual([
      { value: "ACME(Display)", kind: "family", quoted: true },
      { value: "var(--Display)", kind: "family", quoted: true },
      { value: "env(font-name)", kind: "function", quoted: false },
    ]);
  });

  it("resolves an unambiguous root variable and its nested fallback", () => {
    const properties = new Map([["--heading", `var(--brand, "Montserrat")`]]);
    expect(resolveFontFamilyDeclarationFamilies(`var(--heading), serif`, properties)).toEqual([
      "Montserrat",
      "serif",
    ]);
  });

  it("keeps an unknown variable primary but exposes its explicit nested fallback candidates", () => {
    expect(
      resolveFontFamilyDeclarationFamilies(
        `var(--heading, var(--brand, "Montserrat Bold")), serif`,
        new Map(),
      ),
    ).toEqual([
      `var(--heading, var(--brand, "Montserrat Bold"))`,
      `var(--brand, "Montserrat Bold")`,
      "Montserrat Bold",
      "serif",
    ]);
  });

  it("does not guess a cyclic variable", () => {
    const properties = new Map([
      ["--heading", "var(--body)"],
      ["--body", `var(--heading, "Inter")`],
    ]);
    const resolved = resolveFontFamilyDeclarationFamilies(`var(--heading), sans-serif`, properties);
    expect(resolved[0]).toBe("var(--heading)");
    expect(resolved).toContain("Inter");
    expect(resolved).toContain("sans-serif");
  });
});

describe("collectStaticRootFontFamilyCustomProperties", () => {
  it("retains source-order root declarations with !important precedence", () => {
    const properties = collectStaticRootFontFamilyCustomProperties([
      { name: "--font", value: "Inter", staticRoot: true, important: true },
      { name: "--font", value: "Montserrat", staticRoot: true },
      { name: "--font", value: "Outfit", staticRoot: true, important: true },
    ]);
    expect(properties.get("--font")).toBe("Outfit");
  });

  it("drops a root property when any scoped or dynamic declaration can override it", () => {
    const properties = collectStaticRootFontFamilyCustomProperties([
      { name: "--font", value: "Inter", staticRoot: true },
      { name: "--font", value: "system-ui", staticRoot: false },
    ]);
    expect(properties.has("--font")).toBe(false);
  });
});
