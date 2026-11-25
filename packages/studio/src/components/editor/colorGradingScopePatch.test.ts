// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  keepKnownColorGradingValues,
  patchMediaColorGradingInHtml,
} from "./colorGradingScopePatch";

describe("patchMediaColorGradingInHtml", () => {
  it.each(['"', "'"])("replaces and removes long grading values quoted with %s", (quote) => {
    const otherQuote = quote === '"' ? "'" : '"';
    for (const value of [
      "",
      "line1\nline2",
      "a".repeat(100_000),
      `data-color-grading=${otherQuote}a`.repeat(10_000),
    ]) {
      const html = `<img alt="kept"\tDATA-COLOR-GRADING=${quote}${value}${quote} />`;
      expect(patchMediaColorGradingInHtml(html, "new")).toEqual({
        html: '<img alt="kept" data-color-grading="new" />',
        count: 1,
      });
      expect(patchMediaColorGradingInHtml(html, null)).toEqual({
        html: '<img alt="kept" />',
        count: 1,
      });
    }
  });

  it("adds color grading to video and image tags only", () => {
    const { html, count } = patchMediaColorGradingInHtml(
      `<div><video id="v"></video><img id="i" /><audio id="a"></audio></div>`,
      `{"preset":"clean-studio"}`,
    );

    expect(count).toBe(2);
    expect(html).toContain(
      `video id="v" data-color-grading="{&quot;preset&quot;:&quot;clean-studio&quot;}"`,
    );
    expect(html).toContain(
      `img id="i" data-color-grading="{&quot;preset&quot;:&quot;clean-studio&quot;}"`,
    );
    expect(html).toContain(`<audio id="a"></audio>`);
  });

  it("replaces existing color grading without touching other attributes", () => {
    const { html, count } = patchMediaColorGradingInHtml(
      `<video muted data-color-grading='old' playsinline></video>`,
      `{"adjust":{"exposure":0.2}}`,
    );

    expect(count).toBe(1);
    expect(html).toBe(
      `<video muted data-color-grading="{&quot;adjust&quot;:{&quot;exposure&quot;:0.2}}" playsinline></video>`,
    );
  });

  it("keeps quoted greater-than characters inside media attributes", () => {
    const { html, count } = patchMediaColorGradingInHtml(
      `<img alt="before > after" src="photo.jpg">`,
      `{"adjust":{"contrast":0.1}}`,
    );

    expect(count).toBe(1);
    expect(html).toBe(
      `<img alt="before > after" src="photo.jpg" data-color-grading="{&quot;adjust&quot;:{&quot;contrast&quot;:0.1}}">`,
    );
  });

  it("removes color grading when value is empty", () => {
    const { html, count } = patchMediaColorGradingInHtml(
      `<video data-color-grading="old"></video><img alt="">`,
      null,
    );

    expect(count).toBe(1);
    expect(html).toBe(`<video></video><img alt="">`);
  });

  it("does not patch media-looking text inside scripts, styles, or comments", () => {
    const { html, count } = patchMediaColorGradingInHtml(
      [
        `<script>const tpl = '<video id="script-video"></video>';</script>`,
        `<style>.icon::before { content: "<img>"; }</style>`,
        `<!-- <img id="commented"> -->`,
        `<video id="real"></video>`,
      ].join(""),
      `{"preset":"clean-studio"}`,
    );

    expect(count).toBe(1);
    expect(html).toContain(`<script>const tpl = '<video id="script-video"></video>';</script>`);
    expect(html).toContain(`<style>.icon::before { content: "<img>"; }</style>`);
    expect(html).toContain(`<!-- <img id="commented"> -->`);
    expect(html).toContain(
      `<video id="real" data-color-grading="{&quot;preset&quot;:&quot;clean-studio&quot;}"></video>`,
    );
  });
});

function readTag(html: string): { names: string[]; grading: string | null } {
  const element = new DOMParser().parseFromString(html, "text/html").querySelector("video");
  if (!element) throw new Error(`no video in ${html}`);
  return {
    names: element.getAttributeNames(),
    grading: element.getAttribute("data-color-grading"),
  };
}

describe("patchMediaColorGradingInHtml with replacement patterns in the value", () => {
  const patterns = [
    "$&",
    "$'",
    "$`",
    "$1",
    "$$",
    "$<x>",
    "' data-extra='x' a='",
    '" data-extra="x" a="',
  ];
  it.each(['"', "'"])("writes the value as given into a tag quoted with %s", (quote) => {
    const old = quote === '"' ? "{&quot;preset&quot;:&quot;old&quot;}" : '{"preset":"old"}';
    const before = `<video id="v" data-color-grading=${quote}${old}${quote} muted></video>`;
    for (const pattern of patterns) {
      const value = JSON.stringify({ preset: `a${pattern}b`, lut: { src: `${pattern}.cube` } });
      const { html, count } = patchMediaColorGradingInHtml(before, value);
      expect(count).toBe(1);
      expect(readTag(html)).toEqual({
        names: ["id", "data-color-grading", "muted"],
        grading: value,
      });
    }
  });
});

