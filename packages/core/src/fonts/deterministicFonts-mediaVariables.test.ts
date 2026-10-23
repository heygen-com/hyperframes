// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  injectDeterministicFontFaces,
  normalizeSystemFontPrimaryFamilies,
  resolveFontFamilyDeclarationFamilies,
} from "./deterministicFonts.js";

let projectDir: string;
const fetchImpl = Object.assign(async () => new Response("", { status: 404 }), {
  preconnect: fetch.preconnect,
});
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hf-media-variables-"));
});
afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});
async function inject(styles: string) {
  return injectDeterministicFontFaces(
    `<html><head>${styles}</head><body><p>Text</p></body></html>`,
    {
      fetchImpl,
      allowSystemFontCapture: false,
      stylesheetBaseDir: projectDir,
    },
  );
}
function expectFaces(html: string, families: string[]) {
  for (const family of families) expect(html).toContain(`font-family: "${family}";`);
}

it("offers every possible font across multiple unknown variable overrides", async () => {
  const result = await inject(`<style>:root{--font:Inter}p{font-family:var(--font)}
    @media (device-width:1px){:root{--font:Montserrat}}
    @media (device-height:1px){:root{--font:Lato}}</style>`);
  expectFaces(result, ["Inter", "Montserrat", "Lato"]);
});

it.each(["inline", "linked"] as const)(
  "retains variable uncertainty on an unknown %s sheet",
  async (source) => {
    const css = ":root{--font:Montserrat}";
    writeFileSync(join(projectDir, "theme.css"), css);
    const sheet =
      source === "inline"
        ? `<style media="(device-width:1px)">${css}</style>`
        : '<link rel="stylesheet" media="(device-width:1px)" href="theme.css">';
    const result = await inject(
      `<style>:root{--font:Inter}p{font-family:var(--font)}</style>${sheet}`,
    );
    expectFaces(result, ["Inter", "Montserrat"]);
  },
);

it("offers a var fallback when an unknown assignment may leave the property unset", async () => {
  const result = await inject(
    "<style>@media (device-width:1px){:root{--font:Montserrat}}p{font-family:var(--font,Inter)}</style>",
  );
  expectFaces(result, ["Inter", "Montserrat"]);
});

it("carries unknown alternatives through variable aliases", async () => {
  const result = await inject(
    "<style>:root{--base:Inter;--font:var(--base)}@supports (display:imaginary){:root{--base:Montserrat}}p{font-family:var(--font)}</style>",
  );
  expectFaces(result, ["Inter", "Montserrat"]);
});

it("lets a later known assignment replace prior unknown alternatives", async () => {
  const result = await inject(
    "<style>:root{--font:Inter}@media (device-width:1px){:root{--font:Montserrat}}:root{--font:Lato}p{font-family:var(--font)}</style>",
  );
  expectFaces(result, ["Lato"]);
  expect(result).not.toContain('font-family: "Inter";');
  expect(result).not.toContain('font-family: "Montserrat";');
});

it("does not rewrite the fallback of a defined-empty custom property", () => {
  const html =
    "<html><head><style>:root{--font:;}p{font-family:var(--font, serif)}</style></head><body><p>Text</p></body></html>";
  expect(normalizeSystemFontPrimaryFamilies(html)).toBe(html);
});

it("does not select a font fallback for a defined-empty substitution", async () => {
  const result = await inject("<style>:root{--font:;}p{font-family:var(--font,Inter)}</style>");
  expect(result).not.toContain('data-hyperframes-deterministic-fonts="true"');
});

it.each(["Inter,var(--font)", "var(--first),var(--font)"])(
  "offers trailing variable alternatives in %s",
  async (declaration) => {
    const result = await inject(
      `<style>:root{--first:Inter;--font:Montserrat}@media(device-width:1px){:root{--font:Lato}}p{font-family:${declaration}}</style>`,
    );
    expectFaces(result, ["Inter", "Montserrat", "Lato"]);
  },
);

it("preserves quoted commas while resolving a later variable", () => {
  expect(
    resolveFontFamilyDeclarationFamilies(
      '"Brand, Sans",var(--font)',
      new Map([["--font", "Montserrat"]]),
    ),
  ).toEqual(["Brand, Sans", "Montserrat"]);
});

it("keeps quoted var text literal", () => {
  expect(
    resolveFontFamilyDeclarationFamilies(
      '"var(--font)",Inter',
      new Map([["--font", "Montserrat"]]),
    ),
  ).toEqual(["var(--font)", "Inter"]);
});

it("preserves the raw variable at the existing cycle bound", () => {
  expect(
    resolveFontFamilyDeclarationFamilies(
      "Inter,var(--a)",
      new Map([
        ["--a", "var(--b)"],
        ["--b", "var(--a)"],
      ]),
    ),
  ).toEqual(["Inter", "var(--a)"]);
});

it.each(["Inter,var(--font)", "var(--font),Inter"])(
  "keeps an empty substitution invalid across the whole list: %s",
  async (declaration) => {
    const result = await inject(`<style>:root{--font:;}p{font-family:${declaration}}</style>`);
    expect(result).not.toContain('data-hyperframes-deterministic-fonts="true"');
  },
);

it.each(["print", "(device-width:1px)", "(resolution:1dppx)"])(
  "promotes a generic fallback when %s cannot definitely define its variable",
  (media) => {
    const html = `<html><head><style media="${media}">:root{--font:Montserrat}</style><style>p{font-family:var(--font,serif)}</style></head><body>Text</body></html>`;
    expect(
      normalizeSystemFontPrimaryFamilies(html, "Inter", { mediaContext: { deviceScaleFactor: 2 } }),
    ).toContain("var(--font, Inter, serif)");
  },
);
it("promotes a generic fallback beneath an unevaluated conditional group", () => {
  const html =
    "<html><head><style>@supports(display:imaginary){:root{--font:Montserrat}}p{font-family:var(--font,serif)}</style></head><body>Text</body></html>";
  expect(normalizeSystemFontPrimaryFamilies(html)).toContain("var(--font, Inter, serif)");
});
it("preserves a definitely active viewport and DPR variable", () => {
  const html =
    '<html><head><style media="(width:640px) and (resolution:2dppx)">:root{--font:Montserrat}</style><style>p{font-family:var(--font,serif)}</style></head><body>Text</body></html>';
  expect(
    normalizeSystemFontPrimaryFamilies(html, "Inter", {
      mediaContext: { viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 },
    }),
  ).toBe(html);
});
it.each([
  ["screen", false],
  ["print", true],
] as const)("uses the active linked variable view for %s", (media, promoted) => {
  writeFileSync(join(projectDir, "theme.css"), ":root{--font:Montserrat}");
  const html = `<html><head><link rel="stylesheet" media="${media}" href="theme.css"><style>p{font-family:var(--font,serif)}</style></head><body>Text</body></html>`;
  const result = normalizeSystemFontPrimaryFamilies(html, "Inter", {
    stylesheetBaseDir: projectDir,
  });
  if (promoted) expect(result).toContain("var(--font, Inter, serif)");
  else expect(result).toBe(html);
});
