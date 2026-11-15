import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileForRender } from "../../../producer/src/services/htmlCompiler.js";
import { outsideAssetsAllowed } from "./receivedRender.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function project(record?: string): string {
  root = mkdtempSync(join(tmpdir(), "hf-received-render-"));
  for (const name of ["secret.js", "pic.png", "clip.mp4", "bg.png"]) {
    write(join(root, "outside", name), "x");
  }
  const dir = join(root, "project");
  write(
    join(dir, "index.html"),
    `<link rel="stylesheet" href="style.css">
<script src="../outside/secret.js"></script>
<script src="https://cdn.example/lib.js"></script>
<img src="../outside/pic.png"><img src="assets/in.png">
<div data-composition-src="compositions/scene.html"></div>`,
  );
  write(join(dir, "compositions", "scene.html"), `<video src="../../outside/clip.mp4"></video>`);
  write(join(dir, "style.css"), `body { background: url(../outside/bg.png); }`);
  write(join(dir, "assets", "in.png"), "x");
  write(join(dir, "unused.html"), `<img src="../outside/pic.png">`);
  if (record !== undefined) write(join(dir, ".hyperframes", "received-files.json"), record);
  return dir;
}

const received = (...files: string[]) => JSON.stringify({ files });

const SOMEONE_ELSE = "came from someone else and can load other files";

function decide(dir: string, entry?: string) {
  const warn = vi.fn();
  const allowed = outsideAssetsAllowed(dir, entry, warn);
  return { allowed, warn, line: String(warn.mock.calls[0]?.[0] ?? "") };
}

