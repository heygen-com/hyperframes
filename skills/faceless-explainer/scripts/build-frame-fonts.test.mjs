import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  fontFamiliesNamed,
  fontWeightInfo,
  stageFontFile,
  stagePresetFonts,
} from "./lib/font-faces.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const buildFrameScript = join(scriptDir, "build-frame.mjs");
const shippedPresetDir = resolve(scriptDir, "../../hyperframes-creative/frame-presets");

const tmpDirs = [];
const tmp = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
test.after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

// A minimal preset: three families in the typography ramp, a legal color block so the
// script's self-check passes, and whatever the caller drops into fonts/.
function fakePreset(root, fonts = {}) {
  const presetDir = join(root, "presets");
  const dir = join(presetDir, "acme");
  write(
    join(dir, "FRAME.md"),
    [
      "---",
      "name: Acme — Frame",
      "",
      "colors:",
      '  ink: "#141413"',
      '  cream: "#FAF9F5"',
      '  coral: "#CC785C"',
      "",
      "typography:",
      '  display: { fontFamily: "Acme Sans", cqw: 6.7, weight: 700, lineHeight: 1.02 }',
      '  body:    { fontFamily: "Acme Sans", cqw: 1.5, weight: 400, lineHeight: 1.5 }',
      '  code:    { fontFamily: "Other Mono", cqw: 1.4, weight: 400, lineHeight: 1.6 }',
      "---",
      "",
      "# Acme",
      "",
      "Prose about the look.",
      "",
    ].join("\n"),
  );
  for (const [name, bytes] of Object.entries(fonts)) write(join(dir, "fonts", name), bytes);
  return presetDir;
}

function runBuildFrame(project, presetDir, preset = "acme") {
  return execFileSync(
    process.execPath,
    [buildFrameScript, "--preset", preset, "--hyperframes", project, "--preset-dir", presetDir],
    { encoding: "utf8" },
  );
}

const PRESET_FONTS = {
  "AcmeSans-400.woff2": "sans-regular",
  "AcmeSans-Bold.woff2": "sans-bold",
  "AcmeSans-BoldItalic.woff2": "sans-bold-italic",
  "OtherMono-700.ttf": "mono-bold",
  "Stray-400.woff2": "no such family in the ramp",
  "OFL-acme-sans.txt": "SIL Open Font License",
};

