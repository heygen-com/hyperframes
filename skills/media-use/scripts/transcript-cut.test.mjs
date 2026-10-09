import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./transcript-cut.mjs", import.meta.url));
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

const SAMPLE_RATE = 44100;
// A continuous tone's own slope between samples never exceeds amplitude * 2*pi*f/rate
// (~2054 for 440Hz at full scale here); a raw splice between two independently-cut
// points on the same tone lands at two unrelated phases, so an unfaded join jumps far
// past that. This threshold sits well above normal tone motion and well below a splice.
const MAX_CONTINUOUS_STEP = 6000;
const MIN_SUSPICIOUS_ZERO_RUN = 20;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "media-use-transcript-cut-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function writeTone(source) {
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=6:sample_rate=${SAMPLE_RATE}`,
    source,
  ]);
}

function readPcm(filePath) {
  const raw = execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    filePath,
    "-f",
    "s16le",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-",
  ]);
  const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  return samples;
}

for (const { name, edits, segments, duration } of [
  {
    name: "preserves the source tail when removing a filler",
    edits: ["--remove-fillers", "um"],
    segments: [
      { start: 0, end: 1 },
      { start: 1.5, end: 6 },
    ],
    duration: 5.5,
  },
  {
    name: "keeps an explicit range after the last spoken word",
    edits: ["--keep", "4-6"],
    segments: [{ start: 4, end: 6 }],
    duration: 2,
  },
]) {
  test(name, { skip: !HAS_FFMPEG }, (t) => {
    const { dir, cleanup } = fixture();
    t.after(cleanup);
    const source = join(dir, "tone.wav");
    writeTone(source);
    const transcriptPath = join(dir, "transcript.json");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        words: [
          { text: "hello", start: 0, end: 1 },
          { text: "um", start: 1, end: 1.5 },
          { text: "goodbye", start: 1.5, end: 4 },
        ],
      }),
    );
    const output = join(dir, "out.wav");
    const result = run([
      "--input",
      source,
      "--transcript",
      transcriptPath,
      ...edits,
      "--out",
      output,
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const status = JSON.parse(result.stdout);
    assert.deepEqual(status.segments, segments);
    assert.equal(status.kept_s, duration);
    assert.equal(status.total_s, 6);
    const plan = run(["--input", source, "--transcript", transcriptPath, ...edits, "--plan"]);
    assert.equal(plan.status, 0, plan.stderr || plan.stdout);
    assert.deepEqual(JSON.parse(plan.stdout), segments);
    const samples = readPcm(output);
    assert.equal(samples.length, duration * SAMPLE_RATE);
    assert.ok(samples.slice(-SAMPLE_RATE).some((sample) => Math.abs(sample) > 1000));
  });
}

test(
  "keeps a spliced tone continuous at every cut, with no raw phase jump or silence gap",
  { skip: !HAS_FFMPEG },
  (t) => {
    const { dir, cleanup } = fixture();
    t.after(cleanup);

    const source = join(dir, "tone.wav");
    writeTone(source);

    const transcriptPath = join(dir, "transcript.json");
    writeFileSync(transcriptPath, JSON.stringify({ words: [{ text: "tone", start: 0, end: 6 }] }));

    const output = join(dir, "out.wav");
    // Two "ugly" removal ranges: neither aligned to the 440Hz period, so the kept
    // segments' cut edges land at unrelated phases of the same continuous tone --
    // exactly the shape that clicks without a fade, and the shape jrusso1020's
    // review proved this branch never actually fades.
    const result = run([
      "--input",
      source,
      "--transcript",
      transcriptPath,
      "--remove",
      "1.37-1.83,3.29-3.71",
      "--out",
      output,
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const samples = readPcm(output);
    assert.ok(samples.length > SAMPLE_RATE, "expected several seconds of audio");

    let maxStep = 0;
    let zeroRun = 0;
    let maxZeroRun = 0;
    for (let i = 1; i < samples.length; i++) {
      const step = Math.abs(samples[i] - samples[i - 1]);
      if (step > maxStep) maxStep = step;
      if (samples[i] === 0) {
        zeroRun++;
        if (zeroRun > maxZeroRun) maxZeroRun = zeroRun;
      } else {
        zeroRun = 0;
      }
    }

    assert.ok(
      maxStep <= MAX_CONTINUOUS_STEP,
      `largest sample-to-sample step was ${maxStep}, expected <= ${MAX_CONTINUOUS_STEP} (a raw, unfaded splice)`,
    );
    assert.ok(
      maxZeroRun < MIN_SUSPICIOUS_ZERO_RUN,
      `found a run of ${maxZeroRun} consecutive zero samples, expected < ${MIN_SUSPICIOUS_ZERO_RUN} (a priming-silence gap)`,
    );
  },
);
