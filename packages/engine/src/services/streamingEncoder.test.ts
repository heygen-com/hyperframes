/**
 * buildStreamingArgs unit tests.
 *
 * These tests focus on the FFmpeg CLI shape rather than spawning the encoder
 * — they're the cheap regression net for the HDR static-metadata bug
 * (side_data=[none] in the encoded MP4) reproduced by
 * packages/producer/scripts/hdr-smoke.ts. Without these assertions, future
 * refactors of the x265-params string can silently strip
 * master-display / max-cll and ship as SDR BT.2020 again.
 */

import { EventEmitter } from "events";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStreamingArgs,
  createFrameReorderBuffer,
  type StreamingEncoderOptions,
} from "./streamingEncoder.js";
import { DEFAULT_HDR10_MASTERING } from "../utils/hdr.js";

const baseHdrPq: StreamingEncoderOptions = {
  fps: 30,
  width: 1920,
  height: 1080,
  codec: "h265",
  preset: "medium",
  quality: 23,
  pixelFormat: "yuv420p10le",
  useGpu: false,
  rawInputFormat: "rgb48le",
  hdr: { transfer: "pq" },
};

const baseHdrHlg: StreamingEncoderOptions = {
  ...baseHdrPq,
  hdr: { transfer: "hlg" },
};

const baseSdr: StreamingEncoderOptions = {
  fps: 30,
  width: 1920,
  height: 1080,
  codec: "h264",
  preset: "medium",
  quality: 23,
  useGpu: false,
};

function getX265ParamsValue(args: string[]): string | undefined {
  const idx = args.indexOf("-x265-params");
  return idx === -1 ? undefined : args[idx + 1];
}

