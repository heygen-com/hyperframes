/**
 * Encodes real image files and decodes the result. The argument-level tests cannot catch what this
 * does: FFmpeg rounds a concat list's timestamps to a time base chosen from its inputs, so a list that
 * looks right can still drop and repeat frames. At 60 fps, 60 distinct images once came out as 62
 * frames showing 26 of them; at 24 fps the same code was exact, which is how it went unnoticed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { encodeSequence } from "./initTimelineSequence.js";

const ffmpeg = findFFmpeg();
const ffprobe = findFFprobe();
const available = ffmpeg !== undefined && ffprobe !== undefined;

const IMAGES = 60;
let folder: string;
let images: string[]; // IMAGES distinct gray levels

/** The average gray of each frame ffmpeg decodes from `input`, after the same colour conversion the encoder applies. */
function frameMeans(input: string[], filter: string): number[] {
  const raw = execFileSync(
    ffmpeg ?? "ffmpeg",
    ["-v", "error", ...input, "-vf", filter, "-f", "rawvideo", "-"],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const means: number[] = [];
  for (let at = 0; at + 64 <= raw.length; at += 64) {
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += raw[at + i] ?? 0;
    means.push(sum / 64);
  }
  return means;
}

/** What each source image looks like once decoded (the codec is lossy, so frames are matched to these, not to a formula). */
let expected: number[];

/** Which source image each frame of a video shows: the nearest one by gray level. */
function decodeLevels(video: string): number[] {
  return frameMeans(["-i", video], "scale=8:8,format=gray").map((mean) => {
    let best = 0;
    for (let i = 1; i < expected.length; i++) {
      if (Math.abs((expected[i] ?? 0) - mean) < Math.abs((expected[best] ?? 0) - mean)) best = i;
    }
    return best;
  });
}

function durationOf(video: string): number {
  return Number(
    execFileSync(ffprobe ?? "ffprobe", [
      ...["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "--", video],
    ])
      .toString()
      .trim(),
  );
}

const encode = (files: string[], rate: number, name: string) => {
  const out = join(folder, name);
  expect(encodeSequence(files, rate, out)).toBe(true);
  return out;
};

describe.skipIf(!available)("encodeSequence on real images", () => {
  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), "hf-seq-encode-"));
    mkdirSync(join(folder, "img"));
    // One call writes 60 solid images, each 3.6 gray levels brighter than the last and all above video black.
    execFileSync(ffmpeg ?? "ffmpeg", [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=60"],
      ...["-vf", "geq=lum='20+3.6*N':cb=128:cr=128", "-frames:v", String(IMAGES)],
      join(folder, "img", "f%03d.png"),
    ]);
    images = readdirSync(join(folder, "img"))
      .sort()
      .map((name) => join(folder, "img", name));
    expected = frameMeans(
      ["-i", join(folder, "img", "f%03d.png")],
      "format=yuv420p,scale=8:8,format=gray",
    );
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("starts from the right test data: 60 images the decoder can tell apart", () => {
    expect(images).toHaveLength(IMAGES);
    expect(expected).toHaveLength(IMAGES);
    const gaps = expected.slice(1).map((level, i) => level - (expected[i] ?? 0));
    // Frames are matched to the nearest image, so a gap of three times the codec's error on a flat image (about 0.5) is enough.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1.5);
  });

  it.each([23.976023976, 24, 25, 29.97002997, 30, 48, 50, 59.94005994, 60])(
    "plays 60 distinct images at %s fps as exactly 60 frames, in order, of the right length",
    (rate) => {
      const video = encode(images, rate, `plain-${rate}.mp4`);
      const levels = decodeLevels(video);
      expect(levels).toEqual(Array.from({ length: IMAGES }, (_, i) => i));
      expect(Math.abs(durationOf(video) - IMAGES / rate)).toBeLessThan(0.5 / rate);
    },
  );

  it("holds an image for as many frames as it is listed", () => {
    // Each of the first 20 images twice, then one three times, then the next 5 once: 20*2 + 3 + 5 = 48.
    const list = [
      ...images.slice(0, 20).flatMap((image) => [image, image]),
      ...[images[20], images[20], images[20]],
      ...images.slice(21, 26),
    ].filter((image): image is string => image !== undefined);
    const levels = decodeLevels(encode(list, 29.97002997, "held.mp4"));
    const expected = [
      ...Array.from({ length: 20 }, (_, i) => [i, i]).flat(),
      20,
      20,
      20,
      ...[21, 22, 23, 24, 25],
    ];
    expect(levels).toEqual(expected);
  });

  it("repeats one image the whole way", () => {
    const first = images[0];
    expect(first).toBeDefined();
    const levels = decodeLevels(encode(Array(30).fill(first), 60, "same.mp4"));
    expect(levels).toEqual(Array(30).fill(0));
  });

  it("encodes a single image as a single frame", () => {
    const first = images[5];
    expect(first).toBeDefined();
    expect(decodeLevels(encode([first ?? ""], 24, "one.mp4"))).toEqual([5]);
  });

  it("goes back and forth between images without losing a frame (a ping-pong)", () => {
    const forward = images.slice(0, 10);
    const list = [...forward, ...[...forward].reverse().slice(1, -1), ...forward];
    const levels = decodeLevels(encode(list, 59.94005994, "pingpong.mp4"));
    expect(levels).toEqual([
      ...Array.from({ length: 10 }, (_, i) => i),
      ...[8, 7, 6, 5, 4, 3, 2, 1],
      ...Array.from({ length: 10 }, (_, i) => i),
    ]);
  });
});
