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
import { PassThrough } from "node:stream";
import { writeFileSync } from "node:fs";
import {
  buildCompositeDecodeArgs,
  type CompositeDeps,
  compositeAndEncode,
  compositeEncoderOptions,
  createOverlayFrameQueue,
  feedOverlays,
  readAhead,
  readAheadDepth,
} from "./ffmpegComposite.js";
import { EncoderPacingError } from "./encoderPacing.js";
import type { CompositeRequest, OverlayPlan, OverlayState, PassthroughVideo } from "./types.js";

const FPS_30: Fps = { num: 30, den: 1 };

function state(index: number, startFrame: number, endFrame: number): OverlayState {
  return {
    index,
    startFrame,
    endFrame,
    captureFrame: Math.floor((startFrame + endFrame - 1) / 2),
  };
}

/** The overlay PNG of each frame, as capture hands them over. */
async function* framesOf(paths: string[]): AsyncIterable<string> {
  yield* paths;
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
    overlayFrames: framesOf([]),
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
    expect(buildCompositeDecodeArgs(request())).toEqual([
      ...["-hide_banner", "-nostdin", "-v", "error"],
      ...["-ss", "0.000000", "-t", "3.033333", "-i", "/media/vlog.mp4"],
      ...["-probesize", "32", "-analyzeduration", "0", "-threads", "1"],
      ...["-f", "image2pipe", "-c:v", "png", "-framerate", "30", "-i", "pipe:0"],
      ...["-filter_complex", GRAPH_1080, "-map", "[vout]", "-frames:v", "90", "-an"],
      ...["-f", "rawvideo", "-pix_fmt", "rgb48le", "pipe:1"],
    ]);
  });

  it("leaves encoding, colour tags and the encoder's frame filter to the layered encoder", () => {
    const args = buildCompositeDecodeArgs(request({ transfer: "pq" }));
    // `-c:v png` names the overlay input's decoder; no output option sets a codec.
    const output = args.slice(args.lastIndexOf("-i") + 2);
    for (const flag of ["-c:v", "-x265-params", "-color_trc:v", "-vf", "-y", "-dolbyvision"]) {
      expect(output).not.toContain(flag);
    }
    expect(args).not.toContain("-x265-params");
    expect(args[args.indexOf("-filter_complex") + 1]).not.toContain("setparams");
  });

  it("seeks to the normalized trim offset", () => {
    const args = buildCompositeDecodeArgs(
      request({ mediaStart: 12.5, mediaTimeOffsetSeconds: 0.5 }),
    );
    expect(args.slice(4, 8)).toEqual(["-ss", "12.000000", "-t", "3.033333"]);
  });

  it("keeps a negative seek when the streams start after mediaStart, like the layered extraction", () => {
    // Streams starting 0.178 s into the file with mediaStart 0: ffmpeg must read from the start
    // and keep the lead (the fps filter holds the first frame), not play the video early.
    const args = buildCompositeDecodeArgs(
      request({ mediaStart: 0, mediaTimeOffsetSeconds: 0.178 }),
    );
    expect(args.slice(4, 8)).toEqual(["-ss", "-0.178000", "-t", "3.033333"]);
    const partial = buildCompositeDecodeArgs(
      request({ mediaStart: 0.1, mediaTimeOffsetSeconds: 0.178 }),
    );
    expect(partial[5]).toBe("-0.078000");
  });

  it("scales and crops a same-aspect source like the HDR frame extraction", () => {
    const args = buildCompositeDecodeArgs(request({ sourceSize: { width: 3840, height: 2160 } }));
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

/** Three frames' overlay PNG paths (two distinct files), written to a fresh directory. */
function threePngs(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "hdr-composite-png-"));
  const [a, b] = [join(dir, "a.png"), join(dir, "b.png")];
  writeFileSync(a, "png-a");
  writeFileSync(b, "png-b");
  return [a, a, b];
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
      overlayFrames: framesOf(threePngs()),
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
        overlays: new PassThrough().resume(),
        frames: chunked(bytes, 7),
        wait: async () => ({ ok: true, error: "" }),
        drop: () => {
          log.push("drop composite");
        },
      }),
      watchEncoder: async (pid) => {
        log.push(`watch ${pid}`);
        return {
          check: () => {
            log.push(`check ${pid}`);
          },
          waitUntilIdle: async (options) => {
            log.push(`idle ${pid} ${options.calmPolls}`);
          },
        };
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
      "watch 4242",
      "check 4242",
      `write 0 ${FRAME}`,
      "idle 4242 3",
      "check 4242",
      `write 1 ${FRAME}`,
      "idle 4242 3",
      "check 4242",
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

describe("compositeAndEncode pacing guards", () => {
  const req = (): CompositeRequest => {
    const base = request();
    return {
      ...base,
      plan: { ...base.plan, width: 4, height: 2, totalFrames: 3 },
      overlayFrames: framesOf(threePngs()),
      outputPath: join(tmpdir(), "hdr-composite-guard-out", "video-only.mp4"),
    };
  };
  const FRAME = 4 * 2 * 6;
  /** Deps whose encoder is refused by `watch`, or by the pacer's `check` from some frame on. */
  const guarded = (
    watch: () => Promise<void>,
    log: string[],
    check: () => void = () => undefined,
  ): CompositeDeps => ({
    spawnEncoder: async () => fakeEncoder(log),
    spawnComposite: () => ({
      overlays: new PassThrough().resume(),
      frames: chunked(3 * FRAME, 7),
      wait: async () => ({ ok: true, error: "" }),
      drop: () => {
        log.push("drop composite");
      },
    }),
    watchEncoder: async () => {
      await watch();
      return { check, waitUntilIdle: async () => undefined };
    },
  });

  it("declines before the first frame when the encoder process cannot be paced", async () => {
    const log: string[] = [];
    const refuse = async () => {
      throw new EncoderPacingError("the encoder process is sh, not ffmpeg");
    };
    let compositeSpawned = false;
    const deps = guarded(refuse, log);
    const spawn = deps.spawnComposite;
    deps.spawnComposite = (...args) => {
      compositeSpawned = true;
      return spawn(...args);
    };
    await expect(compositeAndEncode(req(), deps)).rejects.toBeInstanceOf(EncoderPacingError);
    expect(log.filter((entry) => entry.startsWith("write"))).toEqual([]);
    expect(log).toContain("close");
    // Refused before the composite starts, so nothing is left reading overlays.
    expect(compositeSpawned).toBe(false);
  });

  it("declines when the encoder process starts a child mid-encode", async () => {
    const log: string[] = [];
    let checks = 0;
    const forksLater = () => {
      if (++checks === 2) throw new EncoderPacingError("the encoder process started 1 process(es)");
    };
    await expect(
      compositeAndEncode(
        req(),
        guarded(async () => undefined, log, forksLater),
      ),
    ).rejects.toThrow("started 1 process(es)");
    expect(log.filter((entry) => entry.startsWith("write"))).toEqual([`write 0 ${FRAME}`]);
    // The composite's pipes are dropped, so a process it left behind cannot hold the encode open.
    expect(log).toContain("drop composite");
  });
});

describe("readAhead", () => {
  it("yields every item in order and asks the source ahead of the consumer", async () => {
    const asked: number[] = [];
    async function* source() {
      for (let i = 0; i < 5; i++) {
        asked.push(i);
        yield i;
      }
    }
    const seen: Array<[number, number]> = [];
    for await (const item of readAhead(source(), 3)) {
      // Let the queued requests run before reading how far the source got.
      await new Promise((done) => setTimeout(done, 1));
      seen.push([item, asked.length]);
    }
    expect(seen.map(([item]) => item)).toEqual([0, 1, 2, 3, 4]);
    // While the consumer holds item 0 the source has produced up to item 3.
    expect(seen[0]?.[1]).toBe(4);
  });

  it("raises a source failure when its item is reached", async () => {
    async function* source() {
      yield 1;
      throw new Error("composite failed");
    }
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const item of readAhead(source(), 4)) seen.push(item);
      })(),
    ).rejects.toThrow("composite failed");
    expect(seen).toEqual([1]);
  });

  it("holds a few frames whatever their size", () => {
    expect(readAheadDepth(1920 * 1080 * 6)).toBe(4);
    expect(readAheadDepth(3840 * 2160 * 6)).toBe(2);
    expect(readAheadDepth(7680 * 4320 * 6)).toBe(2);
  });
});

