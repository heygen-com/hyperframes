import { execFileSync, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

function meanLuma(path: string, filters = ""): number {
  const stats = execFileSync(
    realFfmpeg!,
    [
      "-v",
      "error",
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

type FakeProc = EventEmitter & { stderr: EventEmitter; stdout: EventEmitter };

function createFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  return proc;
}

type SpawnOptions = { windowsHide?: boolean };
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

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const tempDirs: string[] = [];

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
      color: { isHdr, hdrTransfer },
    }),
    probeFirstFrameColour: async () => ({}),
  }));
  return import("./proxyTranscoder.js");
}

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
    const cacheDirEntries = readdirSync(join(projectDir, ".transcode-cache"));
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
    expect(args).not.toContain("-movflags");
    expect(args).not.toContain("+faststart");
    expect(args[args.indexOf("-vf") + 1]).toContain("format=yuva420p");

    succeed(calls[0]!, "fake-vp8-bytes");
    await expect(resultPromise).resolves.toBe(vp8Path);
  });

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

    it("lets a caller leave a started copy without stopping it", async () => {
      const { calls, resolveProxy, projectDir } = await oneSlot();
      const clip = clips(projectDir, ["running"]);

      await askThenLeave((signal) =>
        resolveProxy(projectDir, clip.running!, "h264", undefined, { signal }),
      );

      succeed(calls[0]!);
      await flush(12);
      await expect(resolveProxy(projectDir, clip.running!)).resolves.toBeTruthy();
      expect(calls).toHaveLength(1);
    });
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

  it("produces a new cache key when the source mtime changes", async () => {
    const { resolveProxy: _unused, getProxyCachePath } = await loadModule(
      () => createFakeProc(),
      FFMPEG_PATH,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "video.mov");
    writeFileSync(sourcePath, "source-bytes");
    const past = new Date(Date.now() - 60_000);
    utimesSync(sourcePath, past, past);
    const keyBefore = getProxyCachePath(projectDir, sourcePath);

    const future = new Date(Date.now() + 60_000);
    utimesSync(sourcePath, future, future);
    const keyAfter = getProxyCachePath(projectDir, sourcePath);

    expect(keyAfter).not.toBe(keyBefore);
    void _unused;
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
    fail(calls[0]!, 1, "ffmpeg: unsupported codec");

    await expect(resultPromise).rejects.toBeInstanceOf(ProxyTranscodeError);
    await expect(resultPromise).rejects.toMatchObject({
      exitCode: 1,
      stderrTail: expect.stringContaining("unsupported codec"),
    });

    expect(existsSync(cachePath)).toBe(false);
    const cacheDir = join(projectDir, ".transcode-cache");
    const leftover = existsSync(cacheDir) ? readdirSync(cacheDir) : [];
    expect(leftover).toEqual([]);
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

  it("retries after the source file changes (mtime in the cache key invalidates the remembered failure)", async () => {
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

    // Re-exported file (new mtime) → new key → a fresh transcode attempt.
    const future = new Date(Date.now() + 60_000);
    utimesSync(sourcePath, future, future);
    const retry = resolveProxy(projectDir, sourcePath);
    await flush();
    expect(calls).toHaveLength(2);
    succeed(calls[1]!);
    await expect(retry).resolves.toBeTruthy();
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
});
