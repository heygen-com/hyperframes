// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { pasteElementHtml, pasteTimelineClips } from "./useClipboard";
import { parseHTMLContent } from "@hyperframes/core/compiler/html-document";
import { prepareCopy, refuseAddedMarkup } from "../utils/clipboardMarkup";

const FILE = `<!doctype html><html><head><style>
#card { color: red; }
</style></head><body><div id="root" data-composition-id="root" data-start="0" data-duration="10">
<div id="card" class="clip" data-start="0" data-duration="2" data-track-index="0">Card</div>
</div></body></html>`;

/** Every handler in `html` as saved and as the preview server serves it: what no paste may add. */
function runningCode(html: string): string[] {
  return [html, parseHTMLContent(html).toString()].flatMap(handlersIn);
}

function handlersIn(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("*")).flatMap((el) =>
    el
      .getAttributeNames()
      .filter((name) => name.toLowerCase().startsWith("on"))
      .map((name) => `${el.localName}[${name}]`),
  );
}

/** The paste's own file, or nothing when it was refused. */
function written(paste: () => string): string {
  try {
    return paste();
  } catch (error) {
    expect(String(error)).toMatch(/Couldn't paste/);
    return FILE;
  }
}

// fails without the fix: a comment that loses its data-hf-id text after the check closes early, and what followed it
// in the comment is written as markup.
describe("markup a paste writes is the markup it checked", () => {
  const SPLIT_COMMENTS = ['"', "'"].flatMap((q) => [
    `<!-- x -- data-hf-id=${q}1${q}><img src=x onerror=f()>`,
    `<body><!-- x -- data-hf-id=${q}1${q}><img src=x onerror=f()></body>`,
    `<html><body><!-- x -- data-hf-id=${q}1${q}><img src=x onerror=f()></body></html>`,
    `<html><head><!-- x -- data-hf-id=${q}1${q}><img src=x onerror=f()></head></html>`,
  ]);

  it.each(SPLIT_COMMENTS)("writes no running code for %s", (html) => {
    const file = written(() =>
      pasteElementHtml(FILE, { html, readFrom: null }, false, "index.html"),
    );
    expect(runningCode(file)).toEqual([]);
  });

  it.each(SPLIT_COMMENTS)("writes no running code for a clip of %s", (html) => {
    const file = written(
      () =>
        pasteTimelineClips(
          FILE,
          [{ html, readFrom: null, start: 0, duration: 1, track: 1 }],
          0,
          [],
          false,
          "index.html",
        ).content,
    );
    expect(runningCode(file)).toEqual([]);
  });
});

// fails without the fix: the look copy found <style> text inside a comment and wrote a rule that closed the comment.
describe("the look a copy carries adds no markup", () => {
  const COMMENTED_STYLE =
    '<div id="card" class="clip" data-start="0" data-duration="2" data-track-index="1">Copy' +
    '<!-- <style>#card{content:"\\2d\\2d\\3e"}</style><img src=x onerror=f()> --></div>';

  it("writes no running code when an element is pasted into its own file", () => {
    const file = written(() =>
      pasteElementHtml(FILE, { html: COMMENTED_STYLE, readFrom: null }, true, "index.html"),
    );
    expect(runningCode(file)).toEqual([]);
  });

  it("writes no running code when a clip is duplicated in its own file", () => {
    const clip = { html: COMMENTED_STYLE, readFrom: null, start: 0, duration: 2, track: 1 };
    const file = written(() => pasteTimelineClips(FILE, [clip], 2, [], true, "index.html").content);
    expect(runningCode(file)).toEqual([]);
  });

  it("still gives a pasted copy its original's look", () => {
    const html =
      '<div id="card" class="clip" data-start="0" data-duration="2" data-track-index="1">Copy</div>';
    const file = pasteElementHtml(FILE, { html, readFrom: "index.html" }, true, "index.html");
    expect(file).toMatch(/#card-2\s*\{\s*color: red;?\s*\}/);
  });
});

describe("prepareCopy", () => {
  it("renames each taken id on the copy's elements and leaves every other attribute as it was", () => {
    const html =
      '<div id="hero" data-composition-id="hero"><p id="hero-2" data-id="hero">x</p><p id="free">y</p></div>';
    const copy = prepareCopy(html, new Set(), new Set(["hero", "hero-2"]));
    expect(copy.root.getAttribute("id")).toBe("hero-3");
    expect(copy.root.getAttribute("data-composition-id")).toBe("hero");
    expect(copy.html).toContain('id="hero-2-2" data-id="hero"');
    expect(copy.html).toContain('id="free"');
    expect([...copy.renames]).toEqual([
      ["hero", "hero-3"],
      ["hero-2", "hero-2-2"],
    ]);
  });
});

// fails without the fix: the check compared attribute names only and ran the allowlist on the copy, not on the file.
describe("the final check reads what the saved file holds", () => {
  const copy = '<a id="go" href="next.html" data-hf-id="hf-go">Go</a>';
  const before = FILE;
  const inserted = (html: string) => before.replace('<div id="card"', `${html}\n<div id="card"`);

  it("refuses a saved copy whose link differs from the copy that was checked", () => {
    const after = inserted('<a id="go" href="javascript:alert(1)" data-hf-id="hf-go">Go</a>');
    expect(() =>
      refuseAddedMarkup(before, after, [{ html: copy, readFrom: null }], "index.html"),
    ).toThrow(/Couldn't paste/);
  });

  it("refuses a changed link even for a copy Studio read from this very file", () => {
    const after = inserted('<a id="go" href="other.html" data-hf-id="hf-go">Go</a>');
    expect(() =>
      refuseAddedMarkup(before, after, [{ html: copy, readFrom: "index.html" }], "index.html"),
    ).toThrow(/Couldn't paste/);
  });

  it("refuses a saved copy whose elements moved to other parents in the same order", () => {
    const nested = '<div id="w"><section id="s"><p id="cap">Caption</p></section></div>';
    const after = inserted('<div id="w"><section id="s"></section><p id="cap">Caption</p></div>');
    expect(() =>
      refuseAddedMarkup(before, after, [{ html: nested, readFrom: "index.html" }], "index.html"),
    ).toThrow(/Couldn't paste/);
  });

  it("accepts the saved copy when it is the copy that was checked", () => {
    expect(() =>
      refuseAddedMarkup(before, inserted(copy), [{ html: copy, readFrom: null }], "index.html"),
    ).not.toThrow();
  });
});

// fails without the fix: the file's ids were read as raw text, so an entity-escaped id never matched the copy's.
it("renames a pasted id the file already holds written with entities", () => {
  const file = FILE.replace('<div id="card"', '<span id="left&amp;right">L</span>\n<div id="card"');
  const pasted = pasteElementHtml(
    file,
    { html: '<span id="left&amp;right">R</span>', readFrom: null },
    false,
    "index.html",
  );
  const ids = Array.from(
    new DOMParser().parseFromString(pasted, "text/html").querySelectorAll("span"),
    (el) => el.id,
  );
  expect(ids.sort()).toEqual(["left&right", "left&right-2"]);
});

// fails without the fix: an svg element named template has no template content, and reading the file's ids threw.
it("pastes into a file holding an svg element named template", () => {
  const file = FILE.replace(
    '<div id="card"',
    '<svg><template id="t"></template></svg>\n<div id="card"',
  );
  const pasted = pasteElementHtml(
    file,
    { html: '<span id="new">N</span>', readFrom: null },
    false,
    "index.html",
  );
  expect(pasted).toContain('<span id="new"');
});

it("pastes a clip whose markup spans lines, indented under the root as written", () => {
  const html =
    '<div id="multi" class="clip" data-start="0" data-duration="1" data-track-index="1">\n  <p title="a\nb">x</p>\n</div>';
  const { content } = pasteTimelineClips(
    FILE,
    [{ html, readFrom: null, start: 0, duration: 1, track: 1 }],
    0,
    [],
    false,
    "index.html",
  );
  expect(content).toContain('id="multi"');
});

// fails without the fix: the check read a comment in an svg <title> as a comment, and the preview server's parser
// ends the title inside it, serving what follows as markup.
describe("a paste is checked as the preview server serves the file", () => {
  const svgClip =
    '<div id="icon" class="clip" data-start="0" data-duration="1" data-track-index="1">' +
    "<svg><title><!-- </title><img src=x onerror=f()> --></title></svg></div>";

  it.each([null, "compositions/recv.html", "index.html"])(
    "as an element read from %s",
    (readFrom) => {
      const file = written(() =>
        pasteElementHtml(FILE, { html: svgClip, readFrom }, false, "index.html"),
      );
      expect(runningCode(file)).toEqual([]);
    },
  );

  it.each([null, "compositions/recv.html", "index.html"])("as a clip read from %s", (readFrom) => {
    const clip = { html: svgClip, readFrom, start: 0, duration: 1, track: 1 };
    const file = written(() => pasteTimelineClips(FILE, [clip], 0, [], true, "index.html").content);
    expect(runningCode(file)).toEqual([]);
  });

  // fails without the fix: a copy's comments, svg <title> ones included, were written into the file.
  it.each([
    svgClip,
    '<div id="note" class="clip" data-start="0" data-duration="1" data-track-index="1">Note<!-- draft --></div>',
    '<div id="tpl" class="clip" data-start="0" data-duration="1" data-track-index="1"><template><!-- x --></template></div>',
  ])("writes no comment from the copy %s", (html) => {
    for (const readFrom of [null, "compositions/recv.html"]) {
      const pasted = pasteElementHtml(FILE, { html, readFrom }, false, "index.html");
      const clip = { html, readFrom, start: 0, duration: 1, track: 1 };
      const placed = pasteTimelineClips(FILE, [clip], 0, [], false, "index.html").content;
      for (const file of [pasted, placed]) {
        expect(file).not.toContain("<!--");
        expect(file).toMatch(/id="(icon|note|tpl)"/);
      }
    }
  });

  it("still pastes an svg whose title is plain text", () => {
    const icon =
      '<svg viewBox="0 0 4 4"><title>Icon &lt;/title&gt;</title><circle r="2"></circle></svg>';
    const file = pasteElementHtml(FILE, { html: icon, readFrom: null }, false, "index.html");
    expect(file).toMatch(/<title [^>]*>Icon &lt;\/title&gt;<\/title><circle /);
  });
});

// fails without the fix: each copy was compared with every element of the file, so a batch paste took seconds.
it("compares each pasted copy with only the elements that could be it", () => {
  const clips = Array.from({ length: 60 }, (_, i) => ({
    html: `<div id="c${i}" class="clip" data-start="0" data-duration="1" data-track-index="1"><span>${i}</span></div>`,
    readFrom: null,
    start: i,
    duration: 1,
    track: 1,
  }));
  const compared = vi.spyOn(Node.prototype, "isEqualNode");
  pasteTimelineClips(FILE, clips, 0, [], false, "index.html");
  expect(compared.mock.calls.length).toBeLessThanOrEqual(clips.length * 2);
  compared.mockRestore();
});

// fails without the fix: a copy kept data-composition-file, and Studio then wrote this element's edits to that file.
describe("a copy from another file cannot choose which file its edits go to", () => {
  const marked = (mark: string) =>
    `<div id="moved" class="clip" data-start="0" data-duration="1" data-track-index="1"><p ${mark}="compositions/b.html">x</p></div>`;
  const MARKS = ["data-composition-file", "data-composition-id", "data-hf-original-composition-id"];

  it.each(MARKS)("refuses a copy carrying %s, as an element or a clip", (mark) => {
    const html = marked(mark);
    const readFrom = "compositions/recv.html";
    expect(() => pasteElementHtml(FILE, { html, readFrom }, false, "index.html")).toThrow(
      /Couldn't paste/,
    );
    const clip = { html, readFrom, start: 0, duration: 1, track: 1 };
    expect(() => pasteTimelineClips(FILE, [clip], 0, [], false, "index.html")).toThrow(
      /Couldn't paste/,
    );
  });

  it.each(MARKS)("keeps %s on a copy pasted into the file it was read from", (mark) => {
    const html = marked(mark);
    const pasted = pasteElementHtml(FILE, { html, readFrom: "index.html" }, true, "index.html");
    expect(pasted).toContain(`${mark}="compositions/b.html"`);
  });
});
