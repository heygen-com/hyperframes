import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

const runAsync = (path, args, options = {}) =>
  promisify(execFile)(process.execPath, [script(path), ...args], options).then(
    ({ stdout, stderr }) => ({ code: 0, output: stdout + stderr }),
    (error) => ({ code: error.code, output: `${error.stdout}${error.stderr}` }),
  );

// A real clip in a folder beside the project, which the project's files must not reach.
function clipElsewhere(dir) {
  const clip = join(dir, "elsewhere", "clip.ts");
  mkdirSync(join(dir, "elsewhere"), { recursive: true });
  execFileSync("ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10:duration=2"],
    ...["-f", "lavfi", "-i", "sine=duration=2", "-shortest", "-f", "mpegts", clip],
  ]);
  return clip;
}

// A file named like media that is an ffconcat list naming an HLS playlist, whose one entry is that clip.
// Read with no reader list, ffmpeg follows both and decodes the clip.
function listNamedAsMedia(dir, name) {
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "list.m3u8"),
    `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n${clipElsewhere(dir)}\n#EXT-X-ENDLIST\n`,
  );
  const named = join(project, name);
  writeFileSync(named, "ffconcat version 1.0\nfile 'list.m3u8'\nduration 2\n");
  return named;
}

const NOT_ON_WHITELIST = /not on whitelist/;
const ffmpegTest = (name, body) =>
  test(name, { skip: !HAS_FFMPEG && "ffmpeg and ffprobe are not installed" }, body);

ffmpegTest("dither refuses a list named as media and writes nothing", async (t) => {
  const dir = sandbox(t);
  const out = join(dir, "dithered.mp4");
  const run = await runAsync("skills/media-use/scripts/dither.mjs", [
    ...["--input", listNamedAsMedia(dir, "video_001.mp4"), "--out", out, "--json"],
  ]);
  assert.notEqual(run.code, 0, run.output);
  assert.match(run.output, NOT_ON_WHITELIST);
  assert.equal(existsSync(out), false);
});

ffmpegTest("transcript-cut refuses a list named as media and writes nothing", async (t) => {
  const dir = sandbox(t);
  const transcript = join(dir, "transcript.json");
  writeFileSync(transcript, JSON.stringify({ words: [{ text: "tone", start: 0, end: 2 }] }));
  const out = join(dir, "cut", "cut.mp4");
  const run = await runAsync("skills/media-use/scripts/transcript-cut.mjs", [
    ...["--input", listNamedAsMedia(dir, "video_001.mp4"), "--transcript", transcript],
    ...["--keep", "0-1", "--out", out],
  ]);
  assert.notEqual(run.code, 0, run.output);
  assert.match(run.output, NOT_ON_WHITELIST);
  assert.equal(existsSync(join(dir, "cut")), false);
});

ffmpegTest("verify-motion refuses a list named as media", async (t) => {
  const dir = sandbox(t);
  const reference = listNamedAsMedia(dir, "ref.mp4");
  const run = await runAsync("skills/figma/scripts/verify-motion.mjs", [
    ...["--reference", reference, "--render", join(dir, "elsewhere", "clip.ts")],
  ]);
  assert.notEqual(run.code, 0, run.output);
  assert.match(run.output, NOT_ON_WHITELIST);
});

ffmpegTest("locate refuses a list named as an image and writes nothing", async (t) => {
  const dir = sandbox(t);
  const out = join(dir, "check.png");
  const run = await runAsync("skills/hyperframes/scripts/locate.mjs", [
    ...["mark", listNamedAsMedia(dir, "logo.png"), "--box", "0,0,0.5,0.5", "--out", out],
  ]);
  assert.notEqual(run.code, 0, run.output);
  assert.match(run.output, NOT_ON_WHITELIST);
  assert.equal(existsSync(out), false);
});

