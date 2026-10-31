import { execFileSync, spawn as realSpawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir, totalmem } from "node:os";
import { basename, dirname, join } from "node:path";
import { hdrToSdrToneMapFilter } from "@hyperframes/core";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { afterEach, describe, expect, it, vi } from "vitest";

const FFMPEG_PATH = "/usr/bin/ffmpeg";
const realFfmpeg = findFfBinary("ffmpeg");
const realFfmpegFilters = realFfmpeg
  ? spawnSync(realFfmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout
  : "";
const canToneMapForReal =
  Boolean(findFfBinary("ffprobe")) && /\szscale\s/.test(realFfmpegFilters ?? "");
const realFfmpegEncoders = realFfmpeg
  ? spawnSync(realFfmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout
  : "";
const canEncodeVpxAlphaForReal =
  Boolean(findFfBinary("ffprobe")) &&
  /\slibvpx\s/.test(realFfmpegEncoders ?? "") &&
  /\slibvpx-vp9\s/.test(realFfmpegEncoders ?? "");

function meanLuma(path: string, filters = "", inputArgs: string[] = []): number {
  const stats = execFileSync(
    realFfmpeg!,
    [
      "-v",
      "error",
      ...inputArgs,
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      `${filters}signalstats,metadata=print:file=-`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  return Number(/YAVG=([\d.]+)/.exec(stats)?.[1]);
}

// Mirrors MAX_CONCURRENT_TRANSCODES in proxyTranscoder.ts (not exported —
// this test file and the module are authored together).
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 8;
// Mirrors PROXY_CHUNK_SECONDS in proxyTranscoder.ts.
const PIECE_SECONDS = 15;

type FakeProc = EventEmitter & {
  stderr: EventEmitter;
  stdout: EventEmitter;
  kill: (signal?: string) => void;
};

function createFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill = vi.fn((signal?: string) => void proc.emit("close", null, signal));
  return proc;
}

type SpawnOptions = { windowsHide?: boolean; signal?: AbortSignal };
type SpawnCall = { command: string; args: string[]; options?: SpawnOptions; proc: FakeProc };
type SpawnImpl = (command: string, args: string[], options?: SpawnOptions) => FakeProc;

function createSpawnSpy(): { spawn: SpawnImpl; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnImpl = (command, args, options) => {
    const proc = createFakeProc();
    calls.push({ command, args, options, proc });
    return proc;
  };
  return { spawn, calls };
}

/** Mimics ffmpeg writing its output file before exiting 0. */
function succeed(call: SpawnCall, contents = "fake-h264-bytes"): void {
  const outputPath = call.args.at(-1);
  if (!outputPath) throw new Error("spawn call had no output path arg");
  writeFileSync(outputPath, contents);
  call.proc.emit("close", 0);
}

function fail(call: SpawnCall, code = 1, stderr = "boom"): void {
  call.proc.stderr.emit("data", Buffer.from(stderr));
  call.proc.emit("close", code);
}

async function flush(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** One more source than the queue can hold, to prove a batch never overflows it. */
function batchSources(projectDir: string): Array<{ sourcePath: string; variant: "h264" }> {
  return Array.from({ length: MAX_CONCURRENT + MAX_QUEUED + 1 }, (_, i) => {
    const sourcePath = join(projectDir, `batch-${i}.mov`);
    writeFileSync(sourcePath, `source-${i}`);
    return { sourcePath, variant: "h264" };
  });
}

/** Answers every ffmpeg spawn until no new one starts. A finished copy reaches the
 * next spawn through several promise hops, hence the deep flush. */
async function answerUntilIdle(
  calls: SpawnCall[],
  answer: (call: SpawnCall) => void,
): Promise<void> {
  for (let done = 0; ; done = calls.length) {
    await flush(50);
    if (calls.length === done) return;
    calls.slice(done).forEach(answer);
  }
}

const tempDirs: string[] = [];

/** The copies in a cache folder, leaving out the small index files that find them again. */
function copiesIn(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => !/^\.(?:fast|content)-/.test(name));
}

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-proxy-transcoder-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
  vi.doUnmock("node:child_process");
  vi.doUnmock("@hyperframes/parsers/ff-binaries");
  delete process.env.HYPERFRAMES_PROXY_MAX_CONCURRENCY;
  delete process.env.HYPERFRAMES_PROXY_MAX_QUEUE;
});

async function loadModule(
  spawn: SpawnImpl,
  ffmpegPath: string | undefined,
  isHdr = false,
  hdrTransfer: string | null = isHdr ? "pq" : null,
  codecName?: string,
  durationSeconds?: number,
  streams?: string[],
): Promise<typeof import("./proxyTranscoder.js")> {
  vi.resetModules();
  vi.doMock("node:child_process", () => {
    const mocked = { spawn };
    return { ...mocked, default: mocked };
  });
  vi.doMock("@hyperframes/parsers/ff-binaries", () => ({
    findFfBinary: () => ffmpegPath,
  }));
  vi.doMock("./mediaMetadata.js", () => ({
    probeMediaMetadata: async () => ({
      kind: "video",
      color: { isHdr, hdrTransfer, codecName },
      durationSeconds,
      streams,
    }),
    probeFirstFrameColour: async () => ({}),
  }));
  return import("./proxyTranscoder.js");
}

describe("resolveProxy on a long source", () => {
  // Three pieces: two full ones and a last that takes the remainder.
  const LONG_SECONDS = 3 * PIECE_SECONDS + 5;
  const startsOf = (calls: SpawnCall[]): string[] =>
    calls
      .filter((call) => call.args.includes("-ss"))
      .map((call) => call.args[call.args.indexOf("-ss") + 1]!);

  it("copies in pieces, and a stopped copy continues from its finished pieces", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, getProxyCachePath, clearFailedTranscodesForTest } = await loadModule(
      spawn,
      FFMPEG_PATH,
      false,
      null,
      undefined,
      LONG_SECONDS,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "long.mov");
    writeFileSync(sourcePath, "source-bytes");
    const cachePath = getProxyCachePath(projectDir, sourcePath);
    const cacheDirectory = join(projectDir, ".transcode-cache");

    const first = resolveProxy(projectDir, sourcePath).catch((error: unknown) => error);
    await flush();
    succeed(calls[0]!);
    await flush(50);
    calls[1]!.proc.emit("close", null, "SIGKILL");
    expect(await first).toBeInstanceOf(Error);
    expect(startsOf(calls)).toEqual(["0", String(PIECE_SECONDS)]);
    expect(readdirSync(cacheDirectory)).toHaveLength(1);

    clearFailedTranscodesForTest();
    const heard: Array<{ doneSeconds: number; totalSeconds?: number }> = [];
    const second = resolveProxy(projectDir, sourcePath, "h264", undefined, {
      onProgress: (progress) => heard.push(progress),
    });
    for (let answered = calls.length; ; answered = calls.length) {
      await flush(50);
      if (calls.length === answered) break;
      calls.slice(answered).forEach((call) => succeed(call));
    }

    expect(await second).toBe(cachePath);
    // Only the pieces that were missing were encoded again; the last one runs to the end.
    expect(startsOf(calls)).toEqual([
      "0",
      String(PIECE_SECONDS),
      String(PIECE_SECONDS),
      String(2 * PIECE_SECONDS),
    ]);
    // The retry says at once how much the stopped run left done, then counts on from it.
    expect(heard[0]).toEqual({ doneSeconds: PIECE_SECONDS, totalSeconds: LONG_SECONDS });
    expect(heard.at(-1)).toEqual({ doneSeconds: LONG_SECONDS, totalSeconds: LONG_SECONDS });
    expect(calls.at(-1)!.args).toEqual(expect.arrayContaining(["-f", "concat", "-c", "copy"]));
    expect(copiesIn(cacheDirectory)).toEqual([cachePath.split("/").at(-1)]);
  });

  it("copies alpha pieces side by side, shares the cores out, and counts them together", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(
      spawn,
      FFMPEG_PATH,
      false,
      null,
      undefined,
      LONG_SECONDS,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "long.webm");
    writeFileSync(sourcePath, "source-bytes");
    const cores = availableParallelism();
    const workers = Math.max(1, Math.min(4, cores - 1, Math.floor(totalmem() / (3 * 1024 ** 3))));
    const side = Math.min(workers, 3);

    const heard: number[] = [];
    const result = resolveProxy(projectDir, sourcePath, "vp8", undefined, {
      onProgress: (progress) => heard.push(progress.doneSeconds),
    });
    await flush(50);

    expect(calls).toHaveLength(side);
    for (const call of calls) {
      expect(call.args[call.args.indexOf("-threads") + 1]).toBe(
        String(Math.min(4, Math.floor(cores / workers))),
      );
    }
    calls[0]!.proc.stdout.emit("data", Buffer.from("out_time_us=4000000\n"));
    if (side > 1) calls[1]!.proc.stdout.emit("data", Buffer.from("out_time_us=6000000\n"));
    expect(heard.at(-1)).toBe(side > 1 ? 10 : 4);
    await answerUntilIdle(calls, (call) => succeed(call, "fake-vp8-bytes"));
    await result;
    expect(heard.at(-1)).toBe(LONG_SECONDS);
  });

  it("keeps two alpha copies running together within one cap of pieces", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(
      spawn,
      FFMPEG_PATH,
      false,
      null,
      undefined,
      LONG_SECONDS,
    );
    const projectDir = tmpProject();
    const sources = ["a.webm", "b.webm"].map((name) => join(projectDir, name));
    for (const source of sources) writeFileSync(source, "source-bytes");
    const cap = Math.max(
      1,
      Math.min(4, availableParallelism() - 1, Math.floor(totalmem() / (3 * 1024 ** 3))),
    );

    const results = sources.map((source) => resolveProxy(projectDir, source, "vp8"));
    await flush(50);

    expect(calls).toHaveLength(cap);
    await answerUntilIdle(calls, (call) => succeed(call, "fake-vp8-bytes"));
    await Promise.all(results);
    expect(calls.filter((call) => call.args.includes("-ss"))).toHaveLength(6);
  });

  it("ends the pieces still running when one of them fails, and reports that failure", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(
      spawn,
      FFMPEG_PATH,
      false,
      null,
      undefined,
      LONG_SECONDS,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "long.webm");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath, "vp8").catch((error: unknown) => error);
    await flush(50);
    fail(calls[0]!, 1, "bad piece");
    await flush(50);
    for (const call of calls.slice(1)) {
      expect(call.options?.signal?.aborted).toBe(true);
      call.proc.kill("SIGKILL");
    }
    expect(String(await result)).toContain("bad piece");
  });

  it("keeps a short source to one pass", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, false, null, undefined, 20);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "short.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).not.toContain("-ss");
    succeed(calls[0]!);
    await result;
  });
});

