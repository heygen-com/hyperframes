import { spawnSync } from "node:child_process";
import {
  type PathLike,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, win32 } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

type FfBinariesModule = typeof import("./ffBinaries.js");

// The module caches system lookups in module state, so each test that
// exercises lookup mechanics resets modules and dynamic-imports a fresh copy.
async function importFresh(): Promise<FfBinariesModule> {
  return import("./ffBinaries.js");
}

describe("findFfBinary", () => {
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;
  const originalPath = process.env.PATH;
  const originalPlatform = process.platform;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs");
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("returns the resolved env override without touching the system", async () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/tools/ffmpeg";
    vi.resetModules();
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBe(resolve("/tools/ffmpeg"));
  });

  it("treats a missing env override as not-found when configuredMustExist is set", async () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = join(tmpdir(), "definitely-missing-ffmpeg");
    vi.resetModules();
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg", { configuredMustExist: true })).toBeUndefined();
    expect(findFfBinary("ffmpeg")).toBe(resolve(join(tmpdir(), "definitely-missing-ffmpeg")));
  });

  it("prefers the real Windows exe over a cmd shim in PATH", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    process.env.PATH = "/tools";
    vi.resetModules();
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync: (candidate: unknown) => candidate === "/tools/ffmpeg.exe",
        accessSync: () => {},
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBe("/tools/ffmpeg.exe");
  });

  it("discovers a Windows binary in a Unicode PATH directory without decoding console output", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const unicodeDirectory = "/用户/工具";
    process.env.PATH = unicodeDirectory;
    const ffmpegPath = join(unicodeDirectory, "ffmpeg.exe");
    const execFileSync = vi.fn();
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync,
      default: { execFileSync },
    }));
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync: (candidate: unknown) => candidate === ffmpegPath,
        accessSync: () => {},
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBe(ffmpegPath);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("never returns a Windows binary from the working directory or a relative PATH entry", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const project = "/projects/shared";
    process.env.PATH = ["", ".", "bin"].join(process.platform === "win32" ? ";" : ":");
    vi.spyOn(process, "cwd").mockReturnValue(project);
    const execFileSync = vi.fn();
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync,
      default: { execFileSync },
    }));
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync: (candidate: unknown) =>
          typeof candidate === "string" &&
          /ffmpeg\.exe$/.test(candidate) &&
          !/hyperframes/.test(candidate),
        accessSync: () => {},
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBeUndefined();
  });

  it("finds a binary by walking PATH, without running a lookup program", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    const binDir = mkdtempSync(join(tmpdir(), "hyperframes-ffbinaries-"));
    const ffmpegPath = join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    writeFileSync(ffmpegPath, "#!/bin/sh\n");
    chmodSync(ffmpegPath, 0o755);
    process.env.PATH = binDir;
    const execFileSync = vi.fn();
    vi.resetModules();
    vi.doMock("node:child_process", () => ({ execFileSync, default: { execFileSync } }));

    try {
      const { findFfBinary } = await importFresh();

      expect(findFfBinary("ffmpeg")).toBe(resolve(ffmpegPath));
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      rmSync(binDir, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "never runs a `which` planted in a project folder on PATH",
    async () => {
      delete process.env.HYPERFRAMES_FFMPEG_PATH;
      const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-ff-project-")));
      const tools = realpathSync(mkdtempSync(join(tmpdir(), "hf-ff-tools-")));
      onTestFinished(() => {
        rmSync(project, { recursive: true, force: true });
        rmSync(tools, { recursive: true, force: true });
      });
      const marker = join(tools, "ran");
      writeFileSync(join(project, "which"), `#!/bin/sh\necho ran > "${marker}"\n`, {
        mode: 0o755,
      });
      writeFileSync(join(tools, "ffmpeg"), "", { mode: 0o755 });
      vi.spyOn(process, "cwd").mockReturnValue(project);
      process.env.PATH = [project, tools, "/usr/bin", "/bin"].join(delimiter);
      vi.resetModules();
      const { findFfBinary } = await importFresh();

      expect(findFfBinary("ffmpeg")).toBe(join(tools, "ffmpeg"));
      expect(existsSync(marker)).toBe(false);
    },
  );

  it("falls back to a common install dir when the PATH scan finds nothing", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.PATH = "";
    vi.resetModules();
    vi.doMock("node:child_process", () => {
      const mocked = {
        execFileSync: () => {
          throw new Error("which: no ffmpeg in PATH");
        },
      };
      return { ...mocked, default: mocked };
    });
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync: (candidate: unknown) => candidate === "/opt/homebrew/bin/ffmpeg",
        accessSync: () => {
          throw new Error("not executable");
        },
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBe(resolve("/opt/homebrew/bin/ffmpeg"));
  });

  function installerProject(
    name: "ffmpeg" | "ffprobe",
    { viaInstaller = false, mode = 0o755, content = "" as string | Buffer } = {},
  ) {
    const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-ff-installer-")));
    const platformPackage = `@${name}-installer/${process.platform}-${process.arch}`;
    const packageDir = viaInstaller
      ? join(project, "store", "node_modules", platformPackage)
      : join(project, "node_modules", platformPackage);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), "{}");
    if (viaInstaller) {
      const installerDir = join(project, "store", "node_modules", `@${name}-installer`, name);
      mkdirSync(installerDir, { recursive: true });
      writeFileSync(join(installerDir, "package.json"), "{}");
      mkdirSync(join(project, "node_modules", `@${name}-installer`), { recursive: true });
      symlinkSync(
        installerDir,
        join(project, "node_modules", `@${name}-installer`, name),
        "junction",
      );
    }
    const binary = join(packageDir, process.platform === "win32" ? `${name}.exe` : name);
    writeFileSync(binary, content);
    chmodSync(binary, mode);
    return { project, binary };
  }

  let skipped: { ffmpeg?: string; ffprobe?: string } = {};

  async function findInProjectDir(
    project: string,
    name: "ffmpeg" | "ffprobe",
    { systemBinaries = [], pathDirs = [] }: { systemBinaries?: string[]; pathDirs?: string[] } = {},
  ) {
    skipped = {};
    vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", "");
    vi.stubEnv("HYPERFRAMES_FFPROBE_PATH", "");
    process.env.PATH = pathDirs.join(process.platform === "win32" ? win32.delimiter : delimiter);
    vi.spyOn(process, "cwd").mockReturnValue(project);
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      const existsSync = (candidate: PathLike) =>
        systemBinaries.includes(String(candidate)) ||
        ([project, ...pathDirs].some((dir) => String(candidate).startsWith(dir)) &&
          actual.existsSync(candidate));
      return { ...actual, existsSync, default: { ...actual, existsSync } };
    });
    try {
      const { findFfBinary, getSkippedX86Binary } = await importFresh();
      const found = findFfBinary(name);
      skipped = { ffmpeg: getSkippedX86Binary("ffmpeg"), ffprobe: getSkippedX86Binary("ffprobe") };
      return found;
    } finally {
      vi.unstubAllEnvs();
      rmSync(project, { recursive: true, force: true });
    }
  }

  function binDir(prefix: string, name: "ffmpeg" | "ffprobe", content: string | Buffer = "") {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    const binary = join(dir, process.platform === "win32" ? `${name}.exe` : name);
    writeFileSync(binary, content);
    chmodSync(binary, 0o755);
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    return { dir, binary };
  }

  it.each(["ffmpeg", "ffprobe"] as const)(
    "never runs a %s from the project's installer package or .hyperframes/bin",
    async (name) => {
      const { project } = installerProject(name);
      mkdirSync(join(project, ".hyperframes", "bin"), { recursive: true });
      const local = join(project, ".hyperframes", "bin", name);
      writeFileSync(local, "");
      chmodSync(local, 0o755);

      expect(await findInProjectDir(project, name)).toBeUndefined();
    },
  );

  it("never runs an installer binary in the project's pnpm layout", async () => {
    const { project } = installerProject("ffprobe", { viaInstaller: true });

    expect(await findInProjectDir(project, "ffprobe")).toBeUndefined();
  });

  it("skips a project ffmpeg that comes first on PATH and takes the install dir's copy", async () => {
    const { dir: project } = binDir("hf-ff-project-", "ffmpeg");
    const { dir: tools, binary: installed } = binDir("hf-ff-tools-", "ffmpeg");

    expect(await findInProjectDir(project, "ffmpeg", { pathDirs: [project, tools] })).toBe(
      installed,
    );
  });

  it("finds no ffmpeg when the only copy is in the project, even with the project on PATH", async () => {
    const { dir: project } = binDir("hf-ff-project-", "ffmpeg");
    mkdirSync(join(project, "bin"));
    writeFileSync(join(project, "bin", "ffmpeg"), "");
    chmodSync(join(project, "bin", "ffmpeg"), 0o755);

    expect(
      await findInProjectDir(project, "ffmpeg", {
        pathDirs: [project, join(project, "bin"), ".", "bin"],
      }),
    ).toBeUndefined();
  });

  it("on Windows, skips an ffmpeg.exe in the working directory and takes the PATH copy", async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-ff-project-")));
    writeFileSync(join(project, "ffmpeg.exe"), "");
    const tools = realpathSync(mkdtempSync(join(tmpdir(), "hf-ff-tools-")));
    writeFileSync(join(tools, "ffmpeg.exe"), "");
    onTestFinished(() => rmSync(tools, { recursive: true, force: true }));
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    expect(await findInProjectDir(project, "ffmpeg", { pathDirs: [project, tools] })).toBe(
      join(tools, "ffmpeg.exe"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "prefers a system install in a common dir over the installer package",
    async () => {
      const { project } = installerProject("ffprobe");

      expect(
        await findInProjectDir(project, "ffprobe", { systemBinaries: ["/usr/bin/ffprobe"] }),
      ).toBe("/usr/bin/ffprobe");
    },
  );

  describe.skipIf(process.platform === "win32")("on Apple Silicon without Rosetta", () => {
    const machO = (cpu: number) => Buffer.from([0xcf, 0xfa, 0xed, 0xfe, cpu, 0x00, 0x00, 0x01]);

    function asAppleSilicon() {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      vi.spyOn(process, "arch", "get").mockReturnValue("arm64");
    }

    it("skips an x86_64 binary on PATH and names it under its own name only", async () => {
      asAppleSilicon();
      const { dir, binary } = binDir("hf-ff-x86-", "ffprobe", machO(0x07));
      const project = mkdtempSync(join(tmpdir(), "hf-ff-cwd-"));

      expect(await findInProjectDir(project, "ffprobe", { pathDirs: [dir] })).toBeUndefined();
      expect(skipped).toEqual({ ffprobe: binary });
    });

    it("keeps an arm64 binary on PATH", async () => {
      asAppleSilicon();
      const { dir, binary } = binDir("hf-ff-arm-", "ffprobe", machO(0x0c));
      const project = mkdtempSync(join(tmpdir(), "hf-ff-cwd-"));

      expect(await findInProjectDir(project, "ffprobe", { pathDirs: [dir] })).toBe(binary);
    });
  });
  it("returns undefined when the binary is nowhere, and caches the miss until cleared", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.PATH = "";
    const existsSync = vi.fn(() => false);
    vi.resetModules();
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync,
        accessSync: () => {
          throw new Error("not executable");
        },
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { findFfBinary, clearFfBinaryLookupCache } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBeUndefined();
    const probesPerLookup = existsSync.mock.calls.length;
    expect(probesPerLookup).toBeGreaterThan(0);
    expect(findFfBinary("ffmpeg")).toBeUndefined();
    expect(existsSync).toHaveBeenCalledTimes(probesPerLookup);

    clearFfBinaryLookupCache();
    expect(findFfBinary("ffmpeg")).toBeUndefined();
    expect(existsSync).toHaveBeenCalledTimes(probesPerLookup * 2);
  });

  it("requireFfBinary throws an ENOENT naming the override instead of returning a bare name", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.PATH = "";
    vi.resetModules();
    const execFileSync = vi.fn(() => {
      throw new Error("not found");
    });
    vi.doMock("node:child_process", () => ({ execFileSync, default: { execFileSync } }));
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync: () => false,
        accessSync: () => {
          throw new Error("not executable");
        },
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { requireFfBinary } = await importFresh();

    expect(() => requireFfBinary("ffmpeg")).toThrow(
      expect.objectContaining({
        code: "ENOENT",
        message: expect.stringMatching(/HYPERFRAMES_FFMPEG_PATH/),
      }),
    );
    process.env.HYPERFRAMES_FFMPEG_PATH = "/tools/ffmpeg";
    expect(requireFfBinary("ffmpeg")).toBe(resolve("/tools/ffmpeg"));
  });

  it("finds a binary installed in a common dir shortly after an earlier miss, then caches the hit", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.PATH = "";
    let installed = false;
    const commonBinary = "/opt/homebrew/bin/ffmpeg";
    const existsSync = vi.fn((candidate: unknown) => installed && candidate === commonBinary);
    const lookups = () => existsSync.mock.calls.filter(([c]) => c === commonBinary).length;
    vi.resetModules();
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync,
        accessSync: () => {
          throw new Error("not executable");
        },
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBeUndefined();
    installed = true;
    expect(findFfBinary("ffmpeg")).toBeUndefined();
    expect(lookups()).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(findFfBinary("ffmpeg")).toBe(resolve(commonBinary));
    expect(findFfBinary("ffmpeg")).toBe(resolve(commonBinary));
    expect(lookups()).toBe(2);
  });
});

