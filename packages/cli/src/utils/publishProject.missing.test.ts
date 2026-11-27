import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stagePublishFiles } from "./publishProject.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const FILM = `<div data-composition-id="main" data-width="1920" data-height="1080" data-duration="2">
  <div data-composition-src="compositions/intro.html"></div>
</div>`;

/** Writes `files` under a fresh project folder and stages it as the cloud would upload it. */
function stage(files: Record<string, string | Buffer>, prepare?: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "hf-missing-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries({ "index.html": FILM, ...files })) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  prepare?.(dir);
  return () => stagePublishFiles(dir, Infinity);
}

const refusal = (name: string) =>
  `The composition references "${name}", which is not in the project folder.`;

describe("a file a page names that the folder lacks", () => {
  // fails without the fix: a storyboard page beside the video blocked the cloud render of a video that has every file
  it("is no refusal when the page is one the video never plays", () => {
    const staged = stage({
      "compositions/intro.html": `<video src="clip.mp4"></video>`,
      "compositions/clip.mp4": "mp4",
      "boards/storyboard.html": `<img src="stills/at-1.2s.png">`,
      "drafts/old.html": `<audio src="../music/old.mp3"></audio>`,
    })();
    expect(staged.has("boards/storyboard.html")).toBe(true);
    expect(staged.has("compositions/clip.mp4")).toBe(true);
  });

  it("is still refused when the video's own page names it", () => {
    const staged = stage({
      "index.html": `<div data-composition-id="main"><video src="assets/gone.mp4"></video></div>`,
    });
    expect(staged).toThrow(refusal("assets/gone.mp4"));
  });

  it("is still refused when a composition the video loads names it", () => {
    const staged = stage({ "compositions/intro.html": `<img src="assets/logo.png">` });
    expect(staged).toThrow(refusal("assets/logo.png"));
  });

  it("is still refused on a played page however deep the compositions nest", () => {
    const chain: Record<string, string> = {};
    for (let i = 0; i < 300; i++)
      chain[`compositions/c${i}.html`] =
        `<div data-composition-src="compositions/c${i + 1}.html"></div>`;
    chain["compositions/c300.html"] = `<img src="assets/deep.png">`;
    const staged = stage({
      ...chain,
      "index.html": `<div data-composition-src="compositions/c0.html"></div>`,
    });
    expect(staged).toThrow(refusal("assets/deep.png"));
  });

  it("is still refused on a page mounted by one whose name is written in another Unicode form", () => {
    const staged = stage({
      "index.html": `<div data-composition-src="compositions/caf\u00e9.html"></div>`,
      "compositions/cafe\u0301.html": `<div data-composition-src="compositions/inner.html"></div>`,
      "compositions/inner.html": `<img src="assets/logo.png">`,
    });
    expect(staged).toThrow(refusal("assets/logo.png"));
  });

  it("is still refused on a page a UTF-16 index.html mounts", () => {
    const index = `<div data-composition-src="compositions/intro.html"></div>`;
    const staged = stage({
      "index.html": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(index, "utf16le")]),
      "compositions/intro.html": `<img src="assets/logo.png">`,
    });
    expect(staged).toThrow(refusal("assets/logo.png"));
  });

  it("is refused on any page when a page the video loads is not in the upload", () => {
    const staged = stage({
      "compositions/intro.html": `<div></div>`,
      ".hyperframesignore": "compositions/intro.html\n",
      "boards/storyboard.html": `<img src="stills/at-1.2s.png">`,
    });
    expect(staged).toThrow(refusal("stills/at-1.2s.png"));
  });

  it.skipIf(process.platform === "win32")(
    "is refused on any page, without waiting, when the video loads a named pipe",
    () => {
      const staged = stage(
        { "boards/storyboard.html": `<img src="stills/at-1.2s.png">` },
        (dir) => {
          mkdirSync(join(dir, "compositions"));
          execFileSync("mkfifo", [join(dir, "compositions/intro.html")]);
        },
      );
      expect(staged).toThrow(refusal("stills/at-1.2s.png"));
    },
  );
});

describe("a file named with a percent escape", () => {
  // fails without the fix: a page beside the root looked the root up by the escaped name, not "My Video.mp4"
  it("is staged from the project root when a composition escapes the space in its name", () => {
    const staged = stage({
      "compositions/intro.html": `<video src="assets/My%20Video.mp4"></video>`,
      "assets/My Video.mp4": "mp4",
    })();
    expect(staged.has("assets/My Video.mp4")).toBe(true);
  });

  // fails without the fix: the decoded spelling threw "not in the project folder" before the name as written was tried
  it("is staged when the file's own name holds the escape and the page names it as written", () => {
    const staged = stage({
      "compositions/intro.html": `<video src="clips/My%20Video.mp4"></video>`,
      "compositions/clips/My%20Video.mp4": "mp4",
    })();
    expect(staged.has("compositions/clips/My%20Video.mp4")).toBe(true);
  });

  // fails without the fix: the query stayed on the name looked up, so neither spelling was found on disk
  it("is staged when the reference also carries a query or a fragment", () => {
    const staged = stage({
      "compositions/intro.html": `<video src="clips/My%20Video.mp4#t=1"></video><img src="assets/My%20Logo.png?v=2">`,
      "compositions/clips/My%20Video.mp4": "mp4",
      "assets/My Logo.png": "png",
    })();
    expect(staged.has("compositions/clips/My%20Video.mp4")).toBe(true);
    expect(staged.has("assets/My Logo.png")).toBe(true);
  });

  it("is still refused when neither spelling is on disk", () => {
    const staged = stage({
      "compositions/intro.html": `<video src="clips/My%20Video.mp4"></video>`,
    });
    expect(staged).toThrow(refusal("clips/My%20Video.mp4"));
  });
});