describe("patchMediaColorGradingInHtml with other ways to write the attribute", () => {
  it.each([
    ["unquoted", "data-color-grading=clean-studio"],
    ["with no value", "data-color-grading"],
    ["with spaces around =", "data-color-grading = 'x'"],
  ])("replaces an attribute written %s", (_, attribute) => {
    const before = `<video ${attribute} src="a.mp4"></video>`;
    const value = '{"preset":"mono-clean"}';
    expect(readTag(patchMediaColorGradingInHtml(before, value).html)).toEqual({
      names: ["data-color-grading", "src"],
      grading: value,
    });
    expect(patchMediaColorGradingInHtml(before, null).html).toBe(`<video src="a.mp4"></video>`);
  });

  it.each([
    [
      "its own unquoted value holding =",
      `<video data-color-grading=a=b src="c">`,
      ["data-color-grading", "src"],
    ],
    [
      "its own unquoted value holding <",
      `<video data-color-grading=a<b src="c">`,
      ["data-color-grading", "src"],
    ],
    [
      "no space after its quoted value",
      `<video data-color-grading="a"src="c">`,
      ["data-color-grading", "src"],
    ],
  ])("finds the attribute past %s", (_, before, names) => {
    const value = '{"preset":"mono-clean"}';
    expect(readTag(patchMediaColorGradingInHtml(before, value).html)).toEqual({
      names,
      grading: value,
    });
    const cleared = readTag(patchMediaColorGradingInHtml(before, null).html);
    expect(cleared).toEqual({
      names: names.filter((name) => name !== "data-color-grading"),
      grading: null,
    });
  });

  it("finds the attribute past an unquoted value holding =", () => {
    const before = `<video src=clip.mp4?t=1 data-color-grading="old">`;
    expect(patchMediaColorGradingInHtml(before, '{"preset":"mono-clean"}').html).toBe(
      `<video src=clip.mp4?t=1 data-color-grading="{&quot;preset&quot;:&quot;mono-clean&quot;}">`,
    );
    expect(patchMediaColorGradingInHtml(before, null).html).toBe(`<video src=clip.mp4?t=1>`);
  });

  it.each([
    [
      "a no-break space, which HTML does not treat as a separator",
      "<img src=x\u00a0data-color-grading>",
    ],
    ["a slash that ends an unquoted value", "<img src=images/>"],
    ["a self-closing slash after a quoted value", '<img src="a.png" />'],
  ])("keeps the source whole past %s", (_, before) => {
    const lastValueEnd =
      before.lastIndexOf(" />") === -1 ? before.length - 1 : before.lastIndexOf(" />");
    const written = ' data-color-grading="{&quot;preset&quot;:&quot;mono-clean&quot;}"';
    expect(patchMediaColorGradingInHtml(before, '{"preset":"mono-clean"}').html).toBe(
      before.slice(0, lastValueEnd) + written + before.slice(lastValueEnd),
    );
    expect(patchMediaColorGradingInHtml(before, null).html).toBe(before);
  });

  it("writes the first of two grading attributes and removes the second", () => {
    const before = `<video data-color-grading="a" src="c" data-color-grading="b">`;
    const value = '{"preset":"mono-clean"}';
    expect(readTag(patchMediaColorGradingInHtml(before, value).html)).toEqual({
      names: ["data-color-grading", "src"],
      grading: value,
    });
    expect(patchMediaColorGradingInHtml(before, null).html).toBe(`<video src="c">`);
  });

  it("leaves the attribute's name alone where it is only text inside another attribute", () => {
    const before = `<video title="no data-color-grading here" data-color-grading='x'></video>`;
    const value = '{"preset":"mono-clean"}';
    expect(readTag(patchMediaColorGradingInHtml(before, value).html)).toEqual({
      names: ["title", "data-color-grading"],
      grading: value,
    });
    expect(patchMediaColorGradingInHtml(before, null).html).toBe(
      `<video title="no data-color-grading here"></video>`,
    );
  });
});

describe("keepKnownColorGradingValues", () => {
  const kept = (grading: Record<string, unknown>) =>
    JSON.parse(keepKnownColorGradingValues(JSON.stringify(grading)) ?? "null");

  it("keeps known presets, variable references, the known color space and loadable LUTs", () => {
    for (const grading of [
      {
        preset: "clean-studio",
        colorSpace: "rec709",
        lut: { src: "luts/film.cube", intensity: 1 },
      },
      { preset: null, lut: { src: "https://cdn.example.com/film.cube", intensity: 0.5 } },
      { preset: "$look", lut: { src: "data:text/plain;base64,AA==", intensity: 1 } },
      { preset: "${look}", lut: { src: "/luts/film.cube", intensity: 1 } },
      { adjust: { exposure: 0.2 }, lut: null },
    ]) {
      expect(kept(grading)).toEqual(grading);
    }
  });

  it("drops an unknown preset, an unknown color space and a LUT the player cannot load", () => {
    expect(
      kept({
        preset: 'x" data-extra="1',
        colorSpace: 'srgb" a="',
        lut: { src: "ftp://example.com/film.cube", intensity: 1 },
        adjust: { exposure: 0.2 },
      }),
    ).toEqual({ adjust: { exposure: 0.2 } });
    expect(kept({ lut: { src: "file:///luts/film.cube", intensity: 1 } })).toEqual({});
    expect(kept({ lut: "luts/film.cube" })).toEqual({});
  });

  it("keeps a bare preset id only when it is known or a variable reference", () => {
    expect(keepKnownColorGradingValues(" clean-studio ")).toBe("clean-studio");
    expect(keepKnownColorGradingValues("$look")).toBe("$look");
    expect(keepKnownColorGradingValues("made-up-look")).toBeNull();
  });

  it("reads nothing but a preset id or a serialized grading object", () => {
    for (const value of ["[]", "null", "{"]) {
      expect(keepKnownColorGradingValues(value)).toBeNull();
    }
  });
});
