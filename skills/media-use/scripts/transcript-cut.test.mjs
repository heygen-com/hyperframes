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

// Three kept ranges, none starting or ending on a frame boundary of any rate below.
const UNALIGNED_KEEP = "0.137-1.913,2.845-4.111,4.9-5.47";
const UNALIGNED_KEPT_SECONDS = 1.776 + 1.266 + 0.57;

function cutVideo(t, rate, keep = UNALIGNED_KEEP) {
  const { dir, cleanup } = fixture();
  t.after(cleanup);

  const source = join(dir, "source.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=160x90:rate=${rate}:duration=6`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=6:sample_rate=${SAMPLE_RATE}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    source,
  ]);

  const transcriptPath = join(dir, "transcript.json");
  writeFileSync(transcriptPath, JSON.stringify({ words: [{ text: "tone", start: 0, end: 6 }] }));

  const output = join(dir, "out.mp4");
  const result = run([
    "--input",
    source,
    "--transcript",
    transcriptPath,
    "--keep",
    keep,
    "--out",
    output,
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return output;
}

function readVideoTimestamps(filePath) {
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=time_base:packet=pts",
        "-of",
        "json",
        "--",
        filePath,
      ],
      { encoding: "utf8" },
    ),
  );
  const [tickNum, tickDen] = probe.streams[0].time_base.split("/").map(Number);
  // Packets come in decode order; B-frames put that out of presentation order.
  const pts = probe.packets.map((packet) => Number(packet.pts)).sort((a, b) => a - b);
  return { tickNum, tickDen, pts };
}

for (const rate of ["30", "30000/1001", "60"]) {
  test(
    `puts every frame of a ${rate} fps video cut on the frame grid, with no gaps`,
    { skip: !HAS_FFMPEG },
    (t) => {
      const [rateNum, rateDen = 1] = rate.split("/").map(Number);
      const { tickNum, tickDen, pts } = readVideoTimestamps(cutVideo(t, rate));
      assert.ok(pts.length > rateNum / rateDen, "expected several seconds of video");

      // Frame i belongs at exactly i / rate seconds. Compared as integers, so a
      // timestamp rounded to the millisecond (0.067 for 2/30) cannot pass.
      const offGrid = pts.filter(
        (value, index) => value * tickNum * rateNum !== index * rateDen * tickDen,
      );
      assert.equal(
        offGrid.length,
        0,
        `${offGrid.length} of ${pts.length} frames are off the ${rate} fps grid (timestamps in units of ${tickNum}/${tickDen} s)`,
      );
    },
  );
}

test(
  "keeps the keyframes of a video cut no more than a second apart",
  { skip: !HAS_FFMPEG },
  (t) => {
    // One kept range of almost four seconds, so only the encoder decides where keyframes go.
    const output = cutVideo(t, "30", "0.137-4.111,4.9-5.47");
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "packet=pts_time,flags",
          "-of",
          "json",
          "--",
          output,
        ],
        { encoding: "utf8" },
      ),
    );
    const keyframes = probe.packets
      .filter((packet) => packet.flags.startsWith("K"))
      .map((packet) => Number(packet.pts_time))
      .sort((a, b) => a - b);
    const gaps = keyframes.slice(1).map((time, index) => time - keyframes[index]);
    const widest = Math.max(...gaps);
    // A frame of slack: the forced keyframe is the first frame at or after each second.
    assert.ok(widest < 1.05, `keyframes are up to ${widest.toFixed(3)}s apart`);
  },
);

test(
  "does not pad the audio of a video cut with encoder priming at each splice",
  { skip: !HAS_FFMPEG },
  (t) => {
    const seconds = readPcm(cutVideo(t, "30")).length / SAMPLE_RATE;
    // The single AAC encode may round the end up by a frame or two (23 ms each).
    // Encoding every segment separately instead adds about 25 ms per splice on top.
    assert.ok(
      Math.abs(seconds - UNALIGNED_KEPT_SECONDS) < 0.05,
      `audio runs ${seconds.toFixed(3)}s for ${UNALIGNED_KEPT_SECONDS.toFixed(3)}s kept`,
    );
  },
);

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

// Frame 32 at 30 fps sits at 1.0666666 s. A -ss rounded to 1.067 lands just past
// it, so ffmpeg's accurate seek starts that segment on frame 33 and the cut comes
// out a frame short from the join on.
const THIRTY_FPS_FRAME_32 = 32 / 30;

test("a kept range starting on a 30 fps frame keeps that frame", { skip: !HAS_FFMPEG }, (t) => {
  const { dir, cleanup } = fixture();
  t.after(cleanup);

  const source = join(dir, "src.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=${SAMPLE_RATE}`,
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    source,
  ]);

  const transcriptPath = join(dir, "transcript.json");
  writeFileSync(transcriptPath, JSON.stringify([{ text: "a", start: 0.1, end: 3.9 }]));

  const output = join(dir, "out.mp4");
  const result = run([
    "--input",
    source,
    "--transcript",
    transcriptPath,
    "--keep",
    `0-1,${THIRTY_FPS_FRAME_32}-3`,
    "--out",
    output,
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  // Frames 0-29 for 0-1s, then frames 32-89 for the second segment. Rounding
  // -ss to the millisecond drops frame 32 and yields 87.
  const frames = Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v",
        "-count_packets",
        "-show_entries",
        "stream=nb_read_packets",
        "-of",
        "csv=p=0",
        "--",
        output,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
  assert.equal(frames, 88, `expected 88 frames, got ${frames}`);
});