describe("feedOverlays", () => {
  const sink = () => {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (chunk: Buffer) => chunks.push(chunk));
    return { out, text: () => Buffer.concat(chunks).toString() };
  };

  it("writes each frame's PNG in order, then ends the composite's input", async () => {
    const { out, text } = sink();
    await feedOverlays(framesOf(threePngs()), out, 3);
    expect(text()).toBe("png-apng-apng-b");
    expect(out.writableEnded).toBe(true);
  });

  it("fails, and stops the composite's input, on a frame count other than the plan's", async () => {
    const short = sink();
    await expect(feedOverlays(framesOf(threePngs()), short.out, 4)).rejects.toThrow(
      "3 overlay frames, expected 4",
    );
    expect(short.out.destroyed).toBe(true);
    await expect(feedOverlays(framesOf(threePngs()), sink().out, 2)).rejects.toThrow(
      "more overlay frames than the plan",
    );
  });

  it("raises capture's failure from the frame queue", async () => {
    const queue = createOverlayFrameQueue();
    const [first] = threePngs();
    const { out, text } = sink();
    const feeding = feedOverlays(queue, out, 3);
    queue.push(first as string);
    await new Promise((done) => setTimeout(done, 5));
    queue.fail(new Error("overlay_unverified at frame 1"));
    await expect(feeding).rejects.toThrow("overlay_unverified at frame 1");
    expect(text()).toBe("png-a");
    expect(out.destroyed).toBe(true);
  });
});

