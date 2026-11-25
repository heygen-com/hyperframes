import { describe, expect, it } from "vitest";
import {
  countCompositionSrcMounts,
  countTagsWithAttr,
  countedTagNames,
  firstCompositionIdTag,
  hasClosedMediaTag,
  inlineScriptBlocks,
  remoteSrcUrls,
  removeDelimitedRuns,
  removeScriptAndStyleBlocks,
  replaceGsapDistScripts,
  stripCrossoriginAttr,
  stripPreloadNone,
} from "./htmlTagScans.js";

// The regexes each scan replaces, kept here as the reference the scans must agree with.
const reference = {
  inlineScripts: (html: string) =>
    [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({
      attrs: m[1],
      body: m[2],
    })),
  blockComments: (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ""),
  gsap: (html: string) =>
    html.replace(
      /(<script\b[^>]*\bsrc=["'])([^"']*gsap[^"']*\/dist\/([^"']+))(["'][^>]*>)/gi,
      (...parts: string[]) => `[${parts.slice(0, 5).join("|")}]`,
    ),
  crossorigin: (html: string, tag: string) =>
    html.replace(new RegExp(`(<${tag}\\b[^>]*)\\s+crossorigin(?:=["'][^"']*["'])?`, "gi"), "$1"),
  preload: (html: string) =>
    html.replace(/(<(?:video|audio)\b[^>]*?)\s+preload\s*=\s*["']none["']/gi, "$1"),
  remote: {
    media: /<(?:video|audio)\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi,
    source: /<source\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi,
    img: /<img\b[^>]*?(?<![\w-])src\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi,
  },
  scriptAndStyle: (markup: string) => markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ""),
  tagNames: (markup: string) =>
    [
      ...markup.matchAll(
        /<\/([a-zA-Z][-a-zA-Z0-9]*)|<(img|br|hr|input|source|track|area|base|col|embed|link|meta|param|wbr)\b|<([a-zA-Z][-a-zA-Z0-9]*)\b[^>]*\/>/gi,
      ),
    ].map((m) => m[1] ?? m[2] ?? m[3]),
  aroll: (markup: string) =>
    markup.match(/<video\b[^>]*\bdata-aroll=["']true["'][^>]*>/gi)?.length ?? 0,
  heygen: (markup: string) =>
    markup.match(/<video\b[^>]*\bdata-media-source=["']heygen["'][^>]*>/gi)?.length ?? 0,
  subComps: (markup: string) =>
    markup.match(/<[a-zA-Z][-a-zA-Z0-9]*\b[^>]*\bdata-composition-src=["'][^"']*["']/gi)?.length ??
    0,
  rootTag: (html: string) =>
    html.match(/<[a-zA-Z][-a-zA-Z0-9]*\b[^>]*\bdata-composition-id=["'][^"']*["'][^>]*>/i)?.[0],
};

const CASES = 20_000;

const TOKENS = [
  "<",
  ">",
  "/",
  "/>",
  "</",
  '"',
  "'",
  "=",
  " ",
  "  ",
  "\t",
  "\n",
  " ",
  "_",
  "-",
  "x",
  "1",
  "<script",
  "<SCRIPT",
  "</script>",
  "</Script>",
  "<style",
  "</style>",
  "<scr",
  "ipt>",
  "<video",
  "<VIDEO",
  "<audio",
  "<img",
  "<source",
  "<div",
  "<a_b",
  "<x-",
  "<br",
  "<col",
  "<circle",
  "src",
  "src=",
  " src=",
  "data-src=",
  "SRC = ",
  "crossorigin",
  " crossorigin",
  "=anonymous",
  " preload",
  "preload = ",
  "none",
  "http://",
  "https://",
  "gsap",
  "/dist/",
  "dist/",
  ".js",
  "data-composition-id=",
  " data-composition-id=",
  "data-composition-src=",
  "data-aroll=",
  "true",
  " data-media-source=",
  "heygen",
  "/*",
  "*/",
  "MOUNT{",
  "}MOUNT",
];

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smaller alphabets per scan, so most inputs come close to a match and many do match.
const FOCUSED = {
  scripts: [
    "<script",
    "<STYLE",
    "<style",
    "</script>",
    "</style>",
    "</STYLE>",
    ">",
    " ",
    "x",
    "<",
    "/*",
    "*/",
  ],
  gsap: [
    "<script",
    "<script ",
    ' src="',
    " src='",
    "-src='",
    "gsap",
    "/dist/",
    "gsap/dist/x.js",
    '"gsap/dist/',
    "GSAP/DIST/a",
    '"',
    "'",
    ">",
    "x",
    " ",
    "<",
    "/",
  ],
  attrs: [
    "<video",
    "<img",
    "<audio",
    " ",
    "  ",
    "\t",
    " crossorigin",
    ' crossorigin="a"',
    " CROSSORIGIN='x'",
    "crossorigin",
    "=",
    '"',
    "'",
    "x",
    ">",
    "<",
    ' preload="none"',
    " preload = 'NONE'",
    " preload=none",
    ' preload="no',
    "preload",
  ],
  remote: [
    "<video",
    "<audio",
    "<source",
    "<img",
    " ",
    ' src="http://a',
    " src='https://b",
    ' data-src="http://c',
    " -src='http://",
    ' src = "https://',
    ' src="',
    '"',
    "'",
    "x",
    ">",
    "<",
    "http://",
  ],
  telemetry: [
    "<video",
    "<video ",
    "<a",
    "<a ",
    "<a_b",
    "<x-",
    "<a1",
    " ",
    ' data-aroll="true"',
    " data-aroll='true",
    "data-aroll=",
    ' data-media-source="heygen"',
    " data-media-source='heygen",
    '"',
    "'",
    ">",
    "/>",
    "<",
    ' data-composition-src="',
    " data-composition-src='a'",
    ' data-composition-id="',
    "data-composition-id='r'",
    "x",
    "-",
    "</",
    "_",
    "<script",
    "</script>",
    "<style",
    "</style>",
  ],
};

function* randomInputs(seed: number, count: number, tokens = TOKENS): Generator<string> {
  const random = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const length = 1 + Math.floor(random() * 40);
    let text = "";
    for (let j = 0; j < length; j++) text += tokens[Math.floor(random() * tokens.length)];
    yield text;
  }
}

const both = (seed: number, focused: readonly string[]) => [
  ...randomInputs(seed, CASES),
  ...randomInputs(seed + 100, CASES, focused),
];

// Each case runs tens of thousands of inputs through the old regexes too, which takes seconds on a CI runner.
describe("htmlTagScans agree with the regexes they replace", { timeout: 60_000 }, () => {
  it("inline script blocks", () => {
    for (const html of both(1, FOCUSED.scripts)) {
      expect([...inlineScriptBlocks(html)], html).toEqual(reference.inlineScripts(html));
    }
  });

  it("delimited runs", () => {
    for (const text of both(2, FOCUSED.scripts)) {
      expect(removeDelimitedRuns(text, "/*", "*/"), text).toBe(reference.blockComments(text));
      expect(removeDelimitedRuns(text, "MOUNT{", "}MOUNT"), text).toBe(
        text.replace(/MOUNT\{[\s\S]*?\}MOUNT/g, ""),
      );
    }
  });

  it("gsap dist script rewrite", () => {
    for (const html of both(3, FOCUSED.gsap)) {
      const ours = replaceGsapDistScripts(html, (...parts) => `[${parts.join("|")}]`);
      expect(ours, html).toBe(reference.gsap(html));
    }
  });

  it("crossorigin and preload strips", () => {
    for (const html of both(4, FOCUSED.attrs)) {
      for (const tag of ["video", "img", "audio"] as const) {
        expect(stripCrossoriginAttr(html, tag), html).toBe(reference.crossorigin(html, tag));
      }
      expect(stripPreloadNone(html), html).toBe(reference.preload(html));
    }
  });

  it("closed media tag test", () => {
    for (const text of both(7, FOCUSED.attrs)) {
      expect(hasClosedMediaTag(text), text).toBe(/<(?:video|audio)\b[^>]*>/i.test(text));
    }
  });

  it("remote src urls", () => {
    for (const html of both(5, FOCUSED.remote)) {
      for (const tag of ["media", "source", "img"] as const) {
        const expected = [...html.matchAll(reference.remote[tag])].map((m) => m[1]);
        expect(remoteSrcUrls(html, tag), html).toEqual(expected);
      }
    }
  });

  it("script and style removal, tag names and attribute counts", () => {
    for (const markup of both(6, FOCUSED.telemetry)) {
      expect(removeScriptAndStyleBlocks(markup), markup).toBe(reference.scriptAndStyle(markup));
      expect([...countedTagNames(markup)], markup).toEqual(reference.tagNames(markup));
      expect(countTagsWithAttr(markup, "video", `\\bdata-aroll=["']true["']`), markup).toBe(
        reference.aroll(markup),
      );
      expect(
        countTagsWithAttr(markup, "video", `\\bdata-media-source=["']heygen["']`),
        markup,
      ).toBe(reference.heygen(markup));
      expect(countCompositionSrcMounts(markup), markup).toBe(reference.subComps(markup));
      expect(firstCompositionIdTag(markup), markup).toBe(reference.rootTag(markup));
    }
  });
});

const BUDGET_MS = 400;

function elapsedMs(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

// About 1 MB each: openers that never close, and one tag whose whitespace never reaches the attribute.
const hostile = (opener: string) => opener.repeat(Math.ceil(1_000_000 / opener.length));
const longGap = (tag: string, tail: string) => `${tag}${" ".repeat(1_000_000)}${tail}`;

describe("htmlTagScans run in linear time", () => {
  const scans: Array<[string, (html: string) => unknown, string[]]> = [
    ["inline scripts", (h) => [...inlineScriptBlocks(h)], ["<script ", "<script>"]],
    ["block comments", (h) => removeDelimitedRuns(h, "/*", "*/"), ["/*"]],
    [
      "gsap rewrite",
      (h) => replaceGsapDistScripts(h, (full) => full),
      ["<script ", '<script src="gsap/dist/x ', "<script src='a'>"],
    ],
    ["crossorigin", (h) => stripCrossoriginAttr(h, "video"), ["<video ", "<video crossorigin "]],
    ["preload", stripPreloadNone, ["<video ", '<video preload="none" ']],
    ["closed media tag", hasClosedMediaTag, ["<video", "<audio ", "<VIDEO"]],
    ["remote media", (h) => remoteSrcUrls(h, "media"), ["<video ", '<video src="http://a" ']],
    ["remote img", (h) => remoteSrcUrls(h, "img"), ["<img ", "<img src='https://a "]],
    ["script/style removal", removeScriptAndStyleBlocks, ["<script ", "<style>", "<script>"]],
    ["tag names", (h) => [...countedTagNames(h)], ["<a ", "<circle "]],
    ["aroll count", (h) => countTagsWithAttr(h, "video", "\\bdata-aroll"), ["<video "]],
    ["sub-composition count", countCompositionSrcMounts, ["<a ", '<a data-composition-src="']],
    ["root tag", firstCompositionIdTag, ["<a ", '<a data-composition-id="x" ']],
  ];

  for (const [name, scan, openers] of scans) {
    it(`${name}: 1 MB of unclosed openers and one tag with a 1 MB whitespace run`, () => {
      for (const opener of openers)
        expect(elapsedMs(() => scan(hostile(opener)))).toBeLessThan(BUDGET_MS);
      for (const tag of ["<video", "<img", "<script", "<a"]) {
        for (const tail of ["x>", 'crossorigin="a">', "preload", "src=", "/>", ""]) {
          expect(elapsedMs(() => scan(longGap(tag, tail)))).toBeLessThan(BUDGET_MS);
        }
      }
    });
  }
});
