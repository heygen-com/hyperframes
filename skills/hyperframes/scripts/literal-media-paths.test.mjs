import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SELF_CONTAINED_FORMATS, assertLiteralMediaPath } from "./lib/literal-media-input.mjs";
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

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

test("the scripts' reader list is the parsers' self-contained list plus ico", () => {
  const source = readFileSync(script("packages/parsers/src/ffBinaries.ts"), "utf8");
  const parsers = /export const SELF_CONTAINED_FORMATS =\s*"([^"]+)"/.exec(source)?.[1];
  assert.ok(parsers, "SELF_CONTAINED_FORMATS in packages/parsers/src/ffBinaries.ts");
  assert.deepEqual(SELF_CONTAINED_FORMATS.split(",").sort(), [...parsers.split(","), "ico"].sort());
});

// A file named like media that is an ffconcat list naming an HLS playlist, which names a real clip in
// another folder. Read without a reader list, it decodes that clip, so its frames would land in the output.
function listNamedAsMedia(dir, name) {
  const elsewhere = join(dir, "elsewhere");
  mkdirSync(elsewhere, { recursive: true });
  const clip = join(elsewhere, "clip.ts");
  execFileSync("ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10:duration=2"],
    ...["-f", "lavfi", "-i", "sine=duration=2", "-shortest", "-f", "mpegts", clip],
  ]);
  const project = join(dir, "project");
  mkdirSync(project);
  writeFileSync(
    join(project, "list.m3u8"),
    `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n${clip}\n#EXT-X-ENDLIST\n`,
  );
  const named = join(project, name);
  writeFileSync(named, "ffconcat version 1.0\nfile 'list.m3u8'\n");
  return { project, named };
}

test(
  "dither, transcript-cut, verify-motion and locate refuse a list named as media and write nothing",
  { skip: !HAS_FFMPEG && "ffmpeg and ffprobe are not installed" },
  (t) => {
    const dir = sandbox(t);
    const { project, named } = listNamedAsMedia(dir, "video_001.mp4");
    const { named: namedImage } = listNamedAsMedia(join(dir, "image"), "logo.png");

    const dithered = join(project, "dithered.mp4");
    const dither = runNode("skills/media-use/scripts/dither.mjs", [
      ...["--input", named, "--out", dithered, "--json"],
    ]);
    assert.notEqual(dither.status, 0, dither.stdout + dither.stderr);
    assert.equal(existsSync(dithered), false);

    const transcript = join(project, "transcript.json");
    writeFileSync(transcript, JSON.stringify({ words: [{ text: "tone", start: 0, end: 2 }] }));
    const cutOut = join(project, "cut.mp4");
    const cut = runNode("skills/media-use/scripts/transcript-cut.mjs", [
      ...["--input", named, "--transcript", transcript, "--keep", "0-1", "--out", cutOut],
    ]);
    assert.notEqual(cut.status, 0, cut.stdout + cut.stderr);
    assert.equal(existsSync(cutOut), false);

    const verified = runNode("skills/figma/scripts/verify-motion.mjs", [
      ...["--reference", named, "--render", named],
    ]);
    assert.notEqual(verified.status, 0, verified.stdout + verified.stderr);

    const grid = join(project, "grid");
    const located = runNode("skills/hyperframes/scripts/locate.mjs", [
      ...["overlay", namedImage, "--out", grid],
    ]);
    assert.notEqual(located.status, 0, located.stdout + located.stderr);
    assert.equal(existsSync(join(grid, "gv.png")), false);
  },
);

test(
  "locate and verify-motion read a URL argument as a local name and request nothing",
  { skip: !HAS_FFMPEG && "ffmpeg and ffprobe are not installed" },
  async (t) => {
    const dir = sandbox(t);
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      res.end();
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    const runAsync = (path, args) =>
      promisify(execFile)(process.execPath, [script(path), ...args], { cwd: dir }).then(
        () => 0,
        (error) => error.code,
      );

    const located = await runAsync("skills/hyperframes/scripts/locate.mjs", [
      ...["overlay", `${base}/logo.png`, "--out", join(dir, "grid")],
    ]);
    const verified = await runAsync("skills/figma/scripts/verify-motion.mjs", [
      ...["--reference", `${base}/ref.mp4`, "--render", `${base}/out.mp4`],
    ]);
    assert.notEqual(located, 0);
    assert.notEqual(verified, 0);
    assert.deepEqual(requests, []);
  },
);