ffmpegTest(
  "locate and verify-motion read URL arguments as local names and request nothing",
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
    const image = join(dir, "still.png");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=s=64x48",
      "-frames:v",
      "1",
      image,
    ]);
    const runs = [
      await runAsync("skills/hyperframes/scripts/locate.mjs", [
        ...["mark", `${base}/logo.png`, "--box", "0,0,0.5,0.5", "--out", join(dir, "check.png")],
      ]),
      await runAsync(
        "skills/hyperframes/scripts/locate.mjs",
        ["mark", image, "--box", "0,0,0.5,0.5", "--out", `${base}/check.png`],
        { cwd: dir },
      ),
      await runAsync("skills/figma/scripts/verify-motion.mjs", [
        ...["--reference", `${base}/ref.mp4`, "--render", `${base}/out.mp4`],
      ]),
    ];
    assert.deepEqual(requests, []);
    for (const run of [runs[0], runs[2]]) assert.notEqual(run.code, 0, run.output);
  },
);

const EXTRACT_AUDIO = "skills/media-use/audio/scripts/extract-audio-data.py";
const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import numpy"], { stdio: "ignore" }).status === 0,
);

test("extract-audio-data reads with the same reader list and pattern checks as the scripts' lib", () => {
  const py = readFileSync(script(EXTRACT_AUDIO), "utf8");
  const js = readFileSync(script("skills/hyperframes/scripts/lib/literal-media-input.mjs"), "utf8");
  assert.equal(/^SELF_CONTAINED_FORMATS = "([^"]+)"/m.exec(py)?.[1], SELF_CONTAINED_FORMATS);
  for (const name of ["PATTERN_IMAGE2_EXPANDS", "WILDCARD_MAKES_ANY_PERCENT_A_PATTERN"]) {
    const inJs = new RegExp(`const ${name} = /(.+)/;`).exec(js)?.[1];
    const inPy = new RegExp(`^${name} = re\\.compile\\(r"(.+)"\\)$`, "m").exec(py)?.[1];
    assert.ok(inJs, name);
    assert.equal(inPy, inJs, name);
  }
});

test(
  "extract-audio-data refuses a list named as media, and a name ffmpeg reads as a pattern",
  { skip: (!HAS_FFMPEG || !python) && "ffmpeg or python with numpy is not installed" },
  async (t) => {
    const dir = sandbox(t);
    const out = join(dir, "audio-data.json");
    const listed = await promisify(execFile)(python, [
      script(EXTRACT_AUDIO),
      listNamedAsMedia(dir, "in.mp3"),
      "-o",
      out,
    ]).then(
      () => ({ code: 0, output: "" }),
      (error) => ({ code: error.code, output: `${error.stderr}` }),
    );
    assert.notEqual(listed.code, 0);
    assert.match(listed.output, NOT_ON_WHITELIST);
    assert.equal(existsSync(out), false);

    const patterned = spawnSync(
      python,
      [script(EXTRACT_AUDIO), patternFile(dir, "take%d.wav"), "-o", out],
      {
        encoding: "utf8",
      },
    );
    assert.notEqual(patterned.status, 0);
    assert.match(patterned.stderr, PATTERN);
    assert.equal(existsSync(out), false);
  },
);

// ffmpeg and ffprobe stand-ins that log each call's arguments and run the real program, so a script runs
// its whole ordinary path and every read it makes can be checked, not only the first one that refuses.
function recordingPath(dir) {
  const bin = join(dir, "bin");
  const logs = join(dir, "calls");
  mkdirSync(bin);
  mkdirSync(logs);
  for (const name of ["ffmpeg", "ffprobe"]) {
    const real = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
    const stub = join(bin, name);
    writeFileSync(
      stub,
      `#!/bin/sh\nlog=$(mktemp '${logs}/call.XXXXXX')\nfor a in "$@"; do printf '%s\\t' "$a"; done > "$log"\nexec '${real}' "$@"\n`,
    );
    chmodSync(stub, 0o755);
  }
  return {
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    calls: () =>
      readdirSync(logs).map((file) =>
        readFileSync(join(logs, file), "utf8").split("\t").slice(0, -1),
      ),
  };
}

