// fallow-ignore-file code-duplication
import { execFileSync, spawn as realSpawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
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

type SpawnOptions = {
  windowsHide?: boolean;
  signal?: AbortSignal;
  timeout?: number;
  killSignal?: string;
};
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
  vi.doUnmock("node:os");
  delete process.env.HYPERFRAMES_PROXY_MAX_CONCURRENCY;
  delete process.env.HYPERFRAMES_PROXY_MAX_QUEUE;
});

function mockSetPriority(setPriority: (pid: number, priority: number) => void): void {
  vi.doMock("node:os", async (importOriginal) => {
    const mocked = { ...(await importOriginal<typeof import("node:os")>()), setPriority };
    return { ...mocked, default: mocked };
  });
}

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

  it("makes a keyframe every second, at below-normal OS priority", async () => {
    const setPriority = vi.fn();
    mockSetPriority(setPriority);
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(
      (...args) => Object.assign(spawn(...args), { pid: 4242 }),
      FFMPEG_PATH,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "sparse.mp4");
    writeFileSync(sourcePath, "source-bytes");

    const resultPromise = resolveProxy(projectDir, sourcePath, "h264", {
      width: 1024,
      height: 724,
    });
    await flush();
    const args = calls[0]!.args;
    expect(args[args.indexOf("-force_key_frames") + 1]).toBe("expr:gte(t,n_forced*1)");
    expect(setPriority).toHaveBeenCalledWith(4242, 10);

    succeed(calls[0]!);
    await expect(resultPromise).resolves.toContain(".transcode-cache");
  });

  it("still makes the copy when the OS refuses to lower its priority", async () => {
    mockSetPriority(() => {
      throw new Error("EACCES");
    });
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(
      (...args) => Object.assign(spawn(...args), { pid: 4242 }),
      FFMPEG_PATH,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "sparse.mp4");
    writeFileSync(sourcePath, "source-bytes");

    const resultPromise = resolveProxy(projectDir, sourcePath);
    await flush();
    succeed(calls[0]!);

    await expect(resultPromise).resolves.toContain(".transcode-cache");
  });

  describe("background copies yield to playback and exports", () => {
    const box = { width: 1024, height: 724 };
    type Killable = SpawnCall & { proc: FakeProc & { kill: ReturnType<typeof vi.fn> } };

    async function startCopies() {
      const { spawn, calls } = createSpawnSpy();
      const transcoder = await loadModule(
        (...args) => Object.assign(spawn(...args), { pid: 4242, kill: vi.fn(() => true) }),
        FFMPEG_PATH,
      );
      const projectDir = realpathSync(tmpProject());
      const [seek, waited] = ["sparse.mp4", "hevc.mov"].map((name) => {
        const sourcePath = join(projectDir, name);
        writeFileSync(sourcePath, name);
        return sourcePath;
      });
      const copies = [
        transcoder.resolveProxy(projectDir, seek!, "h264", box, { background: true }),
        transcoder.resolveProxy(projectDir, waited!, "h264", box),
      ];
      await flush();
      const callFor = (name: string) =>
        (calls as Killable[]).find((call) => call.args.includes(join(projectDir, name)))!;
      const signals = (name: string) => callFor(name).proc.kill.mock.calls.map(([sig]) => sig);
      const finish = async () => {
        calls.forEach((call) => succeed(call));
        await Promise.all(copies);
      };
      return { transcoder, signals, finish, projectDir, seek: seek! };
    }

    afterEach(() => vi.useRealTimers());

    it("stops a background copy while the preview plays and resumes it on pause", async () => {
      const { transcoder, signals, finish } = await startCopies();

      transcoder.notePreviewPlaying(true);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP"]);
      expect(signals("hevc.mov")).toEqual([]);

      transcoder.notePreviewPlaying(false);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP", "SIGCONT"]);
      await finish();
    });

    it("resumes once a preview that said it plays goes quiet past its lease", async () => {
      vi.useFakeTimers();
      const { transcoder, signals, finish } = await startCopies();

      transcoder.notePreviewPlaying(true);
      await vi.advanceTimersByTimeAsync(14_000);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP"]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP", "SIGCONT"]);
      await finish();
    });

    it("stops a background copy while an export renders", async () => {
      vi.useFakeTimers();
      const { transcoder, signals, finish } = await startCopies();
      const job = { status: "rendering" };

      transcoder.holdBackgroundCopiesDuring(job);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP"]);
      job.status = "complete";
      await vi.advanceTimersByTimeAsync(1_000);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP", "SIGCONT"]);
      expect(signals("hevc.mov")).toEqual([]);
      await finish();
    });

    it("frees a stopped copy's slot for a needed copy, and resumes stopped copies only into free slots", async () => {
      vi.useFakeTimers();
      const { spawn, calls } = createSpawnSpy();
      const transcoder = await loadModule(
        (...args) => Object.assign(spawn(...args), { pid: 4242, kill: vi.fn(() => true) }),
        FFMPEG_PATH,
      );
      const projectDir = tmpProject();
      const source = (name: string) => {
        writeFileSync(join(projectDir, name), name);
        return join(projectDir, name);
      };
      const copies = ["a.mp4", "b.mp4"].map((name) =>
        transcoder.resolveProxy(projectDir, source(name), "h264", box, { background: true }),
      );
      await flush();
      const signals = (index: number) =>
        (calls[index] as Killable).proc.kill.mock.calls.map(([sig]) => sig);

      transcoder.notePreviewPlaying(true);
      copies.push(transcoder.resolveProxy(projectDir, source("prores.mov"), "h264", box));
      await flush();
      expect(calls).toHaveLength(MAX_CONCURRENT + 1);

      transcoder.notePreviewPlaying(false);
      expect([signals(0), signals(1)]).toEqual([["SIGSTOP", "SIGCONT"], ["SIGSTOP"]]);
      succeed(calls[2]!);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(signals(1)).toEqual(["SIGSTOP", "SIGCONT"]);
      calls.forEach((call) => succeed(call));
      await Promise.all(copies);
    });

    it("resumes a stopped background copy as soon as a viewer asks for it", async () => {
      const { transcoder, signals, finish, projectDir, seek } = await startCopies();
      transcoder.notePreviewPlaying(true);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP"]);

      const asked = transcoder.resolveProxy(projectDir, seek, "h264", box);
      expect(signals("sparse.mp4")).toEqual(["SIGSTOP", "SIGCONT"]);
      transcoder.notePreviewPlaying(false);
      await finish();
      await asked;
    });

    /** Fake ffmpegs that die on SIGKILL and honour spawn's `timeout` as Node does. */
    async function dyingCopies() {
      const { spawn, calls } = createSpawnSpy();
      const transcoder = await loadModule((command, args, options) => {
        const proc = spawn(command, args, options);
        let dead = false;
        const kill = vi.fn((sig: string) => {
          if (sig === "SIGKILL" && !dead) {
            dead = true;
            proc.emit("close", null, "SIGKILL");
          }
          return true;
        });
        if (options?.timeout) {
          const timer = setTimeout(() => kill(options.killSignal ?? "SIGTERM"), options.timeout);
          proc.once("close", () => clearTimeout(timer));
        }
        options?.signal?.addEventListener("abort", () => kill(options.killSignal ?? "SIGTERM"));
        return Object.assign(proc, { pid: 4242, kill });
      }, FFMPEG_PATH);
      const projectDir = tmpProject();
      const source = (name: string) => {
        writeFileSync(join(projectDir, name), name);
        return join(projectDir, name);
      };
      const signals = (index: number) =>
        (calls[index] as Killable).proc.kill.mock.calls.map(([sig]) => sig);
      return { transcoder, calls, projectDir, source, signals };
    }

    it("resumes a stopped copy a viewer waits on into the next freed slot, ahead of queued background copies", async () => {
      vi.useFakeTimers();
      const { transcoder, calls, projectDir, source, signals } = await dyingCopies();
      const [a, b] = [source("a.mp4"), source("b.mp4")];
      const copies = [a, b].map((sourcePath) =>
        transcoder.resolveProxy(projectDir, sourcePath, "h264", box, { background: true }),
      );
      await flush();
      transcoder.notePreviewPlaying(true);
      copies.push(
        ...["c.mov", "d.mov"].map((name) =>
          transcoder.resolveProxy(projectDir, source(name), "h264", box),
        ),
        transcoder.resolveProxy(projectDir, source("e.mp4"), "h264", box, { background: true }),
      );
      await flush();
      expect(calls).toHaveLength(4);

      copies.push(transcoder.resolveProxy(projectDir, a, "h264", box));
      expect(signals(0)).toEqual(["SIGSTOP"]);
      succeed(calls[2]!);
      await flush(50);
      expect(signals(0)).toEqual(["SIGSTOP", "SIGCONT"]);
      expect(signals(1)).toEqual(["SIGSTOP"]);
      expect(calls).toHaveLength(4);

      transcoder.notePreviewPlaying(false);
      [0, 1, 3].forEach((index) => succeed(calls[index]!));
      await flush(50);
      expect(calls).toHaveLength(5);
      succeed(calls[4]!);
      await Promise.all(copies);
    });

    it("drops a stopped copy from the line when its viewers leave, leaking no slot", async () => {
      vi.useFakeTimers();
      const { transcoder, calls, projectDir, source, signals } = await dyingCopies();
      const [a, b] = [source("a.mp4"), source("b.mp4")];
      const leaving = new AbortController();
      const copies = [
        transcoder
          .resolveProxy(projectDir, a, "h264", box, { background: true, signal: leaving.signal })
          .catch(() => "left"),
        transcoder.resolveProxy(projectDir, b, "h264", box, { background: true }),
      ];
      await flush();
      transcoder.notePreviewPlaying(true);
      copies.push(
        ...["c.mov", "d.mov"].map((name) =>
          transcoder.resolveProxy(projectDir, source(name), "h264", box),
        ),
        transcoder.resolveProxy(projectDir, source("e.mp4"), "h264", box, { background: true }),
        transcoder
          .resolveProxy(projectDir, a, "h264", box, { signal: leaving.signal })
          .catch(() => "left"),
      );
      await flush();
      leaving.abort();
      expect(signals(0)).toEqual(["SIGSTOP", "SIGKILL"]);

      succeed(calls[2]!);
      await flush(50);
      expect(calls).toHaveLength(5);
      transcoder.notePreviewPlaying(false);
      [1, 3, 4].forEach((index) => succeed(calls[index]!));
      await Promise.all(copies);

      const fresh = ["f.mov", "g.mov", "h.mov"].map((name) =>
        transcoder.resolveProxy(projectDir, source(name), "h264", box),
      );
      await flush(50);
      expect(calls).toHaveLength(5 + MAX_CONCURRENT);
      [5, 6].forEach((index) => succeed(calls[index]!));
      await flush(50);
      succeed(calls[7]!);
      await Promise.all(fresh);
    });

    it("counts only encoding time toward the timeout, not time spent stopped", async () => {
      vi.useFakeTimers();
      const { transcoder, projectDir, source, signals } = await dyingCopies();
      const copy = transcoder.resolveProxy(projectDir, source("a.mp4"), "h264", box, {
        background: true,
      });
      await flush();
      const exportJob = { status: "rendering" };
      transcoder.holdBackgroundCopiesDuring(exportJob);
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      expect(signals(0)).toEqual(["SIGSTOP"]);

      exportJob.status = "complete";
      await vi.advanceTimersByTimeAsync(1_000);
      const killed = expect(copy).rejects.toBeInstanceOf(transcoder.ProxyTranscodeError);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(signals(0)).toEqual(["SIGSTOP", "SIGCONT"]);
      // The budget resumes where it paused: 15 minutes of encoding in all.
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(signals(0)).toEqual(["SIGSTOP", "SIGCONT", "SIGKILL"]);
      await killed;
    });

    it("does not remember a copy killed while stopped as a failure", async () => {
      vi.useFakeTimers();
      const { transcoder, calls, projectDir, source } = await dyingCopies();
      const sourcePath = source("a.mp4");
      const copy = transcoder.resolveProxy(projectDir, sourcePath, "h264", box, {
        background: true,
      });
      await flush();
      transcoder.notePreviewPlaying(true);
      calls[0]!.proc.emit("close", null, "SIGKILL");
      await expect(copy).rejects.toBeInstanceOf(transcoder.ProxyTranscodeError);

      const again = transcoder.resolveProxy(projectDir, sourcePath, "h264", box);
      await flush();
      expect(calls).toHaveLength(2);
      succeed(calls[1]!);
      await expect(again).resolves.toContain(".transcode-cache");
    });

    it("still fails, and remembers, a running copy that outlasts the timeout", async () => {
      vi.useFakeTimers();
      const { transcoder, calls, projectDir, source, signals } = await dyingCopies();
      const sourcePath = source("a.mp4");
      const copy = transcoder.resolveProxy(projectDir, sourcePath, "h264", box);
      const failed = expect(copy).rejects.toBeInstanceOf(transcoder.ProxyTranscodeError);
      await flush();
      await vi.advanceTimersByTimeAsync(transcoder.TRANSCODE_TIMEOUT_MS - 1_000);
      expect(signals(0)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(signals(0)).toEqual(["SIGKILL"]);
      await failed;

      await expect(transcoder.resolveProxy(projectDir, sourcePath, "h264", box)).rejects.toThrow(
        /killed by SIGKILL/,
      );
      expect(calls).toHaveLength(1);
    });

    it("never signals on Windows, where Node would kill the copy instead", async () => {
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      try {
        const { transcoder, signals, finish } = await startCopies();
        transcoder.notePreviewPlaying(true);
        expect(signals("sparse.mp4")).toEqual([]);
        await finish();
      } finally {
        Object.defineProperty(process, "platform", platform);
      }
    });
  });

  describe("one copy per source, at the largest size it is shown", () => {
    const small = { width: 724, height: 362 };
    const large = { width: 1448, height: 724 };

    async function source() {
      const { spawn, calls } = createSpawnSpy();
      const transcoder = await loadModule(
        (...args) => Object.assign(spawn(...args), { pid: 4242, kill: vi.fn(() => true) }),
        FFMPEG_PATH,
      );
      const projectDir = tmpProject();
      const sourcePath = join(projectDir, "clip.mp4");
      writeFileSync(sourcePath, "source-bytes");
      const copyAt = (box: { width: number; height: number }) =>
        transcoder.resolveProxy(projectDir, sourcePath, "h264", box);
      const pathAt = (box: { width: number; height: number }) =>
        transcoder.getProxyCachePath(projectDir, sourcePath, "h264", box);
      return {
        transcoder,
        calls: calls as Array<SpawnCall & { proc: { kill: ReturnType<typeof vi.fn> } }>,
        copyAt,
        pathAt,
        projectDir,
      };
    }

    afterEach(() => vi.useRealTimers());

    it("serves a smaller box from the larger copy still being made", async () => {
      const { calls, copyAt, pathAt } = await source();
      const larger = copyAt(large);
      await flush();
      const smaller = copyAt(small);
      await flush();

      expect(calls).toHaveLength(1);
      succeed(calls[0]!);
      await expect(smaller).resolves.toBe(pathAt(large));
      await expect(larger).resolves.toBe(pathAt(large));
    });

    it("moves the larger queued copy up when a priority ask is served by it", async () => {
      const { transcoder, calls, copyAt, projectDir } = await source();
      const others = ["fill-1.mp4", "fill-2.mp4", "other.mp4"].map((name) => {
        writeFileSync(join(projectDir, name), name);
        return transcoder.resolveProxy(projectDir, join(projectDir, name), "h264", small);
      });
      await flush();
      const larger = copyAt(large);
      const asked = transcoder.resolveProxy(
        projectDir,
        join(projectDir, "clip.mp4"),
        "h264",
        small,
        {
          priority: true,
        },
      );
      await flush();
      expect(calls).toHaveLength(MAX_CONCURRENT);

      succeed(calls[0]!);
      await flush();
      expect(calls[2]!.args.some((arg) => arg.endsWith("clip.mp4"))).toBe(true);
      calls.forEach((call) => succeed(call));
      await flush();
      calls.forEach((call) => succeed(call));
      await Promise.all([...others, larger, asked]);
    });

    it("stops a smaller copy being made when a larger box is asked, and makes one at the larger box", async () => {
      const { calls, copyAt, pathAt } = await source();
      const smaller = copyAt(small);
      await flush();
      const temp = calls[0]!.args.at(-1)!;
      writeFileSync(temp, "partial");

      const larger = copyAt(large);
      expect(calls[0]!.proc.kill).toHaveBeenCalledWith("SIGKILL");
      calls[0]!.proc.emit("close", null, "SIGKILL");
      await expect(smaller).rejects.toThrow();
      await flush();
      expect(existsSync(temp)).toBe(false);
      expect(calls).toHaveLength(2);

      const again = copyAt(small);
      await flush();
      expect(calls).toHaveLength(2);
      succeed(calls[1]!);
      await expect(larger).resolves.toBe(pathAt(large));
      await expect(again).resolves.toBe(pathAt(large));
    });

    it("stops a smaller copy replaced before its encoder started, as soon as it starts", async () => {
      const { calls, copyAt } = await source();
      void copyAt(small).catch(() => {});
      void copyAt(large).catch(() => {});
      await flush();

      const smallCall = calls.find((call) => call.args.at(-1)!.includes("724x362"))!;
      expect(smallCall.proc.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("makes the smaller copy afresh if the larger one fails, not failing for the stopped one", async () => {
      const { calls, copyAt } = await source();
      void copyAt(small).catch(() => {});
      await flush();
      const larger = copyAt(large);
      calls[0]!.proc.emit("close", null, "SIGKILL");
      await flush();
      fail(calls[1]!);
      await expect(larger).rejects.toThrow();

      void copyAt(small).catch(() => {});
      await flush();
      expect(calls).toHaveLength(3);
    });

    it("serves a smaller box from a finished larger copy without a new encode", async () => {
      const { calls, copyAt, pathAt } = await source();
      const larger = copyAt(large);
      await flush();
      succeed(calls[0]!);
      await larger;

      await expect(copyAt(small)).resolves.toBe(pathAt(large));
      expect(calls).toHaveLength(1);
    });

    it("drops the smaller copy once a larger one is made and nothing reads the smaller", async () => {
      vi.useFakeTimers();
      const { calls, copyAt, pathAt } = await source();
      const first = copyAt(small);
      await flush();
      succeed(calls[0]!);
      await first;
      await copyAt(small);

      const larger = copyAt(large);
      await flush();
      succeed(calls[1]!);
      await larger;
      expect(existsSync(pathAt(small))).toBe(true);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(existsSync(pathAt(small))).toBe(false);
      expect(existsSync(pathAt(large))).toBe(true);
    });
  });

  it("kills every running encoder and removes its temp file when the server exits", async () => {
    const before = new Set(process.listeners("exit"));
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy } = await loadModule(
      (...args) => Object.assign(spawn(...args), { pid: 4242, kill: vi.fn(() => true) }),
      FFMPEG_PATH,
    );
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "clip.mov");
    writeFileSync(sourcePath, "source-bytes");
    void resolveProxy(projectDir, sourcePath).catch(() => {});
    await flush();
    const temp = calls[0]!.args.at(-1)!;
    writeFileSync(temp, "partial");

    const onExit = process.listeners("exit").find((listener) => !before.has(listener))!;
    process.removeListener("exit", onExit);
    onExit.call(process, 0);

    expect(
      (calls[0]!.proc as unknown as { kill: ReturnType<typeof vi.fn> }).kill,
    ).toHaveBeenCalledWith("SIGKILL");
    expect(existsSync(temp)).toBe(false);
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

  it("lends a capture this source's largest finished copy, even one smaller than it shows", async () => {
    const { finishedProxyPath, getProxyCachePath } = await import("./proxyTranscoder.js");
    const projectDir = tmpProject();
    const sourcePath = join(projectDir, "clip.mov");
    writeFileSync(sourcePath, "source-bytes");
    const copy = (width: number, height: number) => {
      const path = getProxyCachePath(projectDir, sourcePath, "h264", { width, height });
      writeFileSync(path, "copy-bytes");
      return path;
    };

    expect(finishedProxyPath(projectDir, sourcePath, "h264")).toBeNull();
    mkdirSync(join(projectDir, ".transcode-cache"));
    const pageCopy = copy(256, 512);
    expect(finishedProxyPath(projectDir, sourcePath, "h264")).toBe(pageCopy);
    copy(256, 256);
    const larger = copy(724, 1024);
    expect(finishedProxyPath(projectDir, sourcePath, "h264")).toBe(larger);
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
    expect(args).not.toContain("-force_key_frames");
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
      message:
        "ffmpeg exited with code 1: Error submitting a packet to the muxer: No space left on device",
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
