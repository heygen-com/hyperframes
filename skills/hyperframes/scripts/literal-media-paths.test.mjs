import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertLiteralMediaPath } from "./lib/literal-media-input.mjs";
import { stretchToWav } from "../../media-use/audio/scripts/lib/recording.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const script = (path) => join(repo, path);
const PATTERN = /pattern of other files/;

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "skill-literal-media-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A file whose own name reads as an image2 pattern: the scripts must refuse it, never hand it to ffmpeg.
function patternFile(dir, name = "still%d.png") {
  const path = join(dir, name);
  writeFileSync(path, "not read");
  return path;
}

function runNode(path, args) {
  return spawnSync(process.execPath, [script(path), ...args], { encoding: "utf8" });
}

test("the standalone check refuses exactly what the parsers check refuses", () => {
  const source = readFileSync(script("packages/parsers/src/literalMediaInput.ts"), "utf8");
  const ours = readFileSync(
    script("skills/hyperframes/scripts/lib/literal-media-input.mjs"),
    "utf8",
  );
  for (const name of [
    "PATTERN_IMAGE2_EXPANDS",
    "WILDCARD_MAKES_ANY_PERCENT_A_PATTERN",
    "FORWARDED",
  ]) {
    const pattern = (text) => new RegExp(`const ${name} = (.+);`).exec(text)?.[1];
    assert.ok(pattern(source), name);
    assert.equal(pattern(ours), pattern(source), name);
  }
  for (const path of [
    "/a/b%d.png",
    "/a/x%3*/c.png",
    "file:/a/b%%.png",
    "/a/credentials.json%a{.xface",
    "/a/x{/y%a.png",
    "concat:/a/b%d.png",
    "subfile,,start,0,end,0,,:/a/b%d.png",
    "data:/a%d.png",
    "crypto:/a/b%d.png",
  ]) {
    assert.throws(() => assertLiteralMediaPath(path), PATTERN);
  }
  for (const path of [
    "/a/100% done.mp4",
    "/a/x{y}.png",
    "https://cdn.example/a%2d.png",
    "http://cdn.example/a%2d.png",
  ]) {
    assert.doesNotThrow(() => assertLiteralMediaPath(path));
  }
});

test("dither refuses an input or an output folder that reads as a pattern", (t) => {
  const dir = sandbox(t);
  const input = patternFile(dir);
  const refusedInput = runNode("skills/media-use/scripts/dither.mjs", [
    ...["--input", input, "--out", join(dir, "out.png"), "--json"],
  ]);
  assert.match(refusedInput.stdout + refusedInput.stderr, PATTERN);

  const plain = join(dir, "plain.png");
  writeFileSync(plain, "not read");
  const refusedOut = runNode("skills/media-use/scripts/dither.mjs", [
    ...["--input", plain, "--out", join(dir, "o%03d", "out.png"), "--json"],
  ]);
  assert.match(refusedOut.stdout + refusedOut.stderr, PATTERN);
});

test("transcript-cut refuses an input or --out that reads as a pattern", (t) => {
  const dir = sandbox(t);
  const transcript = join(dir, "transcript.json");
  writeFileSync(transcript, JSON.stringify({ words: [{ text: "tone", start: 0, end: 6 }] }));
  const cut = (input, out) =>
    runNode("skills/media-use/scripts/transcript-cut.mjs", [
      ...["--input", input, "--transcript", transcript, "--keep", "0-1", "--out", out],
    ]);
  const plain = join(dir, "plain.mp4");
  writeFileSync(plain, "not read");
  const refusedInput = cut(patternFile(dir, "clip%d.mp4"), join(dir, "out.mp4"));
  assert.match(refusedInput.stdout + refusedInput.stderr, PATTERN);
  const refusedOut = cut(plain, join(dir, "out%d.mp4"));
  assert.match(refusedOut.stdout + refusedOut.stderr, PATTERN);
});

test("locate and verify-motion refuse an image or video that reads as a pattern", (t) => {
  const dir = sandbox(t);
  const located = runNode("skills/hyperframes/scripts/locate.mjs", [
    ...["overlay", patternFile(dir), "--out", join(dir, "grid")],
  ]);
  assert.match(located.stdout + located.stderr, PATTERN);

  const plain = join(dir, "plain.mp4");
  writeFileSync(plain, "not read");
  const verified = runNode("skills/figma/scripts/verify-motion.mjs", [
    ...["--reference", patternFile(dir, "ref%d.mp4"), "--render", plain],
  ]);
  assert.match(verified.stdout + verified.stderr, PATTERN);
});

test("a recording that reads as a pattern is refused with a reason", (t) => {
  const dir = sandbox(t);
  const made = stretchToWav(patternFile(dir, "take%d.wav"), join(dir, "out.wav"));
  assert.equal(made.ok, false);
  assert.match(made.error, PATTERN);
});