describe("outsideAssetsAllowed", () => {
  it("refuses outside files for a received entry and names every reference it leaves out", () => {
    const { allowed, warn, line } = decide(project(received("index.html")));
    expect(allowed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(line).toContain(SOMEONE_ELSE);
    for (const ref of [
      "../outside/secret.js",
      "../outside/pic.png",
      "../../outside/clip.mp4",
      "../outside/bg.png",
    ]) {
      expect(line).toContain(ref);
    }
    expect(line).not.toContain("assets/in.png");
    expect(line).not.toContain("cdn.example");
  });

  it("refuses outside files when the own entry plays a received composition, and names it", () => {
    const dir = project(received("compositions/scene.html"));
    for (const entry of ["compositions/scene.html", undefined]) {
      const { allowed, line } = decide(dir, entry);
      expect(allowed).toBe(false);
      expect(line).toContain(SOMEONE_ELSE);
    }
  });

  it("refuses outside files when a linked stylesheet was received", () => {
    const { allowed, line } = decide(project(received("style.css")));
    expect(allowed).toBe(false);
    expect(line).toContain(SOMEONE_ELSE);
  });

  it("refuses outside files when a stylesheet @imports a received stylesheet", () => {
    const dir = project(received("theme.css"));
    write(join(dir, "style.css"), `@import "theme.css";\nbody { color: red; }`);
    write(join(dir, "theme.css"), `body { background: url(../outside/bg.png); }`);
    const { allowed } = decide(dir);
    expect(allowed).toBe(false);
  });

  it("refuses outside files when a received composition sits past the scan limit", () => {
    const dir = project(received("compositions/scene.html"));
    write(
      join(dir, "index.html"),
      `<p>${"a".repeat(2_200_000)}</p><div data-composition-src="compositions/scene.html"></div>`,
    );
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain(SOMEONE_ELSE);
  });

  it("refuses outside files whenever the record lists a file, even one the render never opens", () => {
    const { allowed, line } = decide(project(received("unused.html")));
    expect(allowed).toBe(false);
    expect(line).toContain(SOMEONE_ELSE);
    expect(line).toContain("../outside/secret.js");
  });

  it.each([
    ["an image", "assets/in.png"],
    ["a video", "media/clip.mp4"],
    ["a font", "fonts/brand.woff2"],
  ])("keeps outside files when only %s was received", (_kind, file) => {
    const dir = project(received(file));
    if (file !== "assets/in.png") write(join(dir, file), "\u0000binary\u0000");
    const { allowed, warn } = decide(dir);
    expect(allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["HTML", "notes.txt", "<div><img src='../outside/pic.png'></div>"],
    ["CSS", "theme.dat", "body { background: url(../outside/bg.png); }"],
    ["SVG", "logo.img", "<?xml version='1.0'?><svg></svg>"],
  ])("refuses outside files when a received file sniffs as %s", (_kind, file, text) => {
    const dir = project(received(file));
    write(join(dir, file), text);
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain(`${file} ${SOMEONE_ELSE}`);
  });

  it("keeps outside files when the record lists no files", () => {
    expect(decide(project(received())).allowed).toBe(true);
  });

  it("keeps outside files for a project with no received-files record", () => {
    const { allowed, warn } = decide(project());
    expect(allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")(
    "renders an owned project with a symlink loop normally",
    () => {
      const dir = project();
      symlinkSync("loop", join(dir, "loop"));
      write(
        join(dir, "index.html"),
        `<link rel="stylesheet" href="loop/a.css"><a href="loop">x</a>`,
      );
      expect(decide(dir).allowed).toBe(true);
      write(join(dir, ".hyperframes", "received-files.json"), received("unused.html"));
      expect(() => decide(dir)).not.toThrow();
    },
  );

  it.each(["{not json", "", "{}"])(
    "refuses outside files and names the record when it cannot be read: %j",
    (record) => {
      const dir = project(record);
      const { allowed, warn, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(line).toContain(
        `Could not read ${join(realpathSync(dir), ".hyperframes", "received-files.json")}`,
      );
      expect(line).toContain("../outside/secret.js");
    },
  );

  it("says the render stops on a composition outside the project", () => {
    const dir = project(received("index.html"));
    write(join(dir, "..", "outside", "shared.html"), "<div></div>");
    write(join(dir, "index.html"), `<div data-composition-src="../outside/shared.html"></div>`);
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain("stops on the compositions ../outside/shared.html");
  });

  it.runIf(process.platform !== "win32")(
    "skips a stylesheet it cannot read instead of failing",
    () => {
      const dir = project(received("index.html"));
      write(join(dir, "locked.css"), "body { background: url(../outside/bg.png); }");
      chmodSync(join(dir, "locked.css"), 0o000);
      write(join(dir, "index.html"), `<link href="locked.css"><img src="../outside/pic.png">`);
      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain("../outside/pic.png");
    },
  );

  it("scans a long unclosed url( run in linear time", () => {
    const dir = project("{not json");
    write(join(dir, "style.css"), "url(".repeat(1_000_000));
    const started = performance.now();
    decide(dir);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  describe("parity with the render compiler", () => {
    const scene = (id: string) =>
      `<template><div data-composition-id="${id}" data-width="320" data-height="180" data-duration="1">` +
      `<p>${id}-marker</p><img src="../../outside/pic.png"></div></template>`;

    it.each([
      {
        name: "a root-relative reference with a leading slash",
        files: { "compositions/scene.html": scene("received-scene") },
        src: "/compositions/scene.html",
        receivedFile: "compositions/scene.html",
        consumed: "received-scene-marker",
      },
      {
        name: "a percent-encoded reference",
        files: { "compositions/my scene.html": scene("received-scene") },
        src: "compositions/my%20scene.html",
        receivedFile: "compositions/my scene.html",
        consumed: "received-scene-marker",
      },
      {
        name: "a nested reference resolved from the project root",
        files: {
          "compositions/outer.html":
            `<template><div data-composition-id="outer" data-width="320" data-height="180" data-duration="1">` +
            `<div data-composition-src="compositions/inner.html"></div></div></template>`,
          "compositions/inner.html": scene("received-scene"),
        },
        src: "compositions/outer.html",
        receivedFile: "compositions/inner.html",
        consumed: "received-scene-marker",
      },
      {
        name: "an owned scene's received stylesheet",
        files: {
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<link rel="stylesheet" href="scene.css"><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.css": "body { color: red; }",
        },
        src: "compositions/scene.html",
        receivedFile: "compositions/scene.css",
        consumed: "scene.css",
      },
      {
        name: "a received stylesheet of an owned scene nested in an owned scene",
        files: {
          "compositions/outer.html":
            `<template><div data-composition-id="outer" data-width="320" data-height="180" data-duration="1">` +
            `<div data-composition-src="compositions/scene.html"></div></div></template>`,
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<link rel="stylesheet" href="scene.css"><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.css": "body { color: red; }",
        },
        src: "compositions/outer.html",
        receivedFile: "compositions/scene.css",
        consumed: "scene.css",
      },
      {
        name: "an owned scene's received script",
        files: {
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<script src="scene.js"></script><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.js": "window.sceneLoaded = true;",
        },
        src: "compositions/scene.html",
        receivedFile: "compositions/scene.js",
        consumed: "scene.js",
      },
      {
        name: "a received script of an owned scene nested in an owned scene",
        files: {
          "compositions/outer.html":
            `<template><div data-composition-id="outer" data-width="320" data-height="180" data-duration="1">` +
            `<div data-composition-src="compositions/scene.html"></div></div></template>`,
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<script src="scene.js"></script><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.js": "window.sceneLoaded = true;",
        },
        src: "compositions/outer.html",
        receivedFile: "compositions/scene.js",
        consumed: "scene.js",
      },
    ])("refuses outside files for $name the render compiler reads", async (probe) => {
      const dir = project(received(probe.receivedFile));
      for (const [file, text] of Object.entries(probe.files)) write(join(dir, file), text);
      write(
        join(dir, "index.html"),
        `<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">` +
          `<div data-composition-src="${probe.src}"></div></div>`,
      );

      const compiled = await compileForRender(dir, join(dir, "index.html"), join(dir, ".dl"), {
        allowOutsideProjectAssets: true,
      });
      const rendered = [compiled.html, ...compiled.subCompositions.values()].join("\n");
      expect(rendered).toContain(probe.consumed);

      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain(SOMEONE_ELSE);
      expect(line).toContain("../../outside/pic.png");
    });
  });
});
