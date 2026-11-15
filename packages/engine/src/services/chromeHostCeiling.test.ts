import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PINNED_SHELL_DIGESTS,
  chromeMajorCeiling,
  exceedsChromeCeiling,
  headlessShellDigest,
  isPinnedHeadlessShell,
  managedChromeVersion,
  shellStarts,
} from "./chromeHostCeiling.js";

describe("chromeMajorCeiling", () => {
  it.each([
    ["darwin", "21.6.0", 150],
    ["darwin", "22.1.0", undefined],
    ["linux", "21.0.0", undefined],
    ["win32", "10.0.19045", undefined],
  ])("%s %s -> %s", (platform, release, expected) => {
    expect(chromeMajorCeiling(platform, release)).toBe(expected);
  });
});

describe("exceedsChromeCeiling", () => {
  it.each([
    ["mac-152.0.7977.30", 150, true],
    ["mac_arm-150.0.7871.124", 150, false],
    ["151.0.1.2", 150, true],
    ["mac-152.0.7977.30", undefined, false],
  ])("%s with ceiling %s -> %s", (name, ceiling, expected) => {
    expect(exceedsChromeCeiling(name, ceiling)).toBe(expected);
  });
});

describe.skipIf(process.platform === "win32")("shellStarts", () => {
  it("returns at its timeout even when the shell ignores SIGTERM", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-shell-probe-"));
    const binary = join(dir, "shell.sh");
    writeFileSync(binary, "#!/bin/sh\ntrap '' TERM\nsleep 6\n");
    chmodSync(binary, 0o755);
    const started = Date.now();
    try {
      expect(shellStarts(binary, 300)).toBe(false);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isPinnedHeadlessShell", () => {
  function shellFolder(): { folder: string; shell: string } {
    const folder = mkdtempSync(join(tmpdir(), "hf-pinned-shell-"));
    mkdirSync(join(folder, "locales"));
    writeFileSync(join(folder, "chrome-headless-shell"), "the build");
    writeFileSync(join(folder, "libEGL.so"), "a library it loads");
    writeFileSync(join(folder, "locales", "en-US.pak"), "strings");
    return { folder, shell: join(folder, "chrome-headless-shell") };
  }

  it("has digests for every build a host may be given", () => {
    for (const version of [
      managedChromeVersion("linux"),
      managedChromeVersion("darwin", "21.6.0"),
    ]) {
      expect(PINNED_SHELL_DIGESTS[version]?.length).toBeGreaterThan(0);
    }
  });

  it("uses a shell only while every file in its folder matches a pinned build", () => {
    const { folder, shell } = shellFolder();
    const pinned = PINNED_SHELL_DIGESTS[managedChromeVersion("linux")] as string[];
    try {
      pinned.push(headlessShellDigest(folder) ?? "");
      expect(isPinnedHeadlessShell(shell)).toBe(true);
      // Chrome's own logs may appear while it runs.
      writeFileSync(join(folder, "chrome_debug.log"), "log");
      expect(isPinnedHeadlessShell(shell)).toBe(true);
      // The library beside the shell changes, size kept: still refused.
      writeFileSync(join(folder, "libEGL.so"), "a library it LOADS");
      expect(isPinnedHeadlessShell(shell)).toBe(false);
    } finally {
      pinned.pop();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("refuses a pinned folder once a file is added to it", () => {
    const { folder, shell } = shellFolder();
    const pinned = PINNED_SHELL_DIGESTS[managedChromeVersion("linux")] as string[];
    try {
      pinned.push(headlessShellDigest(folder) ?? "");
      writeFileSync(join(folder, "libvulkan.so.1"), "planted");
      expect(isPinnedHeadlessShell(shell)).toBe(false);
    } finally {
      pinned.pop();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("refuses a folder with a link in it", () => {
    const { folder, shell } = shellFolder();
    try {
      symlinkSync(join(folder, "libEGL.so"), join(folder, "libGLESv2.so"));
      expect(headlessShellDigest(folder)).toBeUndefined();
      expect(isPinnedHeadlessShell(shell)).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
