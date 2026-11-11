import {
  type PathLike,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
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
    process.env.PATH = pathDirs.join(delimiter);
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
