import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedDirectory, isTrustedExecutablePath } from "./trustedExecutable.js";

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
