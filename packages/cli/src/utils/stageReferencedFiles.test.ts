import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageReferencedFiles } from "./stageReferencedFiles.js";

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
});
