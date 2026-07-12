import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { analyzeMediaGrade, formatMeasuredNote, statsToAdjust } from "./grade-analyzer.mjs";

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

test("over-exposed synthetic frame pulls exposure and whites down", { skip: FFMPEG_SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-grade-over-"));
  try {
    const file = makeFrame(dir, "over.png", "white");
    const { adjust } = analyzeMediaGrade(file);
    assert.ok(adjust.exposure < 0, `expected negative exposure, got ${adjust.exposure}`);
    assert.ok(adjust.whites < 0, `expected negative whites, got ${adjust.whites}`);
    assertWithinLimits(adjust);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
  assert.match(note, /YAVG=80/);
  assert.equal(note.includes("\n"), false);
});
