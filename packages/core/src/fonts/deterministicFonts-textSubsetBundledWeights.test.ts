// @vitest-environment node
/**
 * Regression test for #7313: a Google `text=` subset must be emitted at each
 * bundled weight beside the bundled face, or non-Latin text at 400/700 falls
 * back to a system font in Chromium (the exact-weight bundled face wins over
 * the `100 900` range face for codepoints the bundled face lacks).
 *
 * The mock returns the real Google `text=` response shape for Noto Sans JP:
 * one face per requested weight (100..900), all sharing the same subsetted
 * variable file and the same text unicode-range.
 *
 * These tests inject `fetchImpl` (no network) and a temp
 * `HYPERFRAMES_FONT_CACHE_DIR` so they are hermetic.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cacheDir: string;
let prevCacheEnv: string | undefined;

beforeAll(() => {
  prevCacheEnv = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-7313-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
});

afterAll(() => {
  if (prevCacheEnv === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = prevCacheEnv;
  rmSync(cacheDir, { recursive: true, force: true });
});

// Real Google css2 response for Noto Sans JP with text= (fetched 2026-11-06):
// 9 faces, weights 100..900, same file URL, same text unicode-range.
const GOOGLE_CSS = `@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 100;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 200;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 300;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 500;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 600;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 800;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 900;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=-F62fjtqLzI2JPCgQBnw7HFowxo8MMbFZGqZ91ntLBprNTWlW0Exgj_Bpibjw96Jv-73HvmaJELq7DzhXd7j6VrhswRmqNcERlcs&skey=72472b0eb8793570&v=v57) format('woff2');
  unicode-range: U+2460, U+300c-300d, U+3059-305a, U+3066-3067, U+306e, U+3099, U+30b9-30ba, U+30c6-30c9, U+65e5, U+672c, U+8a9e;
}
`;

const googleFetch = (async (input: unknown) => {
  const url = String(input);
  if (url.startsWith("https://fonts.googleapis.com/")) {
    return new Response(GOOGLE_CSS, { status: 200 });
  }
  if (url.startsWith("https://fonts.gstatic.com/")) {
    return new Response("NOTO_TEXT_SUBSET_BYTES", { status: 200 });
  }
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

const TEXT = "①「日本語のテスト」です";
const HTML = `<!doctype html><html lang="ja"><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=block">
</head><body>${[400, 500, 700]
  .map(
    (w) =>
      `<div style="font-family:'Noto Sans JP';font-weight:${w};font-size:40px"><span id="w${w}">${TEXT}</span></div>`,
  )
  .join("")}</body></html>`;

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("7313 text subset at bundled weights", () => {
  it("emits the text subset at each bundled weight beside the bundled face", async () => {
    const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
    const result = await injectDeterministicFontFaces(HTML, {
      allowSystemFontCapture: false,
      fetchImpl: googleFetch,
    });
    const faces = result.match(/@font-face \{[\s\S]*?\}/g) ?? [];
    const textFaces = faces.filter((face) => face.includes(b64("NOTO_TEXT_SUBSET_BYTES")));
    const weights = textFaces.map((face) => /font-weight: ([\d ]+);/.exec(face)?.[1]);
    expect(weights).toEqual(expect.arrayContaining(["400", "700"]));
  }, 30000); // Embedding the bundled faces takes ~5s on a loaded machine.
});
