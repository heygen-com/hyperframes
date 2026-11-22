import { describe, expect, it } from "bun:test";
import type { Fps } from "@hyperframes/core";
import {
  appendSoftwareEncoderThreadsArg,
  getEncoderPreset,
  getHdrEncoderColorParams,
  renderProvenanceArgs,
  type HdrTransfer,
} from "@hyperframes/engine";
import { buildCompositeArgs, buildOverlayConcatList } from "./ffmpegComposite.js";
import type {
  CapturedOverlay,
  CompositeRequest,
  OverlayPlan,
  OverlayState,
  PassthroughVideo,
} from "./types.js";

const FPS_30: Fps = { num: 30, den: 1 };

function state(index: number, startFrame: number, endFrame: number): OverlayState {
  return {
    index,
    startFrame,
    endFrame,
    captureFrame: Math.floor((startFrame + endFrame - 1) / 2),
  };
}

function overlay(s: OverlayState, pngPath: string): CapturedOverlay {
  return { state: s, pngPath, hash: pngPath };
}

interface RequestOverrides {
  transfer?: HdrTransfer;
  sourceSize?: { width: number; height: number };
  mediaStart?: number;
  mediaTimeOffsetSeconds?: number;
  useGpu?: boolean;
  effectiveBitrate?: string;
  maxBitrate?: string;
  bufferSize?: string;
}

function request(overrides: RequestOverrides = {}): CompositeRequest {
  const transfer = overrides.transfer ?? "hlg";
  const width = 1920;
  const height = 1080;
  const source = overrides.sourceSize ?? { width, height };
  const states = [state(0, 0, 45), state(1, 45, 90)];
  const plan: OverlayPlan = { states, fps: FPS_30, totalFrames: 90, width, height };
  const video: PassthroughVideo = {
    id: "bg",
    srcPath: "/media/vlog.mp4",
    mediaStart: overrides.mediaStart ?? 0,
    duration: 3,
    fps: FPS_30,
    width: source.width,
    height: source.height,
    fit: source.width === width ? "fill" : "cover",
    transfer,
    primaries: "bt2020",
    colorSpace: {
      colorTransfer: transfer === "pq" ? "smpte2084" : "arib-std-b67",
      colorPrimaries: "bt2020",
      colorSpace: "bt2020nc",
    },
    metadata: {
      durationSeconds: 10,
      videoStreamDurationSeconds: 10,
      mediaTimeOffsetSeconds: overrides.mediaTimeOffsetSeconds,
      width: source.width,
      height: source.height,
      fps: 30,
      videoCodec: "hevc",
      hasAudio: true,
      isVFR: false,
      hasAlpha: false,
      colorSpace: null,
    },
  };
  return {
    video,
    plan,
    overlays: {
      overlays: [overlay(states[0]!, "/w/o0.png"), overlay(states[1]!, "/w/o1.png")],
      uniqueCount: 2,
      dir: "/w",
      captureMs: 1,
    },
    encoder: {
      preset: getEncoderPreset("standard", "mp4", { transfer }),
      effectiveQuality: 18,
      effectiveBitrate: overrides.effectiveBitrate,
      deliveryEncoder: {
        maxBitrate: overrides.maxBitrate,
        bufferSize: overrides.bufferSize,
        lockGopForChunkConcat: false,
        gopSize: undefined,
      },
      useGpu: overrides.useGpu,
    },
    hdr: { transfer },
    outputPath: "/out/video-only.mp4",
    workDir: "/w",
    abortSignal: undefined,
  };
}

const GRAPH_1080 = [
  "[0:v]fps=30:start_time=0,format=gbrp16le[v]",
  "[1:v]fps=30:start_time=0,format=rgba64le,split[oc][oa]",
  "[oc]format=gbrp16le[o]",
  "[oa]extractplanes=a,mergeplanes=0x000000:gbrp16le[m]",
  "[v][o][m]maskedmerge,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv[vout]",
].join(";");

