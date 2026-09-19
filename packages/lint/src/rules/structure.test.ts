import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter";
import type { HyperframeLinterOptions } from "../types";

const page = (body: string) =>
  `<html><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">${body}</div><script>window.__timelines={main:gsap.timeline({paused:true})};</script></body></html>`;

async function codes(body: string, options: HyperframeLinterOptions = {}) {
  const { findings } = await lintHyperframeHtml(page(body), options);
  return findings.filter((f) => STRUCTURE.has(f.code));
}
const STRUCTURE = new Set([
  "nested_structure_needs_subcomposition",
  "timeline_element_missing_timing",
  "media_missing_duration",
  "caption_track_kind_missing",
  "multiple_caption_tracks",
]);
const has = (found: Awaited<ReturnType<typeof codes>>, code: string) =>
  found.some((f) => f.code === code);

describe("nested_structure_needs_subcomposition", () => {
  it("flags a timed div that contains another div", async () => {
    const found = await codes(
      '<div id="card" class="clip" data-start="0" data-duration="3"><div>inner</div></div>',
    );
    expect(has(found, "nested_structure_needs_subcomposition")).toBe(true);
  });
  it("leaves layout free inside a sub-composition file", async () => {
    const found = await codes(
      '<div class="clip" data-start="0" data-duration="3"><div>inner</div></div>',
      { isSubComposition: true },
    );
    expect(found).toEqual([]);
  });
  it("passes a timed leaf with inline text, media, and a sub-composition host", async () => {
    const found = await codes(
      '<div class="clip" data-start="0" data-duration="3">hello <b>world</b><br></div>' +
        '<video src="a.mp4" data-start="0" data-duration="3"></video>' +
        '<div data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="3" data-duration="2"><div>ignored</div></div>',
    );
    expect(has(found, "nested_structure_needs_subcomposition")).toBe(false);
  });
  it("ignores style, script and template content inside a timed element", async () => {
    const found = await codes(
      '<div class="clip" data-start="0" data-duration="3">hi<style>.a{}</style><script>1</script><template><div></div></template></div>',
    );
    expect(has(found, "nested_structure_needs_subcomposition")).toBe(false);
  });
  it("descends an untimed wrapper to reach the timed element", async () => {
    const found = await codes(
      '<div id="stage"><div class="clip" data-start="0" data-duration="3"><p>x</p></div></div>',
    );
    expect(has(found, "nested_structure_needs_subcomposition")).toBe(true);
  });
});

describe("severity follows the host", () => {
  const body = '<div class="clip" data-start="0" data-duration="3"><div>inner</div></div>';
  it("is a warning for the CLI and an error for Studio", async () => {
    expect((await codes(body))[0]?.severity).toBe("warning");
    expect((await codes(body, { host: "cli" }))[0]?.severity).toBe("warning");
    expect((await codes(body, { host: "studio" }))[0]?.severity).toBe("error");
  });
});

describe("timeline_element_missing_timing", () => {
  it("flags a timed element with no duration, passes one with a duration and a sub-composition host without one", async () => {
    expect(
      has(
        await codes('<div class="clip" data-start="0">x</div>'),
        "timeline_element_missing_timing",
      ),
    ).toBe(true);
    expect(
      has(
        await codes('<div data-composition-id="a" data-start="0"></div>'),
        "timeline_element_missing_timing",
      ),
    ).toBe(false);
    expect(
      has(
        await codes('<div class="clip" data-start="0" data-duration="2">x</div>'),
        "timeline_element_missing_timing",
      ),
    ).toBe(false);
  });
});

describe("media_missing_duration", () => {
  it("flags img, video and audio without data-duration and passes them with one", async () => {
    for (const tag of ["img", "video", "audio"]) {
      expect(
        has(await codes(`<${tag} src="a" data-start="0"></${tag}>`), "media_missing_duration"),
      ).toBe(true);
      expect(
        has(
          await codes(`<${tag} src="a" data-start="0" data-duration="3"></${tag}>`),
          "media_missing_duration",
        ),
      ).toBe(false);
    }
  });
});

describe("static media", () => {
  it("does not flag a bare img with no timing attributes", async () => {
    expect(has(await codes('<img src="bg.svg" alt="" />'), "media_missing_duration")).toBe(false);
  });
});

describe("caption rules", () => {
  const cap = (extra: string) =>
    `<div data-composition-src="compositions/captions.html" data-start="0" data-duration="5" ${extra}></div>`;
  it("asks a legacy captions host to add data-track-kind, and passes an explicit one", async () => {
    const legacy =
      '<div data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="5"></div>';
    expect(has(await codes(legacy), "caption_track_kind_missing")).toBe(true);
    expect(
      has(
        await codes(cap('data-track-kind="captions" data-track-index="5"')),
        "caption_track_kind_missing",
      ),
    ).toBe(false);
  });
  it("flags captions on two lanes and passes captions sharing one lane", async () => {
    const two =
      cap('data-track-kind="captions" data-track-index="5"') +
      cap('data-track-kind="captions" data-track-index="6"');
    const one =
      cap('data-track-kind="captions" data-track-index="5"') +
      cap('data-track-kind="captions" data-track-index="5"');
    expect(has(await codes(two), "multiple_caption_tracks")).toBe(true);
    expect(has(await codes(one), "multiple_caption_tracks")).toBe(false);
  });
  it("does not count a caption row without a lane as a second track", async () => {
    const mixed =
      cap('data-track-kind="captions" data-track-index="5"') + cap('data-track-kind="captions"');
    expect(has(await codes(mixed), "multiple_caption_tracks")).toBe(false);
  });
});
