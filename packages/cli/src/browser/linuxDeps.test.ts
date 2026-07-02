// fallow-ignore-file code-duplication
import { describe, it, expect } from "vitest";
import {
  chromeDepsInstallCommand,
  chromeLaunchRemediation,
  distroFamilyFromOsRelease,
  distroLabel,
  ffmpegInstallCommand,
  isSharedLibLaunchError,
  parseLddMissingLibs,
  parseOsRelease,
} from "./linuxDeps.js";

describe("parseOsRelease", () => {
  it("parses quoted and unquoted key=value pairs", () => {
    const parsed = parseOsRelease(
      ['NAME="Ubuntu"', "ID=ubuntu", 'ID_LIKE="debian"', 'PRETTY_NAME="Ubuntu 22.04.3 LTS"'].join(
        "\n",
      ),
    );
    expect(parsed["ID"]).toBe("ubuntu");
    expect(parsed["ID_LIKE"]).toBe("debian");
    expect(parsed["PRETTY_NAME"]).toBe("Ubuntu 22.04.3 LTS");
  });

  it("ignores comments and blank lines", () => {
    const parsed = parseOsRelease("# a comment\n\nID=fedora\n");
    expect(parsed).toEqual({ ID: "fedora" });
  });
});

describe("distroFamilyFromOsRelease", () => {
  it("maps Ubuntu/Debian derivatives to debian", () => {
    expect(distroFamilyFromOsRelease("ubuntu", "debian")).toBe("debian");
    expect(distroFamilyFromOsRelease("debian")).toBe("debian");
    expect(distroFamilyFromOsRelease("linuxmint", "ubuntu debian")).toBe("debian");
  });

  it("maps RHEL family to fedora", () => {
    expect(distroFamilyFromOsRelease("fedora")).toBe("fedora");
    expect(distroFamilyFromOsRelease("rocky", "rhel centos fedora")).toBe("fedora");
    expect(distroFamilyFromOsRelease("amzn")).toBe("fedora");
  });

  it("maps Arch derivatives to arch", () => {
    expect(distroFamilyFromOsRelease("arch")).toBe("arch");
    expect(distroFamilyFromOsRelease("manjaro", "arch")).toBe("arch");
  });

  it("maps Alpine to alpine", () => {
    expect(distroFamilyFromOsRelease("alpine")).toBe("alpine");
  });

  it("returns unknown for unrecognized ids", () => {
    expect(distroFamilyFromOsRelease("void")).toBe("unknown");
    expect(distroFamilyFromOsRelease(undefined, undefined)).toBe("unknown");
  });
});

describe("chromeDepsInstallCommand", () => {
  it("emits an apt-get line with libnss3 for debian", () => {
    const cmd = chromeDepsInstallCommand("debian");
    expect(cmd).toContain("apt-get install -y");
    expect(cmd).toContain("libnss3");
    expect(cmd).toContain("libatk1.0-0");
  });

  it("emits a dnf line with nss for fedora", () => {
    const cmd = chromeDepsInstallCommand("fedora");
    expect(cmd).toContain("dnf install -y");
    expect(cmd).toContain("nss");
  });

  it("emits a pacman line for arch", () => {
    expect(chromeDepsInstallCommand("arch")).toContain("pacman -S");
  });

  it("emits an apk line for alpine", () => {
    expect(chromeDepsInstallCommand("alpine")).toContain("apk add");
  });

  it("gives generic guidance for unknown distros", () => {
    expect(chromeDepsInstallCommand("unknown").toLowerCase()).toContain("nss");
  });
});

describe("ffmpegInstallCommand", () => {
  it("uses the distro package manager", () => {
    expect(ffmpegInstallCommand("debian")).toBe(
      "sudo apt-get update && sudo apt-get install -y ffmpeg",
    );
    expect(ffmpegInstallCommand("fedora")).toBe("sudo dnf install -y ffmpeg");
    expect(ffmpegInstallCommand("arch")).toBe("sudo pacman -S --needed ffmpeg");
    expect(ffmpegInstallCommand("alpine")).toBe("sudo apk add ffmpeg");
  });

  it("gives generic guidance for unknown distros", () => {
    expect(ffmpegInstallCommand("unknown").toLowerCase()).toContain("ffmpeg");
  });
});

describe("parseLddMissingLibs", () => {
  it("collects libraries reported as not found", () => {
    const output = [
      "\tlinux-vdso.so.1 (0x00007fff...)",
      "\tlibnss3.so => not found",
      "\tlibatk-1.0.so.0 => not found",
      "\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f...)",
    ].join("\n");
    const result = parseLddMissingLibs(output);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["libnss3.so", "libatk-1.0.so.0"]);
    expect(result.probeUnavailable).toBe(false);
  });

  it("reports ok when every library resolves", () => {
    const output = "\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f...)";
    const result = parseLddMissingLibs(output);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("does not false-positive on a resolved path containing 'not found'", () => {
    // A directory literally named "not found" must not trip the missing-lib
    // detection — only the `=> not found` marker counts.
    const output = "\tlibfoo.so.1 => /opt/not found/libfoo.so.1 (0x00007f...)";
    const result = parseLddMissingLibs(output);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe("distroLabel", () => {
  it("returns WSL when running under WSL", () => {
    expect(distroLabel({ family: "debian", prettyName: "Ubuntu", isWsl: true })).toBe("WSL");
  });

  it("returns the pretty name off WSL", () => {
    expect(distroLabel({ family: "fedora", prettyName: "Fedora Linux 40", isWsl: false })).toBe(
      "Fedora Linux 40",
    );
  });

  it("falls back to Linux when no pretty name", () => {
    expect(distroLabel({ family: "unknown", isWsl: false })).toBe("Linux");
  });
});

describe("isSharedLibLaunchError", () => {
  it("matches the libnss3 cannot-open message", () => {
    expect(
      isSharedLibLaunchError(
        "libnss3.so: cannot open shared object file: No such file or directory",
      ),
    ).toBe(true);
  });

  it("matches the dynamic-linker phrasing", () => {
    expect(isSharedLibLaunchError("error while loading shared libraries: libatk-1.0.so.0")).toBe(
      true,
    );
  });

  it("does not match unrelated errors", () => {
    expect(isSharedLibLaunchError("Composition has zero duration")).toBe(false);
  });
});

describe("chromeLaunchRemediation", () => {
  it("returns undefined for non-launch errors", () => {
    expect(chromeLaunchRemediation("Composition HTML is empty")).toBeUndefined();
  });

  // Platform-dependent output (Linux distro detection) is covered by the
  // preflight tests that mock `platform()`; here we only assert the non-Linux /
  // non-launch short-circuits, which are deterministic on the macOS CI host.
  it("returns undefined off Linux even for a launch failure", () => {
    if (process.platform === "linux") return;
    expect(chromeLaunchRemediation("Failed to launch the browser process")).toBeUndefined();
  });
});