/** Every argument naming one of `inputs` has the file-only protocol and the reader list before it, since its previous input. */
function unpinnedReads(calls, inputs) {
  const unpinned = [];
  for (const args of calls) {
    let segmentStart = 0;
    args.forEach((arg, index) => {
      if (!inputs.includes(arg)) return;
      const segment = args.slice(segmentStart, index);
      const at = segment.indexOf("-protocol_whitelist");
      const pinned =
        at !== -1 &&
        segment[at + 1] === "file" &&
        segment[segment.indexOf("-format_whitelist") + 1] === SELF_CONTAINED_FORMATS;
      if (!pinned) unpinned.push(args.join(" "));
      segmentStart = index + 1;
    });
  }
  return unpinned;
}

test(
  "every ffmpeg and ffprobe read of an input carries the reader limits, on each script's ordinary path",
  { skip: (!HAS_FFMPEG || process.platform === "win32") && "needs ffmpeg and a POSIX shell" },
  async (t) => {
    const dir = sandbox(t);
    const { env, calls } = recordingPath(dir);
    const clip = join(dir, "clip.mp4");
    const still = join(dir, "still.png");
    execFileSync("ffmpeg", [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10:duration=2"],
      ...["-f", "lavfi", "-i", "sine=duration=2", "-shortest", "-pix_fmt", "yuv420p", clip],
    ]);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x48",
      "-frames:v",
      "1",
      still,
    ]);
    const transcript = join(dir, "transcript.json");
    writeFileSync(transcript, JSON.stringify({ words: [{ text: "tone", start: 0, end: 2 }] }));
    const run = (path, args) =>
      promisify(execFile)(process.execPath, [script(path), ...args], { env, cwd: dir }).then(
        () => 0,
        (error) => `${error.stdout}${error.stderr}`,
      );
    const runs = {
      "dither video": await run("skills/media-use/scripts/dither.mjs", [
        "--input",
        clip,
        "--out",
        join(dir, "d.mp4"),
        "--json",
      ]),
      "dither image": await run("skills/media-use/scripts/dither.mjs", [
        "--input",
        still,
        "--out",
        join(dir, "d.png"),
        "--json",
      ]),
      "transcript-cut": await run("skills/media-use/scripts/transcript-cut.mjs", [
        ...[
          "--input",
          clip,
          "--transcript",
          transcript,
          "--keep",
          "0-1",
          "--out",
          join(dir, "c.mp4"),
        ],
      ]),
      "transcript-cut --copy": await run("skills/media-use/scripts/transcript-cut.mjs", [
        ...[
          "--input",
          clip,
          "--transcript",
          transcript,
          "--keep",
          "0-1",
          "--copy",
          "--out",
          join(dir, "k.mp4"),
        ],
      ]),
      "verify-motion": await run("skills/figma/scripts/verify-motion.mjs", [
        ...["--reference", clip, "--render", clip, "--interval", "0.5", "--min-motion-psnr", "0"],
      ]),
      "locate mark": await run("skills/hyperframes/scripts/locate.mjs", [
        ...["mark", still, "--box", "0,0,0.5,0.5", "--out", join(dir, "check.png")],
      ]),
    };
    for (const [name, result] of Object.entries(runs))
      assert.equal(result, 0, `${name}: ${result}`);
    if (python) {
      await promisify(execFile)(python, [script(EXTRACT_AUDIO), clip, "-o", join(dir, "a.json")], {
        env,
      });
    }
    const reads = calls().filter((args) => args.some((arg) => arg === clip || arg === still));
    assert.ok(
      reads.length >= 10,
      `expected every script's reads to be logged, saw ${reads.length}`,
    );
    assert.deepEqual(unpinnedReads(reads, [clip, still]), []);
  },
);
