import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { validateFrameHtml } from "./lib/frame-contract.mjs";

const scriptDir = dirname(new URL(import.meta.url).pathname);
const buildFrameScript = join(scriptDir, "build-frame.mjs");
const assembleScript = join(scriptDir, "assemble-index.mjs");
const transitionsScript = join(scriptDir, "transitions.mjs");

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function validFrame(id = "01-valid", duration = 3) {
  return `<template id="${id}-template">
  <div data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${duration}">
    <div class="clip" data-start="0" data-duration="${duration}" data-track-index="0"></div>
    <style>#root { color: black; }</style>
    <script>window.__timelines = window.__timelines || {}; window.__timelines["${id}"] = gsap.timeline({ paused: true });</script>
  </div>
</template>`;
}

test("valid bare template fragment passes the shared frame contract", () => {
  assert.doesNotThrow(() =>
    validateFrameHtml(validFrame(), { expectedId: "01-valid", expectedDuration: 3 }),
  );
});

test("HTML5 unquoted root attributes are accepted", () => {
  assert.deepEqual(
    validateFrameHtml(
      `<template><div data-composition-id=01-valid data-duration=3></div></template>`,
      { expectedId: "01-valid", expectedDuration: 3 },
    ),
    { compositionId: "01-valid", duration: 3 },
  );
});

test("duration accepts decimal seconds but rejects alternate numeric syntaxes", () => {
  assert.doesNotThrow(() =>
    validateFrameHtml(
      `<template><div data-composition-id="01-valid" data-duration="3.25"></div></template>`,
    ),
  );
  for (const duration of ["0x10", "3e2", "Infinity"]) {
    assert.throws(
      () =>
        validateFrameHtml(
          `<template><div data-composition-id="01-valid" data-duration="${duration}"></div></template>`,
        ),
      /positive.*duration/i,
    );
  }
});

test("full HTML is rejected even when it contains a valid inner template", () => {
  const html = `<!doctype html><html><head></head><body>${validFrame()}</body></html>`;
  assert.throws(
    () => validateFrameHtml(html, { expectedId: "01-valid", expectedDuration: 3 }),
    /bare <template>|full HTML document/i,
  );
});

test("missing or mismatched composition id and duration fail explicitly", () => {
  assert.throws(
    () =>
      validateFrameHtml(`<template><div data-duration="3"></div></template>`, {
        expectedId: "01-valid",
        expectedDuration: 3,
      }),
    /composition id/i,
  );
  assert.throws(
    () =>
      validateFrameHtml(
        `<template><div data-composition-id="wrong" data-duration="3"></div></template>`,
        { expectedId: "01-valid", expectedDuration: 3 },
      ),
    /expected.*01-valid/i,
  );
  assert.throws(
    () =>
      validateFrameHtml(
        `<template><div data-composition-id="01-valid" data-duration="0"></div></template>`,
        { expectedId: "01-valid", expectedDuration: 3 },
      ),
    /positive.*duration/i,
  );
});

test("assembler rejects malformed worker output before writing index.html", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-frame-contract-"));
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Broken\n\n- duration: 3s\n- status: animated\n- src: compositions/frames/01-broken.html\n`,
  );
  write(
    join(project, "compositions", "frames", "01-broken.html"),
    `<!doctype html><html><body><div data-composition-id="01-broken" data-duration="3"></div></body></html>`,
  );

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [assembleScript, "--storyboard", join(project, "STORYBOARD.md"), "--hyperframes", project],
        { encoding: "utf8", stdio: "pipe" },
      ),
    /bare <template>|full HTML document/i,
  );
  assert.equal(existsSync(join(project, "index.html")), false);
});

test("validated bare frames survive assembly and transition injection", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-frame-transition-"));
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — First\n\n- duration: 3s\n- transition_in: cut\n- status: animated\n- src: compositions/frames/01-first.html\n\n## Frame 2 — Second\n\n- duration: 3s\n- transition_in: crossfade 0.4s\n- status: animated\n- src: compositions/frames/02-second.html\n`,
  );
  write(join(project, "compositions", "frames", "01-first.html"), validFrame("01-first", 3));
  write(join(project, "compositions", "frames", "02-second.html"), validFrame("02-second", 3));

  execFileSync(
    process.execPath,
    [assembleScript, "--storyboard", join(project, "STORYBOARD.md"), "--hyperframes", project],
    { encoding: "utf8" },
  );
  execFileSync(
    process.execPath,
    [
      transitionsScript,
      "inject",
      "--storyboard",
      join(project, "STORYBOARD.md"),
      "--hyperframes",
      project,
    ],
    { encoding: "utf8" },
  );
  const verified = execFileSync(
    process.execPath,
    [
      transitionsScript,
      "verify",
      "--storyboard",
      join(project, "STORYBOARD.md"),
      "--index",
      join(project, "index.html"),
    ],
    { encoding: "utf8" },
  );
  assert.match(verified, /1 transition\(s\) verified/);
  assert.doesNotThrow(() =>
    execFileSync(
      process.execPath,
      [assembleScript, "--storyboard", join(project, "STORYBOARD.md"), "--hyperframes", project],
      { encoding: "utf8" },
    ),
  );
});

test("Code editorial preset stages renderer-parity fonts for an empty PR token set", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-code-editorial-fonts-"));
  write(join(project, "capture", "extracted", "tokens.json"), '{"colors":[],"fonts":[]}');

  execFileSync(
    process.execPath,
    [buildFrameScript, "--preset", "code-editorial", "--hyperframes", project],
    { encoding: "utf8" },
  );

  const expected = [
    "EBGaramond-400.woff2",
    "EBGaramond-700.woff2",
    "Inter-400.woff2",
    "Inter-700.woff2",
    "JetBrainsMono-400.woff2",
    "JetBrainsMono-700.woff2",
  ];
  for (const name of expected) {
    const path = join(project, "assets", "fonts", name);
    assert.equal(existsSync(path), true, `${name} should be staged`);
    const magic = readFileSync(path).subarray(0, 4).toString("ascii");
    assert.equal(magic, "wOF2", `${name} should be a WOFF2 file`);
  }

  const frameMd = readFileSync(join(project, "frame.md"), "utf8");
  assert.match(frameMd, /@font-face\{font-family:"EB Garamond";font-weight:400/);
  assert.match(frameMd, /@font-face\{font-family:"Inter";font-weight:700/);
  assert.match(frameMd, /@font-face\{font-family:"JetBrains Mono";font-weight:400/);
  assert.doesNotMatch(frameMd, /fonts\.googleapis\.com/);
});

test("bundled Code editorial font licenses are shipped beside the assets", () => {
  const fontDir = resolve(
    scriptDir,
    "../../hyperframes-creative/frame-presets/code-editorial/fonts",
  );
  for (const family of ["eb-garamond", "inter", "jetbrains-mono"]) {
    assert.equal(existsSync(join(fontDir, `OFL-${family}.txt`)), true);
  }
});
