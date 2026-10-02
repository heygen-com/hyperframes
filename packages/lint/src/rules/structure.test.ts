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
  "caption_track_kind_missing",
  "multiple_caption_tracks",
  "clip_ends_past_root_duration",
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

describe("legacy data-end", () => {
  it("counts data-end as the clip's length", async () => {
    const found = await codes('<div class="clip" data-start="0" data-end="3">x</div>');
    expect(has(found, "timeline_element_missing_timing")).toBe(false);
  });
});

describe("media length", () => {
  it("takes length from the file or the image default, so data-start alone passes", async () => {
    for (const tag of ["video", "audio", "img"]) {
      const found = await codes(`<${tag} src="a" data-start="0" data-track-index="1"></${tag}>`);
      expect(has(found, "timeline_element_missing_timing")).toBe(false);
    }
  });

  it("does not flag a bare img with no timing attributes", async () => {
    expect(has(await codes('<img src="bg.svg" alt="" />'), "timeline_element_missing_timing")).toBe(
      false,
    );
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

describe("clip_ends_past_root_duration", () => {
  const PAST = "clip_ends_past_root_duration";
  it("names a direct clip that ends past the root, with its end and the root duration", async () => {
    const [finding, ...rest] = await codes(
      '<div id="outro" class="clip" data-start="8" data-duration="4">x</div>',
    );
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ code: PAST, severity: "warning", elementId: "outro" });
    expect(finding?.message).toContain('<div id="outro"> runs from 8s to 12s');
    expect(finding?.message).toContain("data-duration of 10s");
    expect(finding?.fixHint).toBe(
      'Extend the root data-duration to 12, or make <div id="outro"> end at or before 10s.',
    );
  });
  it("passes a clip ending at the root or within the shared tolerance past it", async () => {
    expect(await codes('<div class="clip" data-start="6" data-duration="4">x</div>')).toEqual([]);
    expect(await codes('<div class="clip" data-start="4" data-duration="6.04">x</div>')).toEqual(
      [],
    );
    expect(await codes('<div class="clip" data-start="4" data-duration="6.05">x</div>')).toEqual(
      [],
    );
    const [finding] = await codes('<div class="clip" data-start="4" data-duration="6.06">x</div>');
    expect(finding?.message).toContain("runs from 4s to 10.06s");
  });
  it("reads a legacy data-end, and skips a start that references another clip", async () => {
    const [finding] = await codes('<div class="clip" data-start="8" data-end="12">x</div>');
    expect(finding).toMatchObject({ code: PAST });
    expect(finding?.message).toContain("runs from 8s to 12s");
    expect(
      await codes('<div class="clip" data-start="intro + 2" data-duration="20">x</div>'),
    ).toEqual([]);
  });
  it("judges a sub-composition by its host, not its inner clips", async () => {
    const [finding] = await codes(
      '<div id="scene" data-composition-src="compositions/scene.html" data-start="7" data-duration="5"></div>',
    );
    expect(finding).toMatchObject({ code: PAST, elementId: "scene" });
    expect(finding?.message).toContain("runs from 7s to 12s");
    const inline =
      '<div id="inner" data-composition-id="inner" data-start="0" data-duration="5">' +
      '<div class="clip" data-start="0" data-duration="20">x</div></div>';
    expect(await codes(inline)).toEqual([]);
  });
  it("skips media whose length only the file knows", async () => {
    expect(await codes('<video src="a.mp4" data-start="9"></video>')).toEqual([]);
  });
  it("leaves a root with no data-duration to the missing-duration rules", async () => {
    const html = page('<div class="clip" data-start="8" data-duration="4">x</div>').replace(
      ' data-duration="10"',
      "",
    );
    const { findings } = await lintHyperframeHtml(html);
    expect(findings.filter((f) => f.code === PAST)).toEqual([]);
  });
});
