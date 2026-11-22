// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pasteElementHtml, pasteTimelineClips } from "./useClipboard";
import { prepareCopy } from "../utils/clipboardMarkup";

const FILE = `<!doctype html><html><head><style>
#card { color: red; }
</style></head><body><div id="root" data-composition-id="root" data-start="0" data-duration="10">
<div id="card" class="clip" data-start="0" data-duration="2" data-track-index="0">Card</div>
</div></body></html>`;

/** Every element or attribute in `html` that runs code once written: what no paste may add. */
function runningCode(html: string): string[] {
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
