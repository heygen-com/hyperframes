// font-faces.mjs — staging font files into assets/fonts/ + the @font-face rule for each.
// Shared by build-frame.mjs's two font sources: captured BRAND font files and a preset's
// own fonts/ folder.
//
// The staged NAME is a contract, not cosmetics: captions.mjs derives each face's weight and
// style back out of it. So the name has to carry every axis that distinguishes one face
// from another, and the dedup key has to be the whole face. Naming on weight alone made
// Google's two-file Newsreader download (upright + italic, both scoring "Regular") collide
// on one slot: the italic sorts first, took the name, the upright was never staged, and
// the @font-face block then asserted font-style:normal over italic bytes.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export const FONT_FORMAT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

/** Family-name key: lowercase alphanumerics only, so "EB Garamond" ≡ "EBGaramond-400.woff2"'s stem. */
export const normFontName = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Lowercase font extension of a filename, or "" when it is not a font file. */
export const fontExtOf = (f) => (f.match(/\.(woff2|woff|ttf|otf)$/i)?.[1] ?? "").toLowerCase();

/** Weight of a face from its filename: `{ n: 700, w: "Bold" }` (n numeric, w the staged-name token). */
export function fontWeightInfo(name) {
  const s = name.toLowerCase();
  // A numeric axis is the font's own answer, so it beats the word heuristic. Fontsource
  // names every face that way and carries no weight WORD at all, so word-only parsing
  // scored a whole family "Regular" and staged exactly one of its faces.
  //
  // A weight token must not be buried inside a longer run: this reads capture files,
  // which are commonly hash-named, and "Newsreader-a1b200c3.woff2" is not a 200-weight
  // face. Hence a non-digit before (which also stops "2100" reading as 100) and no
  // alphanumeric after. "Roboto900.ttf" still parses.
  const numeric = /(?:^|[^0-9])([1-9]00)(?![0-9a-z])/.exec(s);
  if (numeric) return { n: Number(numeric[1]), w: numeric[1] };
  if (/black|heavy|ultra|extrabold/.test(s)) return { n: 800, w: "ExtraBold" };
  if (/semibold|demibold/.test(s)) return { n: 600, w: "SemiBold" };
  if (/bold/.test(s)) return { n: 700, w: "Bold" };
  if (/medium/.test(s)) return { n: 500, w: "Medium" };
  if (/light|thin/.test(s)) return { n: 300, w: "Light" };
  return { n: 400, w: "Regular" };
}

export const fontStyleOf = (name) => (/italic|oblique/i.test(name) ? "italic" : "normal");

/** Every family a frame spec names — `fontFamily: "X"` in its typography ramp. */
export function fontFamiliesNamed(md) {
  const out = new Set();
  for (const m of String(md).matchAll(/fontFamily:\s*"([^"]+)"/g)) out.add(m[1].trim());
  return [...out];
}

/**
 * Copy one font file into `outDir` under its clean face name and return
 * `{ name, rule }` — the staged filename and its root-relative @font-face rule — or
 * `null` when that face is already staged (first source wins) or the file is not a font.
 * An existing file under the clean name is kept, never overwritten.
 */
export function stageFontFile({ family, srcPath, outDir, stagedNames }) {
  const file = basename(srcPath);
  const ext = fontExtOf(file);
  if (!ext) return null;
  const { n, w } = fontWeightInfo(file);
  const style = fontStyleOf(file);
  const name = `${family.replace(/[^A-Za-z0-9]/g, "")}-${w}${style === "italic" ? "-Italic" : ""}.${ext}`;
  if (stagedNames.has(name)) return null;
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(outDir, name))) copyFileSync(srcPath, join(outDir, name));
  stagedNames.add(name);
  return {
    name,
    rule: `@font-face{font-family:"${family}";font-weight:${n};font-style:${style};font-display:block;src:url("assets/fonts/${name}") format("${FONT_FORMAT[ext]}");}`,
  };
}

const LICENSE_FILE = /^(?:OFL|LICEN[CS]E|COPYING)\b/i;

/**
 * Stage a preset's own fonts/ folder. Each font file is assigned to the LONGEST family in
 * `families` (the families the frame spec names) whose key its filename contains; a file
 * matching none is reported in `skipped` rather than staged — after a brand remix the
 * preset's original family may no longer appear in frame.md, and its bytes would be dead
 * weight. License texts shipped beside the fonts (OFL-*.txt, LICENSE…) travel with any
 * staged face. Returns `{ faces, staged, skipped, licenses }`; a preset without a fonts/
 * folder yields all-empty arrays.
 */
export function stagePresetFonts({ presetFontsDir, outDir, families, stagedNames }) {
  const result = { faces: [], staged: [], skipped: [], licenses: [] };
  if (!existsSync(presetFontsDir)) return result;
  const ranked = [...new Set(families)].sort(
    (a, b) => normFontName(b).length - normFontName(a).length,
  );
  const entries = readdirSync(presetFontsDir).sort();
  for (const f of entries) {
    if (!fontExtOf(f)) continue;
    const family = ranked.find((x) => normFontName(x) && normFontName(f).includes(normFontName(x)));
    if (!family) {
      result.skipped.push(f);
      continue;
    }
    const face = stageFontFile({ family, srcPath: join(presetFontsDir, f), outDir, stagedNames });
    if (!face) continue;
    result.faces.push(face.rule);
    result.staged.push(face.name);
  }
  if (result.staged.length) {
    for (const f of entries) {
      if (fontExtOf(f) || !LICENSE_FILE.test(f)) continue;
      if (!existsSync(join(outDir, f))) copyFileSync(join(presetFontsDir, f), join(outDir, f));
      result.licenses.push(f);
    }
  }
  return result;
}
