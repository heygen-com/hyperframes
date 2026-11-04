import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import type { AudioCapability, Moments, Onsets } from "@hyperframes/core/audio-analysis";
import type { MarkedBeats } from "./analyze.js";
import { formatReport } from "./format.js";
import { analyzeTargets, previewTarget } from "./run.js";

const RATE = 48_000;
const dir = mkdtempSync(join(tmpdir(), "hf-audio-run-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stereo 32-bit float WAV of `seconds`, each sample from `fill`. */
function wav(
  name: string,
  seconds: number,
  fill: (t: number) => number,
  sampleRate = RATE,
): string {
  seed = 3;
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) {
    const v = fill(i / sampleRate);
    data.writeFloatLE(v, i * 8);
    data.writeFloatLE(v, i * 8 + 4);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const path = join(dir, name);
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}

let seed = 3; // every file starts the same noise, so no test depends on which ran before it
const noise = () =>
  ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648) * 2 - 1;
const hit = (at: number) => (t: number) =>
  t < at ? 0 : 0.8 * Math.exp(-(t - at) / 0.04) * noise();

const ffmpeg = findFfBinary("ffmpeg") && findFfBinary("ffprobe");

describe.skipIf(!ffmpeg)("analyzeTargets", () => {
  it("reports a file's moments and hits in file seconds, with its format", async () => {
    const path = wav("two-hits.wav", 2, (t) => hit(0.5)(t) + 0.5 * hit(1.3)(t));
    const report = await analyzeTargets([await previewTarget(path, "two-hits.wav", null)], {
      capabilities: ["moments", "onsets"],
    });
    const [item] = report.items;
    expect(item).toMatchObject({ sampleRate: RATE, channels: 2, element: null, placement: null });
    expect((item!.moments as Moments).onset).toBeCloseTo(0.5, 2);
    const hits = (item!.onsets as Onsets).events.map((e) => e.t);
    expect(hits.map((t) => Math.round(t * 100) / 100)).toEqual([0.5, 1.3]);
  });

  it("places a previewed file in the film and prints film seconds", async () => {
    const path = wav("one-hit.wav", 1, hit(0.25));
    const target = await previewTarget(path, "one-hit.wav", 4, 0.1);
    expect(target.placement).toEqual({
      start: 4,
      end: 4.9,
      dataStart: 4,
      mediaStart: 0.1,
      playbackRate: 1,
      volume: 1,
    });
    const report = await analyzeTargets([target], { capabilities: ["moments"] });
    expect((report.items[0]!.moments as Moments).onset).toBeCloseTo(0.25, 2);
    expect(formatReport(report)).toMatch(/onset 4\.1[45]\d/);
  });

  it("warns when the seconds skipped from a placed file held its loudest moment, and refuses to skip all of it", async () => {
    const path = wav("late-cut.wav", 1, hit(0.1));
    const report = await analyzeTargets([await previewTarget(path, "late-cut.wav", 2, 0.3)], {
      capabilities: ["moments"],
    });
    expect(report.items[0]!.warnings).toEqual([
      "the loudest part of late-cut.wav is in the first 0.3 s, which is skipped",
    ]);
    const kept = await analyzeTargets([await previewTarget(path, "late-cut.wav", 2, 0.05)], {
      capabilities: ["moments"],
    });
    expect(kept.items[0]!.warnings).toEqual([]);
    await expect(previewTarget(path, "late-cut.wav", 2, 1)).rejects.toThrow(/leaves nothing/);
  });

  it("warns when the loudest hit is only inside the margin before the kept window", async () => {
    const tone = (at: number, gain: number) => (t: number) =>
      t < at || t >= at + 0.03 ? 0 : gain * Math.sin(2 * Math.PI * 1000 * t);
    const path = wav("margin.wav", 2.4, (t) => tone(0.502, 0.8)(t) + tone(1.202, 0.25)(t));
    const warned = async (skip: number) =>
      (
        await analyzeTargets([await previewTarget(path, "margin.wav", 4, skip)], {
          capabilities: ["moments"],
        })
      ).items[0]!.warnings;
    expect(await warned(0.55)).toEqual([
      "the loudest part of margin.wav is in the first 0.55 s, which is skipped",
    ]);
    expect(await warned(0.65)).toEqual([
      "the loudest part of margin.wav is in the first 0.65 s, which is skipped",
    ]);
  });

  it.each([1, 1800])(
    "measures a long recording after skipping %s seconds and warns about its louder head",
    async (skip) => {
      const file = `long-${skip}.wav`;
      const path = wav(file, 1802, (t) => (t < skip ? 0.5 : 0.25), 100);
      const report = await analyzeTargets([await previewTarget(path, file, 4, skip)], {
        capabilities: ["moments"],
      });

      expect(report.items[0]).toMatchObject({
        duration: 1802,
        window: { from: skip, to: 1802 },
        moments: { onset: skip },
        warnings: [`the loudest part of ${file} is in the first ${skip} s, which is skipped`],
      });
      expect(report.items[0]?.error).toBeUndefined();
    },
  );

  it("finds no hit where a window cuts into a sound that is already playing", async () => {
    const chord = (t: number) =>
      Array.from({ length: 40 }, (_, k) => Math.sin(2 * Math.PI * 110 * (k + 1) * t + k)).reduce(
        (a, b) => a + b,
      ) / 40;
    const path = wav("bed.wav", 3, (t) => 0.9 * chord(t) + 0.125 * hit(2)(t));
    const report = await analyzeTargets(
      [
        {
          path,
          file: "bed.wav",
          ref: "#bed",
          kind: "audio",
          placement: null,
          window: { from: 1, seconds: 1.5 },
        },
      ],
      { capabilities: ["onsets"] },
    );
    const hits = (report.items[0]!.onsets as Onsets).events.map((e) => e.t);
    expect(hits.some((t) => Math.abs(t - 2) < 0.01)).toBe(true);
    expect(hits.filter((t) => Math.abs(t - 2) >= 0.01)).toEqual([]);
  });

  it("judges a clip's kind on all it plays, not on the slice a range query covers", async () => {
    const bed = (t: number) =>
      0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.6 * hit(0)(t % 0.5) + 0.05 * noise();
    const path = wav("music-bed.wav", 12, bed);
    const target = (clip?: { from: number; seconds: number }) => ({
      path,
      file: "music-bed.wav",
      ref: "#music",
      kind: "audio" as const,
      placement: null,
      window: { from: 3, seconds: 1.7 },
      ...(clip && { clip }),
    });
    const slice = await analyzeTargets([target()], { capabilities: ["kind"] });
    expect((slice.items[0]!.kind as { value: string }).value).not.toBe("music");
    const report = await analyzeTargets(
      [target({ from: 0, seconds: 12 })],
      {
        capabilities: ["kind", "moments"],
      },
      true,
    );
    expect(report.items[0]!.kind).toMatchObject({ features: { duration: 12 } });
    expect(report.items[0]!.ladder?.kind).toEqual([{ provider: "signal", outcome: "answered" }]);
    const unavailable = await analyzeTargets(
      [target({ from: 0, seconds: 12 })],
      {
        capabilities: ["kind"],
        provider: { kind: "missing" },
      },
      true,
    );
    expect(unavailable.items[0]!.warnings.length).toBeGreaterThan(0);
    expect(unavailable.items[0]!.ladder?.kind?.length).toBeGreaterThan(0);
    expect((report.items[0]!.kind as { value: string }).value).toBe("music");
    expect(report.items[0]!.window).toEqual({ from: 3, to: 4.7 });
    const windowOnly = await analyzeTargets([target()], { capabilities: ["moments"] });
    expect(report.items[0]!.moments).toEqual(windowOnly.items[0]!.moments);
  });

  it("reads a window's beats, bars and tempo off the whole clip, so a short window still has them", async () => {
    const path = wav("click-bed.wav", 16, (t) => hit(0)(t % 0.5));
    const clip = { from: 0, seconds: 16 };
    const at = (window: { from: number; seconds: number }, withClip: boolean) => ({
      path,
      file: "click-bed.wav",
      ref: "#bed",
      kind: "audio" as const,
      placement: null,
      window,
      ...(withClip && { clip }),
    });
    const request = { capabilities: ["beats", "downbeats", "bpm"] as AudioCapability[] };
    const [whole, windowed, alone] = await Promise.all([
      analyzeTargets([at(clip, true)], request),
      analyzeTargets([at({ from: 6, seconds: 3 }, true)], request),
      analyzeTargets([at({ from: 6, seconds: 3 }, false)], request),
    ]);
    const beatsOf = (report: typeof whole) => report.items[0]!.beats as MarkedBeats;
    const inWindow = (t: number) => t >= 6 && t < 9;
    expect(beatsOf(alone).times).toEqual([]);
    expect(beatsOf(windowed).times.length).toBeGreaterThanOrEqual(5);
    expect(beatsOf(windowed).times).toEqual(beatsOf(whole).times.filter(inWindow));
    expect(beatsOf(windowed).unheard).toEqual(beatsOf(windowed).times.map(() => false));
    expect((windowed.items[0]!.downbeats as MarkedBeats).times).toEqual(
      (whole.items[0]!.downbeats as MarkedBeats).times.filter(inWindow),
    );
    expect((windowed.items[0]!.bpm as { value: number }).value).toBeCloseTo(120, 0);
    expect(windowed.items[0]!.window).toEqual({ from: 6, to: 9 });
  });

  it("answers no steady beat, and no tempo, for a window where only noise plays", async () => {
    // noise() repeats in a short cycle, which reads as a pulse; hiss needs a generator that does not
    let state = 0x9e3779b9;
    const hiss = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 2 ** 31 - 1;
    };
    const path = wav("hiss-gap.wav", 24, (t) =>
      t >= 8 && t < 16 ? 0.05 * hiss() : hit(0)(t % 0.5),
    );
    const target = {
      path,
      file: "hiss-gap.wav",
      ref: "#bed",
      kind: "audio" as const,
      placement: null,
      // 6 s: long enough that the window's own reading is "no steady beat", not "too short"
      window: { from: 9, seconds: 6 },
      clip: { from: 0, seconds: 24 },
    };
    const [item] = (await analyzeTargets([target], { capabilities: ["beats", "downbeats", "bpm"] }))
      .items;
    expect(item!.beats).toMatchObject({ times: [], reason: "no steady beat" });
    expect((item!.downbeats as MarkedBeats).times).toEqual([]);
    expect(item!.bpm).toEqual({ value: null, curve: [] });
  });

  it("reads a section far quieter than the clip's loudest from the window itself, as before", async () => {
    // loud clicks for 10 s, then the same clicks 40 dB under them: the clip's grid has no beats there
    const quiet = 10 ** (-40 / 20);
    const path = wav("quiet-section.wav", 30, (t) => (t < 10 ? 1 : quiet) * hit(0)(t % 0.5));
    const at = (clip: { from: number; seconds: number } | null) => ({
      path,
      file: "quiet-section.wav",
      ref: "#bed",
      kind: "audio" as const,
      placement: null,
      window: { from: 14, seconds: 8 },
      ...(clip && { clip }),
    });
    const request = { capabilities: ["beats", "bpm"] as AudioCapability[] };
    const [withClip, alone] = await Promise.all([
      analyzeTargets([at({ from: 0, seconds: 30 })], request),
      analyzeTargets([at(null)], request),
    ]);
    const beats = withClip.items[0]!.beats as MarkedBeats;
    expect(beats.times.length).toBeGreaterThanOrEqual(15);
    expect(beats.times).toEqual((alone.items[0]!.beats as MarkedBeats).times);
    expect((withClip.items[0]!.bpm as { value: number }).value).toBeCloseTo(120, 0);
  });

  it.each([
    { from: 1, seconds: 8, duration: 8 },
    { from: 11, seconds: 3, duration: 1 },
  ])(
    "keeps kind inside the played source span $from + $seconds, bounded by EOF",
    async ({ from, seconds, duration }) => {
      const path = wav("trimmed.wav", 12, (t) => 0.3 * Math.sin(2 * Math.PI * 200 * t));
      const target = {
        path,
        file: "trimmed.wav",
        ref: "#trimmed",
        kind: "audio" as const,
        placement: null,
        clip: { from, seconds },
        window: { from: from + 0.2, seconds: 0.3 },
      };
      const [whole, slice] = await Promise.all([
        analyzeTargets([{ ...target, window: target.clip }], { capabilities: ["kind"] }),
        analyzeTargets([target], { capabilities: ["kind"] }),
      ]);
      expect(slice.items[0]!.kind).toMatchObject({ features: { duration } });
      expect(slice.items[0]!.kind).toEqual(whole.items[0]!.kind);
    },
  );

  it("reports a file it cannot read on that item and goes on to the next", async () => {
    const broken = join(dir, "notes.txt");
    writeFileSync(broken, "not audio");
    const good = wav("good.wav", 0.5, hit(0.1));
    const report = await analyzeTargets(
      [await previewTarget(broken, "notes.txt", null), await previewTarget(good, "good.wav", null)],
      { capabilities: ["moments"] },
    );
    expect(report.items[0]!.error).toMatch(/^could not read: /);
    expect(report.items[1]!.moments).not.toBeNull();
  });
});