describe("createOverlayFrameQueue", () => {
  it("hands over frames pushed before and after the reader waits, then ends", async () => {
    const queue = createOverlayFrameQueue();
    queue.push("a");
    const seen: string[] = [];
    const reading = (async () => {
      for await (const path of queue) seen.push(path);
    })();
    await new Promise((done) => setTimeout(done, 5));
    queue.push("b");
    queue.end();
    await reading;
    expect(seen).toEqual(["a", "b"]);
    expect(() => queue.push("c")).toThrow("after the last");
  });
});

describe("compositeAndEncode with capture still running", () => {
  it("stops the composite and the encoder, and throws capture's error, when capture fails", async () => {
    const base = request();
    const queue = createOverlayFrameQueue();
    const log: string[] = [];
    let compositeStopped = false;
    const deps: CompositeDeps = {
      spawnEncoder: async () => fakeEncoder(log),
      spawnComposite: (_args, signal) => {
        signal.addEventListener("abort", () => {
          compositeStopped = true;
        });
        return {
          overlays: new PassThrough().resume(),
          // A composite waiting on overlays: no frame until it is stopped.
          frames: (async function* () {
            await new Promise((done) => signal.addEventListener("abort", done));
            yield* [] as Buffer[];
          })(),
          wait: async () => ({ ok: !compositeStopped, error: "killed" }),
          drop: () => {
            log.push("drop composite");
          },
        };
      },
      watchEncoder: async () => ({ check: () => undefined, waitUntilIdle: async () => undefined }),
    };
    const encoding = compositeAndEncode(
      {
        ...base,
        plan: { ...base.plan, width: 4, height: 2, totalFrames: 3 },
        overlayFrames: queue,
        outputPath: join(mkdtempSync(join(tmpdir(), "hdr-composite-fail-")), "v.mp4"),
      },
      deps,
    );
    queue.fail(new Error("video_animated at frame 2"));
    await expect(encoding).rejects.toThrow("video_animated at frame 2");
    expect(compositeStopped).toBe(true);
    expect(log).toContain("close");
  });
});

