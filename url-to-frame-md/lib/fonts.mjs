// fonts.mjs — brand-font classification + @font-face staging, shared by the generator.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// icon / emoji / symbol faces are never brand TEXT — an emoji font (NotoEmoji, Apple Color Emoji)
// leaking into a button/heading typography is a capture artifact, so classify it as an icon font.
export const isIconFont = (n) =>
  /(?:^|[\s_-])icons?(?:[\s_-]|$)|icomoon|font\s*-?awesome|glyphicons?|material\s*icons|feather|emoji|symbols?/i.test(
    String(n),
  );
// serif/editorial display faces (the !sans guard drops ui-sans-serif / PT Sans).
export const isSerifFont = (n) =>
  !/sans/i.test(String(n)) &&
  /serif|times|georgia|playfair|tiempos|lora|garamond|caslon|didot|freight|canela|fraunces|spectral|merriweather|domaine|editorial|instrument/i.test(
    String(n),
  );
// match "mono" anywhere + named mono faces (monaco/consolas/…).
export const isMonoFont = (n) =>
  /mono|consol|courier|menlo|monaco|jetbrains|berkeley\s*mono|source\s*code|fira\s*code|geist\s*mono|dm\s*mono|ibm\s*plex\s*mono|sf\s*mono|roboto\s*mono/i.test(
    String(n),
  );

// bind brand font names to files via fonts-manifest.json; returns a "## Font loading" markdown block, or "".
export function stageFonts(captureDir, outDir, brandFonts, sansFont) {
  if (!brandFonts.length) return { block: "", families: [] };
  const extOf = (f) => (f.match(/\.(woff2|woff|ttf|otf)$/i)?.[1] ?? "").toLowerCase();
  const FMT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const weightFromName = (name) => {
    const s = name.toLowerCase();
    if (/black|heavy|ultra|extrabold/.test(s)) return { n: 800, w: "ExtraBold" };
    if (/semibold|demibold/.test(s)) return { n: 600, w: "SemiBold" };
    if (/bold/.test(s)) return { n: 700, w: "Bold" };
    if (/medium/.test(s)) return { n: 500, w: "Medium" };
    if (/light|thin/.test(s)) return { n: 300, w: "Light" };
    return { n: 400, w: "Regular" };
  };
  const manifestPath = join(captureDir, "extracted/fonts-manifest.json");
  let manifest = {};
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {}; // unreadable manifest → fall back to name-only binding
    }
  }
  const metaByFile = new Map((manifest.files ?? []).map((f) => [f.file, f]));
  const variableFams = new Set(
    (manifest.families ?? []).filter((f) => f.variable).map((f) => norm(f.family)),
  );
  const srcDir = join(captureDir, "assets/fonts");
  // staged output lands in this same dir, so on a re-run skip our own clean-named files.
  const stagedPrefixes = brandFonts.map((b) => b.replace(/[^A-Za-z0-9]/g, ""));
  const isStaged = (f) =>
    stagedPrefixes.some((p) =>
      new RegExp(
        `^${p}-(Regular|Light|Medium|SemiBold|Bold|ExtraBold)\\.(woff2?|ttf|otf)$`,
        "i",
      ).test(f),
    );
  // never stage an ICON font — the orphan-assignment would bind glyph files to a text family.
  const isIconFile = (f) =>
    metaByFile.get(f)?.isIcon ||
    /icon|glyph|fontawesome/i.test(f) ||
    isIconFont(metaByFile.get(f)?.family);
  // skip ITALIC/oblique files — the clean-name dedup ("Family-Regular") sorts "Italic" before
  // "Regular", so an italic subset would win the normal slot and render the whole family slanted.
  const isItalicFile = (f) => metaByFile.get(f)?.style === "italic" || /italic|oblique/i.test(f);
  const files = existsSync(srcDir)
    ? readdirSync(srcDir)
        .filter((f) => extOf(f) && !isStaged(f) && !isIconFile(f) && !isItalicFile(f))
        .sort()
    : [];

  const nonMono = brandFonts.filter((f) => !isMonoFont(f));
  const monoBrand = brandFonts.find(isMonoFont) ?? null;
  const monoish = (s) =>
    isMonoFont(s) || /commit|courier|consol|menlo|monaco|mono/i.test(String(s));

  const assign = files.map((file) => {
    const fam = metaByFile.get(file)?.family ?? "";
    if (monoBrand && (monoish(file) || monoish(fam))) return { file, name: monoBrand };
    const nf = norm(fam);
    const named =
      nf && fam !== "." ? nonMono.find((b) => nf.includes(norm(b)) || norm(b).includes(nf)) : null;
    return { file, name: named ?? null };
  });
  const have = new Set(assign.filter((a) => a.name).map((a) => a.name));
  const orphan = nonMono.find((b) => !have.has(b)) ?? nonMono[nonMono.length - 1] ?? sansFont;
  for (const a of assign) if (!a.name) a.name = orphan;

  const faces = [];
  const staged = new Set();
  const families = new Set(); // @font-face family names actually emitted — the ONLY names that render
  for (const { file, name } of assign) {
    if (!name) continue;
    const meta = metaByFile.get(file) ?? {};
    const { n, w } = weightFromName(file);
    const clean = `${name.replace(/[^A-Za-z0-9]/g, "")}-${w}.${extOf(file)}`;
    if (staged.has(clean)) continue;
    mkdirSync(outDir, { recursive: true });
    // copy unconditionally (idempotent) so a stale clean-named file from an earlier run can't survive.
    if (join(srcDir, file) !== join(outDir, clean))
      copyFileSync(join(srcDir, file), join(outDir, clean));
    staged.add(clean);
    families.add(name);
    const isVar = meta.variable || variableFams.has(norm(meta.family ?? ""));
    faces.push(
      `@font-face{font-family:"${name}";font-weight:${isVar ? "100 900" : n};font-style:normal;font-display:block;src:url("assets/fonts/${clean}") format("${FMT[extOf(file)]}");}`,
    );
  }
  if (!faces.length) return { block: "", families: [] };
  const block = `\n## Font loading (auto-generated)\n\nThe brand fonts ship as local files in \`assets/fonts/\`. Paste this into every frame's \`<head>\`:\n\n\`\`\`html\n<style>\n${faces.join("\n")}\n</style>\n\`\`\`\n`;
  return { block, families: [...families] };
}
