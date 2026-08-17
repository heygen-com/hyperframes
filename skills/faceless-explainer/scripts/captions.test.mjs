import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { brandFontFaces, buildFromSkin } from "./captions.mjs";

const presetsDir = fileURLToPath(
  new URL("../../hyperframes-creative/frame-presets/", import.meta.url),
);
const skins = readdirSync(presetsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    source: readFileSync(
      new URL(
        `../../hyperframes-creative/frame-presets/${entry.name}/caption-skin.html`,
        import.meta.url,
      ),
      "utf8",
    ),
  }))
  .filter(({ source }) => source.includes(".caption-word.is-active"));

for (const canvas of ["#f7f3e8", "#111827"]) {
  for (const skin of skins) {
    test(`${skin.name} preserves word-state rules on ${canvas}`, () => {
      const active = skin.source.match(/\.caption-word\.is-active\s*\{[^}]*\}/s)?.[0];
      const spoken = skin.source.match(/\.caption-word\.is-spoken\s*\{[^}]*\}/s)?.[0];
      assert.ok(active, "skin must define an active-word rule");
      assert.ok(spoken, "skin must define a spoken-word rule");

      const output = buildFromSkin(
        skin.source,
        [],
        1,
        1920,
        1080,
        `:root { --cap-canvas: ${canvas}; --cap-ink: #111111; --cap-accent: #ffcc00; }`,
        (message) => {
          throw new Error(message);
        },
      );

      assert.ok(output.includes(active));
      assert.ok(output.includes(spoken));
      assert.equal(output.match(/\.caption-word\.is-active\s*\{/g)?.length, 1);
      assert.equal(output.match(/\.caption-word\.is-spoken\s*\{/g)?.length, 1);
    });
  }
}

// @font-face is document-global on purpose — the composition CSS scoper exempts it, and it
// has to, since a face declaration cannot be scoped. That makes brandFontFaces the one part
// of the captions sub-composition whose output reaches every sibling composition, so it has
// to describe each face exactly: get an axis wrong and the whole document renders the brand
// family wrong.
function withFontProject(files, run) {
  const dir = mkdtempSync(join(tmpdir(), "hf-captions-fonts-"));
  try {
    mkdirSync(join(dir, "assets/fonts"), { recursive: true });
    for (const name of files) writeFileSync(join(dir, "assets/fonts", name), "");
    writeFileSync(
      join(dir, "frame.md"),
      'typography:\n  display: { fontFamily: "Newsreader", weight: 400 }\n  body: { fontFamily: "Inter", weight: 400 }\n',
    );
    return run(join(dir, "frame.md"), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an italic file is declared italic, and never squats the family's upright slot", () => {
  // Google Fonts' own Newsreader download. The italic sorts first, so before the style axis
  // existed it claimed the family's only 400 slot, the upright was dropped as a duplicate,
  // and the face shipped with no font-style — italicizing every sibling composition that
  // used Newsreader.
  const faces = withFontProject(
    ["Newsreader-Italic-VariableFont_opsz,wght.ttf", "Newsreader-VariableFont_opsz,wght.ttf"],
    brandFontFaces,
  );
  const lines = faces.split("\n").filter((line) => line.includes("Newsreader"));
  assert.equal(lines.length, 2, "both the upright and the italic file must be declared");

  const upright = lines.find((line) => line.includes("Newsreader-VariableFont"));
  const italic = lines.find((line) => line.includes("Newsreader-Italic-VariableFont"));
  assert.ok(upright, "the upright file must survive");
  assert.match(upright, /font-style: normal/);
  assert.ok(italic, "the italic file must survive");
  assert.match(italic, /font-style: italic/);
});

test("a numeric weight in the filename is read as the weight", () => {
  // Fontsource names every face numerically and carries no weight WORD, so word-only
  // parsing scored the whole family 400 and shipped exactly one of its four faces.
  const faces = withFontProject(
    [
      "inter-latin-400-normal.woff2",
      "inter-latin-500-normal.woff2",
      "inter-latin-600-italic.woff2",
      "inter-latin-700-normal.woff2",
    ],
    brandFontFaces,
  );
  const lines = faces.split("\n").filter((line) => line.includes("Inter"));
  assert.equal(lines.length, 4, "each face is a distinct weight/style pair");
  for (const [file, weight, style] of [
    ["inter-latin-400-normal", 400, "normal"],
    ["inter-latin-500-normal", 500, "normal"],
    ["inter-latin-600-italic", 600, "italic"],
    ["inter-latin-700-normal", 700, "normal"],
  ]) {
    const line = lines.find((candidate) => candidate.includes(file));
    assert.ok(line, `${file} must be declared`);
    assert.match(line, new RegExp(`font-weight: ${weight};`));
    assert.match(line, new RegExp(`font-style: ${style};`));
  }
});

test("word-named weights still parse when the filename carries no numeric axis", () => {
  const faces = withFontProject(
    ["Newsreader_Bold.woff2", "Newsreader_Regular.woff2"],
    brandFontFaces,
  );
  const lines = faces.split("\n").filter((line) => line.includes("Newsreader"));
  assert.equal(lines.length, 2);
  assert.match(
    lines.find((line) => line.includes("Bold")),
    /font-weight: 700; font-style: normal/,
  );
  assert.match(
    lines.find((line) => line.includes("Regular")),
    /font-weight: 400; font-style: normal/,
  );
});
