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

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

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

/**
 * Families as `{ family, key }` ranked longest key first, so a filename is matched against
 * "TT Norms Pro Mono" before "TT Norms Pro" can swallow it. Duplicates and families whose key
 * is empty (nothing to match on) are dropped.
 */
export function rankFontFamilies(families) {
  return [...new Set(families)]
    .map((family) => ({ family, key: normFontName(family) }))
    .filter((x) => x.key)
    .sort((a, b) => b.key.length - a.key.length);
}

/** Every family a frame spec names — `fontFamily: "X"` in its typography ramp. */
export function fontFamiliesNamed(md) {
  const out = new Set();
  for (const m of String(md).matchAll(/fontFamily:\s*"([^"]+)"/g)) out.add(m[1].trim());
  return [...out];
}

/**
 * The family a face-named file belongs to: the longest-keyed entry of `ranked` (see
 * `rankFontFamilies`) whose key the filename's stem STARTS with, or `undefined`. Staged files
 * and preset files follow the `<FamilyClean>-<weight>[-Italic].<ext>` contract, so a prefix
 * match is exact — a brand named "Garamond" must not claim the preset's "EBGaramond-400.woff2".
 */
export const familyOfFaceFile = (fileName, ranked) => {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return ranked.find((x) => normFontName(stem).startsWith(x.key))?.family;
};

/**
 * Copy one font file into `outDir` under its clean face name and return
 * `{ name, rule }` — the staged filename and its root-relative @font-face rule — or
 * `null` when that face is already staged (first source wins) or the file is not a font.
 * `stagedFaces` is keyed on the FACE (family + numeric weight + style), not the filename:
 * "Inter-Regular.ttf" and "inter-latin-400-normal.woff2" name the same face and would
 * otherwise both be staged with two contradictory @font-face rules for it. Refresh scope: a
 * file already at the staged path wins by default (the capture source — a hand-placed file,
 * or the previous run's own output, is never overwritten by a download); `refresh: true` is
 * passed for the preset source only, so a face the preset stages is re-copied on every run
 * (a skills update may ship re-subsetted files) unless the source already IS the staged file.
 */
export function stageFontFile({ family, srcPath, outDir, stagedFaces, refresh = false }) {
  const file = basename(srcPath);
  const ext = fontExtOf(file);
  if (!ext) return null;
  const { n, w } = fontWeightInfo(file);
  const style = fontStyleOf(file);
  const faceKey = `${family}|${n}|${style}`;
  if (stagedFaces.has(faceKey)) return null;
  const name = `${family.replace(/[^A-Za-z0-9]/g, "")}-${w}${style === "italic" ? "-Italic" : ""}.${ext}`;
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, name);
  if ((refresh || !existsSync(dest)) && resolve(srcPath) !== resolve(dest))
    copyFileSync(srcPath, dest);
  stagedFaces.add(faceKey);
  return {
    name,
    rule: `@font-face{font-family:"${family}";font-weight:${n};font-style:${style};font-display:block;src:url("assets/fonts/${name}") format("${FONT_FORMAT[ext]}");}`,
  };
}

const LICENSE_FILE = /^(?:OFL|LICEN[CS]E|COPYING)\b/i;

/**
 * Stage a preset's own fonts/ folder. Each font file is assigned to the LONGEST family in
 * `families` (the families the frame spec names) whose key its filename starts with; a file
 * matching none is reported in `skipped` rather than staged — after a brand remix the
 * preset's original family may no longer appear in frame.md, and its bytes would be dead
 * weight. License texts shipped beside the fonts (OFL-*.txt, LICENSE…) travel with any
 * staged face. Returns `{ faces, staged, skipped, licenses }`; a preset without a fonts/
 * folder yields all-empty arrays.
 */
export function stagePresetFonts({ presetFontsDir, outDir, families, stagedFaces }) {
  const result = { faces: [], staged: [], skipped: [], licenses: [] };
  if (!existsSync(presetFontsDir)) return result;
  const ranked = rankFontFamilies(families);
  // Only plain files (symlinks resolved): a subdirectory named like a font would otherwise
  // reach copyFileSync and throw EISDIR, and a dangling symlink would throw ENOENT on stat.
  const isFile = (f) => {
    try {
      return statSync(join(presetFontsDir, f)).isFile();
    } catch {
      return false;
    }
  };
  const entries = readdirSync(presetFontsDir).filter(isFile).sort();
  for (const f of entries) {
    if (!fontExtOf(f)) continue;
    const family = familyOfFaceFile(f, ranked);
    if (!family) {
      result.skipped.push(f);
      continue;
    }
    const face = stageFontFile({
      family,
      srcPath: join(presetFontsDir, f),
      outDir,
      stagedFaces,
      refresh: true,
    });
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
