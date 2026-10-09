import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findStartTags,
  injectScriptsAtHeadStart,
  injectScriptsIntoHtml,
  injectTagsAtHeadStart,
  insertBeforeCloseTag,
  hasCompositionOutsideTemplates,
  isFullHtmlDocument,
  parseHTMLContent,
  stripEmbeddedRuntimeScripts,
} from "./htmlDocument.js";

type Cost = (self: string, args: unknown[], result: unknown) => number;
const untilFound: Cost = (self, [, from], result) =>
  Math.max(0, (result === -1 ? self.length : Number(result)) - Number(from ?? 0));
const STRING_COSTS: Record<string, Cost> = {
  indexOf: untilFound,
  lastIndexOf: (self) => self.length,
  includes: (self) => self.length,
  startsWith: (_, [search]) => String(search).length,
  charAt: () => 1,
  replace: (self) => self.length,
  toLowerCase: (self) => self.length,
};

/**
 * Characters the scanner's string calls and regex searches examine during `run`: its work, counted
 * instead of timed. Blind to bracket reads, `for..of` and spreads over a string.
 */
function scannedChars(run: () => void): number {
  const proto = String.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const originals = Object.keys(STRING_COSTS).map((name) => [name, proto[name]!] as const);
  const exec = RegExp.prototype.exec;
  let chars = 0;
  for (const [name, original] of originals) {
    proto[name] = function (this: string, ...args: unknown[]) {
      const result = original.apply(this, args);
      chars += STRING_COSTS[name]!(this, args, result);
      return result;
    };
  }
  RegExp.prototype.exec = function (this: RegExp, input: string) {
    const from = this.global || this.sticky ? this.lastIndex : 0;
    const found = exec.call(this, input);
    chars += Math.max(0, (found ? found.index + found[0].length : String(input).length) - from);
    return found;
  };
  try {
    run();
  } finally {
    for (const [name, original] of originals) proto[name] = original;
    RegExp.prototype.exec = exec;
  }
  return chars;
}

/** How much more work an input twice as long takes: about 2 when linear, about 4 when quadratic. */
const workGrowth = (scan: (n: number) => void) =>
  scannedChars(() => scan(20_000)) / scannedChars(() => scan(10_000));

