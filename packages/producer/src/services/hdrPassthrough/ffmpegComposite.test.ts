import { describe, expect, it } from "bun:test";
import type { Fps } from "@hyperframes/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStreamingArgs,
  getEncoderPreset,
  type GpuEncoder,
  type HdrTransfer,
  type StreamingEncoder,
} from "@hyperframes/engine";
import {
  buildCompositeDecodeArgs,
  buildOverlayConcatList,
  type CompositeDeps,
  compositeAndEncode,
  compositeEncoderOptions,
} from "./ffmpegComposite.js";
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
  "[0:v]fps=30:start_time=0,scale=threads=4,format=rgb48le,scale=threads=4,format=gbrp16le[v]",
  "[1:v]format=rgba64le,split[oc][oa]",
  "[oc]format=gbrp16le,fps=30:start_time=0[o]",
  "[oa]extractplanes=a,mergeplanes=0x000000:gbrp16le,fps=30:start_time=0[m]",
  "[v][o][m]maskedmerge,scale=threads=4,format=rgb48le[vout]",
].join(";");

describe("buildCompositeDecodeArgs", () => {
  it("composites the overlays onto the source and writes raw rgb48le frames", () => {
    expect(buildCompositeDecodeArgs(request(), "/w/list.ffconcat")).toEqual([
      ...["-hide_banner", "-nostdin", "-v", "error"],
      ...["-ss", "0.000000", "-t", "3.033333", "-i", "/media/vlog.mp4"],
      ...["-f", "concat", "-safe", "0", "-i", "/w/list.ffconcat"],
      ...["-filter_complex", GRAPH_1080, "-map", "[vout]", "-frames:v", "90", "-an"],
      ...["-f", "rawvideo", "-pix_fmt", "rgb48le", "pipe:1"],
    ]);
  });

  it("leaves encoding, colour tags and the encoder's frame filter to the layered encoder", () => {
    const args = buildCompositeDecodeArgs(request({ transfer: "pq" }), "/w/list.ffconcat");
    for (const flag of ["-c:v", "-x265-params", "-color_trc:v", "-vf", "-y", "-dolbyvision"]) {
      expect(args).not.toContain(flag);
    }
    expect(args[args.indexOf("-filter_complex") + 1]).not.toContain("setparams");
  });

  it("seeks to the normalized trim offset", () => {
    const args = buildCompositeDecodeArgs(
      request({ mediaStart: 12.5, mediaTimeOffsetSeconds: 0.5 }),
      "/w/list.ffconcat",
    );
    expect(args.slice(4, 8)).toEqual(["-ss", "12.000000", "-t", "3.033333"]);
  });

  it("keeps a negative seek when the streams start after mediaStart, like the layered extraction", () => {
    // Streams starting 0.178 s into the file with mediaStart 0: ffmpeg must read from the start
    // and keep the lead (the fps filter holds the first frame), not play the video early.
    const args = buildCompositeDecodeArgs(
      request({ mediaStart: 0, mediaTimeOffsetSeconds: 0.178 }),
      "/w/list.ffconcat",
    );
    expect(args.slice(4, 8)).toEqual(["-ss", "-0.178000", "-t", "3.033333"]);
    const partial = buildCompositeDecodeArgs(
      request({ mediaStart: 0.1, mediaTimeOffsetSeconds: 0.178 }),
      "/w/list.ffconcat",
    );
    expect(partial[5]).toBe("-0.078000");
  });

  it("scales and crops a same-aspect source like the HDR frame extraction", () => {
    const args = buildCompositeDecodeArgs(
      request({ sourceSize: { width: 3840, height: 2160 } }),
      "/w/list.ffconcat",
    );
    expect(args[args.indexOf("-filter_complex") + 1]).toStartWith(
      "[0:v]fps=30:start_time=0,scale=1920:1080:force_original_aspect_ratio=increase:threads=4,crop=1920:1080,format=rgb48le,scale=threads=4,format=gbrp16le[v];",
    );
  });
});

