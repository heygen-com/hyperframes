import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type OutsideFileReference, outsideFilesNotice } from "./leftOutReference.js";
import { stagePublishFiles } from "./publishProject.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Writes `files` under a fresh folder, makes `links` (link to target), and stages its `p` project. */
function stage(files: Record<string, string>, links: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "hf-outside-list-"));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body.replaceAll("<root>", root));
  }
  for (const [link, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(root, target), join(root, link));
  }
  const outside: OutsideFileReference[] = [];
  const staged = stagePublishFiles(join(root, "p"), Infinity, undefined, (reference) =>
    outside.push(reference),
  );
  return { root, staged, outside };
}

describe("files from outside the project that an upload carries", () => {
  it("are each named once, for ../, absolute and CSS url() references", () => {
    const { root, staged, outside } = stage({
      "shared/logo.png": "png",
      "shared/brand.woff2": "woff2",
      "p/style.css": `@font-face { font-family: B; src: url("../shared/brand.woff2"); }`,
      "p/index.html": [
        `<img src="../shared/logo.png"><img src="<root>/shared/logo.png">`,
        `<link rel="stylesheet" href="style.css">`,
      ].join(""),
    });
    expect(staged.has("_ext/shared/logo.png")).toBe(true);
    expect(outside).toEqual([
      {
        file: "index.html",
        reference: "../shared/logo.png",
        path: "../shared/logo.png",
        levels_up: 1,
      },
      {
        file: "style.css",
        reference: "../shared/brand.woff2",
        path: "../shared/brand.woff2",
        levels_up: 1,
      },
    ]);
    expect(outside.some((one) => one.reference === `${root}/shared/logo.png`)).toBe(false);
  });

  it("include project files that are links to files outside the project", () => {
    const { staged, outside } = stage(
      {
        "shared/logo.png": "png",
        "shared/pack/scene.json": "{}",
        "p/index.html": `<img src="logo.png">`,
      },
      { "p/logo.png": "shared/logo.png", "p/data/scene.json": "shared/pack/scene.json" },
    );
    expect(staged.has("logo.png")).toBe(true);
    expect(staged.has("data/scene.json")).toBe(true);
    expect(outside).toEqual(
      expect.arrayContaining([
        { file: "logo.png", reference: "logo.png", path: "../shared/logo.png", levels_up: 1 },
        {
          file: "data/scene.json",
          reference: "data/scene.json",
          path: "../shared/pack/scene.json",
          levels_up: 1,
        },
      ]),
    );
    expect(outside).toHaveLength(2);
  });

  it("leave out project files and files the upload does not carry", () => {
    const { outside } = stage({
      "shared/data.json": "{}",
      "shared/.cache/logo.png": "png",
      "p/media/clip.mp4": "mp4",
      "p/index.html": [
        `<video src="media/clip.mp4"></video><link href="../shared/data.json">`,
        `<img src="../shared/.cache/logo.png"><img src="../shared/missing.png">`,
      ].join(""),
    });
    expect(outside).toEqual([]);
  });
});

describe("the notice that names them", () => {
  it("says how many there are and where each one comes from", () => {
    expect(
      outsideFilesNotice([
        { file: "index.html", reference: "../a.png", path: "../a.png", levels_up: 1 },
        { file: "logo.png", reference: "logo.png", path: "../../b.png", levels_up: 2 },
      ]),
    ).toBe(
      [
        "Uploading 2 files from outside the project folder:",
        "  ../a.png (referenced by index.html)",
        "  ../../b.png (linked from logo.png)",
      ].join("\n"),
    );
    expect(
      outsideFilesNotice([{ file: "a.html", reference: "/x.png", path: "../x.png", levels_up: 1 }]),
    ).toMatch(/^Uploading 1 file from outside/);
  });
});
