import { describe, expect, it } from "vitest";
import {
  injectScriptsAtHeadStart,
  injectScriptsIntoHtml,
  injectTagsAtHeadStart,
  insertBeforeCloseTag,
  isFullHtmlDocument,
  parseHTMLContent,
  stripEmbeddedRuntimeScripts,
} from "./htmlDocument.js";

describe("htmlDocument helpers", () => {
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

  it("does not treat non-script tags as scripts when stripping runtimes", () => {
    const html = "<scripture>window.__playerReady = true;</scripture>";

    expect(stripEmbeddedRuntimeScripts(html)).toBe(html);
  });

  it("injects head and body scripts without replacement-token interpolation", () => {
    const html = "<html><head></head><body></body></html>";
    const injected = injectScriptsIntoHtml(html, ["window.x = '$&';"], ["window.y = '$&';"]);

    expect(injected).toContain("<script>window.x = '$&';</script>\n</head>");
    expect(injected).toContain("<script>window.y = '$&';</script>\n</body>");
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
    expect(injected).toContain("<\\!-- kept as script text");
    expect(injected).not.toContain("</script ><script>window.pwned = true;");
  });

  it("injects at the document's own </head> and </body>, not at those strings inside script, style or comment text", () => {
    const vendor = 'w.print("<head>"),w.print("</head>"),w.print("<body>"),w.print("</body>")';
    const html = `<html><head><script>${vendor}</script><style>a::after{content:"</head>"}</style><!-- </body> --></HEAD ><body><script>${vendor}</script></body></html>`;
    const injected = injectScriptsIntoHtml(html, ["window.h = 1;"], ["window.b = 1;"]);

    expect(injected.split(`<script>${vendor}</script>`)).toHaveLength(3);
    expect(injected).toContain("<script>window.h = 1;</script>\n</HEAD >");
    expect(injected).toContain("<script>window.b = 1;</script>\n</body></html>");
  });

  it("falls back to the document's own <body> when </head> is omitted", () => {
    const vendor = 'w.print("<head>"),w.print("<body>")';
    const html = `<html><head><script>${vendor}</script><body><p>x</p></body></html>`;
    const injected = injectScriptsIntoHtml(html, ["window.h = 1;"], []);

    expect(injected).toContain(`<script>${vendor}</script><script>window.h = 1;</script>\n<body>`);
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
    expect(injected).toContain("<script>a=1</script>\n</head>");
    expect(injected).toContain("<script>b=2</script>\n</body></html>");

    const stripped = stripEmbeddedRuntimeScripts(
      '<p>İİ</p><script src="hyperframe.runtime.iife.js"></script><p>kept</p>',
    );
    expect(stripped).toBe("<p>İİ</p><p>kept</p>");

    const escaped = injectScriptsIntoHtml(page, ['x="İİ</SCRIPT>"'], []);
    expect(escaped).toContain('<script>x="İİ<\\/script>"</script>');
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
      "<meta name=it's><script>H</script>\n</head>",
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

  it("ends a comment at --!>, but not on its own opening dashes", () => {
    expect(insertBeforeCloseTag("<head><!-- a --!></head>", "head", "X")).toBe(
      "<head><!-- a --!>X</head>",
    );
    expect(insertBeforeCloseTag("<head><!--!></head>-->", "head", "X")).toBeNull();
    expect(insertBeforeCloseTag("<head><!---></head>", "head", "X")).toBe("<head><!--->X</head>");
  });

  it("stays linear over many unclosed raw-text tags and an unfinished quoted attribute", () => {
    const many = `<body>${"<script/>".repeat(40_000)}</body>`;
    const unfinished = `<body>${'<p data-if="a>b" '.repeat(20_000)}`;
    const started = performance.now();
    expect(insertBeforeCloseTag(many, "body", "X")).toBe(many.replace("</body>", "X</body>"));
    expect(insertBeforeCloseTag(unfinished, "body", "X")).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("finds no head end past an unclosed script", () => {
    expect(insertBeforeCloseTag("<html><head><script>a</head>", "head", "X")).toBeNull();
  });

  it("finds no close tag in a fragment", () => {
    expect(insertBeforeCloseTag('<div><script>"</head>"</script></div>', "head", "x")).toBeNull();
  });
});
