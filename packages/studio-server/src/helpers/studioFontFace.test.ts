import { describe, expect, it } from "vitest";
import { ensureStudioFontFaceCss, isStudioFontFaceCss } from "./studioFontFace.js";

const bold =
  '@font-face { font-family: "Poppins"; src: url("assets/Bold.ttf"); font-weight: 700; font-display: swap; }';
const regular =
  '@font-face { font-family: "Poppins"; src: url("assets/Regular.ttf"); font-weight: 400; font-display: swap; }';

describe("ensureStudioFontFaceCss", () => {
  it("keeps two weights of one family in one block, and adds each once", () => {
    const html = "<html><head></head><body></body></html>";
    const saved = ensureStudioFontFaceCss(ensureStudioFontFaceCss(html, bold), regular);
    expect(saved.match(/<style data-hf-studio-fonts="true">/g)).toHaveLength(1);
    expect(saved).toContain(bold);
    expect(saved).toContain(regular);
    expect(ensureStudioFontFaceCss(saved, bold)).toBe(saved);
  });

  it("puts the block in the head, or first when the file has none", () => {
    expect(ensureStudioFontFaceCss("<html><head></head><body></body></html>", bold)).toMatch(
      /<style data-hf-studio-fonts="true">[\s\S]*<\/style>\s*<\/head>/,
    );
    expect(ensureStudioFontFaceCss("<div>x</div>", bold).startsWith("<style")).toBe(true);
  });

  it("saves a file name with a replacement pattern as written", () => {
    const html = "<html><head></head><body>rest</body></html>";
    const odd =
      '@font-face { font-family: "Cash"; src: url("assets/Cash$\'Font.ttf"); font-display: swap; }';
    const saved = ensureStudioFontFaceCss(html, odd);
    expect(saved).toContain("Cash$'Font.ttf");
    expect(saved.match(/<body>/g)).toHaveLength(1);
    const again = ensureStudioFontFaceCss(saved, odd.split("Cash$'Font").join("Cash$&"));
    expect(again).toContain("Cash$&.ttf");
    expect(again.match(/<body>/g)).toHaveLength(1);
  });
});

describe("isStudioFontFaceCss", () => {
  it("takes one @font-face rule and nothing that could leave the style block", () => {
    expect(isStudioFontFaceCss(bold)).toBe(true);
    expect(isStudioFontFaceCss("body { color: red }")).toBe(false);
    expect(isStudioFontFaceCss(`${bold} body{display:none}`)).toBe(false);
    expect(isStudioFontFaceCss(`${bold}\n${regular}`)).toBe(false);
    expect(isStudioFontFaceCss('@font-face { src: url("assets/Brand{1}.ttf"); }')).toBe(true);
    expect(isStudioFontFaceCss('@font-face { font-family: "x</style><script>"; }')).toBe(false);
    expect(isStudioFontFaceCss('@font-face { font-family: "x; } body{display:none}')).toBe(false);
    expect(isStudioFontFaceCss('@font-face { font-family: "x\\"; } body{}')).toBe(false);
    expect(isStudioFontFaceCss('@font-face { font-family: "x\\""; } body{}')).toBe(false);
    expect(isStudioFontFaceCss('@font-face { font-family: "x\r} body{} "; }')).toBe(false);
    expect(isStudioFontFaceCss("@font-face { font-family: 'x\\\f} body{} '; }")).toBe(false);
    expect(isStudioFontFaceCss('@font-face { src: url("x") } </style><script>')).toBe(false);
    expect(isStudioFontFaceCss(42)).toBe(false);
  });
});
