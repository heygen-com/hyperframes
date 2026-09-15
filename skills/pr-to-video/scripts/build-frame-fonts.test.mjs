import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { fontFamiliesNamed, fontWeightInfo, stageFontFile } from "./lib/font-faces.mjs";

const scriptDir = dirname(new URL(import.meta.url).pathname);
const buildFrameScript = join(scriptDir, "build-frame.mjs");
const shippedPresetDir = resolve(scriptDir, "../../hyperframes-creative/frame-presets");

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
  const root = mkdtempSync(join(tmpdir(), "build-frame-preset-fonts-"));
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
    /skipped 1 preset file\(s\) whose family frame\.md no longer names: Stray-400\.woff2/,
  );
  assert.match(out, /@font-face block for 4 face\(s\) appended to frame\.md/);
});

test("faces of a family the brand remix replaced are not staged; the rest still are", () => {
  const root = mkdtempSync(join(tmpdir(), "build-frame-preset-fonts-remix-"));
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
    /skipped 4 preset file\(s\) whose family frame\.md no longer names: AcmeSans-400\.woff2, AcmeSans-Bold\.woff2, AcmeSans-BoldItalic\.woff2, Stray-400\.woff2/,
  );
});

test("a face the captured brand already staged is not staged twice from the preset", () => {
  const root = mkdtempSync(join(tmpdir(), "build-frame-preset-fonts-dedup-"));
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

test("a preset without a fonts/ folder stages nothing and appends no font-loading section", () => {
  const root = mkdtempSync(join(tmpdir(), "build-frame-preset-no-fonts-"));
  const project = join(root, "project");
  write(join(project, "capture/extracted/tokens.json"), '{"colors":[],"fonts":[]}');
  const out = runBuildFrame(project, fakePreset(root));
  assert.equal(existsSync(join(project, "assets/fonts")), false);
  assert.doesNotMatch(readFileSync(join(project, "frame.md"), "utf8"), /## Font loading/);
  assert.doesNotMatch(out, /fonts: staged/);
});

test("the shipped code-editorial preset stages its six licensed faces plus their licenses", () => {
  const project = mkdtempSync(join(tmpdir(), "build-frame-code-editorial-"));
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
  assert.doesNotMatch(frameMd, /fonts\.googleapis\.com/);
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

test("stageFontFile keeps the first source's bytes for a face and refuses non-font files", () => {
  const root = mkdtempSync(join(tmpdir(), "stage-font-file-"));
  write(join(root, "a/Acme-Bold.woff2"), "first");
  write(join(root, "b/acme-700.woff2"), "second");
  write(join(root, "a/OFL.txt"), "license");
  const outDir = join(root, "out");
  const stagedNames = new Set();
  const first = stageFontFile({
    family: "Acme",
    srcPath: join(root, "a/Acme-Bold.woff2"),
    outDir,
    stagedNames,
  });
  assert.equal(first.name, "Acme-Bold.woff2");
  assert.match(first.rule, /font-weight:700;font-style:normal/);
  assert.equal(
    stageFontFile({ family: "Acme", srcPath: join(root, "b/acme-700.woff2"), outDir, stagedNames })
      .name,
    "Acme-700.woff2",
    "a numeric and a word weight are different staged names, both kept",
  );
  assert.equal(
    stageFontFile({ family: "Acme", srcPath: join(root, "a/OFL.txt"), outDir, stagedNames }),
    null,
  );
  assert.equal(readFileSync(join(outDir, "Acme-Bold.woff2"), "utf8"), "first");
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
