import { describe, expect, it, vi } from "vitest";

// Windows path rules on any host, and a disk that records every look at it.
const touched = vi.hoisted(() => [] as string[]);
const present = vi.hoisted(() => new Set<string>());
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const existsSync = (path: string) => {
    touched.push(path);
    return present.has(path);
  };
  return { ...fs, existsSync, default: { ...fs, existsSync } };
});

const {
  localAbsoluteAssetFile,
  namesAnotherNetworkRoot,
  resolveAuthoredAssetFile,
  resolveCompositionSrc,
  resolveLocalAssetCandidates,
  srcOnAnotherNetworkRoot,
} = await import("./assetResolution.js");
const { resolve } = await import("node:path");

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

  it.each([
    "node_modules/gsap/dist/gsap.min.js",
    "../shared/gsap/dist/gsap.min.js",
    "/vendor/gsap/dist/gsap.min.js",
    "\\\\nas\\films\\shared\\clip.mp4",
  ])("is false for %s resolved in a project on a share", (src) => {
    const project = "\\\\nas\\films\\project";
    expect(namesAnotherNetworkRoot(project, resolve(project, src))).toBe(false);
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

describe("localAbsoluteAssetFile under Windows rules", () => {
  it.each([
    ["C:\\media\\clip.mp4", "C:\\media\\clip.mp4"],
    ["D:/media/clip.mp4", "D:\\media\\clip.mp4"],
    ["C:\\media\\clip.mp4?v=2", "C:\\media\\clip.mp4"],
    ["\\media\\clip.mp4", "C:\\media\\clip.mp4"],
  ])("finds the local file %s names, as render does", (src, file) => {
    present.clear();
    present.add(file);
    expect(localAbsoluteAssetFile(PROJECT, src)).toBe(file);
    expect(resolveAuthoredAssetFile(PROJECT, "index.html", src)).toBe(file);
  });

  it("finds a file on the share the project itself lives on", () => {
    present.clear();
    present.add("\\\\NAS\\films\\shared\\clip.mp4");
    expect(
      localAbsoluteAssetFile("\\\\nas\\films\\project", "\\\\NAS\\films\\shared\\clip.mp4"),
    ).toBe("\\\\NAS\\films\\shared\\clip.mp4");
  });

  it.each([
    "/media/clip.mp4",
    "assets/clip.mp4",
    "file:///C:/media/clip.mp4",
    "https://x.example/a.mp4",
  ])("leaves %s to the project resolver", (src) => {
    touched.length = 0;
    expect(localAbsoluteAssetFile(PROJECT, src)).toBeNull();
    expect(touched).toEqual([]);
  });

  it("never looks at another computer's share", () => {
    touched.length = 0;
    expect(localAbsoluteAssetFile(PROJECT, "\\\\attacker.example\\share\\x.mp4")).toBeNull();
    expect(touched).toEqual([]);
  });

  it("returns null when the file is not there", () => {
    present.clear();
    expect(localAbsoluteAssetFile(PROJECT, "C:\\media\\gone.mp4")).toBeNull();
  });
});

describe("srcOnAnotherNetworkRoot under Windows rules", () => {
  it.each([
    "\\\\attacker.example\\share\\x.wav",
    "//attacker.example/share/x.wav",
    "/\\attacker.example\\share\\x.wav",
    "\\\\attacker.example\\share\\x.wav?v=2",
  ])("is true for %s", (src) => {
    touched.length = 0;
    expect(srcOnAnotherNetworkRoot(PROJECT, src)).toBe(true);
    expect(touched).toEqual([]);
  });

  it.each(["C:\\media\\voice.wav", "assets\\voice.wav", "/assets/voice.wav", "../voice.wav"])(
    "is false for %s",
    (src) => {
      expect(srcOnAnotherNetworkRoot(PROJECT, src)).toBe(false);
    },
  );

  it("is false for a file on the share the project itself lives on", () => {
    expect(srcOnAnotherNetworkRoot("\\\\nas\\films\\project", "//NAS/films/voice.wav")).toBe(false);
  });
});
