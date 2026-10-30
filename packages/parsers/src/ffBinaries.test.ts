import {
  type PathLike,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  it("discovers a Windows binary in a Unicode current directory without decoding console output", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    process.env.PATH = "";
    const unicodeDirectory = "/用户/工具";
    const ffmpegPath = join(unicodeDirectory, "ffmpeg.exe");
    vi.spyOn(process, "cwd").mockReturnValue(unicodeDirectory);
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

  it("falls back to scanning PATH when which/where fails", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    const binDir = mkdtempSync(join(tmpdir(), "hyperframes-ffbinaries-"));
    const ffmpegPath = join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    writeFileSync(ffmpegPath, "#!/bin/sh\n");
    chmodSync(ffmpegPath, 0o755);
    process.env.PATH = binDir;
    const execFileSync = vi.fn(() => {
      throw new Error("lookup command failed");
    });
    vi.resetModules();
    vi.doMock("node:child_process", () => ({ execFileSync, default: { execFileSync } }));

    try {
      const { findFfBinary } = await importFresh();

      expect(findFfBinary("ffmpeg")).toBe(resolve(ffmpegPath));
      expect(execFileSync).toHaveBeenCalledOnce();
    } finally {
      rmSync(binDir, { force: true, recursive: true });
    }
  });

  it("falls back to a common install dir when which and the PATH scan both fail", async () => {
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

  it("falls back to the project-local .hyperframes bin", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    process.env.PATH = "";
    const projectBinary = resolve(
      ".hyperframes",
      "bin",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    vi.resetModules();
    vi.doMock("node:child_process", () => {
      const mocked = {
        execFileSync: () => {
          throw new Error("not found");
        },
      };
      return { ...mocked, default: mocked };
    });
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync: (candidate: unknown) => candidate === projectBinary,
        accessSync: () => {
          throw new Error("not executable");
        },
        constants: { X_OK: 1 },
      };
      return { ...mocked, default: mocked };
    });
    const { findFfBinary } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBe(projectBinary);
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

  async function findInProjectDir(
    project: string,
    name: "ffmpeg" | "ffprobe",
    systemBinaries: string[] = [],
  ) {
    vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", "");
    vi.stubEnv("HYPERFRAMES_FFPROBE_PATH", "");
    process.env.PATH = "";
    vi.spyOn(process, "cwd").mockReturnValue(project);
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      const existsSync = (candidate: PathLike) =>
        systemBinaries.includes(String(candidate)) ||
        (String(candidate).startsWith(project) && actual.existsSync(candidate));
      return { ...actual, existsSync, default: { ...actual, existsSync } };
    });
    vi.doMock("node:child_process", () => {
      const mocked = {
        execFileSync: () => {
          throw new Error("not found");
        },
      };
      return { ...mocked, default: mocked };
    });
    try {
      const { findFfBinary } = await importFresh();
      return findFfBinary(name);
    } finally {
      vi.unstubAllEnvs();
      rmSync(project, { recursive: true, force: true });
    }
  }

  it.each(["ffmpeg", "ffprobe"] as const)(
    "falls back to the project's @%s-installer package",
    async (name) => {
      const { project, binary } = installerProject(name);

      expect(await findInProjectDir(project, name)).toBe(binary);
    },
  );

  it("finds the platform package next to the installer package (pnpm layout)", async () => {
    const { project, binary } = installerProject("ffprobe", { viaInstaller: true });

    expect(await findInProjectDir(project, "ffprobe")).toBe(binary);
  });

  it.skipIf(process.platform === "win32")(
    "prefers a system install in a common dir over the installer package",
    async () => {
      const { project } = installerProject("ffprobe");

      expect(await findInProjectDir(project, "ffprobe", ["/usr/bin/ffprobe"])).toBe(
        "/usr/bin/ffprobe",
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "skips an installer binary that is not executable",
    async () => {
      const { project } = installerProject("ffprobe", { mode: 0o644 });

      expect(await findInProjectDir(project, "ffprobe")).toBeUndefined();
    },
  );

  describe.skipIf(process.platform === "win32")("on Apple Silicon without Rosetta", () => {
    const machO = (cpu: number) => Buffer.from([0xcf, 0xfa, 0xed, 0xfe, cpu, 0x00, 0x00, 0x01]);

    function asAppleSilicon() {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      vi.spyOn(process, "arch", "get").mockReturnValue("arm64");
    }

    it("skips an x86_64 installer binary", async () => {
      asAppleSilicon();
      const { project } = installerProject("ffprobe", { content: machO(0x07) });

      expect(await findInProjectDir(project, "ffprobe")).toBeUndefined();
    });

    it("keeps an arm64 installer binary", async () => {
      asAppleSilicon();
      const { project, binary } = installerProject("ffprobe", { content: machO(0x0c) });

      expect(await findInProjectDir(project, "ffprobe")).toBe(binary);
    });
  });

  it("returns undefined when the binary is nowhere, and caches the miss until cleared", async () => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.PATH = "";
    const execFileSync = vi.fn(() => {
      throw new Error("not found");
    });
    vi.resetModules();
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
    const { findFfBinary, clearFfBinaryLookupCache } = await importFresh();

    expect(findFfBinary("ffmpeg")).toBeUndefined();
    expect(findFfBinary("ffmpeg")).toBeUndefined();
    expect(execFileSync).toHaveBeenCalledOnce();

    clearFfBinaryLookupCache();
    expect(findFfBinary("ffmpeg")).toBeUndefined();
    expect(execFileSync).toHaveBeenCalledTimes(2);
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
    const execFileSync = vi.fn(() => {
      throw new Error("not found");
    });
    vi.resetModules();
    vi.doMock("node:child_process", () => ({ execFileSync, default: { execFileSync } }));
    vi.doMock("node:fs", () => {
      const mocked = {
        existsSync: (candidate: unknown) => installed && candidate === "/opt/homebrew/bin/ffmpeg",
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
    expect(execFileSync).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(findFfBinary("ffmpeg")).toBe(resolve("/opt/homebrew/bin/ffmpeg"));
    expect(findFfBinary("ffmpeg")).toBe(resolve("/opt/homebrew/bin/ffmpeg"));
    expect(execFileSync).toHaveBeenCalledTimes(2);
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
