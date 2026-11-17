import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leftOutNotice, stageReferencedFiles } from "./stageReferencedFiles.js";

let root: string;
let folder: string;
let staged: string;

function write(path: string, text = "x"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function stagedFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(staged, path).split("\\").join("/"));
    }
  };
  walk(staged);
  return files.sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hf-stage-referenced-"));
  folder = join(root, "sent");
  staged = join(root, "staged");
  mkdirSync(folder);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("stageReferencedFiles", () => {
  it("copies the page and every file its markup, stylesheets and compositions name", () => {
    write(
      join(folder, "page.html"),
      `<link rel="stylesheet" href="css/look.css?v=2">
       <img src="img/a.png" srcset="img/a.png 1x, img/a@2x.png 2x">
       <video src="media/clip.mp4" poster="img/poster.jpg"></video>
       <div style="background: url('img/bg.webp')"></div>
       <div data-composition-src="compositions/scene.html"></div>
       <script src="js/run.js"></script>`,
    );
    write(join(folder, "css", "look.css"), `@font-face { src: url("../fonts/brand.woff2"); }`);
    write(
      join(folder, "compositions", "scene.html"),
      `<template><img src="../img/scene.png"></template>`,
    );
    for (const file of ["img/a.png", "img/a@2x.png", "img/poster.jpg", "img/bg.webp"])
      write(join(folder, file));
    for (const file of ["img/scene.png", "media/clip.mp4", "fonts/brand.woff2", "js/run.js"])
      write(join(folder, file));
    write(join(folder, "img", "unnamed.png"));

    stageReferencedFiles(folder, [join(folder, "page.html")], staged);

    expect(stagedFiles()).toEqual([
      "compositions/scene.html",
      "css/look.css",
      "fonts/brand.woff2",
      "img/a.png",
      "img/a@2x.png",
      "img/bg.webp",
      "img/poster.jpg",
      "img/scene.png",
      "js/run.js",
      "media/clip.mp4",
      "page.html",
    ]);
  });

  it("copies nothing from outside the page's folder, through a path or a link", () => {
    write(join(root, "Pictures", "IMG_0001.png"));
    symlinkSync(join(root, "Pictures"), join(folder, "pictures"));
    write(
      join(folder, "page.html"),
      `<img src="../Pictures/IMG_0001.png"><img src="${join(root, "Pictures", "IMG_0001.png")}">
       <img src="pictures/IMG_0001.png">`,
    );

    stageReferencedFiles(folder, [join(folder, "page.html")], staged);

    expect(stagedFiles()).toEqual(["page.html"]);
  });

  it("copies no private file, whatever type its name gives", () => {
    write(
      join(folder, "page.html"),
      `<img src=".git/logo.png"><img src=".env.png"><img src=".hyperframes/thumb.png">
       <img src="secrets/.npmrc">`,
    );
    for (const file of [".git/logo.png", ".env.png", ".hyperframes/thumb.png", "secrets/.npmrc"])
      write(join(folder, file));

    stageReferencedFiles(folder, [join(folder, "page.html")], staged);

    expect(stagedFiles()).toEqual(["page.html"]);
  });

  it("copies root-relative names, string imports, SVG links and the grading table", () => {
    write(
      join(folder, "page.html"),
      `<style>@import "css/theme.css";</style>
       <img src="/img/logo.png?v=1">
       <svg><image xlink:href="img/art.png"/><use xlink:href="icons.svg#star"/></svg>
       <video src="clip.mp4" data-color-grading='{"lut":{"src":"looks/warm.cube"}}'></video>
       <img src="looks/cold.cube">`,
    );
    write(
      join(folder, "css", "theme.css"),
      `@import 'more.css'; body { background: url(/img/bg.png) }`,
    );
    write(join(folder, "css", "more.css"), "p {}");
    for (const file of ["img/logo.png", "img/art.png", "icons.svg", "img/bg.png", "clip.mp4"])
      write(join(folder, file));
    write(join(folder, "looks", "warm.cube"));
    write(join(folder, "looks", "cold.cube"));

    const result = stageReferencedFiles(folder, [join(folder, "page.html")], staged);

    expect(stagedFiles()).toEqual([
      "clip.mp4",
      "css/more.css",
      "css/theme.css",
      "icons.svg",
      "img/art.png",
      "img/bg.png",
      "img/logo.png",
      "looks/warm.cube",
      "page.html",
    ]);
    expect(result).toEqual({ leftOut: ["looks/cold.cube"], complete: true });
  });

  it("names what it left out, and nothing that does not exist", () => {
    write(join(root, "Pictures", "IMG_0001.png"));
    write(join(folder, "notes.txt"));
    write(
      join(folder, "page.html"),
      `<img src="../Pictures/IMG_0001.png"><img src="notes.txt"><img src="missing.png">`,
    );

    const result = stageReferencedFiles(folder, [join(folder, "page.html")], staged);

    expect(result).toEqual({ leftOut: ["../Pictures/IMG_0001.png", "notes.txt"], complete: true });
  });
});

describe("leftOutNotice", () => {
  it("says nothing when nothing was left out", () => {
    expect(leftOutNotice("compare a.html", { leftOut: [], complete: true })).toBeNull();
  });

  it("names the first five escaped, counts the rest and says how to keep them", () => {
    const leftOut = ["a\x1b[2J.png", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt", "g.txt"];
    const notice = leftOutNotice("compare a.html", { leftOut, complete: false });

    expect(notice).not.toContain("\x1b");
    expect(notice).toContain("a\\x1b[2J.png, b.txt, c.txt, d.txt, e.txt, and 2 more.");
    expect(notice).toContain("too large or too many");
    expect(notice).toContain("pass the project folder");
  });
});
