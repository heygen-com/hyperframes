import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectFirstFrameAfterEach } from "../commands/snapshot.js";
import {
  Fix,
  ffprobeReason,
  meanAbsDiff,
  missingFileFix,
  probeVideo,
  readClip,
  readFrames,
  sumOf,
  unreadableFix,
  videoClip,
} from "./media.js";

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

// A crop on yuv420p rounds an odd size or place down to even: a 33x33 box came back 32x32, so its bytes split into
// 9.4 frames, and an odd place shifted the colour.
describe.skipIf(!ffmpeg)("an odd box", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-crop-"));
  const path = join(dir, "clip.mp4");
  beforeAll(() => {
    execFileSync("ffmpeg", [
      ...["-v", "error", "-f", "lavfi", "-i", "testsrc=d=1:r=10:s=64x64"],
      ...["-pix_fmt", "yuv420p", "-y", path],
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    [1, 1, 33, 33],
    [3, 5, 31, 17],
  ])("reads the box %i,%i,%i,%i as the pixels the whole frame has there", (x, y, w, h) => {
    for (const gray of [false, true]) {
      const n = gray ? 1 : 3;
      const whole = readFrames(path, { gray }).frames[9]!;
      const there = Uint8Array.from(
        Array.from({ length: h }, (_, r) => [
          ...whole.subarray(((y + r) * 64 + x) * n, ((y + r) * 64 + x + w) * n),
        ]).flat(),
      );
      const box = readFrames(path, { roi: [x, y, w, h], gray }).frames;
      expect(box).toHaveLength(10);
      expect(meanAbsDiff(box[9]!, there)).toBe(0);
    }
  });
});

describe("a path that is not there", () => {
  it("says the shell dropped a Windows path's backslashes", () => {
    expect(missingFileFix("D:videoclip.mp4")).toMatch(/dropped the backslashes/);
  });

  it("otherwise asks for the path from the project folder", () => {
    expect(missingFileFix(join(tmpdir(), "nope.mp4"))).toBe(
      "pass the video's path from the project folder",
    );
  });
});

describe("a file ffprobe cannot read", () => {
  it("keeps ffprobe's reason without the path it repeats", () => {
    const err = { stderr: Buffer.from("x.mp4: Invalid data found when processing input\n") };
    expect(ffprobeReason(err, "x.mp4")).toBe("Invalid data found when processing input");
    expect(ffprobeReason(new Error("boom"), "x.mp4")).toBeUndefined();
  });

  it("keeps the specific cause of a cut-short file over ffprobe's generic last line", () => {
    const err = {
      stderr: Buffer.from(
        "[mov,mp4,m4a,3gp,3g2,mj2 @ 0x12e808c00] moov atom not found\nhalf.mp4: Invalid data found when processing input\n",
      ),
    };
    const reason = ffprobeReason(err, "half.mp4");
    expect(reason).toBe("moov atom not found");
    expect(unreadableFix(reason, true)).toMatch(/download it again/);
    // A web page named .mp4 gets the same two lines from ffprobe: only the header tells them apart.
    expect(unreadableFix(reason, false)).toMatch(/not a video/);
  });

  it.each([
    ["moov atom not found", true, /download it again/],
    ["moov atom not found", false, /not a video/],
    ["End of file", false, /download it again/],
    ["Invalid data found when processing input", false, /not a video/],
    ["Permission denied", false, /permissions/],
    [undefined, false, /pass a video file/],
  ])("answers %s (MP4 header: %s)", (reason, mp4Header, fix) => {
    expect(unreadableFix(reason, mp4Header)).toMatch(fix);
  });

  it.skipIf(!ffmpeg)(
    "tells a cut-short download to download again, not that it is no video",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-cut-"));
      const full = join(dir, "full.mp4");
      const half = join(dir, "half.mp4");
      execFileSync("ffmpeg", [
        ...["-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=4"],
        ...["-pix_fmt", "yuv420p", full],
      ]);
      const bytes = readFileSync(full);
      writeFileSync(half, bytes.subarray(0, bytes.length >> 1));
      try {
        probeVideo(half);
        expect.unreachable();
      } catch (err) {
        expect((err as Fix).message).toMatch(/moov atom not found/);
        expect((err as Fix).fix).toMatch(/download it again/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!ffmpeg)("puts the reason and its fix on the error", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-probe-"));
    const page = join(dir, "ref.mp4");
    writeFileSync(page, "<!doctype html><title>Sign in</title>");
    try {
      probeVideo(page);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Fix);
      expect((err as Fix).message).toMatch(/^ffprobe cannot read .*: .+/);
      expect((err as Fix).fix).toMatch(/not a video/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