describe("compositeAndEncode when a process dies", () => {
  const plan = (base: CompositeRequest) => ({ ...base.plan, width: 4, height: 2, totalFrames: 3 });
  const outputPath = () => join(mkdtempSync(join(tmpdir(), "hdr-composite-died-")), "v.mp4");

  /** Deps whose composite stops reading overlays (its stdin fails with EPIPE) and exits as `exit`. */
  function dying(log: string[], exit: { ok: boolean; error: string }, encoder = fakeEncoder(log)) {
    const deps: CompositeDeps = {
      spawnEncoder: async () => encoder,
      spawnComposite: (_args, signal) => {
        const overlays = new PassThrough();
        overlays.on("data", () => {
          const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
          overlays.destroy(epipe);
        });
        return {
          overlays,
          frames: (async function* () {
            await new Promise((done) => signal.addEventListener("abort", done));
            yield* [] as Buffer[];
          })(),
          wait: async () => exit,
          drop: () => {
            log.push("drop composite");
          },
        };
      },
      watchEncoder: async () => ({ check: () => undefined, waitUntilIdle: async () => undefined }),
    };
    return deps;
  }

  it("names the composite's exit code, signal and stderr tail behind a bare write EPIPE", async () => {
    const base = request();
    const log: string[] = [];
    const exit = {
      ok: false,
      error:
        "FFmpeg exited with code 137\nffmpeg stderr (tail):\nout of memory (killed by SIGKILL)",
    };
    const error = await compositeAndEncode(
      { ...base, plan: plan(base), overlayFrames: framesOf(threePngs()), outputPath: outputPath() },
      dying(log, exit),
    ).catch((e) => e);
    expect(error.message).toContain("write EPIPE");
    expect(error.message).toContain("ffmpeg composite failed: FFmpeg exited with code 137");
    expect(error.message).toContain("out of memory (killed by SIGKILL)");
  });

  it("names the encoder's exit and signal when it had exited", async () => {
    const base = request();
    const log: string[] = [];
    const encoder: StreamingEncoder = {
      ...fakeEncoder(log),
      getExitStatus: () => "error",
      getExitError: () =>
        "FFmpeg exited with code 1\nffmpeg stderr (tail):\nCannot allocate memory",
      getExitSignal: () => "SIGSEGV",
    };
    const error = await compositeAndEncode(
      { ...base, plan: plan(base), overlayFrames: framesOf(threePngs()), outputPath: outputPath() },
      dying(log, { ok: true, error: "" }, encoder),
    ).catch((e) => e);
    expect(error.message).toContain("write EPIPE");
    expect(error.message).toContain("encoder: FFmpeg exited with code 1");
    expect(error.message).toContain("Cannot allocate memory (killed by SIGSEGV)");
  });

  it("does not repeat a composite failure the error already names", async () => {
    const base = request();
    const log: string[] = [];
    const deps = dying(log, { ok: false, error: "FFmpeg exited with code 255" });
    deps.spawnComposite = () => ({
      overlays: new PassThrough().resume(),
      frames: chunked(3 * 4 * 2 * 6, 7),
      wait: async () => ({ ok: false, error: "FFmpeg exited with code 255" }),
      drop: () => undefined,
    });
    const error = await compositeAndEncode(
      { ...base, plan: plan(base), overlayFrames: framesOf(threePngs()), outputPath: outputPath() },
      deps,
    ).catch((e) => e);
    expect(error.message).toBe(
      "hdrPassthrough: ffmpeg composite failed: FFmpeg exited with code 255",
    );
  });

  it("throws what failed first, not the feed's failure once it is stopped", async () => {
    const base = request();
    const log: string[] = [];
    const FRAME = 4 * 2 * 6;
    const encoder = fakeEncoder(log);
    const close = encoder.close;
    // Stopping a real encoder takes a while, long enough for the dropped feed to fail first.
    encoder.close = async (onEncoded) => {
      await new Promise((done) => setTimeout(done, 20));
      return close(onEncoded);
    };
    const deps: CompositeDeps = {
      spawnEncoder: async () => encoder,
      spawnComposite: (_args, signal) => {
        // Never read: the feed waits on back-pressure until the composite is dropped.
        const overlays = new PassThrough({ highWaterMark: 1 });
        return {
          overlays,
          frames: (async function* () {
            yield Buffer.alloc(FRAME);
            await new Promise((done) => signal.addEventListener("abort", done));
          })(),
          wait: async () =>
            signal.aborted
              ? { ok: false, error: "FFmpeg exited with code 255" }
              : new Promise(() => {}),
          drop: () => {
            overlays.destroy();
          },
        };
      },
      watchEncoder: async () => ({
        check: () => undefined,
        waitUntilIdle: async () => {
          throw new Error("hdrPassthrough: the encoder did not go idle within 120000 ms");
        },
      }),
    };
    const error = await compositeAndEncode(
      { ...base, plan: plan(base), overlayFrames: framesOf(threePngs()), outputPath: outputPath() },
      deps,
    ).catch((e) => e);
    expect(error.message).toBe("hdrPassthrough: the encoder did not go idle within 120000 ms");
  });

  it("names the encoder's exit when a pacing decline was the encoder exiting", async () => {
    const base = request();
    const log: string[] = [];
    let exited = false;
    const encoder: StreamingEncoder = {
      ...fakeEncoder(log),
      getExitStatus: () => (exited ? "error" : "running"),
      getExitError: () =>
        "FFmpeg exited with code 1\nffmpeg stderr (tail):\nCannot allocate memory",
    };
    const deps = dying(log, { ok: true, error: "" }, encoder);
    deps.watchEncoder = async () => ({
      check: () => undefined,
      waitUntilIdle: async () => {
        // Its threads are gone, and the process exits a moment later.
        setTimeout(() => (exited = true), 50);
        throw new EncoderPacingError("the encoder's thread 12 (vf#0:0) is gone");
      },
    });
    deps.spawnComposite = () => ({
      overlays: new PassThrough().resume(),
      frames: chunked(3 * 4 * 2 * 6, 7),
      wait: async () => ({ ok: true, error: "" }),
      drop: () => undefined,
    });
    const error = await compositeAndEncode(
      { ...base, plan: plan(base), overlayFrames: framesOf(threePngs()), outputPath: outputPath() },
      deps,
    ).catch((e) => e);
    expect(error).not.toBeInstanceOf(EncoderPacingError);
    expect(error.message).toContain("the encoder exited mid-encode");
    expect(error.message).toContain("thread 12 (vf#0:0) is gone");
    expect(error.message).toContain("Cannot allocate memory");
  });

  it("leaves a decline's own error as it is", async () => {
    const base = request();
    const log: string[] = [];
    const deps = dying(log, { ok: false, error: "FFmpeg exited with code 1" });
    deps.watchEncoder = async () => ({
      check: () => {
        throw new EncoderPacingError("the encoder process started 1 process(es) of its own");
      },
      waitUntilIdle: async () => undefined,
    });
    deps.spawnComposite = () => ({
      overlays: new PassThrough().resume(),
      frames: chunked(3 * 4 * 2 * 6, 7),
      wait: async () => ({ ok: false, error: "FFmpeg exited with code 1" }),
      drop: () => undefined,
    });
    const error = await compositeAndEncode(
      { ...base, plan: plan(base), overlayFrames: framesOf(threePngs()), outputPath: outputPath() },
      deps,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(EncoderPacingError);
    expect(error.message).toBe("the encoder process started 1 process(es) of its own");
  });
});
