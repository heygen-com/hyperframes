import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  findTrustedExecutable,
  isTrustedDirectory,
  isTrustedExecutablePath,
  trustedPathDirs,
} from "./trustedExecutable.js";

describe("isTrustedDirectory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects relative entries, the working directory and folders inside it", () => {
    const project = resolve("/projects/shared");
    vi.spyOn(process, "cwd").mockReturnValue(project);

    for (const dir of ["", ".", "bin", "./node_modules/.bin"]) {
      expect(isTrustedDirectory(dir)).toBe(false);
    }
    expect(isTrustedDirectory(project)).toBe(false);
    expect(isTrustedDirectory(join(project, "node_modules", ".bin"))).toBe(false);
    expect(isTrustedExecutablePath(join(project, ".hyperframes", "bin", "ffmpeg"))).toBe(false);
    expect(isTrustedExecutablePath("ffmpeg")).toBe(false);
  });

  it("accepts absolute folders outside the working directory", () => {
    vi.spyOn(process, "cwd").mockReturnValue(resolve("/projects/shared"));

    expect(isTrustedDirectory(resolve("/usr/local/bin"))).toBe(true);
    expect(isTrustedDirectory(resolve("/projects/shared-tools"))).toBe(true);
    expect(isTrustedExecutablePath(resolve("/opt/homebrew/bin/ffmpeg"))).toBe(true);
  });

  it("run from the home folder or above it, skips only that folder itself", () => {
    const home = homedir();
    for (const cwd of [home, dirname(home)]) {
      vi.spyOn(process, "cwd").mockReturnValue(cwd);

      expect(isTrustedDirectory(cwd)).toBe(false);
      expect(isTrustedDirectory(join(home, ".local", "bin"))).toBe(true);
    }
  });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("findTrustedExecutable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.skipIf(process.platform === "win32")(
    "never runs a `which` that sits on PATH ahead of the system folders",
    () => {
      const project = tempDir("hf-trusted-project-");
      const tools = tempDir("hf-trusted-tools-");
      const marker = join(tools, "ran");
      const bin = join(project, "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      for (const dir of [bin, project]) {
        const script = `#!/bin/sh\necho ran > "${marker}"\necho "${join(bin, "ffmpeg")}"\n`;
        writeFileSync(join(dir, "which"), script, { mode: 0o755 });
      }
      writeFileSync(join(bin, "ffmpeg"), "", { mode: 0o755 });
      writeFileSync(join(tools, "ffmpeg"), "", { mode: 0o755 });
      mkdirSync(join(tools, "probe"));
      vi.spyOn(process, "cwd").mockReturnValue(project);
      vi.stubEnv("PATH", [bin, project, tools, "/usr/bin", "/bin"].join(delimiter));

      expect(findTrustedExecutable("ffmpeg")).toBe(join(tools, "ffmpeg"));
      expect(findTrustedExecutable("probe")).toBeUndefined();
      expect(existsSync(marker)).toBe(false);
    },
  );

  it("on Windows, takes the PATH copy and skips one in the working directory", () => {
    const project = tempDir("hf-trusted-project-");
    const tools = tempDir("hf-trusted-tools-");
    writeFileSync(join(project, "ffprobe.exe"), "");
    writeFileSync(join(tools, "ffprobe.exe"), "");
    const realPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    onTestFinished(() => {
      Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
    });
    vi.spyOn(process, "cwd").mockReturnValue(project);
    vi.stubEnv("PATH", [".", project, tools].join(delimiter));

    expect(findTrustedExecutable("ffprobe")).toBe(join(tools, "ffprobe.exe"));
  });
});

describe("trustedPathDirs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(process.platform === "win32")(
    "reads a leading ~ as the home folder, as shells do",
    () => {
      vi.spyOn(process, "cwd").mockReturnValue(resolve("/projects/shared"));

      expect(trustedPathDirs(["~/bin", "~", "~other/bin", "/usr/bin"].join(delimiter))).toEqual([
        join(homedir(), "bin"),
        homedir(),
        "/usr/bin",
      ]);
    },
  );
});