describe("htmlDocument helpers", () => {
  it("strips runtimes from large mixed-case base64 HTML within a bounded heap", () => {
    const moduleUrl = pathToFileURL(resolve(__dirname, "htmlDocument.ts")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=256",
        "--import=tsx",
        "--input-type=module",
        "--eval",
        `
          import { strict as assert } from "node:assert";
          import { stripEmbeddedRuntimeScripts } from ${JSON.stringify(moduleUrl)};
          const media = '<img src="data:image/png;base64,' + 'Aa0/'.repeat(8 * 1024 * 1024) + '">';
          const runtime = '<SCRIPT src="HYPERFRAME.RUNTIME.IIFE.JS"></SCRIPT>';
          assert.equal(stripEmbeddedRuntimeScripts(media + runtime), media);
          console.log("large HTML preserved; runtime removed");
        `,
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("large HTML preserved; runtime removed");
  }, 65_000);

  it.each([
    { first: "a", oldSpace: 96 },
    { first: "A", oldSpace: 128 },
  ])(
    "preserves a large authored script starting with $first within $oldSpace MiB old-space",
    ({ first, oldSpace }) => {
      const moduleUrl = pathToFileURL(resolve(__dirname, "htmlDocument.ts")).href;
      const result = spawnSync(
        process.execPath,
        [
          `--max-old-space-size=${oldSpace}`,
          "--max-semi-space-size=4",
          "--import=tsx",
          "--input-type=module",
          "--eval",
          `
        import { strict as assert } from "node:assert";
        import { stripEmbeddedRuntimeScripts } from ${JSON.stringify(moduleUrl)};
        const data = ${JSON.stringify(first)} + "a".repeat(48 * 1024 * 1024 - 1);
        const html = '<!doctype html><html><head></head><body><script>const embeddeddata="' + data + '";</script></body></html>';
        assert.ok(stripEmbeddedRuntimeScripts(html) === html);
        assert.equal(data.length, 48 * 1024 * 1024);
        console.log("authored script preserved");
      `,
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("authored script preserved");
    },
    65_000,
  );

  it("keeps a document's <html> attributes when a comment comes before the doctype", () => {
    const doc = parseHTMLContent(
      '<!-- hyperframes-registry-item: blk -->\n<!doctype html>\n<html lang="en" data-composition-variables="[]"><body></body></html>',
    );
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.documentElement.hasAttribute("data-composition-variables")).toBe(true);
  });

  it("tells a document from a fragment past leading comments", () => {
    expect(isFullHtmlDocument("<!-- marker -->\n<!doctype html><html></html>")).toBe(true);
    expect(isFullHtmlDocument("<!-- a --><!-- b --><html lang='en'></html>")).toBe(true);
    expect(isFullHtmlDocument("<!-- marker --><div data-composition-id='x'></div>")).toBe(false);
    expect(isFullHtmlDocument("<!--><div></div><!-- --><html></html>")).toBe(false);
    expect(isFullHtmlDocument("<html-card></html-card>")).toBe(false);
    expect(isFullHtmlDocument("<!DOCTYPEhtml><html/ lang='en'></html>")).toBe(true);
  });

  it("wraps fragments before parsing", () => {
    const doc = parseHTMLContent("<template><span>hello</span></template>");
    expect(doc.body.querySelector("template")?.innerHTML).toContain("<span>hello</span>");
  });

  it("strips every known embedded HyperFrames runtime marker", () => {
    const html = `
<script src="hyperframe.runtime.iife.js"></script>
<script src="hyperframes-runtime.modular.inline.js"></script >
<script src="hyperframe-runtime.modular-runtime.inline.js"></script>
<script data-hyperframes-preview-runtime="1"></script>
<script>window.__playerReady = true;</script >
<script>window.__renderReady = false;</script>
<script>window.authored = true;</script>`;

    const stripped = stripEmbeddedRuntimeScripts(html);

    expect(stripped).not.toContain("hyperframe.runtime.iife.js");
    expect(stripped).not.toContain("hyperframes-runtime.modular.inline.js");
    expect(stripped).not.toContain("hyperframe-runtime.modular-runtime.inline.js");
    expect(stripped).not.toContain("data-hyperframes-preview-runtime");
    expect(stripped).not.toContain("window.__playerReady");
    expect(stripped).not.toContain("window.__renderReady");
    expect(stripped).toContain("window.authored = true");
  });

  it("keeps authored scripts that reference runtime readiness flags", () => {
    const html = `
<script>
  window.__timelines = window.__timelines || {};
  if (window.__renderReady) window.authoredReadySeen = true;
  window.__timelines["main"] = {};
</script>`;

    const stripped = stripEmbeddedRuntimeScripts(html);

    expect(stripped).toContain('window.__timelines["main"]');
    expect(stripped).toContain("window.__renderReady");
  });

  it.each([
    ["reads the runtime global", "if (window.__hyperframeRuntime) window.seen = 1;"],
    [
      "queries the bootstrap attribute",
      'document.querySelector("[data-hyperframes-preview-runtime]");',
    ],
    ["names a runtime file", 'console.log("hyperframe.runtime.iife.js");'],
    ["sets up window.__player", "window.__player = window.__player || {};"],
  ])("keeps an authored script that %s", (_, source) => {
    const html = `<script>${source}</script>`;
    expect(stripEmbeddedRuntimeScripts(html)).toBe(html);
  });

  it("strips a runtime file linked with a query string or uppercase name", () => {
    const html = '<script src="/static/HYPERFRAME.RUNTIME.IIFE.JS?v=2"></script><p>kept</p>';
    expect(stripEmbeddedRuntimeScripts(html)).toBe("<p>kept</p>");
  });

  it("does not treat non-script tags as scripts when stripping runtimes", () => {
    const html = "<scripture>window.__playerReady = true;</scripture>";

    expect(stripEmbeddedRuntimeScripts(html)).toBe(html);
  });

  const injectedTag = (code: string) =>
    `<script>${code}\n//# sourceURL=hyperframes://injected/0</script>`;

  it("injects head and body scripts without replacement-token interpolation", () => {
    const html = "<html><head></head><body></body></html>";
    const injected = injectScriptsIntoHtml(html, ["window.x = '$&';"], ["window.y = '$&';"]);

    expect(injected).toContain(`${injectedTag("window.x = '$&';")}\n</head>`);
    expect(injected).toContain(`${injectedTag("window.y = '$&';")}\n</body>`);
  });

  it("injects early head scripts before authored head scripts", () => {
    const html = '<html><head><script id="authored"></script></head><body></body></html>';
    const injected = injectScriptsAtHeadStart(html, ["window.early = true;"]);

    expect(injected.indexOf("window.early = true")).toBeLessThan(injected.indexOf('id="authored"'));
  });

  it("escapes inline scripts so authored script text cannot break out of the wrapper tag", () => {
    const html = "<html><head></head><body></body></html>";
    const injected = injectScriptsIntoHtml(
      html,
      ['window.payload = "</script ><script>window.pwned = true;</script>";'],
      ["window.comment = '<!-- kept as script text';"],
    );

    expect(injected).toContain("<\\/script ><script>window.pwned = true;<\\/script>");
    expect(injected).toContain("\\x3C!-- kept as script text");
    expect(injected).not.toContain("</script ><script>window.pwned = true;");
  });

  it("injects at the document's own </head> and </body>, not at those strings inside script, style or comment text", () => {
    const vendor = 'w.print("<head>"),w.print("</head>"),w.print("<body>"),w.print("</body>")';
    const html = `<html><head><script>${vendor}</script><style>a::after{content:"</head>"}</style><!-- </body> --></HEAD ><body><script>${vendor}</script></body></html>`;
    const injected = injectScriptsIntoHtml(html, ["window.h = 1;"], ["window.b = 1;"]);

    expect(injected.split(`<script>${vendor}</script>`)).toHaveLength(3);
    expect(injected).toContain(`${injectedTag("window.h = 1;")}\n</HEAD >`);
    expect(injected).toContain(`${injectedTag("window.b = 1;")}\n</body></html>`);
  });

  it("falls back to the document's own <body> when </head> is omitted", () => {
    const vendor = 'w.print("<head>"),w.print("<body>")';
    const html = `<html><head><script>${vendor}</script><body><p>x</p></body></html>`;
    const injected = injectScriptsIntoHtml(html, ["window.h = 1;"], []);

    expect(injected).toContain(`<script>${vendor}</script>${injectedTag("window.h = 1;")}\n<body>`);
  });

  it("injects at head start past a script that prints <head>, and before <body> without a head", () => {
    const vendor = 'w.print("<head>"),w.print("<body>")';
    const noHead = `<html><body><script>${vendor}</script></body></html>`;

    expect(injectTagsAtHeadStart(noHead, "<meta x>")).toBe(`<html><meta x>\n${noHead.slice(6)}`);
  });

  it("skips title text and an empty comment", () => {
    const html = "<html><head><title>Intro to <script></title><!--></head><body></body></html>";

    expect(insertBeforeCloseTag(html, "head", "X")).toBe(
      "<html><head><title>Intro to <script></title><!-->X</head><body></body></html>",
    );
  });

  it("keeps indexes right after a character that lowercases to two (İ)", () => {
    const page = "<html><head><title>İzmir</title></head><body><h1>İstanbul</h1></body></html>";
    const injected = injectScriptsIntoHtml(page, ["a=1"], ["b=2"]);
    expect(injected).toContain(`${injectedTag("a=1")}\n</head>`);
    expect(injected).toContain(`${injectedTag("b=2")}\n</body></html>`);

    const stripped = stripEmbeddedRuntimeScripts(
      '<p>İİ</p><script src="hyperframe.runtime.iife.js"></script><p>kept</p>',
    );
    expect(stripped).toBe("<p>İİ</p><p>kept</p>");

    const escaped = injectScriptsIntoHtml(page, ['x="İİ</SCRIPT>"'], []);
    expect(escaped).toContain(injectedTag('x="İİ<\\/SCRIPT>"'));
  });

  it("skips a script tag written inside an attribute value", () => {
    const html =
      '<html><head><meta content="<script>"></head><body><script>a</script></body></html>';

    expect(insertBeforeCloseTag(html, "head", "X")).toBe(
      '<html><head><meta content="<script>">X</head><body><script>a</script></body></html>',
    );
  });

  it("reads past stray quotes, a self-closing SVG title and a look-alike close tag", () => {
    expect(insertBeforeCloseTag("<body><img alt=it's><p>hi</p></body>", "body", "X")).toBe(
      "<body><img alt=it's><p>hi</p>X</body>",
    );
    expect(insertBeforeCloseTag("<body><svg><title/></svg></body>", "body", "X")).toBe(
      "<body><svg><title/></svg>X</body>",
    );
    const lookAlike = '<head><script>x="</scripts>";y="</head>"</script></head><body></body>';
    expect(insertBeforeCloseTag(lookAlike, "head", "X")).toBe(
      '<head><script>x="</scripts>";y="</head>"</script>X</head><body></body>',
    );
  });

  it("treats a quote as a value only after =, like the browser", () => {
    const page = "<html><head><meta name=it's></head><body><p>don't</p></body></html>";
    expect(injectScriptsIntoHtml(page, ["H"], [])).toContain(
      `<meta name=it's>${injectedTag("H")}\n</head>`,
    );

    for (const meta of [
      '<meta content=a=" x>',
      '<meta b="c"="d>',
      '<meta ="x>',
      '<meta="b>',
      '<meta b/="x>',
      '</ a="x>',
    ]) {
      const odd = `<html><head>${meta}</head><body class="y"></body></html>`;
      expect(insertBeforeCloseTag(odd, "head", "X")).toBe(odd.replace("</head>", "X</head>"));
    }

    const headAttr = "<html><head data-x=it's></head><body>it's</body></html>";
    expect(injectTagsAtHeadStart(headAttr, "T")).toBe(
      "<html><head data-x=it's>\nT</head><body>it's</body></html>",
    );
  });

  it("puts markup before the outer </template>, past a nested one and a commented one", () => {
    const sub =
      "<template id=t><div><template><i></i></template></div></template>\n<!-- </template> -->";
    expect(insertBeforeCloseTag(sub, "template", "X")).toBe(
      "<template id=t><div><template><i></i></template></div>X</template>\n<!-- </template> -->",
    );
  });

  it("ends a comment at --!>, but not on its own opening dashes", () => {
    expect(insertBeforeCloseTag("<head><!-- a --!></head>", "head", "X")).toBe(
      "<head><!-- a --!>X</head>",
    );
    expect(insertBeforeCloseTag("<head><!--!></head>-->", "head", "X")).toBeNull();
    expect(insertBeforeCloseTag("<head><!---></head>", "head", "X")).toBe("<head><!--->X</head>");
  });

  it("stays linear over many unclosed raw-text tags and an unfinished quoted attribute", () => {
    const many = (n: number) => `<body>${"<script/>".repeat(n)}</body>`;
    const unfinished = (n: number) => `<body>${'<p data-if="a>b" '.repeat(n)}`;
    expect(insertBeforeCloseTag(many(3), "body", "X")).toBe(many(3).replace("</body>", "X</body>"));
    expect(insertBeforeCloseTag(unfinished(3), "body", "X")).toBeNull();
    expect(workGrowth((n) => insertBeforeCloseTag(many(n), "body", "X"))).toBeLessThan(2.5);
    expect(workGrowth((n) => insertBeforeCloseTag(unfinished(n), "body", "X"))).toBeLessThan(2.5);
  });

  it("finds no head end past an unclosed script", () => {
    expect(insertBeforeCloseTag("<html><head><script>a</head>", "head", "X")).toBeNull();
  });

  it("finds no close tag in a fragment", () => {
    expect(insertBeforeCloseTag('<div><script>"</head>"</script></div>', "head", "x")).toBeNull();
  });
});

describe("findStartTags", () => {
  it("preserves Unicode offsets and mixed-case tags across chunk boundaries", () => {
    const prefix = "Aİ" + "a".repeat(65_533) + "😀İ";
    const html = prefix + "<ImG src=x>" + "A".repeat(65_524) + "<IMG src=y>";
    expect(findStartTags(html, "iMg")).toEqual([65_538, 131_073]);
    expect(
      stripEmbeddedRuntimeScripts(prefix + '<SCRIPT src="HYPERFRAME.RUNTIME.IIFE.JS"></SCRIPT>'),
    ).toBe(prefix);
  });

  const at = (html: string, name: string) =>
    findStartTags(html, name).map((i) => html.slice(i, html.indexOf(">", i) + 1));

  it("finds each start tag in any case, and none in comments, raw text or longer names", () => {
    const html =
      '<!-- <img a> --><script>"<img b>"</script><textarea><img c></textarea>' +
      '<img-card></img-card><IMG src=d><img\nsrc=e><div title="<img f>"></div>';
    expect(at(html, "img")).toEqual(["<IMG src=d>", "<img\nsrc=e>"]);
  });

  it("leaves out template content, nested templates included", () => {
    const html =
      "<img a><template><img b><template><img c></template><img d></template>" +
      '<div data-start="5"><template><img e></template><img f></div>';
    expect(at(html, "img")).toEqual(["<img a>", "<img f>"]);
    expect(at(html, "template")).toEqual(["<template>", "<template>"]);
  });
});

describe("injectTagsAtHeadStart on long adversarial input", () => {
  it.each<[string, (n: number) => string]>([
    ["an unclosed double quote", (n) => `<html data-x="${"a".repeat(n)}`],
    ["an unclosed single quote", (n) => `<html data-x='${"a".repeat(n)}`],
    ["many quoted values", (n) => `<html ${'"a" '.repeat(n / 4)}`],
    ["many <", (n) => "<".repeat(n)],
    ["many <html>", (n) => "<html>".repeat(n / 6)],
    ["many comments", (n) => `${"<!--x-->".repeat(n / 8)}<head>`],
    ["an unclosed comment", (n) => `<!--${"a".repeat(n)}`],
    ["an unclosed comment of <", (n) => `<!--${"<".repeat(n)}`],
    ["an unclosed comment of quotes", (n) => `<!--${'"'.repeat(n)}`],
    ["alternating quotes", (n) => `<html ${`"'`.repeat(n / 2)}`],
    ["leading spaces", (n) => `${" ".repeat(n)}x`],
    ["a tag that never closes", (n) => `<html ${"a ".repeat(n / 2)}`],
    ["an unclosed tag name", (n) => `<${"a".repeat(n)}`],
  ])("does linear work on %s", (_, make) => {
    expect(workGrowth((n) => injectTagsAtHeadStart(make(n), "<meta>"))).toBeLessThan(2.5);
  });
});

describe("hasCompositionOutsideTemplates", () => {
  it.each([
    ["a root in <body>", '<body><div data-composition-id="main"></div></body>', true],
    [
      "a root in <body> beside an inline template",
      '<body><div data-composition-id="main"></div><template><div data-composition-id="x"></div></template></body>',
      true,
    ],
    [
      "a full document whose composition is in its template",
      '<html><body><template id="s-template"><div data-composition-id="s"></div></template></body></html>',
      false,
    ],
    ["a bare template", '<template><div data-composition-id="s"></div></template>', false],
    [
      "an id on <html> and on the <template> tag itself",
      '<html data-composition-id="s"><body><template data-composition-id="s"><div></div></template></body></html>',
      false,
    ],
    [
      "a root id on <html> beside a template with no composition",
      '<html data-composition-id="main"><body><template><p>clone me</p></template></body></html>',
      true,
    ],
    [
      "a full document whose <html> carries the id",
      '<html data-composition-id="s"><body data-composition-id="s"><template><div data-composition-id="s"></div></template></body></html>',
      false,
    ],
    [
      "the attribute only in a comment or text",
      '<body><!-- <div data-composition-id="a"> --><p>data-composition-id="b"</p></body>',
      false,
    ],
    [
      "a nested template",
      '<template><template></template><div data-composition-id="s"></div></template>',
      false,
    ],
  ])("%s", (_name, html, expected) => {
    expect(hasCompositionOutsideTemplates(html)).toBe(expected);
  });
});
