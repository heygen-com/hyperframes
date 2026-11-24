import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { afterAll, describe, expect, it } from "vitest";
import { measureAudio } from "./loudness.js";
import { decodePeakMap } from "./peakMap.js";
import { resolveProxy } from "./proxyTranscoder.js";
import { decodeAudioPeaks } from "./waveform.js";

const ffmpeg = findFfBinary("ffmpeg");
const ffprobe = findFfBinary("ffprobe");
const dir = mkdtempSync(join(tmpdir(), "hf-phone-audio-"));

/** A phone recording's shape: a 4-channel track whose codec ffmpeg cannot decode, then `tones` mono tracks.
 * PCM carries no codec config, so renaming its sample entry is all it takes. */
function phoneClip(name: string, tones: number): string {
  const made = join(dir, `made-${name}`);
  const inputs = Array.from({ length: tones }, () => ["-f", "lavfi", "-i", "sine=f=1000:d=1"]);
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:d=1"],
    ...["-f", "lavfi", "-i", "sine=f=300:d=1,pan=4c|c0=c0|c1=c0|c2=c0|c3=c0", ...inputs.flat()],
    ...["-map", "0:v", "-map", "1:a", ...inputs.flatMap((_, i) => ["-map", `${i + 2}:a`])],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", made],
  ]);
  const bytes = readFileSync(made);
  bytes.write("apac", bytes.indexOf("sowt", bytes.indexOf("moov")));
  writeFileSync(join(dir, name), bytes);
  return join(dir, name);
}

const audioChannels = (path: string) =>
  execFileSync(
    ffprobe!,
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=channels",
      "-of",
      "csv=p=0",
      "--",
      path,
    ],
    { encoding: "utf8" },
  ).trim();

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!ffmpeg || !ffprobe)(
  "a phone clip whose first audio track ffmpeg cannot decode",
  () => {
    it("gets a preview copy with the track ffmpeg can decode, or none when there is none", async () => {
      expect(audioChannels(await resolveProxy(dir, phoneClip("phone.mov", 1)))).toBe("1");
      expect(audioChannels(await resolveProxy(dir, phoneClip("spatial.mov", 0)))).toBe("");
    }, 60_000);

    it("draws its waveform and peaks and measures its loudness from that track", async () => {
      const phone = phoneClip("phone-read.mov", 1);
      expect((await decodeAudioPeaks(phone)).some((peak) => peak > 0.05)).toBe(true);
      expect((await decodePeakMap(phone)).some((peak) => peak > 0.05)).toBe(true);
      const loudness = await measureAudio(ffmpeg!, phone, { mediaStart: 0, duration: null });
      expect(loudness.integratedLufs).toBeGreaterThan(-40);
    }, 60_000);
  },
);
