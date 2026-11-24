// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  localizeRemoteBackgroundImages,
  localizeRemoteFontFaces,
  localizeRemoteImageSources,
  localizeRemoteMediaSources,
  REMOTE_MEDIA_SUBDIR,
} from "./htmlCompiler.js";

const downloaded = vi.hoisted(() => ({ name: "" }));

vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (_url: string, destDir: string) => {
    mkdirSync(destDir, { recursive: true });
    const local = join(destDir, downloaded.name);
    writeFileSync(local, "bytes");
    return local;
  },
}));

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-remote-literal-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const element = (html: string, id: string) => parseHTML(html).document.getElementById(id)!;

// fails without the fix: the local file name was a replaceAll pattern, so "$&" put the quoted remote URL back
// into the page outside its attribute, and "$$" and "$`" rewrote the text around the match
describe.each(["$&", "$$", "$`"])("a downloaded file whose name holds %s", (sequence) => {
  const local = (ext: string) => {
    downloaded.name = `download_1${sequence}x${ext}`;
    return `${REMOTE_MEDIA_SUBDIR}/${downloaded.name}`;
  };

  it("becomes exactly the media src, with only the authored attributes", async () => {
    const rel = local(".mp4");
    const page = `<video id="v" src="https://m.example/a.mp4" data-start="0"></video>`;
    const { html } = await localizeRemoteMediaSources(page, dir);
    const video = element(html, "v");
    expect(video.getAttributeNames()).toEqual(["id", "src", "data-start"]);
    expect(video.getAttribute("src")).toBe(rel);
  });

  it("becomes exactly the image src, with only the authored attributes", async () => {
    const rel = local(".png");
    const page = `<img id="i" src='https://m.example/a.png' alt="">`;
    const { html } = await localizeRemoteImageSources(page, dir);
    const image = element(html, "i");
    expect(image.getAttributeNames()).toEqual(["id", "src", "alt"]);
    expect(image.getAttribute("src")).toBe(rel);
  });

  it.each([
    ["unquoted", "url(https://m.example/b.png)"],
    ["quoted", 'url("https://m.example/b.png")'],
  ])("becomes exactly an %s background url", async (_form, url) => {
    const rel = local(".png");
    const page = `<div id="b" style='background-image: ${url}'></div>`;
    const { html } = await localizeRemoteBackgroundImages(page, dir);
    const div = element(html, "b");
    expect(div.getAttributeNames()).toEqual(["id", "style"]);
    expect(div.getAttribute("style")).toBe(
      `background-image: ${url.split("https://m.example/b.png").join(rel)}`,
    );
  });

  it("becomes exactly the font url", async () => {
    const rel = local(".woff2");
    const page = `<style>@font-face { font-family: "B"; src: url(https://f.example/a.woff2); }</style>`;
    const { html } = await localizeRemoteFontFaces(page, dir);
    expect(parseHTML(html).document.querySelector("style")!.textContent).toBe(
      `@font-face { font-family: "B"; src: url("${rel}"); }`,
    );
  });
});
