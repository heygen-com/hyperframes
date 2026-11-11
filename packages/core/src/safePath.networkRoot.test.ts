import { describe, expect, it, vi } from "vitest";

// Windows path rules on any host, and a disk that records every look at it.
const probes = vi.hoisted(() => [] as string[]);
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const missing = (path: string) => {
    probes.push(path);
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  };
  const realpathSync = Object.assign(missing, { native: missing });
  const mocked = { ...fs, realpathSync, lstatSync: missing };
  return { ...mocked, default: mocked };
});

const { resolveWithinProject } = await import("./safePath.js");

describe("a request path on another network root", () => {
  it.each([
    "\\\\attacker.example\\share\\x.html",
    "//attacker.example/share/x.html",
    "\\\\?\\UNC\\attacker.example\\share\\x.html",
    "\\\\.\\pipe\\x",
  ])("is refused without touching the disk: %s", (path) => {
    probes.length = 0;
    expect(resolveWithinProject("C:\\project", path)).toBeNull();
    expect(probes).toEqual([]);
  });

  it("does not stop a project that itself lives on a share", () => {
    probes.length = 0;
    resolveWithinProject("\\\\nas\\films\\project", "scenes\\intro.html");
    expect(probes.length).toBeGreaterThan(0);
  });
});
