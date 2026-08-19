import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processCompositionAudio } from "./audioMixer.js";
import type { AudioElement } from "./audioMixer.types.js";

/**
 * Real-FFmpeg regression test for the pad/trim branch template.
 *
 * `apad,atrim=0:<total>` — an indefinite pad bounded by a downstream trim —
 * behaves on FFmpeg 4.2.7 and misbehaves on 7.0.2 and newer: audio leaks to
 * `t=0` from three mixed branches onward, and from four branches onward the
 * branch with the largest `adelay` disappears from the mix. Nothing errors;
 * the render succeeds with wrong audio, which is why only an output
 * measurement catches it.
 *
 * Three or fewer clips is not enough — the dropped-branch half of the bug does
 * not appear until four. This mixes five.
 */

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const TOTAL_SECONDS = 43.3;

/** start (s), source duration (s), tone frequency (Hz) */
const CLIPS = [
  { start: 0.3, duration: 7.01, frequency: 400 },
  { start: 19.6, duration: 0.4, frequency: 1000 },
  { start: 20.6, duration: 0.4, frequency: 1200 },
  { start: 30.0, duration: 0.4, frequency: 1500 },
  { start: 40.0, duration: 0.4, frequency: 1800 },
] as const;

/**
 * Mean RMS in dB over a 250ms window starting at `atSeconds`. Digital silence
 * reports `-inf`, which is the signal for "this branch is not in the mix".
 */
function rmsDb(path: string, atSeconds: number): number {
  const probe = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "info",
      "-ss",
      atSeconds.toFixed(3),
      "-t",
      "0.25",
      "-i",
      path,
      "-af",
      "astats=metadata=1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const stderr = probe.stderr ?? "";
  const overall = stderr.slice(stderr.lastIndexOf("Overall"));
  const match = /RMS level dB:\s*(\S+)/.exec(overall);
  if (!match) throw new Error(`astats reported no RMS level for ${path} at ${atSeconds}s`);
  const raw = match[1]!;
  return raw.endsWith("inf") ? (raw.startsWith("-") ? -Infinity : Infinity) : Number.parseFloat(raw);
}

describe.skipIf(!hasFfmpeg)("mixed audio branch padding", () => {
  it("keeps t=0 silent and lands all five staggered clips at their offsets", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-padts-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-padts-work-"));
    dirs.push(baseDir, workDir);

    const elements: AudioElement[] = CLIPS.map((clip, i) => {
      const src = `clip-${i}.wav`;
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${clip.frequency}:duration=${clip.duration}`,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-y",
        join(baseDir, src),
      ]);
      return {
        id: `clip-${i}`,
        src,
        start: clip.start,
        end: clip.start + clip.duration,
        mediaStart: 0,
        layer: 0,
        volume: 1,
        type: "audio",
      };
    });

    const outputPath = join(baseDir, "out.m4a");
    const result = await processCompositionAudio(
      elements,
      baseDir,
      workDir,
      outputPath,
      TOTAL_SECONDS,
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.tracksProcessed).toBe(CLIPS.length);

    // The earliest clip starts at 0.3s, so the head of the mix is silence.
    // The bug puts every clip's audio here at once, ~-29 dB.
    expect(rmsDb(outputPath, 0)).toBeLessThan(-60);

    // Every clip is audible at its own offset. `-Infinity` here means the
    // branch is missing from the mix entirely, which is the second half of
    // the bug and only shows from four branches onward.
    for (const clip of CLIPS) {
      expect(rmsDb(outputPath, clip.start + 0.02)).toBeGreaterThan(-45);
    }
  }, 120_000);
});
