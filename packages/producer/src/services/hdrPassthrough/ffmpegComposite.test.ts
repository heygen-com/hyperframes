import { describe, expect, it } from "bun:test";
import type { Fps } from "@hyperframes/core";
import {
  appendSoftwareEncoderThreadsArg,
  buildStreamingArgs,
  getEncoderPreset,
  getHdrEncoderColorParams,
  renderProvenanceArgs,
  type GpuEncoder,
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
      plan,
      uniqueCount: 2,
      candidateCount: 2,
      captureCount: 2,
      verifyProbeCount: 0,
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
  "[0:v]sidedata=mode=delete,fps=30:start_time=0,scale=threads=4,format=rgb48le,scale=threads=4,format=gbrp16le[v]",
  "[1:v]format=rgba64le,split[oc][oa]",
  "[oc]format=gbrp16le,fps=30:start_time=0[o]",
  "[oa]extractplanes=a,mergeplanes=0x000000:gbrp16le,fps=30:start_time=0[m]",
  "[v][o][m]maskedmerge,scale=threads=4,format=rgb48le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv,scale=threads=4[vout]",
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

  it("keeps a negative seek when the streams start after mediaStart, like the layered extraction", () => {
    // Streams starting 0.178 s into the file with mediaStart 0: ffmpeg must read from the start
    // and keep the lead (the fps filter holds the first frame), not play the video early.
    const args = buildCompositeArgs(
      request({ mediaStart: 0, mediaTimeOffsetSeconds: 0.178 }),
      "/w/list.ffconcat",
    );
    expect(args.slice(0, 4)).toEqual(["-ss", "-0.178000", "-t", "3.033333"]);
    const partial = buildCompositeArgs(
      request({ mediaStart: 0.1, mediaTimeOffsetSeconds: 0.178 }),
      "/w/list.ffconcat",
    );
    expect(partial[1]).toBe("-0.078000");
  });

  it("scales and crops a same-aspect source like the HDR frame extraction", () => {
    const args = buildCompositeArgs(
      request({ sourceSize: { width: 3840, height: 2160 } }),
      "/w/list.ffconcat",
    );
    expect(args[args.indexOf("-filter_complex") + 1]).toStartWith(
      "[0:v]sidedata=mode=delete,fps=30:start_time=0,scale=1920:1080:force_original_aspect_ratio=increase:threads=4,crop=1920:1080,format=rgb48le,scale=threads=4,format=gbrp16le[v];",
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

  it("drops every side data type the source frames carry before anything else", () => {
    // ffmpeg 8 carries the source's mastering display / content light level through the graph
    // and the mp4 muxer writes them as container boxes the layered output does not have.
    const graph = buildCompositeArgs(request(), "/w/list.ffconcat");
    const chain = graph[graph.indexOf("-filter_complex") + 1] ?? "";
    expect(chain).toStartWith("[0:v]sidedata=mode=delete,");
    expect(chain.match(/sidedata=/g)).toHaveLength(1);
  });

  it("turns libx265's Dolby Vision copy off when the binary has the option", () => {
    const on = buildCompositeArgs(request(), "/w/list.ffconcat", {
      encoder: null,
      x265DolbyVisionOption: true,
    });
    const at = on.indexOf("-dolbyvision");
    expect(on.slice(at, at + 2)).toEqual(["-dolbyvision", "0"]);
    expect(at).toBeGreaterThan(on.indexOf("libx265"));
    expect(at).toBeLessThan(on.indexOf("-y"));
    // ffmpeg 7.0's libx265 has no such option and rejects the flag.
    expect(buildCompositeArgs(request(), "/w/list.ffconcat")).not.toContain("-dolbyvision");
    const nvenc = buildCompositeArgs(request({ useGpu: true }), "/w/list.ffconcat", {
      encoder: "nvenc",
      nvencPresets: new Set(["p4"]),
      x265DolbyVisionOption: true,
    });
    expect(nvenc).not.toContain("-dolbyvision");
  });

  it("falls back to software when GPU was requested but none was detected", () => {
    const args = buildCompositeArgs(request({ useGpu: true }), "/w/list.ffconcat");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx265");
  });
});

/** Removes `count` tokens starting at the first `token` (after `from`). */
function without(args: readonly string[], token: string, count: number, from = 0): string[] {
  const at = args.indexOf(token, from);
  if (at < 0) throw new Error(`${token} not found`);
  return [...args.slice(0, at), ...args.slice(at + count)];
}

describe("encoder parity with the layered HDR encoder", () => {
  const cases: ReadonlyArray<{
    name: string;
    useGpu: boolean;
    encoder: GpuEncoder;
    nvencPresets?: ReadonlySet<string>;
  }> = [
    { name: "software", useGpu: false, encoder: null },
    { name: "GPU requested, none detected", useGpu: true, encoder: null },
    { name: "nvenc", useGpu: true, encoder: "nvenc", nvencPresets: new Set(["p4"]) },
    { name: "vaapi", useGpu: true, encoder: "vaapi" },
  ];
  for (const c of cases) {
    it(`${c.name}: every encoder option is the layered stage's`, () => {
      const req = request({ useGpu: c.useGpu, effectiveBitrate: "20M", maxBitrate: "25M" });
      const { preset } = req.encoder;
      // The options `captureHdrStage` passes to `spawnStreamingEncoder`.
      const layered = buildStreamingArgs(
        {
          fps: req.plan.fps,
          width: req.plan.width,
          height: req.plan.height,
          codec: preset.codec,
          useGpu: c.useGpu,
          preset: preset.preset,
          quality: req.encoder.effectiveQuality,
          bitrate: req.encoder.effectiveBitrate,
          ...req.encoder.deliveryEncoder,
          pixelFormat: preset.pixelFormat,
          hdr: preset.hdr,
          rawInputFormat: "rgb48le",
        },
        req.outputPath,
        c.encoder,
        c.nvencPresets as Set<string> | undefined,
      );
      const composite = buildCompositeArgs(req, "/w/list.ffconcat", {
        encoder: c.encoder,
        nvencPresets: c.nvencPresets as Set<string> | undefined,
      });

      // Layered: global options, raw stdin input, encoder options, `-vf <tail>`, output.
      const rawStart = layered.indexOf("-f");
      const rawEnd = layered.indexOf("-", rawStart) + 1;
      const vf = layered.indexOf("-vf");
      const tail = layered[vf + 1] ?? "";
      const layeredEncoder = [...layered.slice(0, rawStart), ...layered.slice(rawEnd)];
      // Composite: the same, with the two file inputs, the composite graph and the frame cap.
      const global = layered.slice(0, rawStart).length;
      let stripped = [...composite.slice(0, global), ...composite.slice(global + 12)];
      const graph = stripped[stripped.indexOf("-filter_complex") + 1] ?? "";
      stripped = without(stripped, "-filter_complex", 4);
      stripped = without(stripped, "-frames:v", 3);
      expect(stripped).toEqual(without(layeredEncoder, "-vf", 2));
      expect(composite.slice(global, global + 12)).toEqual([
        ...["-ss", "0.000000", "-t", "3.033333", "-i", "/media/vlog.mp4"],
        ...["-f", "concat", "-safe", "0", "-i", "/w/list.ffconcat"],
      ]);
      // The layered encoder's frame filter ends the composite graph unchanged.
      expect(graph.includes(tail)).toBe(true);
    });
  }
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