describe("buildCompositeArgs", () => {
  it("builds the software HLG composite with the layered encoder settings", () => {
    const req = request();
    const preset = req.encoder.preset.preset;
    const x265 = getHdrEncoderColorParams("hlg").x265ColorParams;
    // The x265 thread count follows the host CPU budget; take it from the same helper.
    const threads: string[] = [];
    appendSoftwareEncoderThreadsArg(threads, "libx265");
    expect(buildCompositeArgs(req, "/w/list.ffconcat")).toEqual([
      ...["-ss", "0.000000", "-t", "3.033333", "-i", "/media/vlog.mp4"],
      ...["-f", "concat", "-safe", "0", "-i", "/w/list.ffconcat"],
      ...["-r", "30", "-c:v", "libx265", "-preset", preset, ...threads, "-crf", "18"],
      ...["-x265-params", `aq-mode=3:aq-strength=0.8:deblock=1,1:${x265}`, "-tag:v", "hvc1"],
      ...["-colorspace:v", "bt2020nc", "-color_primaries:v", "bt2020"],
      ...["-color_trc:v", "arib-std-b67", "-color_range", "tv"],
      ...["-filter_complex", GRAPH_1080, "-map", "[vout]"],
      ...["-video_track_timescale", "90000", "-pix_fmt", "yuv420p10le"],
      ...["-avoid_negative_ts", "make_zero"],
      ...renderProvenanceArgs("/out/video-only.mp4"),
      ...["-frames:v", "90", "-an", "-y", "/out/video-only.mp4"],
    ]);
  });

  it("tags PQ output and maps PQ x265 params", () => {
    const args = buildCompositeArgs(request({ transfer: "pq" }), "/w/list.ffconcat");
    const x265 = getHdrEncoderColorParams("pq").x265ColorParams;
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("smpte2084");
    expect(args[args.indexOf("-x265-params") + 1]).toContain(x265);
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("color_trc=smpte2084");
  });

  it("seeks to the normalized trim offset", () => {
    const args = buildCompositeArgs(
      request({ mediaStart: 12.5, mediaTimeOffsetSeconds: 0.5 }),
      "/w/list.ffconcat",
    );
    expect(args.slice(0, 4)).toEqual(["-ss", "12.000000", "-t", "3.033333"]);
  });

  it("scales and crops a same-aspect source like the HDR frame extraction", () => {
    const args = buildCompositeArgs(
      request({ sourceSize: { width: 3840, height: 2160 } }),
      "/w/list.ffconcat",
    );
    expect(args[args.indexOf("-filter_complex") + 1]).toStartWith(
      "[0:v]fps=30:start_time=0,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=gbrp16le[v];",
    );
  });

  it("keeps bitrate mode and delivery rate caps", () => {
    const args = buildCompositeArgs(
      request({ effectiveBitrate: "20M", maxBitrate: "25M", bufferSize: "50M" }),
      "/w/list.ffconcat",
    );
    expect(args[args.indexOf("-b:v") + 1]).toBe("20M");
    expect(args).not.toContain("-crf");
    expect(args).toContain("-maxrate");
    expect(args).toContain("-bufsize");
  });

  it("uses the resolved GPU encoder", () => {
    const args = buildCompositeArgs(request({ useGpu: true }), "/w/list.ffconcat", {
      encoder: "nvenc",
      nvencPresets: new Set(["p4"]),
    });
    expect(args[args.indexOf("-c:v") + 1]).toBe("hevc_nvenc");
    expect(args).toContain("-filter_complex");
    expect(args).not.toContain("-vf");
  });

  it("keeps vaapi's device and upload around the composite graph", () => {
    const args = buildCompositeArgs(request({ useGpu: true }), "/w/list.ffconcat", {
      encoder: "vaapi",
    });
    expect(args.slice(0, 4)).toEqual(["-vaapi_device", "/dev/dri/renderD128", "-ss", "0.000000"]);
    expect(args[args.indexOf("-filter_complex") + 1]).toEndWith(
      "range=tv,format=nv12,hwupload[vout]",
    );
  });

  it("falls back to software when GPU was requested but none was detected", () => {
    const args = buildCompositeArgs(request({ useGpu: true }), "/w/list.ffconcat");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx265");
  });
});

describe("buildOverlayConcatList", () => {
  it("writes per-state durations and repeats the last file", () => {
    const states = [state(0, 0, 45), state(1, 45, 46), state(2, 46, 90)];
    const list = buildOverlayConcatList(
      [
        overlay(states[0]!, "/w/a.png"),
        overlay(states[1]!, "/w/b.png"),
        overlay(states[2]!, "/w/c.png"),
      ],
      FPS_30,
    );
    expect(list).toBe(
      [
        "ffconcat version 1.0",
        "file '/w/a.png'",
        "option framerate 30",
        "duration 1500000us",
        "file '/w/b.png'",
        "option framerate 30",
        "duration 33333us",
        "file '/w/c.png'",
        "option framerate 30",
        "duration 1466667us",
        "file '/w/c.png'",
        "option framerate 30",
        "",
      ].join("\n"),
    );
  });

  it("merges adjacent states that share a PNG", () => {
    const states = [state(0, 0, 10), state(1, 10, 20), state(2, 20, 30)];
    const list = buildOverlayConcatList(
      [
        overlay(states[0]!, "/w/a.png"),
        overlay(states[1]!, "/w/a.png"),
        overlay(states[2]!, "/w/b.png"),
      ],
      FPS_30,
    );
    expect(list.split("\n").slice(1, 7)).toEqual([
      "file '/w/a.png'",
      "option framerate 30",
      "duration 666667us",
      "file '/w/b.png'",
      "option framerate 30",
      "duration 333333us",
    ]);
  });

  it("keeps state starts on the frame grid for fractional rates", () => {
    const ntsc: Fps = { num: 30000, den: 1001 };
    const states = Array.from({ length: 1000 }, (_, i) => state(i, i * 7, i * 7 + 7));
    const list = buildOverlayConcatList(
      states.map((s) => overlay(s, `/w/${s.index % 2}.png`)),
      ntsc,
    );
    expect(list).toContain("option framerate 30000/1001");
    const micros = [...list.matchAll(/duration (\d+)us/g)].map((m) => Number(m[1]));
    const total = micros.reduce((a, b) => a + b, 0);
    expect(total).toBe(Math.round((7000 * 1001 * 1_000_000) / 30000));
  });

  it("escapes single quotes in paths", () => {
    const list = buildOverlayConcatList([overlay(state(0, 0, 3), "/w/it's.png")], FPS_30);
    expect(list).toContain("file '/w/it'\\''s.png'");
  });

  it("rejects an empty overlay set", () => {
    expect(() => buildOverlayConcatList([], FPS_30)).toThrow("no overlay states");
  });
});
