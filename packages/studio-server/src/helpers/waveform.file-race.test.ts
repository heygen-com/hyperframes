// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { buildWaveformCacheKey, generateWaveformCache } from "./waveform.js";
import { registerWaveformRoutes } from "../routes/waveform.js";
import type { StudioApiAdapter } from "../types.js";

const hooks = vi.hoisted(() => {
  const state: {
    decode?: () => void;
    writing?: () => void;
    failDecode: boolean;
    failWrite: boolean;
    failRename: boolean;
    failCleanup: boolean;
  } = { failDecode: false, failWrite: false, failRename: false, failCleanup: false };
  return state;
});
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: vi.fn(() => {
      const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
      queueMicrotask(() => {
        hooks.decode?.();
        if (!hooks.failDecode)
          proc.stdout.emit("data", Buffer.from(new Float32Array([0.5]).buffer));
        proc.emit("close", hooks.failDecode ? 1 : 0);
      });
      return proc;
    }),
  };
});
vi.mock("@hyperframes/parsers/ff-binaries", () => ({ findFfBinary: () => "ffmpeg" }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      hooks.writing?.();
      if (hooks.failWrite) {
        fs.writeFileSync(args[0], "partial");
        throw new Error("cache write failed");
      }
      return fs.writeFileSync(...args);
    },
    rmSync: (...args: Parameters<typeof fs.rmSync>) => {
      if (hooks.failCleanup) throw new Error("cache cleanup failed");
      return fs.rmSync(...args);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (hooks.failRename) throw new Error("cache rename failed");
      return fs.renameSync(...args);
    },
  };
});
const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
let projectDir: string;
let cacheDir: string;
let cachePath: string;
let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(hooks, {
    decode: undefined,
    writing: undefined,
    failDecode: false,
    failWrite: false,
    failRename: false,
    failCleanup: false,
  });
  projectDir = fs.mkdtempSync(join(tmpdir(), "hf-waveform-test-"));
  fs.writeFileSync(join(projectDir, "audio.wav"), "audio");
  cacheDir = join(projectDir, ".waveform-cache");
  cachePath = join(
    cacheDir,
    buildWaveformCacheKey("audio.wav", fs.statSync(join(projectDir, "audio.wav"))),
  );
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: (id) => (id === "demo" ? { id, dir: projectDir } : null),
    bundle: async () => null,
    lint: () => ({ findings: [] }),
    runtimeUrl: "/runtime.js",
    rendersDir: () => projectDir,
    startRender: () => ({ id: "unused", status: "rendering", progress: 0, outputPath: "unused" }),
  };
  app = new Hono();
  registerWaveformRoutes(app, adapter);
});
afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

function readPeaks() {
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}
function seedCache(content: string) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, content);
}
function request() {
  return app.request("http://localhost/projects/demo/waveform/audio.wav");
}

