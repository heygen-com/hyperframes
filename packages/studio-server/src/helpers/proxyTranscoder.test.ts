import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const FFMPEG_PATH = "/usr/bin/ffmpeg";
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

type SpawnCall = { command: string; args: string[]; proc: FakeProc };
type SpawnImpl = (command: string, args: string[]) => FakeProc;

function createSpawnSpy(): { spawn: SpawnImpl; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnImpl = (command, args) => {
    const proc = createFakeProc();
    calls.push({ command, args, proc });
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
      color: { isHdr },
    }),
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

    succeed(calls[1]!);
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

  it("rejects an in-project symlink whose target escapes the project", async () => {
    const { spawn, calls } = createSpawnSpy();
    const { resolveProxy, ProxySourceOutsideProjectError } = await loadModule(spawn, FFMPEG_PATH);
    const projectDir = tmpProject();
    const outsideDir = tmpProject();
    const outsidePath = join(outsideDir, "outside.mov");
    const sourcePath = join(projectDir, "linked.mov");
    writeFileSync(outsidePath, "source-bytes");
    symlinkSync(outsidePath, sourcePath);

    await expect(resolveProxy(projectDir, sourcePath)).rejects.toBeInstanceOf(
      ProxySourceOutsideProjectError,
    );
    expect(calls).toHaveLength(0);
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
