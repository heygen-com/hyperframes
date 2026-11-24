import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeAudio, probeAudio } from "../audio/analysis/decode.js";
import { probeSeconds, probeVideo, readFrames } from "../measure/media.js";
import { sampledAlphaIsFullyOpaque } from "./webmAlphaCheck.js";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const vp9 =
  ffmpeg && spawnSync("ffmpeg", ["-hide_banner", "-encoders"]).stdout.includes("libvpx-vp9");
const PATTERN = /read it as a pattern/;

const dir = mkdtempSync(join(tmpdir(), "hf-literal-inputs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function make(out: string, args: string[]): void {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args, out]);
}

describe.skipIf(!ffmpeg)("a sound whose path ffmpeg would read as a pattern", () => {
  const tone = join(dir, "tone.wav");
  const inPatternFolder = join(dir, "d%03d", "tone.wav");
  beforeAll(() => {
    make(tone, ["-f", "lavfi", "-i", "sine=d=0.5"]);
    mkdirSync(join(dir, "d%03d"));
    copyFileSync(tone, inPatternFolder);
  });

  it("is probed and decoded under a plain name", async () => {
    expect((await probeAudio(tone))?.sampleRate).toBe(44100);
    expect((await decodeAudio(tone))?.signal.channels[0]?.length).toBeGreaterThan(0);
  });

  it("is refused by the probe, with or without the caller's input arguments", async () => {
    await expect(probeAudio(inPatternFolder)).rejects.toThrow(PATTERN);
    await expect(probeAudio(inPatternFolder, ["-format_whitelist", "wav"])).rejects.toThrow(
      PATTERN,
    );
  });

  it("is refused by the decoder even when the caller passes a probe", async () => {
    const probed = await probeAudio(tone);
    await expect(decodeAudio(inPatternFolder, {}, probed ?? undefined)).rejects.toThrow(PATTERN);
  });

  it("is refused by measure's sound probe", () => {
    expect(probeSeconds(tone)).toBeGreaterThan(0);
    expect(() => probeSeconds(inPatternFolder)).toThrow(PATTERN);
  });
});

describe.skipIf(!ffmpeg)("a picture named like a numbered sequence", () => {
  const plain = join(dir, "frame.png");
  const pattern = join(dir, "a%d.png");
  beforeAll(() => {
    make(plain, ["-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1"]);
    copyFileSync(plain, join(dir, "a1.png"));
    copyFileSync(plain, pattern);
  });

  it("is measured under a plain name", () => {
    expect(probeVideo(plain).width).toBe(16);
    expect(readFrames(plain, { limit: 1 }).frames).toHaveLength(1);
  });

  it("is refused by measure's probe and decode instead of opening a1.png", () => {
    expect(() => probeVideo(pattern)).toThrow(PATTERN);
    expect(() => readFrames(pattern, { limit: 1 })).toThrow(PATTERN);
  });
});

describe.skipIf(!vp9)("a transparent WebM named like a pattern", () => {
  const plain = join(dir, "alpha.webm");
  const pattern = join(dir, "alpha%d.webm");
  beforeAll(() => {
    make(plain, [
      ...["-f", "lavfi", "-i", "color=c=red@0.5:s=16x16:d=0.2,format=yuva420p"],
      ...["-c:v", "libvpx-vp9", "-auto-alt-ref", "0"],
    ]);
    copyFileSync(plain, pattern);
  });

  it("is sampled under a plain name and left unsampled under the pattern name", () => {
    expect(sampledAlphaIsFullyOpaque(plain)).toBe(false);
    expect(sampledAlphaIsFullyOpaque(pattern)).toBeUndefined();
  });
});
