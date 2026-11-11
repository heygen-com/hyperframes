import { describe, expect, it, vi } from "vitest";

// Windows path rules on any host, and a disk that records every look at it.
const touched = vi.hoisted(() => [] as string[]);
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const existsSync = (path: string) => {
    touched.push(path);
    return false;
  };
  return { ...fs, existsSync, default: { ...fs, existsSync } };
});

const { namesAnotherNetworkRoot, resolveCompositionSrc, resolveLocalAssetCandidates } =
  await import("./assetResolution.js");

const PROJECT = "C:\\project";
const insideProject = (path: string) => path.toLowerCase().startsWith("c:\\project\\");

describe("namesAnotherNetworkRoot under Windows rules", () => {
  it.each([
    "\\\\attacker.example\\share\\x.png",
    "//attacker.example/share/x.png",
    "/\\attacker.example\\share\\x.png",
    "\\\\?\\UNC\\attacker.example\\share\\x.png",
    "\\\\.\\pipe\\x",
  ])("is true for %s", (path) => {
    expect(namesAnotherNetworkRoot(PROJECT, path)).toBe(true);
  });

  it.each(["C:\\project\\a.png", "D:\\media\\a.png", "assets\\a.png"])(
    "is false for %s",
    (path) => {
      expect(namesAnotherNetworkRoot(PROJECT, path)).toBe(false);
    },
  );

  it("is false for a path on the share the project itself lives on", () => {
    expect(namesAnotherNetworkRoot("\\\\nas\\films\\project", "//NAS/films/clip.mp4")).toBe(false);
  });
});

describe("resolveLocalAssetCandidates under Windows rules", () => {
  it.each([
    "C:\\Users\\me\\.env",
    "C:/Users/me/.env",
    "\\Users\\me\\.env",
    "/%2FUsers/me/.env",
    "%2F%2Fattacker.example/share/x.css",
    "/C:%5CUsers%5Cme%5C.env",
  ])("offers only files inside the project for %s", (url) => {
    expect(resolveLocalAssetCandidates(PROJECT, url).filter((c) => !insideProject(c))).toEqual([]);
  });

  it("still clamps a leading ../ into the project, as a browser does", () => {
    expect(resolveLocalAssetCandidates(PROJECT, "../assets/a.png")).toEqual([
      "C:\\project\\assets\\a.png",
    ]);
  });
});

describe("resolveCompositionSrc under Windows rules", () => {
  it.each(["C:\\elsewhere\\scene.html", "..\\scene.html", "%2E%2E/scene.html"])(
    "refuses %s without touching the disk",
    (src) => {
      touched.length = 0;
      expect(resolveCompositionSrc(PROJECT, src)).toBeNull();
      expect(touched).toEqual([]);
    },
  );

  it("reads a UNC-looking src as a project path, never as a share", () => {
    touched.length = 0;
    expect(resolveCompositionSrc(PROJECT, "\\\\attacker.example\\share\\x.html")).toBe(
      "C:\\project\\attacker.example\\share\\x.html",
    );
    expect(touched.every(insideProject)).toBe(true);
  });
});
