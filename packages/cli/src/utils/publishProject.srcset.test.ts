import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import AdmZip from "adm-zip";
import { parseHTML } from "linkedom";
import { createPublishArchive, readStaged, stagePublishFiles } from "./publishProject.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), "hf-publish-srcset-"));
  fixtureDirs.push(dir);
  const projectDir = join(dir, "project");
  const sharedDir = join(dir, "shared");
  mkdirSync(projectDir);
  mkdirSync(sharedDir);
  return { projectDir, sharedDir };
}

describe("publishing external srcset assets", () => {
  it.each(["index.html", "compositions/scene.html"])(
    "archives image and picture candidates relative to %s without duplicating src assets",
    (entryPath) => {
      const { projectDir, sharedDir } = createFixture();
      mkdirSync(join(projectDir, dirname(entryPath)), { recursive: true });
      if (entryPath !== "index.html")
        writeFileSync(join(projectDir, "index.html"), "<html></html>");
      writeFileSync(join(sharedDir, "small.png"), PNG);
      writeFileSync(join(sharedDir, "large.png"), PNG);
      const sourcePrefix = entryPath === "index.html" ? "../shared" : "../../shared";
      const html = `<html><body><picture><source srcset="${sourcePrefix}/small.png 640w, ${sourcePrefix}/large.png 1280w"><img src="${sourcePrefix}/small.png" srcset="${sourcePrefix}/small.png 1x, ${sourcePrefix}/large.png 2x"></picture></body></html>`;
      writeFileSync(join(projectDir, entryPath), html);

      const archive = createPublishArchive(projectDir);
      const zip = new AdmZip(archive.buffer);
      const externalPaths = zip
        .getEntries()
        .map((entry) => entry.entryName)
        .filter((path) => path.startsWith("_ext/"));
      expect(externalPaths.sort()).toEqual(["_ext/shared/large.png", "_ext/shared/small.png"]);
      for (const path of externalPaths) expect(zip.readFile(path)).toEqual(PNG);

      const { document } = parseHTML(zip.readAsText(entryPath));
      const small = posix.relative(posix.dirname(entryPath), "_ext/shared/small.png");
      const large = posix.relative(posix.dirname(entryPath), "_ext/shared/large.png");
      expect(document.querySelector("img")?.getAttribute("src")).toBe(small);
      expect(document.querySelector("img")?.getAttribute("srcset")).toBe(
        `${small} 1x, ${large} 2x`,
      );
      expect(document.querySelector("source")?.getAttribute("srcset")).toBe(
        `${small} 640w, ${large} 1280w`,
      );
      expect(archive.fileCount).toBe(entryPath === "index.html" ? 3 : 4);
      expect(readFileSync(join(projectDir, entryPath), "utf-8")).toBe(html);
    },
  );

  it("preserves mixed data URLs, URL commas, descriptors and separators", () => {
    const { projectDir, sharedDir } = createFixture();
    writeFileSync(join(sharedDir, "hero,blue.png"), PNG);
    writeFileSync(join(projectDir, "inside.png"), PNG);
    const srcset =
      "  data:image/png;base64,AA== 1x,\n\t../shared/hero,blue.png 2x, https://cdn.example.com/a,b.png 3x, //cdn.example.com/c.png 4x, inside.png 5x, ../shared/missing.png 6x  ";
    const html = `<html><body><img srcset="${srcset}"></body></html>`;
    writeFileSync(join(projectDir, "index.html"), html);

    const zip = new AdmZip(createPublishArchive(projectDir).buffer);
    expect(zip.readFile("_ext/shared/hero,blue.png")).toEqual(PNG);
    const { document } = parseHTML(zip.readAsText("index.html"));
    expect(document.querySelector("img")?.getAttribute("srcset")).toBe(
      srcset.replace("../shared/hero,blue.png", "_ext/shared/hero%2Cblue.png"),
    );
    expect(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .sort(),
    ).toEqual(["_ext/shared/hero,blue.png", "index.html", "inside.png"]);
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(html);
  });

  it("keeps HTML bytes when all candidates are internal, remote, inline or missing", () => {
    const { projectDir } = createFixture();
    writeFileSync(join(projectDir, "inside.png"), PNG);
    const html =
      "<!doctype html>\n<!-- retain formatting -->\n<html><body><IMG srcset='data:image/png;base64,AA== 1x, https://cdn.example.com/a,b.png 2x, inside.png 3x, ../missing.png 4x'><source srcset=''></body></html>\n";
    writeFileSync(join(projectDir, "index.html"), html);

    const zip = new AdmZip(createPublishArchive(projectDir).buffer);
    expect(zip.readAsText("index.html")).toBe(html);
    expect(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .sort(),
    ).toEqual(["index.html", "inside.png"]);
  });

  it("localizes percent-encoded filenames without changing srcset descriptors", () => {
    const { projectDir, sharedDir } = createFixture();
    const filename = "poster #雪%.png";
    const encodedFilename = "poster%20%23%E9%9B%AA%25.png";
    writeFileSync(join(sharedDir, filename), PNG);
    const html = `<html><body><source srcset="../shared/${encodedFilename} 640w, ../shared/${encodedFilename} 1280w"></body></html>`;
    writeFileSync(join(projectDir, "index.html"), html);

    const zip = new AdmZip(createPublishArchive(projectDir).buffer);
    expect(zip.readFile(`_ext/shared/${filename}`)).toEqual(PNG);
    expect(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .sort(),
    ).toEqual([`_ext/shared/${filename}`, "index.html"]);
    const { document } = parseHTML(zip.readAsText("index.html"));
    expect(document.querySelector("source")?.getAttribute("srcset")).toBe(
      `_ext/shared/${encodedFilename} 640w, _ext/shared/${encodedFilename} 1280w`,
    );
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(html);
  });

  it("stages srcset-only binary assets on disk for streamed uploads", () => {
    const { projectDir, sharedDir } = createFixture();
    const assetPath = join(sharedDir, "image.png");
    writeFileSync(assetPath, PNG);
    const html = '<html><body><img srcset="../shared/image.png 2x"></body></html>';
    writeFileSync(join(projectDir, "index.html"), html);

    const files = stagePublishFiles(projectDir, 1);
    const image = files.get("_ext/shared/image.png");
    expect(image).toBeDefined();
    if (!image || Buffer.isBuffer(image)) throw new Error("Expected an image staged on disk");
    expect(image.absPath).toBe(assetPath);
    expect(image.size).toBe(PNG.byteLength);
    expect(readStaged(image)).toEqual(PNG);
    const entry = files.get("index.html");
    if (!entry) throw new Error("Expected the staged HTML entry");
    expect(Buffer.isBuffer(entry)).toBe(true);
    expect(readStaged(entry).toString("utf-8")).toContain('srcset="_ext/shared/image.png 2x"');
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(html);
  });
});
