import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectFirstFrameAfterEach } from "../commands/snapshot.js";
import { probeVideo, readClip, sumOf, videoClip } from "./media.js";

const terms = (n: number) => Array.from({ length: n }, (_, i) => `eq(n\\,${i * 2})`);

describe("sumOf", () => {
  it("keeps a short sum flat", () => {
    expect(sumOf(terms(3))).toBe("eq(n\\,0)+eq(n\\,2)+eq(n\\,4)");
  });

  it("nests a sum past 50 terms and keeps every one", () => {
    const sum = sumOf(terms(51));
    expect(sum.startsWith("(eq(n\\,0)+")).toBe(true);
    expect(sum.match(/eq\(n/g)).toHaveLength(51);
  });
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

// ffmpeg 8 answered "Error while parsing expression" at 199-201 eq() picks and 97-100 snapshot times
// (more inside other calls); ffmpeg 6 and 7 never did.
describe.skipIf(!ffmpeg)("a select of many frames", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-sum-"));
  const path = join(dir, "clip.mp4");
  beforeAll(() => {
    execFileSync("ffmpeg", [
      ...["-v", "error", "-f", "lavfi", "-i", "testsrc=d=30:r=30:s=16x16"],
      ...["-pix_fmt", "yuv420p", "-y", path],
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const decoded = (select: string) => {
    const info = probeVideo(path);
    const clip = {
      ...videoClip(path, 0, undefined, info),
      filters: [select, `setpts=N/(${info.fpsText})/TB`],
    };
    return readClip(clip).frames.length;
  };

  it.each([199, 200, 237, 401])("decodes all %i picked frames", (n) => {
    expect(decoded(`select=${sumOf(terms(n))}`)).toBe(n);
  });

  it.each([97, 100, 199])("decodes one frame for each of %i snapshot times", (n) => {
    const times = Array.from({ length: n }, (_, i) => i * 0.1);
    expect(decoded(selectFirstFrameAfterEach(times))).toBe(n);
  });
});
