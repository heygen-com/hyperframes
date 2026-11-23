import { describe, expect, it } from "vitest";

import { describeWslGpuAccess, detectWsl, type WslHostFacts } from "./wslHost.js";

const RENDER_NODE = "/dev/dri/renderD128";

function fakeHost(overrides: Partial<WslHostFacts> = {}): WslHostFacts {
  return {
    platform: "linux",
    release: "6.18.54.1-microsoft-standard-WSL2",
    readProcVersion: () => "Linux version 6.18.54.1-microsoft-standard-WSL2",
    renderNodeAccess: () => ({ state: "denied", group: "render", userInGroup: false }),
    ...overrides,
  };
}

const note = (host: WslHostFacts) => describeWslGpuAccess(host)?.join("\n") ?? null;

describe("detectWsl", () => {
  it("detects WSL from the kernel release", () => {
    expect(detectWsl(fakeHost({ readProcVersion: () => "" }))).toBe(true);
  });

  it("falls back to /proc/version when the release string is generic", () => {
    expect(detectWsl(fakeHost({ release: "6.8.0-45-generic" }))).toBe(true);
  });

  it("is false on plain Linux and on other platforms", () => {
    const plainLinux = fakeHost({
      release: "6.8.0-45-generic",
      readProcVersion: () => "Linux version 6.8.0-45-generic (buildd@ubuntu)",
    });
    expect(detectWsl(plainLinux)).toBe(false);
    expect(detectWsl(fakeHost({ platform: "win32" }))).toBe(false);
  });

  it("is false when /proc/version cannot be read", () => {
    const host = fakeHost({
      release: "6.8.0-45-generic",
      readProcVersion: () => {
        throw new Error("EACCES");
      },
    });
    expect(detectWsl(host)).toBe(false);
  });
});

describe("describeWslGpuAccess", () => {
  it("gives the usermod fix only when access is denied and the user is not in the node's group", () => {
    const text = note(fakeHost());
    expect(text).toContain(
      `cannot read and write ${RENDER_NODE} and is not in its group ("render")`,
    );
    expect(text).toContain("sudo usermod -aG render $USER");
    expect(text).toContain("wsl --shutdown");
    expect(text).toContain("native Windows");
    expect(text).not.toContain("Docker");
  });

  it("uses the numeric group id when the group has no name", () => {
    const host = fakeHost({
      renderNodeAccess: () => ({ state: "denied", group: "993", userInGroup: false }),
    });
    expect(note(host)).toContain("sudo usermod -aG 993 $USER");
  });

  it("does not suggest joining a group the user is already in", () => {
    const host = fakeHost({
      renderNodeAccess: () => ({ state: "denied", group: "render", userInGroup: true }),
    });
    const text = note(host);
    expect(text).toContain('is in the "render" group but still cannot read and write');
    expect(text).toContain(`ls -l ${RENDER_NODE}`);
    expect(text).not.toContain("usermod");
  });

  it("does not blame permissions when the node is readable and writable or missing", () => {
    const readWrite = note(fakeHost({ renderNodeAccess: () => ({ state: "read-write" }) }));
    expect(readWrite).toContain(`${RENDER_NODE} is readable and writable, so file permissions`);
    expect(readWrite).not.toContain("usermod");
    expect(readWrite).toContain("native Windows");
    const missing = note(fakeHost({ renderNodeAccess: () => ({ state: "missing" }) }));
    expect(missing).toContain(`${RENDER_NODE} does not exist`);
    expect(missing).not.toContain("usermod");
  });

  it("returns null outside WSL", () => {
    expect(describeWslGpuAccess(fakeHost({ platform: "darwin" }))).toBeNull();
  });
});