describe("buildStreamingArgs", () => {
  describe("HDR PQ (libx265)", () => {
    it("emits master-display and max-cll in -x265-params", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265).toBeDefined();
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
      expect(x265).toContain(`max-cll=${DEFAULT_HDR10_MASTERING.maxCll}`);
      expect(x265).toContain("colorprim=bt2020");
      expect(x265).toContain("transfer=smpte2084");
      expect(x265).toContain("colormatrix=bt2020nc");
    });

    it("tags the output stream with bt2020 / smpte2084 / tv range", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      expect(args).toContain("-colorspace:v");
      expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
      expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
      expect(args[args.indexOf("-color_trc:v") + 1]).toBe("smpte2084");
      expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    });

    it("uses libx265 with -tag:v hvc1 for QuickTime compatibility", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const cvIdx = args.indexOf("-c:v");
      expect(cvIdx).toBeGreaterThan(-1);
      expect(args[cvIdx + 1]).toBe("libx265");
      expect(args).toContain("-tag:v");
      expect(args[args.indexOf("-tag:v") + 1]).toBe("hvc1");
    });

    it("keeps the aq-mode prefix even with master-display present", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265?.startsWith("aq-mode=3")).toBe(true);
    });

    it("uses the simpler aq-mode prefix on ultrafast preset", () => {
      const args = buildStreamingArgs({ ...baseHdrPq, preset: "ultrafast" }, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265?.startsWith("aq-mode=3:")).toBe(true);
      expect(x265).not.toContain("aq-strength");
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
    });
  });

  describe("HDR HLG (libx265)", () => {
    it("emits master-display, max-cll, and the HLG transfer", () => {
      const args = buildStreamingArgs(baseHdrHlg, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265).toContain("transfer=arib-std-b67");
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
      expect(x265).toContain(`max-cll=${DEFAULT_HDR10_MASTERING.maxCll}`);
    });

    it("tags the output stream with arib-std-b67", () => {
      const args = buildStreamingArgs(baseHdrHlg, "/tmp/out.mp4");
      expect(args[args.indexOf("-color_trc:v") + 1]).toBe("arib-std-b67");
    });
  });

  describe("HDR raw input tagging", () => {
    it("tags the rawvideo input with the matching color metadata", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const inputColorTrcIdx = args.indexOf("-color_trc");
      expect(inputColorTrcIdx).toBeGreaterThan(-1);
      expect(args[inputColorTrcIdx + 1]).toBe("smpte2084");
      const inputPrimariesIdx = args.indexOf("-color_primaries");
      expect(inputPrimariesIdx).toBeGreaterThan(-1);
      expect(args[inputPrimariesIdx + 1]).toBe("bt2020");
      // Pix_fmt of the raw input must match the buffer we hand FFmpeg.
      expect(args.indexOf("rgb48le")).toBeGreaterThan(-1);
    });

    it("does not strip the input color tags when bitrate is set instead of CRF", () => {
      const args = buildStreamingArgs({ ...baseHdrPq, bitrate: "20M" }, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
      expect(args).toContain("-b:v");
      expect(args[args.indexOf("-b:v") + 1]).toBe("20M");
    });
  });

  describe("SDR fallback", () => {
    it("does NOT emit HDR mastering metadata for SDR encodes", () => {
      const args = buildStreamingArgs(baseSdr, "/tmp/out.mp4");
      const x264 = args[args.indexOf("-x264-params") + 1];
      expect(x264).toContain("colorprim=bt709");
      expect(x264).toContain("transfer=bt709");
      expect(x264).toContain("colormatrix=bt709");
      expect(x264).not.toContain("master-display");
      expect(x264).not.toContain("max-cll");
    });

    it("tags SDR output with bt709 and tv range", () => {
      const args = buildStreamingArgs(baseSdr, "/tmp/out.mp4");
      expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
      expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt709");
      expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
      expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    });
  });

  describe("output path", () => {
    it("places the output path last after -y", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/some-output.mp4");
      expect(args[args.length - 2]).toBe("-y");
      expect(args[args.length - 1]).toBe("/tmp/some-output.mp4");
    });
  });

  describe("GPU preset mapping", () => {
    const baseGpu: StreamingEncoderOptions = {
      fps: 30,
      width: 1920,
      height: 1080,
      codec: "h264",
      preset: "ultrafast",
      quality: 28,
      useGpu: true,
    };

    function presetArg(args: string[]): string | undefined {
      const idx = args.indexOf("-preset");
      return idx === -1 ? undefined : args[idx + 1];
    }

    // Regression for the streaming-encode + --gpu failure: NVENC rejects
    // libx264 `ultrafast` with AVERROR(EINVAL), which previously surfaced
    // as a bare "FFmpeg exited with code -22".
    it("translates ultrafast to NVENC p1", () => {
      const args = buildStreamingArgs(baseGpu, "/tmp/out.mp4", "nvenc");
      expect(presetArg(args)).toBe("p1");
    });

    it("translates medium to NVENC p4", () => {
      const args = buildStreamingArgs({ ...baseGpu, preset: "medium" }, "/tmp/out.mp4", "nvenc");
      expect(presetArg(args)).toBe("p4");
    });

    // Same mapping applies to hevc_nvenc: NVENC's preset vocabulary is
    // codec-agnostic, so the helper must translate for H.265 too.
    it("translates libx264 preset names to NVENC pN for h265 as well", () => {
      for (const [libx264, nvencPreset] of [
        ["ultrafast", "p1"],
        ["medium", "p4"],
        ["veryslow", "p7"],
      ] as const) {
        const args = buildStreamingArgs(
          { ...baseGpu, codec: "h265", preset: libx264 },
          "/tmp/out.mp4",
          "nvenc",
        );
        expect(args[args.indexOf("-c:v") + 1]).toBe("hevc_nvenc");
        expect(presetArg(args)).toBe(nvencPreset);
      }
    });

    it("rewrites QSV's unsupported ultrafast preset to veryfast", () => {
      const args = buildStreamingArgs(baseGpu, "/tmp/out.mp4", "qsv");
      expect(presetArg(args)).toBe("veryfast");
    });

    it("passes QSV-supported preset names through unchanged", () => {
      const args = buildStreamingArgs({ ...baseGpu, preset: "medium" }, "/tmp/out.mp4", "qsv");
      expect(presetArg(args)).toBe("medium");
    });
  });
});

