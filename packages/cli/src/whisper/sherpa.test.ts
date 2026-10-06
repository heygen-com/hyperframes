import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadOptions } from "../cloud/download.js";
import {
  ensureParakeetModel,
  installSherpaRuntime,
  SHERPA_RUNTIME_DIR,
  sherpaPlatformPackage,
  DecodeCancelled,
  sherpaRuntimeLoadError,
  sherpaUnsupportedReason,
  transcribeWithSherpa,
  type ModelFile,
} from "./sherpa.js";

const file = (name: string, content: string): ModelFile => ({
  name,
  bytes: Buffer.byteLength(content),
  sha256: createHash("sha256").update(content).digest("hex"),
});

/** A downloader that serves `served[name]` for any URL ending in that name. */
function fakeDownload(served: Record<string, string>) {
  return vi.fn(async (url: string, dest: string, opts?: DownloadOptions) => {
    const content = served[url.split("/").at(-1)!]!;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    opts?.signal?.throwIfAborted();
    opts?.onProgress?.(Buffer.byteLength(content), undefined);
    return { path: dest, bytes: Buffer.byteLength(content) };
  });
}

/** A stand-in runtime in `root` whose entry point loads, or throws as a missing library does. */
const LOADS = "module.exports = {};";
const BROKEN = 'throw new Error("libonnxruntime.so: cannot open\\n  shared object");';
function fakeRuntime(root: string, body: string, version = "1.13.8") {
  const pkg = join(root, "node_modules", "sherpa-onnx-node");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "sherpa-onnx-node", main: "index.js", version }),
  );
  writeFileSync(join(pkg, "index.js"), body);
}

