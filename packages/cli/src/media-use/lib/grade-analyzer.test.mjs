import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  analyzeMediaGrade,
  formatMeasuredNote,
  parseMediaTreatmentSignalStats,
  statsToAdjust,
  summarizeMediaTreatmentAnalysis,
} from "./grade-analyzer.mjs";

const SIGNALSTATS = `frame:0 pts:0 pts_time:0
lavfi.signalstats.YMIN=0
lavfi.signalstats.YLOW=8
lavfi.signalstats.YAVG=100
lavfi.signalstats.YHIGH=240
lavfi.signalstats.YMAX=255
lavfi.signalstats.UAVG=120
lavfi.signalstats.VAVG=140
lavfi.signalstats.SATAVG=40
frame:1 pts:2000 pts_time:2
lavfi.signalstats.YMIN=10
lavfi.signalstats.YLOW=20
lavfi.signalstats.YAVG=130
lavfi.signalstats.YHIGH=220
lavfi.signalstats.YMAX=245
lavfi.signalstats.UAVG=130
lavfi.signalstats.VAVG=125
lavfi.signalstats.SATAVG=60`;

// The "Test: skills" CI job runs bare `node --test` with no ffmpeg on PATH (by
// design — skills tests are meant to be node-builtin-only). Tests that shell to
// ffmpeg skip there and run wherever ffmpeg is present (locally, dev).
const FFMPEG_SKIP =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0
    ? false
    : "ffmpeg not on PATH";

const ADJUST_LIMITS = {
  exposure: { min: -2, max: 2 },
  contrast: { min: -1, max: 1 },
  highlights: { min: -1, max: 1 },
  shadows: { min: -1, max: 1 },
  whites: { min: -1, max: 1 },
  blacks: { min: -1, max: 1 },
  temperature: { min: -1, max: 1 },
  tint: { min: -1, max: 1 },
  vibrance: { min: -1, max: 1 },
  saturation: { min: -1, max: 1 },
};

