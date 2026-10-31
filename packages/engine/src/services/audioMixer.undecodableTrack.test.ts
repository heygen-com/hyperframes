import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { extractAudioMetadata, extractMediaMetadata } from "../utils/ffprobe.js";
import { parseAudioElements, processCompositionAudio } from "./audioMixer.js";

const FFMPEG = getFfmpegBinary();
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"]).status === 0;
const SAMPLE_RATE = 48_000;

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync(FFMPEG, ["-nostdin", "-v", "error", "-y", ...args]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

/** A phone recording's shape: its first audio track names a codec ffmpeg has no decoder for (an iPhone's
 * spatial track), so ffmpeg's own pick of the 4-channel track fails; `tracks` are the sine tones after it. */
function phoneClip(path: string, tracks: number[]): void {
  const tones = tracks.flatMap((hz) => ["-f", "lavfi", "-i", `sine=f=${hz}:r=${SAMPLE_RATE}:d=3`]);
  ffmpeg([
    ...["-f", "lavfi", "-i", "color=size=64x36:rate=10:duration=3"],
    ...["-f", "lavfi", "-i", `sine=f=300:r=${SAMPLE_RATE}:d=3,pan=4c|c0=c0|c1=c0|c2=c0|c3=c0`],
    ...tones,
    ...["-map", "0:v", "-map", "1:a", ...tracks.flatMap((_, i) => ["-map", `${i + 2}:a`])],
    ...["-c:v", "mpeg4", "-c:a", "pcm_s16le", `${path}.tmp.mov`],
  ]);
  // PCM carries no codec config, so its sample entry's fourcc alone names the codec.
  const bytes = readFileSync(`${path}.tmp.mov`);
  const at = bytes.indexOf("sowt", bytes.indexOf("moov"));
  bytes.write("apac", at);
  writeFileSync(path, bytes);
}

function loudestHz(pcm: Buffer): number {
  let crossings = 0;
  for (let i = 1; i < pcm.length / 2; i += 1) {
    if (pcm.readInt16LE((i - 1) * 2) < 0 && pcm.readInt16LE(i * 2) >= 0) crossings += 1;
  }
  return Math.round(crossings / (pcm.length / 2 / SAMPLE_RATE) / 100) * 100;
}

describe.skipIf(!HAS_FFMPEG)("a source whose first audio track ffmpeg cannot decode", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-audio-undecodable-"));
    phoneClip(join(dir, "phone.mov"), [1000]);
    phoneClip(join(dir, "spatial-only.mov"), []);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("mixes the track ffmpeg can decode", async () => {
    const work = mkdtempSync(join(dir, "work-"));
    const output = `${work}.m4a`;
    const html =
      '<video id="clip" src="phone.mov" data-start="0" data-duration="2" data-has-audio="true"></video>';
    const result = await processCompositionAudio(parseAudioElements(html), dir, work, output, 2);
    expect(result, result.error).toMatchObject({ success: true, tracksProcessed: 1 });
    const pcm = ffmpeg(["-i", output, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"]);
    expect(loudestHz(pcm.subarray(SAMPLE_RATE, SAMPLE_RATE * 3))).toBe(1000);
  });

  it("bakes a rate lane from that track", async () => {
    const work = mkdtempSync(join(dir, "work-"));
    const output = `${work}.m4a`;
    const rate = {
      target: "rate" as const,
      points: [
        { t: 0, v: 1 },
        { t: 2, v: 1.5 },
      ],
    };
    const clip = {
      id: "clip",
      src: "phone.mov",
      start: 0,
      end: 2,
      mediaStart: 0,
      layer: 0,
      volume: 1,
    };
    const result = await processCompositionAudio(
      [{ ...clip, playbackRate: rate, type: "video" }],
      dir,
      work,
      output,
      2,
    );
    expect(result, result.error).toMatchObject({ success: true, tracksProcessed: 1 });
    const pcm = ffmpeg(["-i", output, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"]);
    expect(loudestHz(pcm.subarray(SAMPLE_RATE, SAMPLE_RATE * 3))).toBe(1000);
  });

  it("probes that track, and counts a clip with only the undecodable one as silent", async () => {
    const audio = await extractAudioMetadata(join(dir, "phone.mov"));
    expect([audio.audioStream, audio.channels, audio.audioStreamCount]).toEqual([1, 1, 2]);
    expect((await extractMediaMetadata(join(dir, "phone.mov"))).hasAudio).toBe(true);
    expect((await extractMediaMetadata(join(dir, "spatial-only.mov"))).hasAudio).toBe(false);
  });
});
