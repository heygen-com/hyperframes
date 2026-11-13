import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LeftOutReference } from "./leftOutReference.js";
import { OUTSIDE_FILE_EXTENSIONS } from "./outsideFileType.js";
import { stagePublishFiles } from "./publishProject.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Writes `files` under a fresh folder, stages its `p` project, and collects what was left out. */
function stage(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "hf-file-type-"));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body.replaceAll("<root>", root));
  }
  const warnings: string[] = [];
  const leftOut: LeftOutReference[] = [];
  const staged = stagePublishFiles(join(root, "p"), Infinity, (warning, reference) => {
    warnings.push(warning);
    leftOut.push(reference);
  });
  const ext = [...staged.keys()].filter((key) => key.startsWith("_ext/")).sort();
  return { root, staged, warnings, leftOut, ext };
}

describe("a file outside the project", () => {
  it("is still copied when it is an image, video, audio, font or stylesheet, without a warning", () => {
    const { ext, warnings } = stage({
      "shared/logo.png": "png",
      "shared/LOUD.PNG": "png",
      "shared/clip.mp4": "mp4",
      "shared/brand.woff2": "woff2",
      "shared/theme.css": "body {}",
      "shared/old.avi": "avi",
      "shared/scan.tif": "tif",
      "shared/take.aiff": "aiff",
      "p/index.html": [
        `<img src="../shared/logo.png"><img src="../shared/LOUD.PNG"><img src="../shared/scan.tif">`,
        `<video src="../shared/old.avi"></video><audio src="../shared/take.aiff"></audio>`,
        `<video src="../shared/clip.mp4"></video><link rel="stylesheet" href="../shared/theme.css">`,
        `<style>@font-face { font-family: B; src: url("../shared/brand.woff2"); }</style>`,
      ].join(""),
    });
    expect(ext).toEqual([
      "_ext/shared/LOUD.PNG",
      "_ext/shared/brand.woff2",
      "_ext/shared/clip.mp4",
      "_ext/shared/logo.png",
      "_ext/shared/old.avi",
      "_ext/shared/scan.tif",
      "_ext/shared/take.aiff",
      "_ext/shared/theme.css",
    ]);
    expect(warnings).toEqual([]);
  });

  it("is left out when it is any other type, for ../, absolute and percent-encoded spellings", () => {
    const { root, staged, ext, warnings, leftOut } = stage({
      "shared/scene.json": "{}",
      "shared/brief.pdf": "pdf",
      "shared/notes": "text",
      "p/index.html": [
        `<lottie-player src="../shared/scene.json"></lottie-player>`,
        `<a href="<root>/shared/brief.pdf"></a>`,
        `<link href="%2e%2e/shared/notes">`,
      ].join(""),
    });
    expect(ext).toEqual([]);
    const tail =
      "which is outside the project and is not an image, video, audio, font, CSS or JS file; it was left out of the upload. Move it into the project to include it.";
    expect(warnings.sort()).toEqual(
      [
        `index.html references ../shared/scene.json, ${tail}`,
        `index.html references ${root}/shared/brief.pdf, ${tail}`,
        `index.html references %2e%2e/shared/notes, ${tail}`,
      ].sort(),
    );
    const at = (reference: string, path: string) => ({
      file: "index.html",
      reference,
      path,
      reason: "file_type",
      levels_up: 1,
    });
    expect(leftOut).toEqual(
      expect.arrayContaining([
        at("../shared/scene.json", "../shared/scene.json"),
        at(`${root}/shared/brief.pdf`, "../shared/brief.pdf"),
        at("%2e%2e/shared/notes", "../shared/notes"),
      ]),
    );
    expect(leftOut).toHaveLength(3);
    const index = staged.get("index.html")!.toString("utf-8");
    expect(index).toContain(`src="../shared/scene.json"`);
  });

  it("follows the same rule for CSS url() targets and @import", () => {
    const { ext, warnings, leftOut } = stage({
      "shared/theme.css": "body {}",
      "shared/data.json": "{}",
      "p/style.css": `@import url("../shared/theme.css"); body { background: url("../shared/data.json"); }`,
      "p/index.html": `<link rel="stylesheet" href="style.css">`,
    });
    expect(ext).toEqual(["_ext/shared/theme.css"]);
    expect(warnings).toEqual([
      expect.stringMatching(/^style\.css references \.\.\/shared\/data\.json, which is outside/),
    ]);
    expect(leftOut.map((one) => one.reason)).toEqual(["file_type"]);
  });

  it("is left out when its name looks like an image but it links to another type", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-file-type-"));
    dirs.push(root);
    mkdirSync(join(root, "p"));
    writeFileSync(join(root, "data.json"), "{}");
    symlinkSync(join(root, "data.json"), join(root, "logo.png"));
    writeFileSync(join(root, "p", "index.html"), `<img src="../logo.png">`);
    const reasons: string[] = [];
    const staged = stagePublishFiles(join(root, "p"), Infinity, (_, one) =>
      reasons.push(one.reason),
    );
    expect([...staged.keys()].some((key) => key.startsWith("_ext/"))).toBe(false);
    expect(reasons).toEqual(["file_type"]);
  });

  it("is left out when its own name is another type, even if it links to an image", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-file-type-"));
    dirs.push(root);
    mkdirSync(join(root, "p"));
    writeFileSync(join(root, "logo.png"), "png");
    symlinkSync(join(root, "logo.png"), join(root, "scene.json"));
    writeFileSync(join(root, "p", "index.html"), `<link href="../scene.json">`);
    const reasons: string[] = [];
    const staged = stagePublishFiles(join(root, "p"), Infinity, (_, one) =>
      reasons.push(one.reason),
    );
    expect([...staged.keys()].some((key) => key.startsWith("_ext/"))).toBe(false);
    expect(reasons).toEqual(["file_type"]);
  });

  it("keeps the private-location reason ahead of the file type", () => {
    const { ext, leftOut } = stage({
      "shared/.cache/state.json": "{}",
      "p/index.html": `<link href="../shared/.cache/state.json">`,
    });
    expect(ext).toEqual([]);
    expect(leftOut.map((one) => one.reason)).toEqual(["blocklisted"]);
  });

  it("does not change what is copied from inside the project", () => {
    const { staged, warnings } = stage({
      "p/data/scene.json": "{}",
      "p/index.html": `<lottie-player src="data/scene.json"></lottie-player>`,
    });
    expect(staged.has("data/scene.json")).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe("the outside file types", () => {
  it("are images, video, audio, fonts, CSS and JS, and nothing else", () => {
    for (const extension of [".png", ".avif", ".svg", ".bmp", ".tif", ".mp4", ".mov", ".webm"]) {
      expect(OUTSIDE_FILE_EXTENSIONS).toContain(extension);
    }
    for (const extension of [".avi", ".ogv", ".mp3", ".wav", ".aiff"]) {
      expect(OUTSIDE_FILE_EXTENSIONS).toContain(extension);
    }
    for (const extension of [".woff", ".woff2", ".ttf", ".otf", ".css", ".js", ".mjs"]) {
      expect(OUTSIDE_FILE_EXTENSIONS).toContain(extension);
    }
    for (const extension of [".json", ".html", ".txt", ".md", ".cube", ".pdf", ".key", ""]) {
      expect(OUTSIDE_FILE_EXTENSIONS).not.toContain(extension);
    }
  });
});
