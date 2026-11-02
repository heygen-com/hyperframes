import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import {
  buildChunkStreamingArgs,
  spawnChunkStreamingEncoder,
  BT709_LIMITED,
} from "./chunkStreamingEncoder.js";

const fps = { num: 30, den: 1 };

describe("buildChunkStreamingArgs", () => {
  it("copies an Annex-B stream, tags it BT.709 and runs no filter", () => {
    const args = buildChunkStreamingArgs({ fps }, "/tmp/out.mp4");

    expect(args.slice(0, 6)).toEqual(["-f", "h264", "-framerate", "30", "-i", "-"]);
    expect(args).toContain("copy");
    expect(args).not.toContain("-vf");
    expect(args[args.indexOf("-bsf:v") + 1]).toBe(
      "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
    );
    expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("writes the range the page encoder reported", () => {
    const args = buildChunkStreamingArgs(
      { fps, colour: { ...BT709_LIMITED, fullRange: true } },
      "o.mp4",
    );

    expect(args[args.indexOf("-bsf:v") + 1]).toContain("video_full_range_flag=1");
    expect(args[args.indexOf("-color_range") + 1]).toBe("pc");
  });
});

describe("spawnChunkStreamingEncoder", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-chunk-enc-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("muxes encoded chunks into an mp4 with one frame per tick and BT.709 tags", async () => {
    const source = spawnSync(
      getFfmpegBinary(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=d=1:r=30:s=160x90",
      ].concat(["-c:v", "libx264", "-bf", "0", "-pix_fmt", "yuv420p", "-f", "h264", "-"]),
      { maxBuffer: 64 * 1024 * 1024 },
    );
    expect(source.status).toBe(0);
    const stream = source.stdout;
    const out = join(dir, "out.mp4");

    const encoder = spawnChunkStreamingEncoder(out, { fps });
    const third = Math.ceil(stream.length / 3);
    for (let at = 0; at < stream.length; at += third) {
      expect(await encoder.writeFrame(stream.subarray(at, at + third))).toBe(true);
    }
    const result = await encoder.close();

    expect(result.success).toBe(true);
    const entries =
      "stream=nb_read_frames,r_frame_rate,color_space,color_primaries,color_transfer,color_range";
    const probe = spawnSync(
      getFfprobeBinary(),
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        entries,
        "-of",
        "json",
        "--",
        out,
      ],
      { encoding: "utf-8" },
    );
    const stream0 = JSON.parse(probe.stdout).streams[0];
    expect(stream0).toMatchObject({
      nb_read_frames: "30",
      r_frame_rate: "30/1",
      color_space: "bt709",
      color_primaries: "bt709",
      color_transfer: "bt709",
      color_range: "tv",
    });
  });
});