describe("createFrameReorderBuffer", () => {
  it("fast-paths waitForFrame(cursor) without queueing", async () => {
    const buf = createFrameReorderBuffer(0, 3);
    await buf.waitForFrame(0);
  });

  it("gates out-of-order writers into cursor order", async () => {
    const buf = createFrameReorderBuffer(0, 4);
    const writeOrder: number[] = [];

    const writer = async (frame: number) => {
      await buf.waitForFrame(frame);
      writeOrder.push(frame);
      buf.advanceTo(frame + 1);
    };

    const p3 = writer(3);
    const p1 = writer(1);
    const p2 = writer(2);
    const p0 = writer(0);

    await Promise.all([p0, p1, p2, p3]);
    expect(writeOrder).toEqual([0, 1, 2, 3]);
  });

  it("supports multiple waiters registered for the same frame", async () => {
    const buf = createFrameReorderBuffer(0, 2);
    const resolved: string[] = [];

    const a = buf.waitForFrame(1).then(() => resolved.push("a"));
    const b = buf.waitForFrame(1).then(() => resolved.push("b"));

    buf.advanceTo(0);
    await Promise.resolve();
    expect(resolved).toEqual([]);

    buf.advanceTo(1);
    await Promise.all([a, b]);
    expect(resolved.sort()).toEqual(["a", "b"]);
  });

  it("waitForAllDone resolves when cursor reaches endFrame", async () => {
    const buf = createFrameReorderBuffer(0, 3);
    let done = false;
    const allDone = buf.waitForAllDone().then(() => {
      done = true;
    });

    buf.advanceTo(1);
    await Promise.resolve();
    expect(done).toBe(false);

    buf.advanceTo(3);
    await allDone;
    expect(done).toBe(true);
  });

  it("waitForAllDone fast-paths when cursor already past endFrame", async () => {
    const buf = createFrameReorderBuffer(0, 3);
    buf.advanceTo(5);
    await buf.waitForAllDone();
  });
});

interface FakeStdin extends EventEmitter {
  destroyed: boolean;
  end: (cb?: () => void) => void;
  write: (chunk: Buffer) => boolean;
}

interface FakeProc extends EventEmitter {
  stdin: FakeStdin;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  proc: FakeProc;
}

function createFakeStdin(): FakeStdin {
  const state = { destroyed: false };
  const stdin = new EventEmitter() as FakeStdin;
  Object.defineProperty(stdin, "destroyed", {
    get: () => state.destroyed,
    set: (v: boolean) => {
      state.destroyed = v;
    },
  });
  stdin.end = (cb?: () => void) => {
    state.destroyed = true;
    if (cb) process.nextTick(cb);
  };
  stdin.write = (_chunk: Buffer): boolean => !state.destroyed;
  return stdin;
}

function createFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdin = createFakeStdin();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

function createSpawnSpy(): {
  spawn: (command: string, args: readonly string[]) => FakeProc;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: readonly string[]): FakeProc => {
    const proc = createFakeProc();
    calls.push({ command, args, proc });
    return proc;
  };
  return { spawn, calls };
}

const baseOptions: StreamingEncoderOptions = {
  fps: 30,
  width: 100,
  height: 100,
  codec: "h264",
  useGpu: false,
};

