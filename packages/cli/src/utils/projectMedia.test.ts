import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { heardClips } from "./projectMedia.js";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function project(scene: string): string {
  dir = mkdtempSync(join(tmpdir(), "hf-heard-"));
  mkdirSync(join(dir, "compositions"));
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="30" data-width="1080" data-height="1920">
  <div id="talk-host" data-composition-id="talk" data-composition-src="compositions/talk.html"
       data-start="10" data-duration="20" data-width="1080" data-height="1920"></div>
</div></body></html>`,
  );
  writeFileSync(
    join(dir, "compositions", "talk.html"),
    `<template id="talk-template"><div data-composition-id="talk" data-start="0" data-duration="20" data-width="1080" data-height="1920">
${scene}
</div></template>`,
  );
  return dir;
}

const probe = { seconds: async () => 6 };

describe("heardClips", () => {
  it("hears a speaking video inside a timed wrapper in a scene, where the render plays it", async () => {
    const clips = await heardClips(
      project(`<div id="wrap" class="clip" data-start="1" data-duration="8">
  <video id="talk" src="../assets/talk.mp4" data-has-audio="true" data-start="0" data-duration="5"></video>
</div>`),
      probe,
    );
    expect(clips.map(({ src, start, end }) => ({ src, start, end }))).toEqual([
      { src: "assets/talk.mp4", start: 10, end: 15 },
    ]);
  });

  it("ends a speaking clip with no set length where its media runs out, not where its scene ends", async () => {
    const clips = await heardClips(
      project(
        `<video id="talk" src="../assets/talk.mp4" data-has-audio="true" data-start="2" data-media-start="1"></video>`,
      ),
      probe,
    );
    expect(clips.map(({ src, start, end }) => ({ src, start, end }))).toEqual([
      { src: "assets/talk.mp4", start: 12, end: 17 },
    ]);
  });

  it("leaves out a clip that starts past its media's end, and reads each file's length once", async () => {
    const probed: string[] = [];
    const counting = { seconds: async (path: string) => (probed.push(path), 6) };
    const clips = await heardClips(
      project(`<video id="late" src="../assets/talk.mp4" data-has-audio="true" data-start="0" data-media-start="7"></video>
<video id="talk" src="../assets/talk.mp4" data-has-audio="true" data-start="8" data-duration="3"></video>`),
      counting,
    );
    expect(clips.map(({ id, start, end }) => ({ id, start, end }))).toEqual([
      { id: "talk-audio", start: 18, end: 21 },
    ]);
    expect(probed).toHaveLength(1);
  });

  it("hears a video only when it says data-has-audio and is not muted, as the render does", async () => {
    const clips = await heardClips(
      project(`<video id="broll" src="../assets/broll.mp4" data-start="0" data-duration="3"></video>
<video id="quiet" src="../assets/quiet.mp4" data-has-audio="true" data-start="4" data-duration="3" muted></video>
<video id="talk" src="../assets/talk.mp4" data-has-audio="true" data-start="8" data-duration="3"></video>`),
      probe,
    );
    expect(clips.map(({ src, start, end }) => ({ src, start, end }))).toEqual([
      { src: "assets/talk.mp4", start: 18, end: 21 },
    ]);
  });
});