test("a preset's own fonts/ folder is staged by family, weight and style read from the filename", () => {
  const root = tmp("build-frame-preset-fonts-");
  const project = join(root, "project");
  write(join(project, "capture/extracted/tokens.json"), '{"colors":[],"fonts":[]}');
  const out = runBuildFrame(project, fakePreset(root, PRESET_FONTS));

  const stagedDir = join(project, "assets/fonts");
  assert.deepEqual(readdirSync(stagedDir).sort(), [
    "AcmeSans-400.woff2",
    "AcmeSans-Bold-Italic.woff2",
    "AcmeSans-Bold.woff2",
    "OFL-acme-sans.txt",
    "OtherMono-700.ttf",
  ]);
  assert.equal(
    readFileSync(join(stagedDir, "AcmeSans-Bold-Italic.woff2"), "utf8"),
    "sans-bold-italic",
  );

  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.match(frameMd, /## Font loading \(auto-generated\)/);
  assert.match(frameMd, /from the acme preset/);
  for (const rule of [
    '@font-face{font-family:"Acme Sans";font-weight:400;font-style:normal;font-display:block;src:url("assets/fonts/AcmeSans-400.woff2") format("woff2");}',
    '@font-face{font-family:"Acme Sans";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/AcmeSans-Bold.woff2") format("woff2");}',
    '@font-face{font-family:"Acme Sans";font-weight:700;font-style:italic;font-display:block;src:url("assets/fonts/AcmeSans-Bold-Italic.woff2") format("woff2");}',
    '@font-face{font-family:"Other Mono";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/OtherMono-700.ttf") format("truetype");}',
  ]) {
    assert.ok(frameMd.includes(rule), `frame.md should carry ${rule}`);
  }
  assert.equal((frameMd.match(/## Font loading/g) ?? []).length, 1, "one font-loading section");
  assert.doesNotMatch(frameMd, /Stray/);

  assert.match(out, /fonts: staged 4 preset face\(s\) → assets\/fonts\/ \(\+ OFL-acme-sans\.txt\)/);
  assert.match(
    out,
    /skipped 1 preset file\(s\) matching no family frame\.md names: Stray-400\.woff2/,
  );
  assert.match(out, /@font-face block for 4 face\(s\) appended to frame\.md/);
});

test("faces of a family the brand remix replaced are not staged; the rest still are", () => {
  const root = tmp("build-frame-preset-fonts-remix-");
  const project = join(root, "project");
  write(
    join(project, "capture/extracted/tokens.json"),
    JSON.stringify({ colors: [], fonts: [{ family: "Brand Grotesk", weights: [400, 700] }] }),
  );
  const out = runBuildFrame(project, fakePreset(root, PRESET_FONTS));

  // Acme Sans (display + body) became Brand Grotesk, which ships no files here; Other Mono
  // is untouched by the remix and keeps its preset-owned face.
  assert.deepEqual(readdirSync(join(project, "assets/fonts")).sort(), [
    "OFL-acme-sans.txt",
    "OtherMono-700.ttf",
  ]);
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.doesNotMatch(frameMd, /Acme Sans/);
  assert.match(frameMd, /@font-face\{font-family:"Other Mono";font-weight:700/);
  assert.doesNotMatch(frameMd, /AcmeSans-/);
  assert.match(out, /fonts: staged 1 preset face\(s\)/);
  assert.match(
    out,
    /skipped 4 preset file\(s\) matching no family frame\.md names: AcmeSans-400\.woff2, AcmeSans-Bold\.woff2, AcmeSans-BoldItalic\.woff2, Stray-400\.woff2/,
  );
});

test("a face the captured brand already staged is not staged twice from the preset", () => {
  const root = tmp("build-frame-preset-fonts-dedup-");
  const project = join(root, "project");
  // The brand IS the preset's mono family and the capture downloaded its bold face.
  write(
    join(project, "capture/extracted/tokens.json"),
    JSON.stringify({ colors: [], fonts: [{ family: "Other Mono", weights: [700] }] }),
  );
  write(join(project, "capture/assets/fonts/othermono-latin-700-normal.woff2"), "captured-bold");
  runBuildFrame(project, fakePreset(root, { "OtherMono-700.woff2": "preset-bold" }));

  const stagedDir = join(project, "assets/fonts");
  assert.deepEqual(readdirSync(stagedDir).sort(), ["OtherMono-700.woff2"]);
  assert.equal(readFileSync(join(stagedDir, "OtherMono-700.woff2"), "utf8"), "captured-bold");
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.equal((frameMd.match(/@font-face\{/g) ?? []).length, 1);
});

test("a brand face the capture named by weight word is not staged again from the preset's numeric file", () => {
  const root = tmp("build-frame-preset-fonts-dedup-word-");
  const project = join(root, "project");
  write(
    join(project, "capture/extracted/tokens.json"),
    JSON.stringify({ colors: [], fonts: [{ family: "Other Mono", weights: [700] }] }),
  );
  write(join(project, "capture/assets/fonts/OtherMono-Bold.woff2"), "captured-bold");
  runBuildFrame(project, fakePreset(root, { "OtherMono-700.woff2": "preset-bold" }));

  assert.deepEqual(readdirSync(join(project, "assets/fonts")).sort(), ["OtherMono-Bold.woff2"]);
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.equal((frameMd.match(/@font-face\{/g) ?? []).length, 1);
});

test("a rerun after brand tokens arrive does not relabel previously staged preset faces as the brand", () => {
  const root = tmp("build-frame-preset-fonts-rerun-");
  const project = join(root, "project");
  const presetDir = fakePreset(root, PRESET_FONTS);
  // Run 1: no brand yet — the preset's own faces land in assets/fonts/.
  write(join(project, "capture/extracted/tokens.json"), '{"colors":[],"fonts":[]}');
  runBuildFrame(project, presetDir);
  assert.equal(existsSync(join(project, "assets/fonts/AcmeSans-400.woff2")), true);
  // Run 2: one captured brand family with a Google-named file. Only the capture file may be
  // claimed by the single-family shortcut; the preset bytes already in assets/fonts/ must
  // not — "Sans" is even a substring of the staged "AcmeSans-*" names.
  write(
    join(project, "capture/extracted/tokens.json"),
    JSON.stringify({ colors: [], fonts: [{ family: "Sans", weights: [400] }] }),
  );
  write(join(project, "capture/assets/fonts/sans-regular.woff2"), "sans-regular");
  const out = runBuildFrame(project, presetDir);

  const stagedDir = join(project, "assets/fonts");
  assert.equal(readFileSync(join(stagedDir, "Sans-Regular.woff2"), "utf8"), "sans-regular");
  assert.equal(
    existsSync(join(stagedDir, "Sans-400.woff2")),
    false,
    "AcmeSans bytes not relabeled",
  );
  assert.equal(existsSync(join(stagedDir, "Sans-Bold.woff2")), false);
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  const sansRules = frameMd.match(/@font-face\{font-family:"Sans";[^\n]*/g) ?? [];
  assert.equal(sansRules.length, 1);
  assert.match(sansRules[0], /Sans-Regular\.woff2/);
  assert.match(out, /fonts: staged 1 brand face\(s\)/);
});

test("a hash-named capture file is staged as the single captured brand family", () => {
  const root = tmp("build-frame-capture-hash-");
  const project = join(root, "project");
  write(
    join(project, "capture/extracted/tokens.json"),
    JSON.stringify({ colors: [], fonts: [{ family: "Brand Grotesk", weights: [400] }] }),
  );
  // The capture pipeline saves downloads under their content hash (see the CLI's
  // fontMetadataExtractor): nothing in the name says "Brand Grotesk", so only the
  // single-family shortcut can claim it — the prefix rule would leave the brand unstaged.
  write(join(project, "capture/assets/fonts/19cfc7226ec3afaa-s.woff2"), "captured-regular");
  const out = runBuildFrame(project, fakePreset(root));

  const stagedDir = join(project, "assets/fonts");
  assert.deepEqual(readdirSync(stagedDir).sort(), ["BrandGrotesk-Regular.woff2"]);
  assert.equal(
    readFileSync(join(stagedDir, "BrandGrotesk-Regular.woff2"), "utf8"),
    "captured-regular",
  );
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.match(
    frameMd,
    /@font-face\{font-family:"Brand Grotesk";font-weight:400;font-style:normal;[^\n]*BrandGrotesk-Regular\.woff2/,
  );
  assert.match(out, /fonts: staged 1 brand face\(s\)/);
});

test("capture files of two brand families each go to the family whose key their name contains", () => {
  const root = tmp("build-frame-capture-two-families-");
  const project = join(root, "project");
  write(
    join(project, "capture/extracted/tokens.json"),
    JSON.stringify({
      colors: [],
      fonts: [
        { family: "Brand Grotesk", weights: [400] },
        { family: "Brand Mono", weights: [700] },
      ],
    }),
  );
  // CDN-style names carry the family INSIDE the stem, not at its start: substring matching
  // is what tells the two downloads apart; a prefix match would stage neither.
  write(join(project, "capture/assets/fonts/cdn-brandgrotesk-400.woff2"), "grotesk-regular");
  write(join(project, "capture/assets/fonts/cdn-brandmono-700.woff2"), "mono-bold");
  const out = runBuildFrame(project, fakePreset(root));

  const stagedDir = join(project, "assets/fonts");
  assert.deepEqual(readdirSync(stagedDir).sort(), [
    "BrandGrotesk-400.woff2",
    "BrandMono-700.woff2",
  ]);
  assert.equal(readFileSync(join(stagedDir, "BrandGrotesk-400.woff2"), "utf8"), "grotesk-regular");
  assert.equal(readFileSync(join(stagedDir, "BrandMono-700.woff2"), "utf8"), "mono-bold");
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.match(
    frameMd,
    /@font-face\{font-family:"Brand Grotesk";font-weight:400;[^\n]*BrandGrotesk-400\.woff2/,
  );
  assert.match(
    frameMd,
    /@font-face\{font-family:"Brand Mono";font-weight:700;[^\n]*BrandMono-700\.woff2/,
  );
  assert.match(out, /fonts: staged 2 brand face\(s\)/);
});

test("a capture file does not overwrite a face already staged in assets/fonts/", () => {
  const root = tmp("build-frame-capture-keeps-staged-");
  const project = join(root, "project");
  write(
    join(project, "capture/extracted/tokens.json"),
    JSON.stringify({ colors: [], fonts: [{ family: "Brand Grotesk", weights: [400] }] }),
  );
  write(join(project, "capture/assets/fonts/brand-grotesk-400.woff2"), "captured-regular");
  // Hand-placed (or previously staged) bytes under the staged name win over the download.
  write(join(project, "assets/fonts/BrandGrotesk-400.woff2"), "hand-placed");
  runBuildFrame(project, fakePreset(root));

  const stagedDir = join(project, "assets/fonts");
  assert.deepEqual(readdirSync(stagedDir).sort(), ["BrandGrotesk-400.woff2"]);
  assert.equal(readFileSync(join(stagedDir, "BrandGrotesk-400.woff2"), "utf8"), "hand-placed");
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.equal((frameMd.match(/@font-face\{/g) ?? []).length, 1);
});

test("a rerun refreshes a preset face's staged bytes from the preset", () => {
  const root = tmp("build-frame-preset-refresh-");
  const project = join(root, "project");
  const presetDir = fakePreset(root, PRESET_FONTS);
  write(join(project, "capture/extracted/tokens.json"), '{"colors":[],"fonts":[]}');
  runBuildFrame(project, presetDir);
  const staged = join(project, "assets/fonts/AcmeSans-400.woff2");
  assert.equal(readFileSync(staged, "utf8"), "sans-regular");
  // A skills update may ship re-subsetted files: the preset source is authoritative.
  writeFileSync(staged, "stale bytes from an earlier run");
  runBuildFrame(project, presetDir);
  assert.equal(readFileSync(staged, "utf8"), "sans-regular");
});

test("a preset without a fonts/ folder stages nothing and appends no font-loading section", () => {
  const root = tmp("build-frame-preset-no-fonts-");
  const project = join(root, "project");
  write(join(project, "capture/extracted/tokens.json"), '{"colors":[],"fonts":[]}');
  const out = runBuildFrame(project, fakePreset(root));
  assert.equal(existsSync(join(project, "assets/fonts")), false);
  assert.doesNotMatch(readFileSync(join(project, "frame.md"), "utf8"), /## Font loading/);
  assert.doesNotMatch(out, /fonts: staged/);
});

test("the shipped code-editorial preset stages its six licensed faces plus their licenses", () => {
  const project = tmp("build-frame-code-editorial-");
  write(join(project, "capture/extracted/tokens.json"), '{"colors":[],"fonts":[]}');
  runBuildFrame(project, shippedPresetDir, "code-editorial");

  const stagedDir = join(project, "assets/fonts");
  for (const name of [
    "EBGaramond-400.woff2",
    "EBGaramond-700.woff2",
    "Inter-400.woff2",
    "Inter-700.woff2",
    "JetBrainsMono-400.woff2",
    "JetBrainsMono-700.woff2",
  ]) {
    assert.equal(existsSync(join(stagedDir, name)), true, `${name} should be staged`);
    assert.equal(readFileSync(join(stagedDir, name)).subarray(0, 4).toString("ascii"), "wOF2");
  }
  for (const family of ["eb-garamond", "inter", "jetbrains-mono"]) {
    assert.equal(existsSync(join(stagedDir, `OFL-${family}.txt`)), true);
  }
  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.match(frameMd, /@font-face\{font-family:"EB Garamond";font-weight:400/);
  assert.match(frameMd, /@font-face\{font-family:"Inter";font-weight:700/);
  assert.match(frameMd, /@font-face\{font-family:"JetBrains Mono";font-weight:400/);
  assert.ok(!frameMd.includes("fonts.googleapis.com"));
});

test("fontFamiliesNamed reads every family in a ramp once", () => {
  assert.deepEqual(
    fontFamiliesNamed(
      'display: { fontFamily: "EB Garamond" }\nbody: { fontFamily: "Inter" }\nlead: { fontFamily: "Inter" }',
    ),
    ["EB Garamond", "Inter"],
  );
});

test("fontWeightInfo prefers a numeric axis and never reads a hash as a weight", () => {
  assert.deepEqual(fontWeightInfo("Inter-700.woff2"), { n: 700, w: "700" });
  assert.deepEqual(fontWeightInfo("inter-latin-500-normal.woff2"), { n: 500, w: "500" });
  assert.deepEqual(fontWeightInfo("Newsreader-a1b200c3.woff2"), { n: 400, w: "Regular" });
  assert.deepEqual(fontWeightInfo("Acme-SemiBold.otf"), { n: 600, w: "SemiBold" });
});

test("stageFontFile leaves a file already at the staged path alone unless refresh is set", () => {
  const root = tmp("stage-font-file-keep-");
  write(join(root, "src/Acme-Bold.woff2"), "download");
  const outDir = join(root, "out");
  write(join(outDir, "Acme-Bold.woff2"), "hand-placed");
  const kept = stageFontFile({
    family: "Acme",
    srcPath: join(root, "src/Acme-Bold.woff2"),
    outDir,
    stagedFaces: new Set(),
  });
  assert.equal(kept.name, "Acme-Bold.woff2");
  assert.match(kept.rule, /Acme-Bold\.woff2/);
  assert.equal(readFileSync(join(outDir, "Acme-Bold.woff2"), "utf8"), "hand-placed");
});

test("stageFontFile refreshes stale bytes, keeps the first source's face and refuses non-font files", () => {
  const root = tmp("stage-font-file-");
  write(join(root, "a/Acme-Bold.woff2"), "first");
  write(join(root, "b/acme-700.woff2"), "second");
  write(join(root, "a/OFL.txt"), "license");
  const outDir = join(root, "out");
  write(join(outDir, "Acme-Bold.woff2"), "stale bytes from an earlier run");
  const stagedFaces = new Set();
  const first = stageFontFile({
    family: "Acme",
    srcPath: join(root, "a/Acme-Bold.woff2"),
    outDir,
    stagedFaces,
    refresh: true,
  });
  assert.equal(first.name, "Acme-Bold.woff2");
  assert.match(first.rule, /font-weight:700;font-style:normal/);
  assert.equal(
    stageFontFile({ family: "Acme", srcPath: join(root, "b/acme-700.woff2"), outDir, stagedFaces }),
    null,
    "a numeric and a word weight for the same face are one face — the first source wins",
  );
  assert.equal(existsSync(join(outDir, "Acme-700.woff2")), false);
  assert.equal(
    stageFontFile({ family: "Acme", srcPath: join(root, "a/OFL.txt"), outDir, stagedFaces }),
    null,
  );
  assert.equal(readFileSync(join(outDir, "Acme-Bold.woff2"), "utf8"), "first");
});

test("a font file goes to the longest family its name starts with, not the first that matches", () => {
  const root = tmp("stage-preset-fonts-overlap-");
  const presetFontsDir = join(root, "fonts");
  write(join(presetFontsDir, "InterTight-700.woff2"), "tight-bold");
  write(join(presetFontsDir, "Inter-400.woff2"), "inter-regular");
  const outDir = join(root, "out");
  // "Inter" is a prefix of "Inter Tight": listed first so that only the length ranking, not
  // the input order, can send InterTight-700 to the right family.
  const result = stagePresetFonts({
    presetFontsDir,
    outDir,
    families: ["Inter", "Inter Tight"],
    stagedFaces: new Set(),
  });
  assert.deepEqual(result.staged, ["Inter-400.woff2", "InterTight-700.woff2"]);
  assert.deepEqual(result.skipped, []);
  assert.match(result.faces[0], /font-family:"Inter";font-weight:400;.*Inter-400\.woff2/);
  assert.match(
    result.faces[1],
    /font-family:"Inter Tight";font-weight:700;.*InterTight-700\.woff2/,
  );
  assert.equal(readFileSync(join(outDir, "InterTight-700.woff2"), "utf8"), "tight-bold");
  assert.equal(readFileSync(join(outDir, "Inter-400.woff2"), "utf8"), "inter-regular");

  // A family whose key merely appears INSIDE a filename does not own it: after a remix
  // renamed "EB Garamond" to "Garamond", the preset's EBGaramond files are dead weight.
  const substring = stagePresetFonts({
    presetFontsDir,
    outDir: join(root, "out2"),
    families: ["Tight"],
    stagedFaces: new Set(),
  });
  assert.deepEqual(substring.staged, []);
  assert.deepEqual(substring.skipped, ["Inter-400.woff2", "InterTight-700.woff2"]);
});

test("a subdirectory or dangling symlink named like a font file is neither staged nor a crash", () => {
  const root = tmp("stage-preset-fonts-dir-entry-");
  const presetFontsDir = join(root, "fonts");
  mkdirSync(join(presetFontsDir, "Inter-700.woff2"), { recursive: true });
  mkdirSync(join(presetFontsDir, "LICENSE"), { recursive: true });
  symlinkSync(join(root, "gone.woff2"), join(presetFontsDir, "Inter-Bold.woff2"));
  write(join(presetFontsDir, "Inter-400.woff2"), "inter-regular");
  const result = stagePresetFonts({
    presetFontsDir,
    outDir: join(root, "out"),
    families: ["Inter"],
    stagedFaces: new Set(),
  });
  assert.deepEqual(result.staged, ["Inter-400.woff2"]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.licenses, []);
});

// font-faces.mjs ships once per creation workflow because each skill installs standalone;
// the three copies are meant to be byte-identical so a fix landing in one cannot drift.
test("font-faces.mjs is byte-identical across the three workflows that ship it", () => {
  const [first, ...rest] = ["product-launch-video", "faceless-explainer", "pr-to-video"].map(
    (skill) => ({
      skill,
      source: readFileSync(
        new URL(`../../${skill}/scripts/lib/font-faces.mjs`, import.meta.url),
        "utf8",
      ),
    }),
  );
  for (const other of rest) {
    assert.equal(other.source, first.source, `${other.skill} drifted from ${first.skill}`);
  }
});
