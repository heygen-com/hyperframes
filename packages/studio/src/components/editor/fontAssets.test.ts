// @vitest-environment jsdom
import { expect, it } from "vitest";
import { ensureImportedFontFace, injectPreviewImportedFont } from "../../utils/studioFontHelpers";
import { importedFontFaceCss, type ImportedFontAsset } from "./fontAssets";

const face = (file: string, extra: Partial<ImportedFontAsset> = {}): ImportedFontAsset => ({
  family: "Poppins",
  path: `assets/fonts/Poppins/${file}`,
  url: `/preview/assets/fonts/Poppins/${file}`,
  ...extra,
});

it("a face with no weight or style is written as before", () => {
  expect(importedFontFaceCss(face("Poppins-Bold.ttf"))).toBe(
    '@font-face { font-family: "Poppins"; src: url("/preview/assets/fonts/Poppins/Poppins-Bold.ttf"); font-display: swap; }',
  );
});

it("a face says which weight and style it draws, a variable file its weight range", () => {
  expect(
    importedFontFaceCss(face("Poppins-BoldItalic.ttf", { weight: "700", style: "italic" })),
  ).toBe(
    '@font-face { font-family: "Poppins"; src: url("/preview/assets/fonts/Poppins/Poppins-BoldItalic.ttf"); font-weight: 700; font-style: italic; font-display: swap; }',
  );
  expect(
    importedFontFaceCss(face("Roboto-Variable.ttf", { weight: "100 900", style: "normal" })),
  ).toContain("font-weight: 100 900; font-style: normal;");
  expect(importedFontFaceCss(face("x.ttf", { weight: "700; color: red" }))).not.toContain(
    "font-weight",
  );
});

it("two weights of one family are both kept in the file and both drawn in the preview", () => {
  const bold = face("Poppins-Bold.ttf", { weight: "700", style: "normal" });
  const regular = face("Poppins-Regular.ttf", { weight: "400", style: "normal" });
  const html = "<html><head></head><body></body></html>";
  const saved = ensureImportedFontFace(
    ensureImportedFontFace(html, bold, "index.html"),
    regular,
    "index.html",
  );
  expect(saved).toContain("font-weight: 700;");
  expect(saved).toContain("font-weight: 400;");
  expect(ensureImportedFontFace(saved, bold, "index.html")).toBe(saved);
  injectPreviewImportedFont(document, bold);
  injectPreviewImportedFont(document, regular);
  injectPreviewImportedFont(document, bold);
  expect(document.head.querySelectorAll("style")).toHaveLength(2);
});

it("a weight the browser would drop is left out, and a family cannot close the style block", () => {
  for (const weight of ["0", "5000", "bold", "700;}"])
    expect(importedFontFaceCss(face("x.ttf", { weight }))).not.toContain("font-weight");
  expect(importedFontFaceCss(face("x.ttf", { weight: "1000" }))).toContain("font-weight: 1000;");
  expect(importedFontFaceCss({ ...face("x.ttf"), family: "</style><b>x" })).not.toContain(
    "</style>",
  );
});

it("a file name with a replacement pattern is saved as written, not expanded into the page", () => {
  const html = "<html><head></head><body>rest</body></html>";
  const odd = { family: "Cash", path: "assets/Cash$'Font.ttf", url: "/Cash$'Font.ttf" };
  const saved = ensureImportedFontFace(html, odd, "index.html");
  expect(saved).toContain("Cash$'Font.ttf");
  expect(saved.match(/<body>/g)).toHaveLength(1);
  const again = ensureImportedFontFace(saved, { ...odd, path: "assets/Cash$&.ttf" }, "index.html");
  expect(again).toContain("Cash$&.ttf");
  expect(again.match(/<body>/g)).toHaveLength(1);
});
