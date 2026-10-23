import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { decodeAudio } from "./decode.js";
import { writeIphoneClip } from "../../../../studio-server/src/helpers/iphoneClip.test-helpers.js";

const ffmpeg = findFfBinary("ffmpeg");

describe.skipIf(!ffmpeg || !findFfBinary("ffprobe"))("decodeAudio", () => {
  it("decodes an iPhone clip's AAC voice, not its undecodable spatial track", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-decode-"));
    try {
      const decoded = await decodeAudio(writeIphoneClip(ffmpeg ?? "ffmpeg", dir));
      expect(decoded?.stream).toMatchObject({ track: 1, sampleRate: 48_000, channels: 1 });
      const samples = decoded?.signal.channels[0] ?? new Float32Array();
      // ffmpeg's sine peaks at 1/8.
      expect(Math.max(...samples)).toBeGreaterThan(0.1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