describe("encoder parity with the layered HDR encoder", () => {
  const cases: ReadonlyArray<{
    name: string;
    overrides: RequestOverrides;
    encoder: GpuEncoder;
    nvencPresets?: ReadonlySet<string>;
  }> = [
    { name: "software CRF", overrides: {}, encoder: null },
    {
      name: "software bitrate with delivery caps",
      overrides: { effectiveBitrate: "20M", maxBitrate: "25M", bufferSize: "50M" },
      encoder: null,
    },
    { name: "PQ", overrides: { transfer: "pq" }, encoder: null },
    { name: "GPU requested, none detected", overrides: { useGpu: true }, encoder: null },
    {
      name: "nvenc",
      overrides: { useGpu: true },
      encoder: "nvenc",
      nvencPresets: new Set(["p4"]),
    },
    { name: "vaapi", overrides: { useGpu: true }, encoder: "vaapi" },
  ];
  for (const c of cases) {
    it(`${c.name}: the encoder's command line is the layered stage's, byte for byte`, () => {
      const req = request(c.overrides);
      const { preset } = req.encoder;
      // The options `captureHdrStage` passes to `spawnStreamingEncoder`.
      const layered = {
        fps: req.plan.fps,
        width: req.plan.width,
        height: req.plan.height,
        codec: preset.codec,
        useGpu: req.encoder.useGpu,
        preset: preset.preset,
        quality: req.encoder.effectiveQuality,
        bitrate: req.encoder.effectiveBitrate,
        ...req.encoder.deliveryEncoder,
        pixelFormat: preset.pixelFormat,
        hdr: preset.hdr,
        rawInputFormat: "rgb48le" as const,
      };
      const presets = c.nvencPresets as Set<string> | undefined;
      expect(compositeEncoderOptions(req)).toEqual(layered);
      expect(
        buildStreamingArgs(compositeEncoderOptions(req), req.outputPath, c.encoder, presets),
      ).toEqual(buildStreamingArgs(layered, req.outputPath, c.encoder, presets));
    });
  }
});

/** A fake encoder process that logs what happens to it. */
function fakeEncoder(log: string[], opts: { failAt?: number; frames?: number } = {}) {
  let written = 0;
  const encoder: StreamingEncoder = {
    pid: 4242,
    writeFrame: async (frame) => {
      if (opts.failAt === written) return false;
      log.push(`write ${written} ${frame.length}`);
      written++;
      return true;
    },
    close: async (onEncoded) => {
      log.push("close");
      onEncoded?.(opts.frames ?? written);
      return { success: true, durationMs: 5, fileSize: 100 };
    },
    getExitStatus: () => "running",
    getExitError: () => "boom",
  };
  return encoder;
}

/** Composite stdout split into uneven chunks, so frames straddle chunk boundaries. */
function chunked(total: number, chunk: number): AsyncIterable<Buffer> {
  return (async function* () {
    for (let at = 0; at < total; at += chunk) yield Buffer.alloc(Math.min(chunk, total - at));
  })();
}

describe("compositeAndEncode", () => {
  const small = (): CompositeRequest => {
    const req = request();
    const plan = { ...req.plan, width: 4, height: 2, totalFrames: 3 };
    return {
      ...req,
      plan,
      workDir: mkdtempSync(join(tmpdir(), "hdr-composite-unit-")),
      outputPath: join(tmpdir(), "hdr-composite-unit-out", "video-only.mp4"),
    };
  };
  const FRAME = 4 * 2 * 6;

  function deps(log: string[], encoder: StreamingEncoder, bytes: number): CompositeDeps {
    return {
      spawnEncoder: async (_path, options) => {
        log.push(`spawn ${options.rawInputFormat}`);
        return encoder;
      },
      spawnComposite: () => ({
        frames: chunked(bytes, 7),
        wait: async () => ({ ok: true, error: "" }),
      }),
      waitForEncoder: async (pid, options) => {
        log.push(`idle ${pid} ${options.calmPolls}`);
      },
    };
  }

  it("hands the layered encoder one frame at a time, each once it has gone idle", async () => {
    const log: string[] = [];
    const heard: number[] = [];
    const req = { ...small(), onFramesEncoded: (n: number) => heard.push(n) };
    const result = await compositeAndEncode(req, deps(log, fakeEncoder(log), 3 * FRAME));
    expect(log).toEqual([
      "spawn rgb48le",
      `write 0 ${FRAME}`,
      "idle 4242 3",
      `write 1 ${FRAME}`,
      "idle 4242 3",
      `write 2 ${FRAME}`,
      "idle 4242 3",
      "close",
    ]);
    expect(heard).toEqual([1, 2, 3]);
    expect(result.framesEncoded).toBe(3);
  });

  it("fails when the composite ends inside a frame or short of the plan", async () => {
    const log: string[] = [];
    await expect(
      compositeAndEncode(small(), deps(log, fakeEncoder(log), 2 * FRAME + 5)),
    ).rejects.toThrow("ended inside a frame");
    await expect(compositeAndEncode(small(), deps([], fakeEncoder([]), 2 * FRAME))).rejects.toThrow(
      "wrote 2 frames, expected 3",
    );
  });

  it("fails when the encoder stops or reports another frame count", async () => {
    await expect(
      compositeAndEncode(small(), deps([], fakeEncoder([], { failAt: 1 }), 3 * FRAME)),
    ).rejects.toThrow("the encoder stopped: boom");
    await expect(
      compositeAndEncode(small(), deps([], fakeEncoder([], { frames: 2 }), 3 * FRAME)),
    ).rejects.toThrow("encoded 2 frames, expected 3");
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
