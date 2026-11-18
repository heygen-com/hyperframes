import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

/**
 * A whole-document substring rewrite of a font path also rewrote the tail of a longer path and the
 * same text in a comment. These are invisible in a project with one font.
 */
describe("font embed url() anchoring", () => {
  const fonts = {
    "img/logo.ttf": "short",
    "assets/img/logo.ttf": "long",
    "fonts/x+y[1].ttf": "meta",
  };
  const dataUri = (text: string) =>
    `url("data:font/ttf;base64,${Buffer.from(text).toString("base64")}")`;

  it("replaces each @font-face source with its own file and nothing else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-font-anchor-"));
    for (const [path, text] of Object.entries(fonts)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const faces = Object.keys(fonts)
      .map((path, i) => `@font-face { font-family: "F${i}"; src: url("${path}"); }`)
      .join("\n");
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head><style>/* see img/logo.ttf */\n${faces}</style></head><body>
  <div data-composition-id="root" data-width="640" data-height="360" data-duration="1">Text</div>
</body></html>`,
    );

    const { html } = await compileForRender(dir, join(dir, "index.html"), dir);

    for (const text of Object.values(fonts)) expect(html).toContain(dataUri(text));
    expect(html).toContain("/* see img/logo.ttf */");
  });
});