describe("spawnStreamingEncoder lifecycle and cleanup", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
  });

  it("returns a success result when ffmpeg exits cleanly after close()", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { spawnStreamingEncoder } = await import("./streamingEncoder.js");
    const dir = mkdtempSync(join(tmpdir(), "se-success-"));
    const encoder = await spawnStreamingEncoder(join(dir, "out.mp4"), baseOptions);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("ffmpeg");

    const proc = calls[0]!.proc;
    const closePromise = encoder.close();
    process.nextTick(() => proc.emit("close", 0));

    const result = await closePromise;
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.fileSize).toBe(0); // No real ffmpeg, no file written
  });

  it("returns a failure result (does NOT throw) when ffmpeg exits non-zero before close()", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { spawnStreamingEncoder } = await import("./streamingEncoder.js");
    const dir = mkdtempSync(join(tmpdir(), "se-fail-"));
    const encoder = await spawnStreamingEncoder(join(dir, "out.mp4"), baseOptions);

    const proc = calls[0]!.proc;
    proc.stderr.emit("data", Buffer.from("Encoder error\n"));
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        proc.emit("close", 1);
        resolve();
      });
    });

    const result = await encoder.close();
    expect(result.success).toBe(false);
    expect(result.error).toContain("FFmpeg exited with code 1");
    expect(result.error).toContain("Encoder error");
  });

  it("returns a failure result (does NOT throw) when ffmpeg fails to spawn (ENOENT)", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { spawnStreamingEncoder } = await import("./streamingEncoder.js");
    const dir = mkdtempSync(join(tmpdir(), "se-enoent-"));
    const encoder = await spawnStreamingEncoder(join(dir, "out.mp4"), baseOptions);

    const proc = calls[0]!.proc;
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        const err = new Error("spawn ffmpeg ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        proc.emit("error", err);
        resolve();
      });
    });

    const result = await encoder.close();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spawn ffmpeg ENOENT/);
  });

  it("returns a 'cancelled' result and SIGTERMs ffmpeg when the abort signal fires", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { spawnStreamingEncoder } = await import("./streamingEncoder.js");
    const controller = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), "se-abort-"));
    const encoder = await spawnStreamingEncoder(
      join(dir, "out.mp4"),
      baseOptions,
      controller.signal,
    );

    const proc = calls[0]!.proc;
    controller.abort();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    process.nextTick(() => proc.emit("close", null));
    const result = await encoder.close();

    expect(result.success).toBe(false);
    expect(result.error).toBe("Streaming encode cancelled");
  });

  it("close() is idempotent: a second call still resolves to a result and does not throw", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { spawnStreamingEncoder } = await import("./streamingEncoder.js");
    const dir = mkdtempSync(join(tmpdir(), "se-idempotent-"));
    const encoder = await spawnStreamingEncoder(join(dir, "out.mp4"), baseOptions);

    const proc = calls[0]!.proc;
    process.nextTick(() => proc.emit("close", 0));

    const first = await encoder.close();
    expect(first.success).toBe(true);

    // Defensive cleanup in renderOrchestrator may call close() again after the
    // explicit call. Verify the second call doesn't reject — it can return
    // either success (cached) or a benign failure result, but must not throw.
    let threw = false;
    try {
      const second = await encoder.close();
      expect(typeof second.success).toBe("boolean");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("writeFrame returns false after ffmpeg has exited", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { spawnStreamingEncoder } = await import("./streamingEncoder.js");
    const dir = mkdtempSync(join(tmpdir(), "se-writefail-"));
    const encoder = await spawnStreamingEncoder(join(dir, "out.mp4"), baseOptions);

    expect(encoder.writeFrame(Buffer.from([0]))).toBe(true);

    const proc = calls[0]!.proc;
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        proc.emit("close", 0);
        resolve();
      });
    });

    expect(encoder.writeFrame(Buffer.from([0]))).toBe(false);
  });

  it("close() removes the abort listener so a post-close abort does not re-kill ffmpeg", async () => {
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { spawnStreamingEncoder } = await import("./streamingEncoder.js");
    const controller = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), "se-detach-"));
    const encoder = await spawnStreamingEncoder(
      join(dir, "out.mp4"),
      baseOptions,
      controller.signal,
    );

    const proc = calls[0]!.proc;
    process.nextTick(() => proc.emit("close", 0));
    await encoder.close();

    expect(proc.kill).not.toHaveBeenCalled();

    controller.abort();
    expect(proc.kill).not.toHaveBeenCalled();
  });
});