for (const caller of ["helper", "route"]) {
  describe(caller, () => {
    async function generate() {
      if (caller === "helper") return generateWaveformCache(projectDir, "audio.wav");
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ peaks: readPeaks() });
    }

    it.each([true, false])(
      "does not write through a swapped cache symlink (target exists: %s)",
      async (exists) => {
        const target = join(projectDir, "outside.json");
        if (exists) fs.writeFileSync(target, "untouched");
        hooks.decode = () => {
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.symlinkSync(target, cachePath, "file");
        };
        await generate();
        if (exists) expect(fs.readFileSync(target, "utf8")).toBe("untouched");
        else expect(fs.existsSync(target)).toBe(false);
        expect(fs.lstatSync(cachePath).isSymbolicLink()).toBe(false);
        expect(readPeaks()).toHaveLength(4000);
        expect(fs.readdirSync(cacheDir)).toEqual([
          buildWaveformCacheKey("audio.wav", fs.statSync(join(projectDir, "audio.wav"))),
        ]);
      },
    );

    it.each([true, false])(
      "rejects a cache-directory symlink (target exists: %s)",
      async (exists) => {
        const outside = fs.mkdtempSync(join(tmpdir(), "hf-waveform-outside-"));
        const target = join(outside, "cache");
        const outsideCache = join(
          target,
          buildWaveformCacheKey("audio.wav", fs.statSync(join(projectDir, "audio.wav"))),
        );
        if (exists) {
          fs.mkdirSync(target);
          fs.writeFileSync(outsideCache, "untouched");
        }
        fs.symlinkSync(target, cacheDir, process.platform === "win32" ? "junction" : "dir");
        try {
          if (caller === "helper")
            await expect(generateWaveformCache(projectDir, "audio.wav")).rejects.toThrow();
          else {
            const response = await request();
            expect(response.status).toBe(200);
            expect((await response.json()).peaks).toHaveLength(4000);
          }
          if (exists) {
            expect(fs.readFileSync(outsideCache, "utf8")).toBe("untouched");
            expect(fs.readdirSync(target)).toHaveLength(1);
          } else expect(fs.existsSync(target)).toBe(false);
        } finally {
          fs.rmSync(outside, { recursive: true, force: true });
        }
      },
    );

    it("rejects a cache-directory symlink planted during decoding", async () => {
      const outside = fs.mkdtempSync(join(tmpdir(), "hf-waveform-outside-"));
      hooks.decode = () =>
        fs.symlinkSync(outside, cacheDir, process.platform === "win32" ? "junction" : "dir");
      try {
        if (caller === "helper")
          await expect(generateWaveformCache(projectDir, "audio.wav")).rejects.toThrow();
        else expect((await request()).status).toBe(200);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it("reuses an existing cache without decoding", async () => {
      seedCache("[0.25,1]");
      await generate();
      expect(spawn).not.toHaveBeenCalled();
      expect(readPeaks()).toEqual([0.25, 1]);
    });

    it("publishes complete JSON and removes staging directories", async () => {
      hooks.writing = () => expect(fs.existsSync(cachePath)).toBe(false);
      await generate();
      expect(readPeaks()).toHaveLength(4000);
      expect(fs.readdirSync(cacheDir)).toHaveLength(1);
    });

    it.each(["write", "rename"])(
      "cleans up a failed %s and preserves the previous cache",
      async (failure) => {
        hooks.decode = () => seedCache("[0.25]");
        hooks.failWrite = failure === "write";
        hooks.failRename = failure === "rename";
        if (caller === "helper") {
          await expect(generateWaveformCache(projectDir, "audio.wav")).rejects.toThrow(
            `cache ${failure} failed`,
          );
        } else {
          const response = await request();
          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.peaks).toHaveLength(4000);
        }
        expect(readPeaks()).toEqual([0.25]);
        expect(fs.readdirSync(cacheDir)).toHaveLength(1);
      },
    );

    it("handles a cache-directory creation failure with the existing error contract", async () => {
      fs.writeFileSync(cacheDir, "blocked");
      if (caller === "helper")
        await expect(generateWaveformCache(projectDir, "audio.wav")).rejects.toThrow();
      else expect((await request()).status).toBe(200);
      expect(fs.readFileSync(cacheDir, "utf8")).toBe("blocked");
    });
  });
}

it("regenerates a corrupt cache and reuses the replacement", async () => {
  seedCache("not JSON");
  hooks.writing = () => expect(fs.readFileSync(cachePath, "utf8")).toBe("not JSON");
  expect((await request()).status).toBe(200);
  expect(readPeaks()).toHaveLength(4000);
  expect((await request()).status).toBe(200);
  expect(spawn).toHaveBeenCalledTimes(1);
});
it("concurrent misses leave one complete cache and no staging files", async () => {
  await Promise.all([generateWaveformCache(projectDir, "audio.wav"), request(), request()]);
  expect(readPeaks()).toHaveLength(4000);
  expect(fs.readdirSync(cacheDir)).toHaveLength(1);
});
it("keeps helper skipping, route 404s and decode failures unchanged", async () => {
  expect((await app.request("http://localhost/projects/missing/waveform/audio.wav")).status).toBe(
    404,
  );
  hooks.failDecode = true;
  await expect(generateWaveformCache(projectDir, "audio.wav")).rejects.toThrow(
    "ffmpeg exited with code 1",
  );
  const failed = await request();
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: "failed to decode audio" });
  fs.unlinkSync(join(projectDir, "audio.wav"));
  await expect(generateWaveformCache(projectDir, "audio.wav")).resolves.toBeUndefined();
  expect((await request()).status).toBe(404);
  expect(fs.existsSync(cacheDir)).toBe(false);
});

it("cleanup failure does not turn a successful publication into a helper error", async () => {
  hooks.failCleanup = true;
  await expect(generateWaveformCache(projectDir, "audio.wav")).resolves.toBeUndefined();
  expect(readPeaks()).toHaveLength(4000);
});
it("cleanup failure does not mask the original write error", async () => {
  hooks.failWrite = true;
  hooks.failCleanup = true;
  await expect(generateWaveformCache(projectDir, "audio.wav")).rejects.toThrow(
    "cache write failed",
  );
  expect(fs.existsSync(cachePath)).toBe(false);
});