describe("isX86OnlyMachO", () => {
  function fixture(bytes: number[]): string {
    const file = join(realpathSync(mkdtempSync(join(tmpdir(), "hf-macho-"))), "ffprobe");
    writeFileSync(file, Buffer.from(bytes));
    onTestFinished(() => rmSync(file, { force: true }));
    return file;
  }

  it("flags a 64-bit x86_64 Mach-O (the ffprobe-static darwin/arm64 payload)", async () => {
    const { isX86OnlyMachO } = await importFresh();
    expect(isX86OnlyMachO(fixture([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01]))).toBe(true);
  });

  it("passes an arm64 Mach-O, a universal binary, a script and a missing file", async () => {
    const { isX86OnlyMachO } = await importFresh();
    expect(isX86OnlyMachO(fixture([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]))).toBe(false);
    expect(isX86OnlyMachO(fixture([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]))).toBe(false);
    expect(isX86OnlyMachO(fixture([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73]))).toBe(false);
    expect(isX86OnlyMachO("/nonexistent/ffprobe")).toBe(false);
  });
});

describe("mediaInputFormatArgs", () => {
  const formatsOf = (args: string[]) => args[args.indexOf("-format_whitelist") + 1]!.split(",");

  afterEach(async () => (await importFresh())._setDemuxerListingForTests());

  it("reads an ffmpeg 4 listing, which has no device column", async () => {
    const { _setDemuxerListingForTests, mediaInputFormatArgs } = await importFresh();
    _setDemuxerListingForTests(
      [
        "File formats:",
        " D. = Demuxing supported",
        " .E = Muxing supported",
        " --",
        " D  3dostr          3DO STR",
        " D  dash            Dynamic Adaptive Streaming over HTTP",
        " D  mov,mp4,m4a     QuickTime / MOV",
      ].join("\n"),
    );
    expect(formatsOf(mediaInputFormatArgs("/ffprobe", "clip.mp4"))).toEqual([
      "3dostr",
      "mov",
      "mp4",
      "m4a",
    ]);
  });

  it("leaves out the demuxers that draw a text file as a picture", async () => {
    const { _setDemuxerListingForTests, mediaInputFormatArgs } = await importFresh();
    _setDemuxerListingForTests(
      [
        " D  adf             Artworx Data Format",
        " D  bin             Binary text",
        " D  idf             iCE Draw File",
        " D  mov,mp4,m4a     QuickTime / MOV",
        " D  tty             Tele-typewriter",
        " D  xbin            eXtended BINary text (XBIN)",
      ].join("\n"),
    );
    expect(formatsOf(mediaInputFormatArgs("/ffmpeg", "clip.mp4"))).toEqual(["mov", "mp4", "m4a"]);
  });

  it("keeps the installed ffmpeg from decoding a text file into a frame", async () => {
    vi.resetModules();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:child_process");
    const { findFfBinary, mediaInputFormatArgs } = await importFresh();
    const ffmpeg = findFfBinary("ffmpeg");
    if (!ffmpeg) return;
    const dir = mkdtempSync(join(tmpdir(), "hf-text-art-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const note = join(dir, "note.asc");
    writeFileSync(note, "API_KEY=not-a-video\nsecond line\n");
    const frame = join(dir, "frame.png");
    const args = ["-v", "error", "-y", ...mediaInputFormatArgs(ffmpeg, note), "-i", note];
    spawnSync(ffmpeg, [...args, "-frames:v", "1", frame]);
    expect(existsSync(frame)).toBe(false);
  });

  it.each([
    ["a playlist", "list.m3u8", "absolute"],
    ["a playlist", "list.m3u8", "climbing"],
    ["a concat list under a media name", "clip.mp4", "absolute"],
    ["a concat list under a media name", "clip.mp4", "climbing"],
  ])("keeps the installed ffmpeg from reading what %s (%s) names, %s", async (_, name, entry) => {
    vi.resetModules();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:child_process");
    const { findFfBinary, mediaInputFormatArgs } = await importFresh();
    const ffmpeg = findFfBinary("ffmpeg");
    if (!ffmpeg) return;
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "hf-playlist-input-")));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "outside"));
    mkdirSync(join(dir, "project"));
    const elsewhere = join(dir, "outside", "elsewhere.ts");
    spawnSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=1",
      "-f",
      "mpegts",
      elsewhere,
    ]);
    expect(existsSync(elsewhere)).toBe(true);
    const target = entry === "absolute" ? elsewhere : "../outside/elsewhere.ts";
    const hls = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${target}\n#EXT-X-ENDLIST\n`;
    const input = join(dir, "project", name);
    if (name.endsWith(".m3u8")) writeFileSync(input, hls);
    else {
      writeFileSync(join(dir, "project", "inner.m3u8"), hls);
      writeFileSync(input, "ffconcat version 1.0\nfile inner.m3u8\n");
    }
    const out = join(dir, "out.wav");
    spawnSync(ffmpeg, ["-v", "error", ...mediaInputFormatArgs(ffmpeg, input), "-i", input, out]);
    expect(existsSync(out)).toBe(false);
  });

  it.each([
    ["/project/clip.mp4", true],
    ["C:\\project\\clip.mp4", true],
    ["concat:/project/a.mp4|/project/b.mp4", true],
    ["https://cdn.example/clip.mp4", false],
  ])("reads %s as a local file only: %s", async (input, local) => {
    const { _setDemuxerListingForTests, mediaInputFormatArgs } = await importFresh();
    _setDemuxerListingForTests(" D  mov,mp4,m4a     QuickTime / MOV");
    const args = mediaInputFormatArgs("/ffmpeg", input);
    expect(args.slice(0, 2)).toEqual(
      local ? ["-protocol_whitelist", "file"] : ["-format_whitelist", "mov,mp4,m4a"],
    );
  });

  it("reads playlists only for a caller that walked the file", async () => {
    const { _setDemuxerListingForTests, mediaInputFormatArgs } = await importFresh();
    _setDemuxerListingForTests(
      [" D  concat  Virtual concatenation", " D  hls,applehttp  Apple HTTP Live Streaming"]
        .concat([" D  mov,mp4,m4a     QuickTime / MOV"])
        .join("\n"),
    );
    expect(formatsOf(mediaInputFormatArgs("/ffmpeg", "a.mp4"))).toEqual(["mov", "mp4", "m4a"]);
    expect(formatsOf(mediaInputFormatArgs("/ffmpeg", "a.mp4", { playlists: true }))).toEqual([
      "concat",
      "hls",
      "applehttp",
      "mov",
      "mp4",
      "m4a",
    ]);
  });

  it.skipIf(process.platform === "win32")("asks a binary that failed once again", async () => {
    const { mediaInputFormatArgs, SELF_CONTAINED_FORMATS } = await importFresh();
    const dir = mkdtempSync(join(tmpdir(), "hf-demuxers-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const binary = join(dir, "ffprobe");
    writeFileSync(
      binary,
      `#!/bin/sh\nif [ -e "${dir}/ran" ]; then echo ' D  wav  WAV'; else touch "${dir}/ran"; exit 1; fi\n`,
    );
    chmodSync(binary, 0o755);
    const local = ["-protocol_whitelist", "file"];
    expect(mediaInputFormatArgs(binary, "a.wav")).toEqual([
      ...local,
      "-format_whitelist",
      SELF_CONTAINED_FORMATS,
    ]);
    expect(mediaInputFormatArgs(binary, "a.wav")).toEqual([...local, "-format_whitelist", "wav"]);
  });

  it("falls back to a list the installed ffprobe reads CAF, W64, WavPack, AU and AC3 with", async () => {
    vi.resetModules();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:child_process");
    const { findFfBinary, SELF_CONTAINED_FORMATS } = await importFresh();
    const [ffmpeg, ffprobe] = [findFfBinary("ffmpeg"), findFfBinary("ffprobe")];
    if (!ffmpeg || !ffprobe) return;
    const dir = mkdtempSync(join(tmpdir(), "hf-audio-containers-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    for (const ext of ["caf", "w64", "wv", "au", "ac3"]) {
      const file = join(dir, `a.${ext}`);
      spawnSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", file]);
      const probe = spawnSync(
        ffprobe,
        ["-v", "error", "-format_whitelist", SELF_CONTAINED_FORMATS].concat([
          "-show_entries",
          "format=format_name",
          "-of",
          "default=nw=1:nk=1",
          "--",
          file,
        ]),
        { encoding: "utf8" },
      );
      expect(probe.stdout.trim(), probe.stderr).toBe(ext);
    }
  });
});

describe("assertLiteralMediaInput", () => {
  it("refuses a local path ffmpeg's image2 demuxer would read as a pattern of other files", async () => {
    const { assertLiteralMediaInput } = await importFresh();
    for (const path of [
      "/job/decoy%d.png",
      "/job/frame%03d.jpg",
      "/job/%%/still.png",
      "/job/x%*/still.png",
      "/job/x%[ab]/still.png",
      "/job/x%{a,b}/still.png",
      "/job/x%3*/still.png",
      "/job/x%03?.png",
      "/job/x%1{a,b}.png",
      "file:/job/decoy%d.png",
      // A "%" and a wildcard that are not next to each other, in either order or in different folders.
      "/job/credentials.json%a{.xface",
      "/job/x{%ay.png",
      "/job/x%a*y.png",
      "/job/x?%ay.png",
      "/job/x%a[y].png",
      "/job/x%a/y{.png",
      "/job/x{/y%a.png",
      "/job/x{%.png",
    ]) {
      expect(() => assertLiteralMediaInput(path), path).toThrow(/pattern of other files/);
    }
  });

  it("also refuses a harmless name that looks like a pattern, such as a %20 before a d", async () => {
    const { assertLiteralMediaInput } = await importFresh();
    expect(() => assertLiteralMediaInput("/job/My%20demo.mp4")).toThrow(
      /Rename the file or folder/,
    );
    expect(() => assertLiteralMediaInput("/job/a%2d/clip.mp4")).toThrow(
      /Rename the file or folder/,
    );
  });

  it("reads other percent signs, and URLs, as written", async () => {
    const { assertLiteralMediaInput } = await importFresh();
    for (const path of [
      "/job/clip 100% done.mp4",
      "/job/My%20Video.mp4",
      "/job/a%2D.png",
      "C:\\job\\clip.mp4",
      "/job/x{y}.png",
      "https://cdn.example/a%2d.png",
      "https://cdn.example/a%20{b}.png",
    ]) {
      expect(() => assertLiteralMediaInput(path), path).not.toThrow();
    }
  });

  it("stops the installed ffmpeg from reaching images next to a placeholder", async () => {
    vi.resetModules();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:child_process");
    const { findFfBinary, mediaInputFormatArgs } = await importFresh();
    const ffmpeg = findFfBinary("ffmpeg");
    if (!ffmpeg) return;
    const dir = mkdtempSync(join(tmpdir(), "hf-image2-pattern-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const decoy = join(dir, "decoy1.png");
    spawnSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=16x16",
      "-frames:v",
      "1",
      decoy,
    ]);
    if (!existsSync(decoy)) return;
    const pattern = join(dir, "decoy%d.png");
    const frame = join(dir, "frame.png");
    // Without the check, ffmpeg opens decoy1.png through the pattern; no file is named decoy%d.png.
    spawnSync(ffmpeg, ["-v", "error", "-y", "-i", pattern, "-frames:v", "1", frame]);
    expect(existsSync(frame)).toBe(true);
    expect(() => mediaInputFormatArgs(ffmpeg, pattern)).toThrow(/pattern of other files/);
  });
});

describe("assertLiteralMediaInput against the installed ffprobe", () => {
  it("lets through only names ffprobe opens as the one file written", async () => {
    vi.resetModules();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:child_process");
    const { assertLiteralMediaInput, findFfBinary } = await importFresh();
    const [ffmpeg, ffprobe] = [findFfBinary("ffmpeg"), findFfBinary("ffprobe")];
    if (!ffmpeg || !ffprobe) return;
    const dir = mkdtempSync(join(tmpdir(), "hf-image2-forms-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const still = (size: number, at: string) =>
      spawnSync(ffmpeg, [
        ...["-v", "error", "-y", "-f", "lavfi", "-i", `color=red:s=${size}x${size}`],
        ...["-frames:v", "1", "-c:v", "png", "-f", "image2", "-update", "1", at],
      ]);
    const [small, big] = [join(dir, "small.png"), join(dir, "big.png")];
    still(16, small);
    still(32, big);
    if (!existsSync(small) || !existsSync(big)) return;
    const width = (path: string) =>
      spawnSync(
        ffprobe,
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width",
          "-of",
          "csv=p=0",
          "--",
          path,
        ],
        { encoding: "utf8" },
      ).stdout.trim();
    const tails = "!#$&'()*+,-.:;<=>?@[]^_`{|}~ adisx%";
    const forms = ["", "1", "03"].flatMap((digits) =>
      [...tails].map((tail) => `%${digits}${tail}`),
    );
    const misread: string[] = [];
    forms.forEach((form, index) => {
      const at = join(dir, `case${index}`);
      mkdirSync(at);
      for (const decoy of ["x y.png", "x!y.png", "x0y.png", "x1y.png", "x001y.png"]) {
        copyFileSync(big, join(at, decoy));
      }
      const literal = join(at, `x${form}y.png`);
      copyFileSync(small, literal);
      let refused = false;
      try {
        assertLiteralMediaInput(literal);
      } catch {
        refused = true;
      }
      if (!refused && width(literal) !== "16") misread.push(form);
    });
    expect(misread).toEqual([]);
  }, 60_000);

  it("lets through no name where a stray % and a wildcard make ffprobe open a shorter one", async () => {
    vi.resetModules();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:child_process");
    const { assertLiteralMediaInput, findFfBinary } = await importFresh();
    const [ffmpeg, ffprobe] = [findFfBinary("ffmpeg"), findFfBinary("ffprobe")];
    if (!ffmpeg || !ffprobe) return;
    const dir = mkdtempSync(join(tmpdir(), "hf-image2-stray-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const still = (size: number, at: string) =>
      spawnSync(ffmpeg, [
        ...["-v", "error", "-y", "-f", "lavfi", "-i", `color=red:s=${size}x${size}`],
        ...["-frames:v", "1", "-c:v", "png", "-f", "image2", "-update", "1", at],
      ]);
    const [small, big] = [join(dir, "small.png"), join(dir, "big.png")];
    still(16, small);
    still(32, big);
    if (!existsSync(small) || !existsSync(big)) return;
    const width = (path: string) =>
      spawnSync(
        ffprobe,
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width"].concat([
          "-of",
          "csv=p=0",
          "--",
          path,
        ]),
        { encoding: "utf8" },
      ).stdout.trim();
    // Each name next to a decoy at the name cut at its "%", which is what ffmpeg opens when it misreads it.
    const cases: Array<[string, string]> = [];
    for (const wildcard of ["{", "*", "?", "["]) {
      cases.push(
        [`x%a${wildcard}y.png`, "x"],
        [`x${wildcard}%ay.png`, `x${wildcard}`],
        [`x%a/y${wildcard}.png`, "x"],
        [`x${wildcard}/y%a.png`, `x${wildcard}/y`],
        [`x%a${wildcard}.xface`, "x"],
        [`x${wildcard}%.png`, `x${wildcard}`],
      );
    }
    cases.push(["x%ay.png", "x"], ["clip 100% done.png", "clip 100"], ["x{y}.png", "x{y}"]);
    const misread: string[] = [];
    cases.forEach(([name, prefix], index) => {
      const at = join(dir, `case${index}`);
      const literal = join(at, name);
      const decoy = join(at, prefix);
      mkdirSync(dirname(literal), { recursive: true });
      mkdirSync(dirname(decoy), { recursive: true });
      if (decoy !== literal) copyFileSync(big, decoy);
      copyFileSync(small, literal);
      try {
        assertLiteralMediaInput(literal);
      } catch {
        return;
      }
      if (width(literal) === "32") misread.push(name);
    });
    expect(misread).toEqual([]);
  }, 60_000);
});

describe.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)("concatListInputArgs", () => {
  it("refuses a listed entry that is not a local file", async () => {
    const { concatListInputArgs } = await importFresh();
    const dir = mkdtempSync(join(tmpdir(), "hf-concat-list-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const list = join(dir, "list.txt");
    writeFileSync(list, "file 'data:video/mp4;base64,AAAA'\n");
    const run = spawnSync(
      "ffmpeg",
      ["-v", "error", ...concatListInputArgs(list), "-c", "copy", "-y", join(dir, "out.mp4")],
      { encoding: "utf8" },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("not on whitelist 'file'");
  });

  it.skipIf(process.platform === "win32")(
    "joins every clip under a folder whose name holds a tab, a quote and a #",
    async () => {
      const { concatListInputArgs, concatListText } = await importFresh();
      const root = mkdtempSync(join(tmpdir(), "hf-concat-tab-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const dir = join(root, "out\tit's #dir");
      mkdirSync(dir);
      const clips = ["a.mp4", "b.mp4"].map((name) => join(dir, name));
      for (const clip of clips) {
        const made = spawnSync("ffmpeg", [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=64x64:rate=10",
          "-frames:v",
          "10",
          "-c:v",
          "mpeg4",
          "-y",
          clip,
        ]);
        expect(made.status).toBe(0);
      }
      const list = join(dir, "list.txt");
      writeFileSync(list, concatListText(clips));
      const out = join(dir, "joined.mp4");
      const run = spawnSync(
        "ffmpeg",
        ["-v", "error", ...concatListInputArgs(list), "-c", "copy", "-y", out],
        {
          encoding: "utf8",
        },
      );
      expect(run.stderr).toBe("");
      const probe = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_packets",
          "-select_streams",
          "v",
          "-show_entries",
          "stream=nb_read_packets",
          "-of",
          "csv=p=0",
          "--",
          out,
        ],
        { encoding: "utf8" },
      );
      expect(probe.stdout.trim()).toBe("20");
    },
  );
});

describe("concatListText", () => {
  // fails without the fix: every list writer escaped only the single quote, so a line break started a new list line.
  it("writes one quoted entry per path and refuses a path holding a line break or NUL", async () => {
    const { concatListText } = await importFresh();
    expect(concatListText(["/a/it's.mp4", "/b/c.mp4"])).toBe(
      "file '/a/it'\\''s.mp4'\nfile '/b/c.mp4'\n",
    );
    for (const path of ["/p\nfile '/etc/x.mov'\n#/c.mp4", "/p\r/c.mp4", "/p\u0000/c.mp4"]) {
      expect(() => concatListText([path])).toThrow("line break or NUL");
    }
  });

  it("places an entry given a duration that long after the one before, on its own timestamps", async () => {
    const { concatListText } = await importFresh();
    expect(concatListText([{ path: "/a/it's.mp4", durationSeconds: 15 }, "/b/c.mp4"])).toBe(
      "file '/a/it'\\''s.mp4'\ninpoint 0\nduration 15\nfile '/b/c.mp4'\n",
    );
    expect(() => concatListText([{ path: "/p\n.mp4", durationSeconds: 1 }])).toThrow(
      "line break or NUL",
    );
  });

  // fails without the fix: a tab inside the quotes is read fine by ffmpeg, but the writer refused it.
  it("keeps a tab or DEL in a path, which do not end a list line", async () => {
    const { concatListText } = await importFresh();
    expect(concatListText(["/out\tdir/c.mp4", "/p\u007f/c.mp4"])).toBe(
      "file '/out\tdir/c.mp4'\nfile '/p\u007f/c.mp4'\n",
    );
  });
});