describe("resolveProxy", () => {
  it("bounds a caller wait without cancelling the shared transcode promise", async () => {
    const { waitForProxy, ProxyWaitTimeoutError } = await loadModule(
      () => createFakeProc(),
      FFMPEG_PATH,
    );
    let finish!: (value: string) => void;
    const shared = new Promise<string>((resolvePromise) => {
      finish = resolvePromise;
    });

    await expect(waitForProxy(shared, 1)).rejects.toBeInstanceOf(ProxyWaitTimeoutError);
    finish("eventual-proxy.mp4");
    await expect(shared).resolves.toBe("eventual-proxy.mp4");
  });

  it("transcodes once on a cache miss and caches via temp+rename", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, getProxyCachePath } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    const expectedCachePath = getProxyCachePath(projectDir, sourcePath);
    const resultPromise = resolveProxy(projectDir, sourcePath);

    await flush();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.args).toContain("-c:v");
    expect(call.args).toContain("libx264");
    expect(call.args).toContain("-crf");
    expect(call.args).toContain("18");
    expect(call.args).toContain("-preset");
    expect(call.args).toContain("veryfast");
    expect(call.args).toContain("-movflags");
    expect(call.args).toContain("+faststart");
    expect(call.args).toContain("-c:a");
    expect(call.args).toContain("aac");
    expect(call.args.some((a) => a.includes("scale="))).toBe(true);
    expect(call.args).toContain("-pix_fmt");
    expect(call.args).toContain("yuv420p");
    expect(call.args).toContain("-colorspace");
    expect(call.args).toContain("bt709");
    expect(call.args).toContain("-color_primaries");
    expect(call.args).toContain("-color_trc");
    // temp-name-then-rename: the ffmpeg output target is not the final path.
    const outputArg = call.args.at(-1)!;
    expect(outputArg).not.toBe(expectedCachePath);
    expect(existsSync(expectedCachePath)).toBe(false);

    succeed(call);
    const result = await resultPromise;

    expect(result).toBe(expectedCachePath);
    expect(existsSync(expectedCachePath)).toBe(true);
    // No leftover temp file next to the final cache entry.
    const cacheDirEntries = copiesIn(join(projectDir, ".transcode-cache"));
    expect(cacheDirEntries).toEqual([expectedCachePath.split("/").at(-1)]);
  });

  it("names the boxed preview copy resolveProxy writes when given the same box", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, getProxyCachePath } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "clip.mov");
    writeFileSync(sourcePath, "source-bytes");
    const box = { width: 1024, height: 724 };

    const boxedPath = getProxyCachePath(projectDir, sourcePath, "h264", box);
    const resultPromise = resolveProxy(projectDir, sourcePath, "h264", box);
    await flush();
    succeed(calls[0]!);

    expect(await resultPromise).toBe(boxedPath);
    expect(boxedPath).not.toBe(getProxyCachePath(projectDir, sourcePath, "h264"));
  });

  it("uses Chromium-compatible VP8 alpha args and a distinct WebM cache path", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, getProxyCachePath } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "alpha.mov");
    writeFileSync(sourcePath, "source-bytes");

    const h264Path = getProxyCachePath(projectDir, sourcePath, "h264");
    const vp8Path = getProxyCachePath(projectDir, sourcePath, "vp8");
    const resultPromise = resolveProxy(projectDir, sourcePath, "vp8");
    await flush();

    expect(vp8Path).not.toBe(h264Path);
    expect(vp8Path).toMatch(/\.webm$/);
    expect(h264Path).toMatch(/\.mp4$/);
    const args = calls[0]!.args;
    expect(args).toContain("libvpx");
    expect(args).not.toContain("libvpx-vp9");
    expect(args).toContain("yuva420p");
    expect(args).toContain("libopus");
    expect(args[args.indexOf("-b:v") + 1]).toBe("0");
    expect(args[args.indexOf("-crf") + 1]).toBe("23");
    expect(args[args.indexOf("-deadline") + 1]).toBe("good");
    expect(args[args.indexOf("-auto-alt-ref") + 1]).toBe("0");
    expect(args[args.indexOf("-metadata:s:v:0") + 1]).toBe("alpha_mode=1");
    expect(args[args.indexOf("-ac") + 1]).toBe("2");
    expect(args).not.toContain("-row-mt");
    expect(args).toContain("-cpu-used");
    expect(args[args.indexOf("-threads") + 1]).toBe(String(Math.min(4, availableParallelism())));
    expect(args).not.toContain("-movflags");
    expect(args).not.toContain("+faststart");
    expect(args[args.indexOf("-vf") + 1]).toContain("format=yuva420p");

    succeed(calls[0]!, "fake-vp8-bytes");
    await expect(resultPromise).resolves.toBe(vp8Path);
  });

  it("puts a keyframe every second into a copy, so scrubbing lands close", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "clip.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath);
    await flush();

    const args = calls[0]!.args;
    expect(args[args.indexOf("-force_key_frames") + 1]).toBe("expr:gte(t,n_forced*1)");
    succeed(calls[0]!);
    await result;
  });

  it("decodes a VP9 alpha source with libvpx-vp9 so the VP8 proxy keeps its alpha", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, false, null, "vp9");
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "cutout.webm");
    writeFileSync(sourcePath, "source-bytes");

    const vp8 = resolveProxy(projectDir, sourcePath, "vp8");
    await flush();
    const vp8Args = calls[0]!.args;
    expect(vp8Args.slice(vp8Args.indexOf("-i") - 2, vp8Args.indexOf("-i"))).toEqual([
      "-c:v",
      "libvpx-vp9",
    ]);
    succeed(calls[0]!, "fake-vp8-bytes");
    await vp8;

    const h264 = resolveProxy(projectDir, sourcePath, "h264");
    await flush();
    expect(calls[1]!.args.slice(0, calls[1]!.args.indexOf("-i"))).not.toContain("-c:v");
    succeed(calls[1]!);
    await h264;
  });

  it.skipIf(!canEncodeVpxAlphaForReal)(
    "keeps a real VP9 alpha webm transparent through probe, variant and transcode",
    async () => {
      vi.resetModules();
      vi.doUnmock("./mediaMetadata.js");
      const { resolveProxy } = await import("./proxyTranscoder.js");
      const { probeAssetCodec, proxyVariantFor } = await import("./mediaCodecMap.js");
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "cutout.webm");
      // Left half fully transparent, right half opaque: mean alpha 127.5.
      execFileSync(realFfmpeg!, [
        ...["-v", "error", "-f", "lavfi", "-i"],
        "testsrc2=s=64x64:d=0.2,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,32),0,255)'",
        ...["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0"],
        ...["-metadata:s:v:0", "alpha_mode=1", sourcePath],
      ]);

      const facts = await probeAssetCodec(sourcePath);
      expect(facts).toMatchObject({ codecName: "vp9", hasAlpha: true });
      const proxyPath = await resolveProxy(projectDir, sourcePath, proxyVariantFor(facts!));
      expect(proxyPath).toMatch(/\.webm$/);
      const meanAlpha = meanLuma(proxyPath, "alphaextract,", ["-c:v", "libvpx"]);
      expect(Math.abs(meanAlpha - 127.5)).toBeLessThan(8);
    },
    60_000,
  );

  it("returns without spawning on a cache hit", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, getProxyCachePath } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    const cachePath = getProxyCachePath(projectDir, sourcePath);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(projectDir, ".transcode-cache"), { recursive: true });
    writeFileSync(cachePath, "already-cached");

    const result = await resolveProxy(projectDir, sourcePath);
    expect(result).toBe(cachePath);
    expect(calls).toHaveLength(0);
  });

  it("tone-maps HDR input before emitting browser-safe BT.709", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, true);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "hdr.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath);
    await flush();

    expect(calls[0]!.args).toEqual(["-hide_banner", "-filters"]);
    expect(calls[0]!.options?.windowsHide).toBe(true);
    calls[0]!.proc.stdout.emit(
      "data",
      Buffer.from(" ..C zscale V->V zimg scale\n T.C tonemap V->V tone map\n"),
    );
    calls[0]!.proc.emit("close", 0);
    await flush();

    const filterIndex = calls[1]!.args.indexOf("-vf");
    const filter = calls[1]!.args[filterIndex + 1];
    expect(filter).toContain("tonemap=");
    expect(filter).toContain("bt709");
    expect(filter).toContain("out_color_matrix=bt709");

    succeed(calls[1]!);
    await result;
  });

  it("resizes HDR input to the box before the tone map, so the map runs on the smaller frame", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, true);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "hdr.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath, "h264", { width: 2048, height: 1218 });
    await flush();
    calls[0]!.proc.stdout.emit(
      "data",
      Buffer.from(" ..C zscale V->V zimg\n T.C tonemap V->V tone map\n"),
    );
    calls[0]!.proc.emit("close", 0);
    await flush();

    const filter = calls[1]!.args[calls[1]!.args.indexOf("-vf") + 1]!;
    expect(filter.indexOf("zscale=w=")).toBeGreaterThanOrEqual(0);
    expect(filter.indexOf("zscale=w=")).toBeLessThan(filter.indexOf("tonemap="));
    expect(filter).toContain("2048/iw");
    succeed(calls[1]!);
    await result;
  });

  it("tells a listener how far the encode has got, from ffmpeg's own progress lines", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, false, null, undefined, 20);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "progress.mov");
    writeFileSync(sourcePath, "source-bytes");
    const heard: Array<{ doneSeconds: number; totalSeconds?: number }> = [];

    const result = resolveProxy(projectDir, sourcePath, "h264", undefined, {
      onProgress: (progress) => heard.push(progress),
    });
    await flush();
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["-progress", "pipe:1"]));
    calls[0]!.proc.stdout.emit("data", Buffer.from("frame=10\nout_time_us=12000000\nprogre"));
    calls[0]!.proc.stdout.emit(
      "data",
      Buffer.from("ss=continue\nout_time_us=18500000\nprogress=continue\n"),
    );

    expect(heard).toEqual([
      { doneSeconds: 12, totalSeconds: 20 },
      { doneSeconds: 18.5, totalSeconds: 20 },
    ]);
    succeed(calls[0]!);
    await result;
  });

  describe("a copy that stops making progress", () => {
    afterEach(() => vi.useRealTimers());

    it("is ended once it makes no progress for the stall window, not before", async () => {
      vi.useFakeTimers();
      const { spawn, calls } = createSpawnSpy();
      const { resolveProxy, TRANSCODE_STALL_MS } = await loadModule(
        spawn,
        FFMPEG_PATH,
        false,
        null,
        undefined,
        80,
      );
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "hung.mov");
      writeFileSync(sourcePath, "source-bytes");

      const result = resolveProxy(projectDir, sourcePath).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(TRANSCODE_STALL_MS - 1);
      expect(calls[0]!.proc.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(calls[0]!.proc.kill).toHaveBeenCalledWith("SIGKILL");
      expect(await result).toEqual(
        expect.objectContaining({ message: expect.stringMatching(/no progress/) }),
      );
    });

    it("keeps going past the old fifteen minute cap while it moves on", async () => {
      vi.useFakeTimers();
      const { spawn, calls } = createSpawnSpy();
      const { resolveProxy, TRANSCODE_STALL_MS } = await loadModule(
        spawn,
        FFMPEG_PATH,
        false,
        null,
        undefined,
        20,
      );
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "slow.mov");
      writeFileSync(sourcePath, "source-bytes");

      const result = resolveProxy(projectDir, sourcePath);
      await vi.advanceTimersByTimeAsync(0);
      const step = TRANSCODE_STALL_MS / 2;
      for (let at = 1; at <= (20 * 60_000) / step; at++) {
        await vi.advanceTimersByTimeAsync(step);
        calls[0]!.proc.stdout.emit("data", Buffer.from(`out_time_us=${at * 1_000_000}\n`));
      }

      expect(calls[0]!.proc.kill).not.toHaveBeenCalled();
      succeed(calls[0]!);
      await result;
    });
  });

  it("hands the abort signal of a batch to its copies, so a stopped check ends them", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxies } = await loadModule(spawn, FFMPEG_PATH, false, null, undefined, 80);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "stopped.mov");
    writeFileSync(sourcePath, "source-bytes");
    const stopped = new AbortController();

    const results = resolveProxies(
      projectDir,
      [{ sourcePath, variant: "h264" }],
      undefined,
      undefined,
      stopped.signal,
    );
    await flush();
    expect(calls[0]!.options?.signal?.aborted).toBe(false);
    stopped.abort();
    await flush();

    expect(calls[0]!.options?.signal?.aborted).toBe(true);
    calls[0]!.proc.emit("close", null, "SIGKILL");
    expect((await results)[0]!.status).toBe("rejected");
  });

  it("preserves alpha on HDR-tagged VP8 proxies by bypassing the opaque tonemap chain", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, true);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "hdr-alpha.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath, "vp8");
    await flush();

    expect(calls).toHaveLength(1);
    const filter = calls[0]!.args[calls[0]!.args.indexOf("-vf") + 1];
    expect(filter).toContain("format=yuva420p");
    expect(filter).not.toContain("tonemap=");
    succeed(calls[0]!, "fake-vp8-alpha-bytes");
    await result;
  });

  it("rejects HDR proxying with a typed actionable error when ffmpeg lacks zscale", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, FfmpegMissingFilterError } = await loadModule(spawn, FFMPEG_PATH, true);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "hdr.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath);
    await flush();

    expect(calls[0]!.args).toEqual(["-hide_banner", "-filters"]);
    calls[0]!.proc.stdout.emit("data", Buffer.from(" T.C tonemap V->V tone map\n"));
    calls[0]!.proc.emit("close", 0);

    await expect(result).rejects.toBeInstanceOf(FfmpegMissingFilterError);
    await expect(result).rejects.toThrow(/zscale.*libzimg/i);
    expect(calls).toHaveLength(1);
  });

  it("does not tone-map BT.2020 footage without a PQ or HLG transfer, as renders do", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, true, "unknown");
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "bt2020-sdr.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath);
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain("-vf");
    expect(calls[0]!.args[calls[0]!.args.indexOf("-vf") + 1]).not.toContain("tonemap=");
    succeed(calls[0]!);
    await result;
  });

  it.skipIf(!canToneMapForReal)(
    "tone-maps real HLG footage that tags only its transfer, as renders do",
    async () => {
      vi.resetModules();
      vi.doUnmock("./mediaMetadata.js");
      const { resolveProxy } = await import("./proxyTranscoder.js");
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "hlg-transfer-only.mp4");
      // Primaries and matrix "unspecified" (2), transfer HLG (18).
      const hlgTransferOnly =
        "h264_metadata=colour_primaries=2:transfer_characteristics=18:matrix_coefficients=2";
      execFileSync(realFfmpeg!, [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=64x36:d=0.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-bsf:v",
        hlgTransferOnly,
        sourcePath,
      ]);

      const proxyPath = await resolveProxy(projectDir, sourcePath);
      // Reference: the render tone map's RGB, converted with BT.709. Mean luma is ~53 there;
      // skipping the tone map gives ~60, a BT.601 conversion ~56.
      const reference = meanLuma(
        sourcePath,
        `${hdrToSdrToneMapFilter({ colorTransfer: "arib-std-b67" }, { colorTransfer: "arib-std-b67" })},format=gbrp,scale=in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p,`,
      );
      expect(Math.abs(meanLuma(proxyPath) - reference)).toBeLessThan(1);
    },
    60_000,
  );

  it.skipIf(!canToneMapForReal)(
    "tone-maps each frame of a real mixed HLG and PQ stream with its own transfer",
    async () => {
      vi.resetModules();
      vi.doUnmock("./mediaMetadata.js");
      const { resolveProxy } = await import("./proxyTranscoder.js");
      const projectDir = tmpProject();
      const segment = (transfer: number) =>
        execFileSync(realFfmpeg!, [
          ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=0.2"],
          // No B-frames: genpts stamps a raw stream in decode order, so reordered frames get wrong times.
          ...["-c:v", "libx264", "-bf", "0", "-pix_fmt", "yuv420p", "-bsf:v"],
          `h264_metadata=colour_primaries=9:transfer_characteristics=${transfer}:matrix_coefficients=9`,
          ...["-f", "h264", "-"],
        ]);
      const mux = (name: string, stream: Buffer) => {
        const raw = join(projectDir, `${name}.h264`);
        const path = join(projectDir, `${name}.mp4`);
        writeFileSync(raw, stream);
        execFileSync(realFfmpeg!, [
          ...["-v", "error", "-fflags", "+genpts", "-r", "25", "-f", "h264", "-i", raw],
          ...["-c", "copy", path],
        ]);
        return path;
      };
      const pq = segment(16);
      const mixedProxy = await resolveProxy(
        projectDir,
        mux("hlg-then-pq", Buffer.concat([segment(18), pq])),
      );
      const pqProxy = await resolveProxy(projectDir, mux("pq-only", pq));

      // Frame 5 is the first PQ frame: tone-mapped as PQ it lands near 42 dB, read as HLG near 30.
      const psnrAt = (n: number) => {
        const stats = spawnSync(
          realFfmpeg!,
          [
            ...["-i", mixedProxy, "-i", pqProxy, "-lavfi"],
            `[0:v]select=eq(n\\,${n}),setpts=PTS-STARTPTS[a];[1:v]select=eq(n\\,0),setpts=PTS-STARTPTS[b];[a][b]psnr`,
            ...["-frames:v", "1", "-f", "null", "-"],
          ],
          { encoding: "utf8" },
        ).stderr;
        return Number(/average:([\d.]+)/.exec(stats)?.[1] ?? 0);
      };
      expect(psnrAt(5)).toBeGreaterThan(36);
    },
    60_000,
  );

  it.skipIf(!realFfmpeg || !findFfBinary("ffprobe"))(
    "makes a preview copy that fills the shown box, never larger than the source",
    async () => {
      vi.resetModules();
      vi.doUnmock("./mediaMetadata.js");
      const { resolveProxy } = await import("./proxyTranscoder.js");
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "portrait.mp4");
      execFileSync(realFfmpeg!, [
        ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:d=0.1"],
        ...["-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath],
      ]);
      const size = (path: string) =>
        execFileSync(
          findFfBinary("ffprobe")!,
          [
            ...["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height"],
            ...["-of", "csv=p=0", "--", path],
          ],
          { encoding: "utf8" },
        ).trim();

      // The width side binds: 512/1080 > 724/1920, so the height follows the source's shape.
      const boxed = await resolveProxy(projectDir, sourcePath, "h264", { width: 512, height: 724 });
      expect(size(boxed)).toBe("512,912");
      const roomy = await resolveProxy(projectDir, sourcePath, "h264", {
        width: 2048,
        height: 2048,
      });
      expect(size(roomy)).toBe("1080,1920");
      const full = await resolveProxy(projectDir, sourcePath);
      expect(size(full)).toBe("1080,1920");
      expect(new Set([boxed, roomy, full]).size).toBe(3);
    },
    60_000,
  );

  it("dedupes two concurrent same-key calls to one spawn", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    const p1 = resolveProxy(projectDir, sourcePath);
    const p2 = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(1);

    succeed(calls[0]!);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it("respects the global concurrency bound across distinct keys", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePaths = Array.from({ length: 5 }, (_, i) => {
      const p = join(projectDir, `video-${i}.mov`);
      writeFileSync(p, `source-bytes-${i}`);
      return p;
    });

    const results = sourcePaths.map((p) => resolveProxy(projectDir, p));
    await flush();
    expect(calls).toHaveLength(MAX_CONCURRENT);

    succeed(calls[0]!);
    succeed(calls[1]!);
    await flush();
    expect(calls).toHaveLength(4);

    succeed(calls[2]!);
    succeed(calls[3]!);
    await flush();
    expect(calls).toHaveLength(5);

    succeed(calls[4]!);
    const resolved = await Promise.all(results);
    expect(new Set(resolved).size).toBe(5);
    // At no point did more than MAX_CONCURRENT spawns run unresolved at once.
    expect(calls.length).toBeLessThanOrEqual(sourcePaths.length);
  });

  it("rejects excess queued work with a typed capacity error", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxyCapacityError } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePaths = Array.from({ length: MAX_CONCURRENT + MAX_QUEUED + 1 }, (_, i) => {
      const path = join(projectDir, `queued-${i}.mov`);
      writeFileSync(path, `source-${i}`);
      return path;
    });

    const accepted = sourcePaths.slice(0, -1).map((path) => resolveProxy(projectDir, path));
    await expect(resolveProxy(projectDir, sourcePaths.at(-1)!)).rejects.toBeInstanceOf(
      ProxyCapacityError,
    );
    await flush();
    expect(calls).toHaveLength(MAX_CONCURRENT);

    for (let index = 0; index < accepted.length; index += MAX_CONCURRENT) {
      calls.slice(index, index + MAX_CONCURRENT).forEach((call) => succeed(call));
      await flush();
    }
    await Promise.all(accepted);

    // A full queue is not remembered: once there is room, the same clip transcodes.
    const retry = resolveProxy(projectDir, sourcePaths.at(-1)!);
    await flush();
    expect(calls).toHaveLength(accepted.length + 1);
    succeed(calls.at(-1)!);
    await expect(retry).resolves.toBeTruthy();
  });

  it("resolves a whole project's batch past the queue cap by waiting for room, not refusing", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxies } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sources = batchSources(projectDir);

    let settled = 0;
    const batch = resolveProxies(projectDir, sources, () => settled++);
    await answerUntilIdle(calls, (call) => succeed(call));

    const results = await batch;
    expect(results.map((result) => result.status)).toEqual(sources.map(() => "fulfilled"));
    expect(settled).toBe(sources.length);
  });

  it("makes a batch's copy at the box it is given, under that box's own cache name", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxies, getProxyCachePath } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "clip.mov");
    writeFileSync(sourcePath, "source");
    const box = { width: 2048, height: 1448 };

    const batch = resolveProxies(projectDir, [{ sourcePath, variant: "h264", box }]);
    await answerUntilIdle(calls, (call) => succeed(call));

    const [result] = await batch;
    expect(result).toEqual({
      status: "fulfilled",
      value: getProxyCachePath(projectDir, sourcePath, "h264", box),
    });
    expect(result.status === "fulfilled" && result.value).not.toBe(
      getProxyCachePath(projectDir, sourcePath, "h264"),
    );
  });

  it("clears a partial copy left by a stopped process before it starts a batch, and keeps a live one", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxies } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "clip.mov");
    writeFileSync(sourcePath, "source");
    const cacheDir = join(projectDir, ".transcode-cache");
    mkdirSync(cacheDir, { recursive: true });
    const name = (id: string) => `.tmp-${id}-${"a".repeat(64)}.mp4`;
    const dead = join(cacheDir, name("11111111-1111-1111-1111-111111111111"));
    const live = join(cacheDir, name("22222222-2222-2222-2222-222222222222"));
    writeFileSync(dead, "partial");
    writeFileSync(live, "partial");
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    utimesSync(dead, minutesAgo(11), minutesAgo(11));
    utimesSync(live, minutesAgo(1), minutesAgo(1));

    const batch = resolveProxies(projectDir, [{ sourcePath, variant: "h264" }]);
    await answerUntilIdle(calls, (call) => succeed(call));
    await batch;

    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it("settles each request of a batch on its own when one of them fails", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxies } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sources = batchSources(projectDir);
    const failing = (call: SpawnCall) => call.args.some((arg) => arg.endsWith("batch-3.mov"));

    const batch = resolveProxies(projectDir, sources);
    await answerUntilIdle(calls, (call) => (failing(call) ? fail(call) : succeed(call)));

    const statuses = (await batch).map((result) => result.status);
    expect(statuses.filter((status) => status === "fulfilled")).toHaveLength(sources.length - 1);
    expect(statuses[3]).toBe("rejected");
  });

  describe("queue order and callers that leave", () => {
    function clipOf(call: SpawnCall): string {
      return basename(call.args[call.args.indexOf("-i") + 1]!, ".mov");
    }

    function clips(projectDir: string, names: string[]): Record<string, string> {
      return Object.fromEntries(
        names.map((name) => {
          const path = join(projectDir, `${name}.mov`);
          writeFileSync(path, name);
          return [name, path];
        }),
      );
    }

    async function askThenLeave(ask: (signal: AbortSignal) => Promise<string>): Promise<void> {
      const leaving = new AbortController();
      const left = ask(leaving.signal);
      await flush();
      leaving.abort();
      await expect(left).rejects.toBe(leaving.signal.reason);
    }

    async function oneSlot(queue = 8, slots = 1) {
      process.env.HYPERFRAMES_PROXY_MAX_CONCURRENCY = String(slots);
      process.env.HYPERFRAMES_PROXY_MAX_QUEUE = String(queue);
      const spy = createSpawnSpy();
      return { ...spy, ...(await loadModule(spy.spawn, FFMPEG_PATH)), projectDir: tmpProject() };
    }

    it("moves another project's activity mark when its ask is refused, and copies it once there is room", async () => {
      const { calls, resolveProxy, ProxyCapacityError, proxyActivityMark, projectDir } =
        await oneSlot(0);
      const busyProject = tmpProject();
      const running = resolveProxy(busyProject, clips(busyProject, ["running"]).running!);
      const target = clips(projectDir, ["target"]).target!;
      const before = proxyActivityMark(projectDir);

      await expect(resolveProxy(projectDir, target)).rejects.toBeInstanceOf(ProxyCapacityError);
      expect(proxyActivityMark(projectDir)).not.toBe(before);

      succeed(calls[0]!);
      await running;
      const retry = resolveProxy(projectDir, target);
      await flush();
      expect(calls.map(clipOf)).toEqual(["running", "target"]);
      succeed(calls[1]!);
      await retry;
    });

    it("starts a priority copy before queued thumbnails, even when the queue is full", async () => {
      const { calls, resolveProxy, ProxyCapacityError, projectDir } = await oneSlot(1);
      const clip = clips(projectDir, ["running", "thumb", "late", "preview"]);

      const running = resolveProxy(projectDir, clip.running!);
      const thumb = resolveProxy(projectDir, clip.thumb!);
      await expect(resolveProxy(projectDir, clip.late!)).rejects.toBeInstanceOf(ProxyCapacityError);
      const preview = resolveProxy(projectDir, clip.preview!, "h264", undefined, {
        priority: true,
      });
      await flush();

      succeed(calls[0]!);
      await running;
      await flush();
      expect(clipOf(calls[1]!)).toBe("preview");
      succeed(calls[1]!);
      await preview;
      await flush();
      expect(clipOf(calls[2]!)).toBe("thumb");
      succeed(calls[2]!);
      await thumb;
    });

    it("moves an already queued copy forward when the preview asks for it", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running", "first", "second"]);

      const asks = [
        resolveProxy(projectDir, clip.running!),
        resolveProxy(projectDir, clip.first!),
        resolveProxy(projectDir, clip.second!),
        resolveProxy(projectDir, clip.second!, "h264", undefined, { priority: true }),
      ];
      await flush();
      succeed(calls[0]!);
      await flush(12);

      expect(clipOf(calls[1]!)).toBe("second");
      succeed(calls[1]!);
      await flush(12);
      succeed(calls[2]!);
      await Promise.all(asks);
      expect(calls).toHaveLength(3);
    });

    it("drops a queued copy once its only caller leaves, without remembering a failure", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running", "thumb"]);
      const scrolledOff = new AbortController();

      const running = resolveProxy(projectDir, clip.running!);
      const thumb = resolveProxy(projectDir, clip.thumb!, "h264", undefined, {
        signal: scrolledOff.signal,
      });
      await flush();
      scrolledOff.abort();
      await expect(thumb).rejects.toBe(scrolledOff.signal.reason);

      succeed(calls[0]!);
      await running;
      await flush(12);
      expect(calls).toHaveLength(1);

      const again = resolveProxy(projectDir, clip.thumb!);
      await flush();
      expect(calls).toHaveLength(2);
      succeed(calls[1]!);
      await expect(again).resolves.toBeTruthy();
    });

    it.each([
      ["another caller with a signal", true],
      ["a caller without a signal", false],
    ])("keeps a shared queued copy while %s still waits", async (_label, withSignal) => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running", "shared"]);

      const running = resolveProxy(projectDir, clip.running!);
      const staying = resolveProxy(
        projectDir,
        clip.shared!,
        "h264",
        undefined,
        withSignal ? { signal: new AbortController().signal } : {},
      );
      await askThenLeave((signal) =>
        resolveProxy(projectDir, clip.shared!, "h264", undefined, { signal }),
      );

      succeed(calls[0]!);
      await running;
      await flush(12);
      expect(clipOf(calls[1]!)).toBe("shared");
      succeed(calls[1]!);
      await expect(staying).resolves.toBeTruthy();
    });

    it("makes the copy asked for last first, and moves a copy to the front each time it is asked again", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running", "c", "d", "f"]);
      const ask = (name: string) =>
        resolveProxy(projectDir, clip[name]!, "h264", undefined, { priority: true });

      const running = resolveProxy(projectDir, clip.running!);
      await flush();
      const asks = [ask("c"), ask("d"), ask("f"), ask("c")];
      succeed(calls[0]!);
      await running;
      for (const next of ["c", "f", "d"]) {
        await flush(12);
        expect(clipOf(calls[calls.length - 1]!)).toBe(next);
        succeed(calls[calls.length - 1]!);
      }
      await expect(Promise.all(asks)).resolves.toHaveLength(4);
    });

    it("makes the copy when the preview asks in the same moment the last thumbnail leaves", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running", "handoff"]);
      const leaving = new AbortController();

      const running = resolveProxy(projectDir, clip.running!);
      const thumb = resolveProxy(projectDir, clip.handoff!, "h264", undefined, {
        signal: leaving.signal,
      });
      await flush();
      leaving.abort();
      const preview = resolveProxy(projectDir, clip.handoff!, "h264", undefined, {
        priority: true,
      });
      await expect(thumb).rejects.toBe(leaving.signal.reason);

      succeed(calls[0]!);
      await running;
      await flush(12);
      expect(clipOf(calls[1]!)).toBe("handoff");
      succeed(calls[1]!);
      await expect(preview).resolves.toBeTruthy();
    });

    it("keeps one copy per clip when a dropped copy settles after its replacement started", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot(8, 2);
      const clip = clips(projectDir, ["first", "second", "handoff"]);
      const leaving = new AbortController();

      const running = [
        resolveProxy(projectDir, clip.first!),
        resolveProxy(projectDir, clip.second!),
      ];
      const thumb = resolveProxy(projectDir, clip.handoff!, "h264", undefined, {
        signal: leaving.signal,
      });
      await flush();
      leaving.abort();
      const preview = resolveProxy(projectDir, clip.handoff!);
      await expect(thumb).rejects.toBe(leaving.signal.reason);
      await flush(12);
      const later = resolveProxy(projectDir, clip.handoff!);

      succeed(calls[0]!);
      succeed(calls[1]!);
      await Promise.all(running);
      await flush(12);
      expect(calls.map(clipOf).filter((name) => name === "handoff")).toHaveLength(1);
      succeed(calls[2]!);
      await expect(Promise.all([preview, later])).resolves.toHaveLength(2);
    });

    it("accepts a priority ask in the same moment a normal ask for that clip was refused", async () => {
      const { calls, resolveProxy, ProxyCapacityError, projectDir } = await oneSlot(1);
      const clip = clips(projectDir, ["running", "thumb", "late"]);

      const running = resolveProxy(projectDir, clip.running!);
      const thumb = resolveProxy(projectDir, clip.thumb!);
      const refused = resolveProxy(projectDir, clip.late!);
      const preview = resolveProxy(projectDir, clip.late!, "h264", undefined, { priority: true });
      await expect(refused).rejects.toBeInstanceOf(ProxyCapacityError);

      succeed(calls[0]!);
      await running;
      await flush(12);
      expect(clipOf(calls[1]!)).toBe("late");
      succeed(calls[1]!);
      await expect(preview).resolves.toBeTruthy();
      await flush(12);
      succeed(calls[2]!);
      await thumb;
    });

    it("stops a started copy once its last caller leaves, and starts afresh on the next ask", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running"]);

      await askThenLeave((signal) =>
        resolveProxy(projectDir, clip.running!, "h264", undefined, { signal }),
      );

      expect(calls[0]!.options?.signal?.aborted).toBe(true);
      calls[0]!.proc.emit("close", null, "SIGKILL");
      await flush(12);
      const again = resolveProxy(projectDir, clip.running!);
      await flush();
      expect(calls).toHaveLength(2);
      succeed(calls[1]!);
      await expect(again).resolves.toBeTruthy();
    });

    it("keeps a started copy while a caller without a signal still waits", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running"]);
      const kept = resolveProxy(projectDir, clip.running!);

      await askThenLeave((signal) =>
        resolveProxy(projectDir, clip.running!, "h264", undefined, { signal }),
      );

      expect(calls[0]!.options?.signal?.aborted).not.toBe(true);
      succeed(calls[0]!);
      await expect(kept).resolves.toBeTruthy();
      expect(calls).toHaveLength(1);
    });

    it.skipIf(process.platform === "win32")(
      "kills the running ffmpeg when its last caller leaves",
      async () => {
        let child: ChildProcess | undefined;
        const neverFinishes = (_command: string, _args: string[], options?: SpawnOptions) => {
          child = realSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
          return child as unknown as FakeProc;
        };
        const { resolveProxy } = await loadModule(neverFinishes, FFMPEG_PATH);
        const projectDir = tmpProject();
        const clip = clips(projectDir, ["running"]);

        await askThenLeave((signal) =>
          resolveProxy(projectDir, clip.running!, "h264", undefined, { signal }),
        );

        const [, exitSignal] = child!.exitCode === null ? await once(child!, "exit") : [];
        expect(exitSignal).toBe("SIGKILL");
      },
    );
  });

  it("honors bounded concurrency and queue environment overrides", async () => {
    process.env.HYPERFRAMES_PROXY_MAX_CONCURRENCY = "1";
    process.env.HYPERFRAMES_PROXY_MAX_QUEUE = "0";
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxyCapacityError } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const firstPath = join(projectDir, "first.mov");
    const secondPath = join(projectDir, "second.mov");
    writeFileSync(firstPath, "first");
    writeFileSync(secondPath, "second");

    const first = resolveProxy(projectDir, firstPath);
    await flush();
    expect(calls).toHaveLength(1);
    await expect(resolveProxy(projectDir, secondPath)).rejects.toBeInstanceOf(ProxyCapacityError);

    succeed(calls[0]!);
    await expect(first).resolves.toBeTruthy();
  });

  describe("finding the copy of a source", () => {
    /** Makes the copy of `sourcePath` and returns the path it was made at. */
    async function made(
      env: Awaited<ReturnType<typeof loadModule>>,
      calls: SpawnCall[],
      projectDir: string,
      sourcePath: string,
    ): Promise<string> {
      const before = calls.length;
      const result = env.resolveProxy(projectDir, sourcePath);
      await flush(80);
      for (const call of calls.slice(before)) succeed(call);
      return result;
    }

    it("reuses the copy of a file that was only touched or re-saved with the same bytes", async () => {
      const { spawn, calls } = createSpawnSpy();
      const env = await loadModule(spawn, FFMPEG_PATH);
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "video.mov");
      writeFileSync(sourcePath, "source-bytes");
      const first = await made(env, calls, projectDir, sourcePath);

      const future = new Date(Date.now() + 60_000);
      utimesSync(sourcePath, future, future);
      const again = await made(env, calls, projectDir, sourcePath);

      expect(again).toBe(first);
      expect(calls).toHaveLength(1);
      expect(env.getProxyCachePath(projectDir, sourcePath)).toBe(first);
    });

    it("gives a copied project the copy its original has, and a symlinked clip the same one", async () => {
      const { spawn, calls } = createSpawnSpy();
      const env = await loadModule(spawn, FFMPEG_PATH);
      const original = tmpProject();
      writeFileSync(join(original, "video.mov"), "source-bytes");
      symlinkSync(join(original, "video.mov"), join(original, "linked.mov"));
      const first = await made(env, calls, original, join(original, "video.mov"));
      const copied = join(tmpProject(), "project");
      cpSync(original, copied, { recursive: true, dereference: true });
      for (const name of readdirSync(copied))
        utimesSync(join(copied, name), new Date(), new Date(Date.now() + 5_000));

      const viaLink = await made(env, calls, original, join(original, "linked.mov"));
      const inCopy = await made(env, calls, copied, join(copied, "video.mov"));

      expect(viaLink).toBe(first);
      expect(inCopy.startsWith(realpathSync(copied))).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it("makes a new copy for a changed file, even one of the same size that differs in a small stretch", async () => {
      const { spawn, calls } = createSpawnSpy();
      const env = await loadModule(spawn, FFMPEG_PATH);
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "big.mov");
      const bytes = Buffer.alloc(1024 * 1024, 1);
      writeFileSync(sourcePath, bytes);
      const pinned = new Date("2026-01-01T00:00:00Z");
      utimesSync(sourcePath, pinned, pinned);
      const first = await made(env, calls, projectDir, sourcePath);

      bytes[200 * 1024] = 2;
      writeFileSync(sourcePath, bytes);
      utimesSync(sourcePath, new Date(pinned.getTime() + 1000), new Date(pinned.getTime() + 1000));
      const second = await made(env, calls, projectDir, sourcePath);

      expect(second).not.toBe(first);
      expect(calls).toHaveLength(2);
    });

    it("makes a new copy when a link is retargeted to other bytes", async () => {
      const { spawn, calls } = createSpawnSpy();
      const env = await loadModule(spawn, FFMPEG_PATH);
      const projectDir = tmpProject();
      writeFileSync(join(projectDir, "a.mov"), "source-bytes");
      writeFileSync(join(projectDir, "b.mov"), "SOURCE-BYTES");
      symlinkSync(join(projectDir, "a.mov"), join(projectDir, "linked.mov"));
      const first = await made(env, calls, projectDir, join(projectDir, "linked.mov"));

      rmSync(join(projectDir, "linked.mov"));
      symlinkSync(join(projectDir, "b.mov"), join(projectDir, "linked.mov"));
      const second = await made(env, calls, projectDir, join(projectDir, "linked.mov"));

      expect(second).not.toBe(first);
      expect(calls).toHaveLength(2);
    });
  });

  it("produces a new cache key when size changes but mtime is pinned the same", async () => {
    const { getProxyCachePath } = await loadModule(() => createFakeProc(), FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    const pinned = new Date("2026-01-01T00:00:00Z");

    writeFileSync(sourcePath, "short");
    utimesSync(sourcePath, pinned, pinned);
    const keyBefore = getProxyCachePath(projectDir, sourcePath);

    writeFileSync(sourcePath, "a much longer replacement payload");
    utimesSync(sourcePath, pinned, pinned);
    const keyAfter = getProxyCachePath(projectDir, sourcePath);

    expect(keyAfter).not.toBe(keyBefore);
  });

  it("surfaces a typed error on ffmpeg failure and leaves no cache file", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, getProxyCachePath, ProxyTranscodeError } = await loadModule(
      spawn,
      FFMPEG_PATH,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");
    const cachePath = getProxyCachePath(projectDir, sourcePath);

    const resultPromise = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(1);
    fail(
      calls[0]!,
      1,
      [
        "Input #0, mov, from 'video.mov': unsupported codec",
        "[hevc] Error while decoding stream #0:0: Invalid data found when processing input",
        "Error submitting a packet to the muxer: No space left on device.",
        "Conversion failed!",
      ].join("\n"),
    );

    await expect(resultPromise).rejects.toBeInstanceOf(ProxyTranscodeError);
    await expect(resultPromise).rejects.toMatchObject({
      message: expect.stringContaining(
        "ffmpeg exited with code 1: [hevc] Error while decoding stream #0:0: Invalid data found when processing input; Error submitting a packet to the muxer: No space left on device (source: video,",
      ),
      exitCode: 1,
      stderrTail: expect.stringContaining("unsupported codec"),
    });

    expect(existsSync(cachePath)).toBe(false);
    const cacheDir = join(projectDir, ".transcode-cache");
    const leftover = existsSync(cacheDir) ? readdirSync(cacheDir) : [];
    expect(leftover).toEqual([]);
  });

  it("says how far the copy being made has got, and makes a failed one again when told to retry", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, proxyCopyProgress, retryProxyCopy } = await loadModule(
      spawn,
      FFMPEG_PATH,
      false,
      null,
      undefined,
      20,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    const first = resolveProxy(projectDir, sourcePath).catch((error: unknown) => error);
    await flush();
    expect(proxyCopyProgress(projectDir, sourcePath, "h264")).toBeUndefined();
    calls[0]!.proc.stdout.emit("data", Buffer.from("out_time_us=5000000\n"));
    expect(proxyCopyProgress(projectDir, sourcePath, "h264")).toBeCloseTo(0.25);
    fail(calls[0]!, 1, "boom");
    await first;
    expect(proxyCopyProgress(projectDir, sourcePath, "h264")).toBeUndefined();

    const stillFailed = resolveProxy(projectDir, sourcePath).catch((error: unknown) => error);
    await flush();
    expect(calls).toHaveLength(1);
    await stillFailed;

    retryProxyCopy(projectDir, sourcePath, "h264");
    const again = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(2);
    succeed(calls[1]!);
    await again;
  });

  it("names why the output could not open, not only that it could not", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "phone.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath).catch((error: unknown) => error);
    await flush();
    fail(
      calls[0]!,
      234,
      [
        "[out#0/mp4 @ 0x1] Output file does not contain any stream",
        "Error opening output file /project/.transcode-cache/.tmp-1-abc.mp4.",
        "Error opening output files: Invalid argument",
      ].join("\n"),
    );

    expect(String(await result)).toContain(
      "ffmpeg exited with code 234: [out#0/mp4 @ 0x1] Output file does not contain any stream; Error opening output files: Invalid argument",
    );
  });

  it("ends a failure with what the source is, without its name or folder", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH, false, null, "hevc", undefined, [
      "video:hevc[default]",
      "data:?[]",
    ]);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "Phone Clip.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath).catch((error: unknown) => error);
    await flush();
    fail(calls[0]!, 234, "Error opening output files: Invalid argument");

    const message = String(await result);
    expect(message).toContain(
      "(source: video, hevc, no audio, streams video:hevc[default] data:?[], 0 MB, local)",
    );
    expect(message).not.toContain("Phone Clip");
    expect(message).not.toContain(projectDir);
  });

  it("keeps a spaced file or folder name out of the failure, and survives a source that vanished", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "My Project", "Screen Recording 2026.mov");
    mkdirSync(dirname(sourcePath));
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath).catch((error: unknown) => error);
    await flush();
    rmSync(sourcePath);
    const input = calls[0]!.args[calls[0]!.args.indexOf("-i") + 1];
    fail(
      calls[0]!,
      234,
      `Error opening input file ${input}.\nError opening input files: Invalid argument`,
    );

    const message = String(await result);
    expect(message).toContain("Error opening input file <path>");
    expect(message).toContain("missing");
    expect(message).not.toMatch(/My Project|Screen Recording/);
  });

  it("remembers a failure per cache key: a second call rethrows without respawning ffmpeg", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxyTranscodeError, clearFailedTranscodesForTest } = await loadModule(
      spawn,
      FFMPEG_PATH,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    const first = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(1);
    fail(calls[0]!, 1, "ffmpeg: unsupported codec");
    await expect(first).rejects.toBeInstanceOf(ProxyTranscodeError);

    // Same key, remembered failure: rethrown instantly, no second spawn.
    await expect(resolveProxy(projectDir, sourcePath)).rejects.toMatchObject({
      stderrTail: expect.stringContaining("unsupported codec"),
    });
    expect(calls).toHaveLength(1);

    // The exported clear hook forgets the failure and allows a retry.
    clearFailedTranscodesForTest();
    const retry = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.options?.windowsHide).toBe(true);
    succeed(calls[1]!);
    await expect(retry).resolves.toBeTruthy();
  });

  it("expires remembered failures so transient environment errors can recover", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxyTranscodeError } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    const first = resolveProxy(projectDir, sourcePath);
    await flush();
    fail(calls[0]!, 137, "transient OOM");
    await expect(first).rejects.toBeInstanceOf(ProxyTranscodeError);

    now.mockReturnValue(1_000 + 60_001);
    const retry = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(2);
    succeed(calls[1]!);
    await expect(retry).resolves.toBeTruthy();
  });

  // A real ffprobe answers after a macrotask, so a failure lands after a zero wait gave up.
  async function loadWithSlowProbe(
    spawn: SpawnImpl,
    ffmpegPath: () => string | undefined,
    probe: () => Promise<unknown>,
  ): Promise<typeof import("./proxyTranscoder.js")> {
    vi.resetModules();
    vi.doMock("node:child_process", () => {
      const mocked = { spawn };
      return { ...mocked, default: mocked };
    });
    vi.doMock("@hyperframes/parsers/ff-binaries", () => ({ findFfBinary: ffmpegPath }));
    vi.doMock("./mediaMetadata.js", () => ({
      probeMediaMetadata: () =>
        new Promise((resolveProbe) => setTimeout(resolveProbe, 5)).then(probe),
    }));
    return import("./proxyTranscoder.js");
  }

  const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

  it("keeps an environment failure briefly, so an ask that stopped waiting hears it next", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { spawn, calls } = createSpawnSpy();
    let ffmpegPath: string | undefined;
    const { resolveProxy, waitForProxy, ProxyWaitTimeoutError } = await loadWithSlowProbe(
      spawn,
      () => ffmpegPath,
      async () => ({ kind: "video", color: { isHdr: false } }),
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    await expect(waitForProxy(resolveProxy(projectDir, sourcePath), 0)).rejects.toBeInstanceOf(
      ProxyWaitTimeoutError,
    );
    await sleep(30);
    await expect(waitForProxy(resolveProxy(projectDir, sourcePath), 0)).rejects.toThrow(
      "ffmpeg binary not found",
    );

    ffmpegPath = FFMPEG_PATH;
    now.mockReturnValue(1_000 + 10_001);
    const retry = resolveProxy(projectDir, sourcePath);
    await sleep(30);
    expect(calls).toHaveLength(1);
    succeed(calls[0]!);
    await expect(retry).resolves.toBeTruthy();
    now.mockRestore();
  });

  it("remembers a failure that is not a transcode error, so it is not retried on every ask", async () => {
    const { spawn } = createSpawnSpy();
    const probe = vi.fn(async () => {
      throw new Error("EBUSY: file locked");
    });
    const { resolveProxy, waitForProxy, ProxyWaitTimeoutError } = await loadWithSlowProbe(
      spawn,
      () => FFMPEG_PATH,
      probe,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    await expect(waitForProxy(resolveProxy(projectDir, sourcePath), 0)).rejects.toBeInstanceOf(
      ProxyWaitTimeoutError,
    );
    await sleep(30);
    await expect(waitForProxy(resolveProxy(projectDir, sourcePath), 0)).rejects.toThrow("EBUSY");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("marks a project's copy as in flight, and moves the mark once it lands", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, proxyActivityMark } = await loadWithSlowProbe(
      spawn,
      () => FFMPEG_PATH,
      async () => ({ kind: "video", color: { isHdr: false } }),
    );
    const projectDir = tmpProject();
    const otherProjectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");
    const before = proxyActivityMark(projectDir);

    const copy = resolveProxy(projectDir, sourcePath);
    expect(proxyActivityMark(projectDir)).toBeNull();
    expect(proxyActivityMark(otherProjectDir)).toBe(before);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    succeed(calls[0]!);
    await copy;
    expect(proxyActivityMark(projectDir)).not.toBeNull();
    expect(proxyActivityMark(projectDir)).not.toBe(before);
    expect(proxyActivityMark(join(projectDir, "missing"))).not.toBeNull();
  });

  it("rejects sources outside the project before probing or spawning", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxySourceOutsideProjectError } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const outsideDir = tmpProject();
    const sourcePath = join(outsideDir, "outside.mov");
    writeFileSync(sourcePath, "source-bytes");

    await expect(resolveProxy(projectDir, sourcePath)).rejects.toBeInstanceOf(
      ProxySourceOutsideProjectError,
    );
    expect(calls).toHaveLength(0);
  });

  it("proxies an external target reached through an in-project symlink", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, getProxyCachePath } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const outsideDir = tmpProject();
    const outsidePath = join(outsideDir, "outside.mov");
    const sourcePath = join(projectDir, "linked.mov");
    writeFileSync(outsidePath, "source-bytes");
    symlinkSync(outsidePath, sourcePath);

    const cachePath = getProxyCachePath(projectDir, sourcePath);
    const result = resolveProxy(projectDir, sourcePath);
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain(realpathSync(outsidePath));
    succeed(calls[0]!);
    await expect(result).resolves.toBe(cachePath);
    expect(cachePath.startsWith(join(realpathSync(projectDir), ".transcode-cache"))).toBe(true);
  });

  it("retries after the source file changes (its content in the cache key invalidates the remembered failure)", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxyTranscodeError } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");
    const past = new Date(Date.now() - 60_000);
    utimesSync(sourcePath, past, past);

    const first = resolveProxy(projectDir, sourcePath);
    await flush();
    fail(calls[0]!, 1, "boom");
    await expect(first).rejects.toBeInstanceOf(ProxyTranscodeError);

    // Re-exported file (new bytes) → new key → a fresh transcode attempt.
    writeFileSync(sourcePath, "re-exported-bytes");
    const retry = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(2);
    succeed(calls[1]!);
    await expect(retry).resolves.toBeTruthy();
  });

  describe("two processes sharing one cache", () => {
    it("lets only one make the copy, and gives both the finished file", async () => {
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "video.mov");
      writeFileSync(sourcePath, "source-bytes");
      const first = createSpawnSpy();
      const second = createSpawnSpy();
      const a = await loadModule(first.spawn, FFMPEG_PATH);
      const b = await loadModule(second.spawn, FFMPEG_PATH);

      const madeByA = a.resolveProxy(projectDir, sourcePath);
      await flush(50);
      const madeByB = b.resolveProxy(projectDir, sourcePath);
      await new Promise((resolveWait) => setTimeout(resolveWait, 700));
      expect(first.calls).toHaveLength(1);
      expect(second.calls).toHaveLength(0);

      succeed(first.calls[0]!);
      const paths = await Promise.all([madeByA, madeByB]);

      expect(paths[1]).toBe(paths[0]);
      expect(second.calls).toHaveLength(0);
      expect(copiesIn(join(projectDir, ".transcode-cache"))).toEqual([basename(paths[0]!)]);
    });

    it("takes over from a process that died, and clears its lock when done", async () => {
      const { spawn, calls } = createSpawnSpy();
      const { resolveProxy, getProxyCachePath } = await loadModule(spawn, FFMPEG_PATH);
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "video.mov");
      writeFileSync(sourcePath, "source-bytes");
      const cachePath = getProxyCachePath(projectDir, sourcePath);
      mkdirSync(dirname(cachePath), { recursive: true });
      const lockPath = join(dirname(cachePath), `.lock-${basename(cachePath)}`);
      writeFileSync(lockPath, "99999999");

      const result = resolveProxy(projectDir, sourcePath);
      await flush(50);
      expect(calls).toHaveLength(1);
      succeed(calls[0]!);

      await expect(result).resolves.toBe(cachePath);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  it("throws a typed error when ffmpeg cannot be resolved, without spawning", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxyTranscodeError } = await loadModule(spawn, undefined);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    await expect(resolveProxy(projectDir, sourcePath)).rejects.toBeInstanceOf(ProxyTranscodeError);
    expect(calls).toHaveLength(0);
  });

  it("treats an ffmpeg that cannot start as an unusable environment, not a bad source", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, FfmpegUnavailableError } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");

    const result = resolveProxy(projectDir, sourcePath);
    await flush();
    calls[0]!.proc.emit("error", new Error("EACCES"));

    await expect(result).rejects.toBeInstanceOf(FfmpegUnavailableError);
  });
});

describe("sourceFolderKind", () => {
  it.each([
    ["/Users/a/Library/Mobile Documents/com~apple~CloudDocs/clip.mov", "icloud"],
    ["/Users/a/Library/CloudStorage/Dropbox/p/clip.mov", "cloud-storage"],
    ["/Users/a/Dropbox (Team)/p/clip.mov", "cloud-storage"],
    ["C:\\Users\\a\\OneDrive - Co\\p\\clip.mov", "cloud-storage"],
    ["/Volumes/Phone Backup/clip.mov", "external-volume"],
    ["/Users/a/Movies/clip.mov", "local"],
    ["/Users/a/Dropboxes/clip.mov", "local"],
  ])("tells %s apart as %s", async (path, kind) => {
    const { spawn } = createSpawnSpy();
    const { sourceFolderKind } = await loadModule(spawn, FFMPEG_PATH);
    expect(sourceFolderKind(path)).toBe(kind);
  });
});
