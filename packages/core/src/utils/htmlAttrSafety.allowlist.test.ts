import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { markupOutsideAllowlist } from "./htmlAttrSafety";

/** `html` as a parser reads it with scripting off (what the check sees) or on (what a preview or render runs). jsdom
 * parses with scripting on only under "dangerously"; it loads no resources, so no handler here ever fires. */
const parse = (html: string, scripting: boolean) =>
  new JSDOM(html, scripting ? { runScripts: "dangerously" } : {}).window.document;

const tagsOf = (doc: Document) =>
  Array.from(doc.querySelectorAll("*"), (el) => [
    el.localName,
    ...Array.from(el.attributes, (a) => a.name),
  ]);
const runsCode = (doc: Document) =>
  Array.from(doc.querySelectorAll("*")).some(
    (el) =>
      ["script", "base"].includes(el.localName) ||
      Array.from(el.attributes).some((a) => a.name.toLowerCase().startsWith("on")),
  );

const ALLOWED = [
  '<div id="card" class="clip" data-start="1" data-duration="2" style="left: 4px"><h1>Title</h1></div>',
  '<video id="v" class="clip" src="clip.mp4" muted playsinline data-start="0" data-duration="3"></video>',
  '<div class="clip"><svg viewBox="0 0 10 10"><path d="M0 0L10 10" fill="red"></path></svg></div>',
  '<div class="clip"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"></use></svg></div>',
];

// fails without the fix: each of these passed the old denylist, and the first runs a handler once scripting is on.
// The last three passed the allowlist too: a composition source makes the runtime fetch and run another page.
const REFUSED = [
  '<div class="clip"><noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript></div>',
  '<div class="clip"><style>p{}</style><p>Made</p></div>',
  '<div class="clip"><textarea><img src=x onerror=alert(1)></textarea></div>',
  '<div class="clip"><base href="https://elsewhere.example/"></div>',
  '<div class="clip"><meta http-equiv="refresh" content="0;url=x"></div>',
  '<div class="clip"><link rel="stylesheet" href="https://elsewhere.example/a.css"></div>',
  '<div class="clip"><template><img src=x onerror=alert(1)></template></div>',
  '<div class="clip"><form action="https://elsewhere.example/"><button>Go</button></form></div>',
  '<div class="clip" data-composition-src="https://elsewhere.example/scene.html"></div>',
  '<div class="clip"><div data-composition-src="//elsewhere.example/scene.html"></div></div>',
  '<div class="clip"><template><div data-composition-src="scenes/b.html"></div></template></div>',
];

describe("markupOutsideAllowlist", () => {
  it("passes clip markup that parses to the same inert tree with scripting on as in the check", () => {
    for (const html of ALLOWED) {
      const checked = parse(html, false);
      expect(markupOutsideAllowlist(checked.documentElement)).toEqual([]);
      const run = parse(html, true);
      expect(tagsOf(run)).toEqual(tagsOf(checked));
      expect(runsCode(run)).toBe(false);
    }
  });

  it("refuses markup a scripting parser could read differently, or that loads or points elsewhere", () => {
    for (const html of REFUSED)
      expect(markupOutsideAllowlist(parse(html, false).documentElement), html).not.toEqual([]);
  });

  // fails without the fix: a copy kept the marks Studio reads as its file, so later edits went to that other file.
  it.each(["data-composition-file", "data-composition-id", "data-hf-original-composition-id"])(
    "refuses %s at any depth and inside templates",
    (mark) => {
      for (const html of [
        `<div class="clip" ${mark}="compositions/b.html"></div>`,
        `<div class="clip"><p ${mark}="compositions/b.html">x</p></div>`,
        `<div class="clip"><template><p ${mark}="compositions/b.html">x</p></template></div>`,
      ])
        expect(markupOutsideAllowlist(parse(html, false).documentElement), html).not.toEqual([]);
    },
  );

  it("shows why: a noscript the check reads as inert runs a handler once scripting is on", () => {
    const html = REFUSED[0]!;
    expect(runsCode(parse(html, false))).toBe(false);
    expect(runsCode(parse(html, true))).toBe(true);
  });
});
