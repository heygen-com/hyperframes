import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { decodeAudio } from "../audio/analysis/decode.js";
import { buildPublishFileMap } from "../utils/publishProject.js";
import { OFFLOAD_MIN_BYTES, offloadHeavyMedia, type UploadableFile } from "./offload.js";

const ffmpeg = findFfBinary("ffmpeg");
const ffprobe = findFfBinary("ffprobe");
const dir = mkdtempSync(join(tmpdir(), "hf-offload-phone-"));

/** A phone recording's shape: a 4-channel track whose codec ffmpeg cannot decode, then a mono tone. An mkv
 * name (the demuxer reads the content) and a `free` box past the cutoff send it through a re-encode. */
function phoneClip(): Buffer {
  const made = join(dir, "made.mov");
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:d=1"],
    ...["-f", "lavfi", "-i", "sine=f=300:d=1,pan=4c|c0=c0|c1=c0|c2=c0|c3=c0"],
    ...["-f", "lavfi", "-i", "sine=f=1000:d=1", "-map", "0:v", "-map", "1:a", "-map", "2:a"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", made],
  ]);
  const bytes = readFileSync(made);
  bytes.write("apac", bytes.indexOf("sowt", bytes.indexOf("moov")));
  const free = Buffer.alloc(OFFLOAD_MIN_BYTES);
  free.writeUInt32BE(free.length);
  free.write("free", 4);
  return Buffer.concat([bytes, free]);
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
    it("decodes the track ffmpeg can", async () => {
      writeFileSync(join(dir, "phone.mov"), phoneClip());
      const decoded = await decodeAudio(join(dir, "phone.mov"));
      expect(decoded?.stream).toMatchObject({ audioStream: 1, channels: 1 });
    });

    it("re-encodes it for upload with that track", async () => {
      const project = mkdtempSync(join(dir, "project-"));
      writeFileSync(
        join(project, "index.html"),
        `<html><body><video src="phone.mkv"></video></body></html>`,
      );
      writeFileSync(join(project, "phone.mkv"), phoneClip());
      const uploads: UploadableFile[] = [];
      await offloadHeavyMedia(project, buildPublishFileMap(project), {
        apiBaseUrl: "https://api.example",
        cachePath: join(project, "cache.json"),
        upload: async (file) => {
          uploads.push(file);
          return { asset_id: "a", url: "https://assets.example/a.mp4" };
        },
      });
      const [upload] = uploads;
      if (!upload || !("bytes" in upload)) throw new Error("nothing re-encoded");
      writeFileSync(join(project, upload.filename), upload.bytes);
      expect(audioChannels(join(project, upload.filename))).toBe("1");
    }, 60_000);
  },
);
