import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import {
  buildConcatArgs,
  writeVideoConcatList,
  concatVideoFiles,
  encodeFramesChunkedConcat,
} from "./chunkEncoder.js";
import { validJpeg } from "./__fixtures__/jpeg.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)("concat input paths", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-relative-concat-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finishes a multi-chunk encode with a relative output directory", async () => {
    const framesDir = join(root, "frames");
    mkdirSync(framesDir);
    for (let frame = 0; frame < 40; frame++) {
      writeFileSync(join(framesDir, `frame_${String(frame).padStart(6, "0")}.jpg`), validJpeg);
    }
    const outputPath = relative(process.cwd(), join(root, "output", "video.mp4"));
    const result = await encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.jpg",
      outputPath,
      { fps: { num: 30, den: 1 }, width: 64, height: 64, preset: "ultrafast" },
      30,
    );

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ success: true, outputPath, framesEncoded: 40 });
    const probe = spawnSync(
      getFfprobeBinary(),
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,avg_frame_rate,nb_read_frames",
        "-of",
        "csv=p=0",
        "--",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout.trim()).toBe("64,64,30/1,40");
  }, 30_000);

  it("rejects a non-video demuxer even after a valid first segment", async () => {
    const clip = join(root, "clip.mp4");
    const made = spawnSync(getFfmpegBinary(), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=size=32x32",
      "-frames:v",
      "1",
      "-c:v",
      "libx264",
      clip,
    ]);
    expect(made.status, made.stderr.toString()).toBe(0);
    const other = join(root, "second.mp4");
    writeFileSync(other, "ffconcat version 1.0\n");
    const list = writeVideoConcatList(root, [other]);
    const rejected = spawnSync(getFfmpegBinary(), buildConcatArgs(list, join(root, "unused.mp4")), {
      encoding: "utf8",
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("not on whitelist");
    const result = await concatVideoFiles([clip, other], join(root, "joined.mp4"));
    expect(result).toMatchObject({ success: false, externalInterruption: false });
  });

  it.each([true, false])(
    "preserves frames and order with mixed input paths, relative first: %s",
    async (relativeFirst) => {
      const inputs = join(root, "clips' directory");
      mkdirSync(inputs);
      const paths = [join(inputs, "red.mp4"), join(root, "blue.mp4")];
      for (const [index, path] of paths.entries()) {
        const made = spawnSync(getFfmpegBinary(), [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=${index === 0 ? "red" : "blue"}:size=32x32:rate=30`,
          "-frames:v",
          String(index + 2),
          "-c:v",
          "libx264",
          "-bf",
          "0",
          path,
        ]);
        expect(made.status, made.stderr.toString()).toBe(0);
      }
      const inputPaths = paths.map((path, index) =>
        (index === 0) === relativeFirst ? relative(process.cwd(), path) : path,
      );
      const outputPath = join(root, "output", "joined.mp4");
      const result = await concatVideoFiles(inputPaths, outputPath);
      expect(result).toEqual({ success: true });

      const decoded = spawnSync(getFfmpegBinary(), [
        "-v",
        "error",
        "-i",
        outputPath,
        "-vf",
        "scale=1:1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ]);
      expect(decoded.status, decoded.stderr.toString()).toBe(0);
      expect(decoded.stdout).toHaveLength(5 * 3);
      for (let frame = 0; frame < 5; frame++) {
        const red = decoded.stdout[frame * 3];
        const blue = decoded.stdout[frame * 3 + 2];
        expect(frame < 2 ? red : blue).toBeGreaterThan(240);
        expect(frame < 2 ? blue : red).toBeLessThan(5);
      }
    },
    30_000,
  );
});

describe.skipIf(!HAS_FFMPEG)("concat input formats", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-concat-formats-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeClip(path: string, frames: number): void {
    const codec = path.endsWith(".webm") ? ["libvpx-vp9"] : ["libx264", "-bf", "0"];
    const made = spawnSync(getFfmpegBinary(), [
      ...["-v", "error", "-f", "lavfi", "-i", "color=red:size=32x32:rate=30"],
      ...["-frames:v", String(frames), "-c:v", ...codec, "-y", path],
    ]);
    expect(made.status, made.stderr.toString()).toBe(0);
  }

  // fails without the fix: the line break ended the entry and ffmpeg read the rest as list lines.
  // Windows paths cannot hold a line break.
  it.skipIf(process.platform === "win32")(
    "refuses inputs whose folder name holds a line break, before writing a list",
    async () => {
      const folder = join(root, "proj\nfile 'other.mov'\n#");
      mkdirSync(folder);
      makeClip(join(folder, "a.mp4"), 2);
      makeClip(join(folder, "b.mp4"), 2);

      const result = await concatVideoFiles(
        [join(folder, "a.mp4"), join(folder, "b.mp4")],
        join(root, "joined.mp4"),
      );

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("line break or NUL"),
        externalInterruption: false,
      });
      expect(readdirSync(folder).filter((name) => name.startsWith("concat-list-"))).toEqual([]);
    },
    30_000,
  );

  function frameCount(path: string): string {
    const probe = spawnSync(
      getFfprobeBinary(),
      [
        ...["-v", "error", "-count_frames", "-select_streams", "v:0"],
        ...["-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", "--", path],
      ],
      { encoding: "utf8" },
    );
    expect(probe.status, probe.stderr).toBe(0);
    return probe.stdout.trim();
  }

  it.each(["mp4", "mov", "webm"])(
    "joins %s files the encoders write",
    async (ext) => {
      const inputs = [join(root, `a.${ext}`), join(root, `b.${ext}`)];
      makeClip(inputs[0]!, 2);
      makeClip(inputs[1]!, 3);
      const outputPath = join(root, `joined.${ext}`);
      expect(await concatVideoFiles(inputs, outputPath)).toEqual({ success: true });
      expect(frameCount(outputPath)).toBe("5");
    },
    30_000,
  );

  function writePlaylist(): string {
    makeClip(join(root, "elsewhere.mp4"), 4);
    const playlist = join(root, "segment.m3u8");
    writeFileSync(
      playlist,
      "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nelsewhere.mp4\n#EXT-X-ENDLIST\n",
    );
    return playlist;
  }

  it("refuses a listed file that is a playlist of other files", async () => {
    const result = await concatVideoFiles([writePlaylist()], join(root, "joined.mp4"));
    expect(result.success).toBe(false);
  }, 30_000);

  it("refuses nested lists with relative or absolute names", async () => {
    const sub = join(root, "sub");
    mkdirSync(sub);
    makeClip(join(root, "a.mp4"), 2);
    makeClip(join(sub, "beside.mp4"), 3);
    const nested = join(sub, "nested.mp4");
    const joined = join(root, "joined.mp4");

    writeFileSync(nested, "ffconcat version 1.0\nfile 'beside.mp4'\n");
    const relative = await concatVideoFiles([join(root, "a.mp4"), nested], joined);
    expect(relative.success).toBe(false);

    writeFileSync(nested, `ffconcat version 1.0\nfile '${join(sub, "beside.mp4")}'\n`);
    const absolute = await concatVideoFiles([join(root, "a.mp4"), nested], joined);
    expect(absolute.success).toBe(false);
  }, 30_000);

  it("fails the join when a refused file sits between good ones", async () => {
    const good = [join(root, "a.mp4"), join(root, "b.mp4")];
    for (const path of good) makeClip(path, 2);
    const inputs = [good[0]!, writePlaylist(), good[1]!];
    const result = await concatVideoFiles(inputs, join(root, "joined.mp4"));
    expect(result.success).toBe(false);
  }, 30_000);
});