describe("installSherpaRuntime", () => {
  it.each([
    ["darwin", "arm64", "sherpa-onnx-darwin-arm64@1.13.8"],
    ["linux", "x64", "sherpa-onnx-linux-x64@1.13.8"],
    ["win32", "ia32", "sherpa-onnx-win-ia32@1.13.8"],
  ])("pins the %s-%s native package", (platform, arch, spec) => {
    expect(sherpaPlatformPackage(platform as NodeJS.Platform, arch as NodeJS.Architecture)).toBe(
      spec,
    );
  });

  it("asks npm for the runtime and its native package at the same exact version", async () => {
    const run = vi.fn(async (_args: string[]) => {
      throw new Error("stop before touching the cache");
    });
    const cancel = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), "hf-sherpa-runtime-"));
    await installSherpaRuntime({ run, signal: cancel.signal, dir }).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
    expect((run.mock.calls[0] as unknown[] | undefined)?.[1]).toBe(cancel.signal);
    const args = run.mock.calls[0]?.[0] as string[] | undefined;
    expect(args).toContain("sherpa-onnx-node@1.13.8");
    expect(args).toContain(sherpaPlatformPackage());
  });

  it("reinstalls a runtime that is present but does not load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-sherpa-runtime-"));
    try {
      fakeRuntime(dir, BROKEN);
      expect(await sherpaRuntimeLoadError(dir)).toBe(
        "libonnxruntime.so: cannot open shared object",
      );
      const run = vi.fn(async (args: string[]) =>
        fakeRuntime(args[args.indexOf("--prefix") + 1]!, LOADS),
      );

      expect(await installSherpaRuntime({ run, dir })).toEqual({
        installed: true,
        runtimePath: join(dir, "node_modules", "sherpa-onnx-node", "index.js"),
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(await sherpaRuntimeLoadError(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a runtime that loads alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-sherpa-runtime-"));
    try {
      fakeRuntime(dir, LOADS);
      const run = vi.fn();
      expect(await installSherpaRuntime({ run, dir })).toEqual({
        installed: false,
        runtimePath: join(dir, "node_modules", "sherpa-onnx-node", "index.js"),
      });
      expect(run).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails with the loader's error when the reinstalled runtime still does not load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-sherpa-runtime-"));
    try {
      const run = vi.fn(async (args: string[]) =>
        fakeRuntime(args[args.indexOf("--prefix") + 1]!, BROKEN),
      );
      await expect(installSherpaRuntime({ run, dir })).rejects.toThrow(
        "The sherpa-onnx runtime was reinstalled but still does not load (libonnxruntime.so: cannot open shared object). Use --engine whisper for now.",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32").each(["SIGINT", "SIGHUP"])(
    "treats a probe stopped by %s as a cancel and keeps the runtime",
    async (signal) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-sherpa-runtime-"));
      try {
        fakeRuntime(dir, `process.kill(process.pid, "${signal}");`);
        const run = vi.fn();
        await expect(installSherpaRuntime({ run, dir })).rejects.toBeInstanceOf(DecodeCancelled);
        expect(run).not.toHaveBeenCalled();
        expect(existsSync(join(dir, "node_modules", "sherpa-onnx-node", "index.js"))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("reads its own probe timeout as a broken runtime, not a cancel, and says so", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-sherpa-runtime-"));
    try {
      fakeRuntime(dir, "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);");
      expect(await sherpaRuntimeLoadError(dir, 300)).toBe("loading it timed out after 0.3 s");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports timeout even when the runtime handles SIGTERM and exits zero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-sherpa-runtime-"));
    try {
      fakeRuntime(
        dir,
        'process.on("SIGTERM", () => process.exit(0)); require("node:net").createServer().listen(0, "127.0.0.1");',
      );
      expect(await sherpaRuntimeLoadError(dir, 300)).toBe("loading it timed out after 0.3 s");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps each platform and arch in its own runtime dir", () => {
    expect(SHERPA_RUNTIME_DIR).toMatch(
      new RegExp(`sherpa-onnx-node@1\\.13\\.8-${process.platform}-${process.arch}$`),
    );
  });
});

describe("a pinned Sherpa copy beside the CLI", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-sherpa-beside-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function layout(besideBody: string, cachedBody?: string) {
    const bundle = join(root, "bundle");
    const cache = join(root, "cache");
    fakeRuntime(bundle, besideBody);
    if (cachedBody !== undefined) fakeRuntime(cache, cachedBody);
    const cliUrl = pathToFileURL(join(bundle, "dist", "cli.js")).href;
    const pinnedPath = join(bundle, "node_modules", "sherpa-onnx-node", "index.js");
    return { cache, cliUrl, pinnedPath };
  }

  function decoder() {
    const parentMarker = join(root, "loaded-in-parent");
    return `
if (process.pid === ${process.pid}) require("node:fs").writeFileSync(${JSON.stringify(parentMarker)}, "");
module.exports = {
  readWave() { return { sampleRate: 100, samples: new Float32Array(100).fill(0.5) }; },
  OfflineRecognizer: class {
    createStream() { return { acceptWaveform() {} }; }
    decode() {}
    getResult() { return { tokens: [" hello"], timestamps: [0], durations: [1] }; }
  }
};`;
  }

  async function transcript(cache: string, cliUrl: string) {
    const out = join(root, "out");
    mkdirSync(out, { recursive: true });
    const onEvent = vi.fn();
    await transcribeWithSherpa(join(root, "speech.wav"), out, {
      signal: new AbortController().signal,
      runtimeDir: cache,
      cliUrl,
      onEvent,
    });
    const result = JSON.parse(readFileSync(join(out, "transcript.json"), "utf-8"));
    expect(result).toEqual([{ text: "hello", start: 0, end: 1 }]);
    const event = { type: "progress", phase: "transcription", model: "parakeet-tdt-0.6b-v3" };
    expect(onEvent.mock.calls).toEqual([
      [{ ...event, status: "started" }],
      [{ ...event, status: "completed" }],
    ]);
    expect(existsSync(join(root, "loaded-in-parent"))).toBe(false);
  }

  it("loads a pinned adjacent copy without a cache or npm install", async () => {
    const { cache, cliUrl, pinnedPath } = layout(LOADS);
    const run = vi.fn();
    expect(await sherpaRuntimeLoadError(cache, 60_000, cliUrl)).toBeNull();
    expect(await installSherpaRuntime({ dir: cache, cliUrl, run })).toEqual({
      installed: false,
      runtimePath: pinnedPath,
    });
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(cache)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "cancels an in-flight probe without inspecting the cache",
    async () => {
      const cacheMarker = join(root, "cache-loaded");
      const { cache, cliUrl } = layout(
        'require("node:net").createServer().listen(0, "127.0.0.1", () => process.kill(process.ppid, "SIGUSR2"));',
        `require("node:fs").writeFileSync(${JSON.stringify(cacheMarker)}, ""); module.exports = {};`,
      );
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.once("SIGUSR2", abort);
      try {
        await expect(
          sherpaRuntimeLoadError(cache, 300, cliUrl, controller.signal),
        ).rejects.toBeInstanceOf(DecodeCancelled);
        expect(existsSync(cacheMarker)).toBe(false);
        expect(log).not.toHaveBeenCalled();
      } finally {
        process.removeListener("SIGUSR2", abort);
      }
    },
  );

  it("passes the pinned adjacent copy to the real decode worker", async () => {
    const { cache, cliUrl } = layout(decoder());
    await transcript(cache, cliUrl);
  });

  it("logs the broken pinned path once and decodes with the healthy cache", async () => {
    const { cache, cliUrl, pinnedPath } = layout(BROKEN, decoder());
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await transcript(cache, cliUrl);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain(pinnedPath);
    expect(log.mock.calls[0]?.[0]).toContain("libonnxruntime.so: cannot open shared object");
    expect(String(log.mock.calls[0]?.[0])).not.toContain("\n");
  });

  it("reports an accepted package with a missing entry and uses the healthy cache", async () => {
    const { cache, cliUrl, pinnedPath } = layout(LOADS, decoder());
    rmSync(pinnedPath);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await transcript(cache, cliUrl);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain(dirname(pinnedPath));
    expect(log.mock.calls[0]?.[0]).toContain("Cannot find module");
  });

  it.each([undefined, BROKEN])(
    "logs the broken pinned path once and reports repair when no cache loads (%s)",
    async (cachedBody) => {
      const { cache, cliUrl, pinnedPath } = layout(BROKEN, cachedBody);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = join(root, "out");
      mkdirSync(out);
      await expect(
        transcribeWithSherpa(join(root, "speech.wav"), out, {
          signal: new AbortController().signal,
          runtimeDir: cache,
          cliUrl,
        }),
      ).rejects.toThrow(/hyperframes models install parakeet/);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toContain(pinnedPath);
      expect(log.mock.calls[0]?.[0]).toContain("libonnxruntime.so: cannot open shared object");
      expect(readdirSync(out)).toEqual([]);
    },
  );
});

describe("sherpaParakeetInstalled", () => {
  it.each(["cache", "beside CLI"])(
    "counts a broken runtime in %s, so transcribe reports it instead of skipping it",
    async (location) => {
      const home = mkdtempSync(join(tmpdir(), "hf-sherpa-home-"));
      vi.stubEnv("HOME", home);
      vi.resetModules();
      try {
        const sherpa = await import("./sherpa.js");
        const bundle = join(home, "bundle");
        const cliUrl = pathToFileURL(join(bundle, "dist", "cli.js")).href;
        const manifest = join(
          location === "cache" ? sherpa.SHERPA_RUNTIME_DIR : bundle,
          "node_modules",
          "sherpa-onnx-node",
        );
        mkdirSync(manifest, { recursive: true });
        if (location === "cache") writeFileSync(join(manifest, "package.json"), "{}");
        else fakeRuntime(bundle, BROKEN);
        mkdirSync(sherpa.PARAKEET_MODEL_DIR, { recursive: true });
        for (const [name, bytes] of [
          ["encoder.int8.onnx", 652_184_281],
          ["decoder.int8.onnx", 11_845_275],
          ["joiner.int8.onnx", 6_355_277],
          ["tokens.txt", 93_939],
        ] as const) {
          writeFileSync(join(sherpa.PARAKEET_MODEL_DIR, name), "");
          truncateSync(join(sherpa.PARAKEET_MODEL_DIR, name), bytes);
        }
        expect(sherpa.sherpaParakeetInstalled(cliUrl)).toBe(true);
      } finally {
        vi.unstubAllEnvs();
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});

describe("ensureParakeetModel", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const tempDir = () => (dir = mkdtempSync(join(tmpdir(), "hf-parakeet-model-")));
  const stagingLeft = () =>
    readdirSync(dirname(dir)).filter((name) => name.startsWith(`${basename(dir)}.tmp-`));

  it("refuses a file whose sha256 does not match and leaves nothing under its name", async () => {
    tempDir();
    const files = [file("encoder.onnx", "abc")];
    const download = fakeDownload({ "encoder.onnx": "abd" });

    await expect(ensureParakeetModel({ dir, files, download })).rejects.toThrow(/sha256/);
    expect(readdirSync(dir)).toEqual([]);
    expect(stagingLeft()).toEqual([]);
  });

  it("names the file, the host and a retry when a download fails", async () => {
    tempDir();
    const download = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      ensureParakeetModel({ dir, files: [file("encoder.onnx", "enc")], download }),
    ).rejects.toThrow(
      "Could not download encoder.onnx from huggingface.co (fetch failed). Check your network and re-run.",
    );
    expect(stagingLeft()).toEqual([]);
  });

  it("stops at the next file on cancel, keeping only files that verified", async () => {
    tempDir();
    const files = [file("encoder.onnx", "enc"), file("tokens.txt", "tok")];
    const cancel = new AbortController();
    const download = fakeDownload({ "encoder.onnx": "enc", "tokens.txt": "tok" });
    download.mockImplementationOnce(async (_url, dest) => {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, "enc");
      cancel.abort();
      return { path: dest, bytes: 3 };
    });

    await expect(
      ensureParakeetModel({ dir, files, download, signal: cancel.signal }),
    ).rejects.toThrow(/abort/i);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]?.[2]?.signal).toBe(cancel.signal);
    expect(readdirSync(dir)).toEqual(["encoder.onnx"]);
    expect(stagingLeft()).toEqual([]);
  });

  it("sweeps the staging dir a killed install left behind", async () => {
    tempDir();
    const stale = `${dir}.tmp-999999999-dead`;
    mkdirSync(stale);
    writeFileSync(join(stale, "encoder.onnx"), "half");
    const files = [file("tokens.txt", "tok")];

    await ensureParakeetModel({ dir, files, download: fakeDownload({ "tokens.txt": "tok" }) });
    expect(existsSync(stale)).toBe(false);
  });

  it("fetches only what is missing or corrupt, then is a no-op", async () => {
    tempDir();
    mkdirSync(dir, { recursive: true });
    const files = [
      file("encoder.onnx", "enc"),
      file("tokens.txt", "tok"),
      file("joiner.onnx", "j"),
    ];
    writeFileSync(join(dir, "encoder.onnx"), "enc");
    writeFileSync(join(dir, "tokens.txt"), "xxx");
    const download = fakeDownload({ "tokens.txt": "tok", "joiner.onnx": "j" });
    const onBytes = vi.fn();

    expect(await ensureParakeetModel({ dir, files, download, onBytes })).toBe(true);
    expect(download.mock.calls.map(([url]) => url.split("/").at(-1))).toEqual([
      "tokens.txt",
      "joiner.onnx",
    ]);
    expect(readdirSync(dir).sort()).toEqual(["encoder.onnx", "joiner.onnx", "tokens.txt"]);
    expect(onBytes.mock.calls.at(-1)).toEqual([4, 4]);

    download.mockClear();
    expect(await ensureParakeetModel({ dir, files, download })).toBe(false);
    expect(download).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "tokens.txt"))).toBe(true);
  });
});

describe("sherpaUnsupportedReason", () => {
  const linux = (glibc?: string) => ({ platform: "linux", arch: "x64", glibc });

  it("refuses Linux without glibc 2.32 and accepts newer glibc", () => {
    expect(sherpaUnsupportedReason(linux("2.31"))).toMatch(/glibc 2\.32.*2\.31/);
    expect(sherpaUnsupportedReason(linux())).toMatch(/musl/);
    expect(sherpaUnsupportedReason(linux("2.32"))).toBeNull();
    expect(sherpaUnsupportedReason(linux("2.36"))).toBeNull();
  });

  it("refuses targets with no native package, naming the ones that have one", () => {
    expect(sherpaUnsupportedReason({ platform: "darwin", arch: "arm64" })).toBeNull();
    expect(sherpaUnsupportedReason({ platform: "win32", arch: "x64" })).toBeNull();
    expect(sherpaUnsupportedReason({ platform: "win32", arch: "arm64" })).toMatch(
      /darwin-arm64.*win32-ia32; this system is win32-arm64/,
    );
    expect(sherpaUnsupportedReason({ platform: "linux", arch: "arm", glibc: "2.36" })).toMatch(
      /this system is linux-arm/,
    );
  });
});