function makeFrame(dir, name, color) {
  const out = join(dir, name);
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=64x64`,
      "-frames:v",
      "1",
      "-y",
      out,
    ],
    { stdio: "pipe" },
  );
  return out;
}

function assertWithinLimits(adjust) {
  for (const [key, value] of Object.entries(adjust)) {
    const limit = ADJUST_LIMITS[key];
    assert.ok(limit, `unexpected adjust key ${key}`);
    assert.ok(value >= limit.min && value <= limit.max, `${key} out of range: ${value}`);
  }
}

test("under-exposed synthetic frame suggests positive exposure", { skip: FFMPEG_SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-grade-under-"));
  try {
    const file = makeFrame(dir, "under.png", "0x202020");
    const { adjust, measured } = analyzeMediaGrade(file);
    assert.ok(measured.frames >= 1);
    assert.ok(adjust.exposure > 0, `expected positive exposure, got ${adjust.exposure}`);
    assertWithinLimits(adjust);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "over-exposed synthetic frame pulls exposure down without inventing clipping",
  { skip: FFMPEG_SKIP },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mu-grade-over-"));
    try {
      const file = makeFrame(dir, "over.png", "white");
      const { adjust } = analyzeMediaGrade(file);
      assert.ok(adjust.exposure < 0, `expected negative exposure, got ${adjust.exposure}`);
      assert.ok(adjust.whites <= 0, `expected non-positive whites, got ${adjust.whites}`);
      assertWithinLimits(adjust);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "warm-cast synthetic frame suggests negative temperature correction",
  { skip: FFMPEG_SKIP },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mu-grade-warm-"));
    try {
      const file = makeFrame(dir, "warm.png", "orange");
      const { adjust } = analyzeMediaGrade(file);
      assert.ok(adjust.temperature < 0, `expected cooling correction, got ${adjust.temperature}`);
      assertWithinLimits(adjust);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("low-spread stats suggest positive contrast", () => {
  const { adjust } = statsToAdjust({
    frames: 1,
    yMin: 104,
    yMax: 116,
    yAvg: 110,
    uAvg: 128,
    vAvg: 128,
  });
  assert.ok(adjust.contrast > 0, `expected positive contrast, got ${adjust.contrast}`);
  assertWithinLimits(adjust);
});

test("malformed media fails cleanly", () => {
  assert.throws(
    () => analyzeMediaGrade(join(tmpdir(), "does-not-exist.png")),
    /grade analysis failed/,
  );
});

test(
  "media path with shell metacharacters is passed as argv, not a shell string",
  {
    skip: FFMPEG_SKIP,
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mu-grade-shell-"));
    const sentinel = join(process.cwd(), "mu-grade-shell-sentinel.png");
    try {
      if (existsSync(sentinel)) unlinkSync(sentinel);
      const file = makeFrame(dir, "frame; touch mu-grade-shell-sentinel.png", "orange");
      const result = analyzeMediaGrade(file);
      assert.ok(result.measured.frames >= 1);
      assert.equal(existsSync(sentinel), false);
    } finally {
      if (existsSync(sentinel)) unlinkSync(sentinel);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("measured note is a stderr-safe single-line summary", () => {
  const note = formatMeasuredNote("/tmp/frame.png", {
    frames: 1,
    yMin: 10,
    yMax: 240,
    yAvg: 80,
    uAvg: 120,
    vAvg: 140,
  });
  assert.match(note, /^media-use: measured /);
  assert.match(note, /YMIN=10/);
  assert.match(note, /YMAX=240/);
  assert.match(note, /YAVG=80/);
  assert.equal(note.includes("\n"), false);
});

test("parses deterministic FFmpeg signalstats frames", () => {
  const frames = parseMediaTreatmentSignalStats(SIGNALSTATS);
  assert.equal(frames.length, 2);
  assert.deepEqual(
    {
      ptsTime: frames[0]?.ptsTime,
      YLOW: frames[0]?.YLOW,
      YAVG: frames[0]?.YAVG,
      YHIGH: frames[0]?.YHIGH,
      SATAVG: frames[0]?.SATAVG,
    },
    { ptsTime: 0, YLOW: 8, YAVG: 100, YHIGH: 240, SATAVG: 40 },
  );
});

test("keeps adjust output while adding HDR metadata and warnings", () => {
  const result = summarizeMediaTreatmentAnalysis(
    {
      duration: 4,
      colorSpace: "bt2020nc",
      transfer: "smpte2084",
      primaries: "bt2020",
      pixelFormat: "yuv420p10le",
    },
    parseMediaTreatmentSignalStats(SIGNALSTATS),
  );

  assert.deepEqual(
    {
      blacks: result.adjust.blacks,
      whites: result.adjust.whites,
      frames: result.measured.frames,
      yLow: result.measured.yLow,
      yHigh: result.measured.yHigh,
      satAvg: result.measured.satAvg,
      shadowClipRisk: result.measured.shadowClipRisk,
      highlightClipRisk: result.measured.highlightClipRisk,
    },
    {
      blacks: 0.04,
      whites: -0.04,
      frames: 2,
      yLow: 14,
      yHigh: 230,
      satAvg: 50,
      shadowClipRisk: 0.5,
      highlightClipRisk: 0.5,
    },
  );
  assert.equal(result.source.hdr, true);
  assert.equal(result.source.log, "unknown");
  assert.match(result.warnings[0] ?? "", /HDR/);
});

test("does not force middle-gray exposure onto healthy intentional contrast", () => {
  const result = summarizeMediaTreatmentAnalysis(
    {
      duration: 4,
      colorSpace: "bt709",
      transfer: "bt709",
      primaries: "bt709",
      pixelFormat: "yuv420p",
    },
    [
      {
        YMIN: 20,
        YLOW: 42,
        YAVG: 122,
        YHIGH: 190,
        YMAX: 220,
        UAVG: 128,
        VAVG: 128,
        SATAVG: 40,
      },
      {
        YMIN: 18,
        YLOW: 38,
        YAVG: 118,
        YHIGH: 196,
        YMAX: 225,
        UAVG: 128,
        VAVG: 128,
        SATAVG: 42,
      },
    ],
  );

  assert.deepEqual(
    {
      exposure: result.adjust.exposure,
      blacks: result.adjust.blacks,
      whites: result.adjust.whites,
      temperature: result.adjust.temperature,
      tint: result.adjust.tint,
    },
    { exposure: 0, blacks: 0, whites: 0, temperature: 0, tint: 0 },
  );
});
