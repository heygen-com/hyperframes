import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { isRichTextFormattingTag, sanitizeRichTextChildren } from "./richTextSanitize";

function parseWithLinkedom(html: string): Element {
  const { document: doc } = parseHTML(
    `<!DOCTYPE html><html><body><div id="test-host">${html}</div></body></html>`,
  );
  const host = doc.getElementById("test-host");
  if (!host) throw new Error("test host was not parsed");
  return host as unknown as Element;
}

// Both DOM implementations, every case. The contract must not depend on which
// parser constructs the inert tree at a trust boundary.
const PARSERS: Array<[string, (html: string) => Element]> = [
  [
    "jsdom",
    (html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      return host;
    },
  ],
  ["linkedom", parseWithLinkedom],
];

function clean(html: string, parse: (html: string) => Element): string {
  const host = parse(html);
  sanitizeRichTextChildren(host);
  return host.innerHTML;
}

describe.each(PARSERS)("sanitizeRichTextChildren (%s)", (_name, parse) => {
  it("keeps a styled span, which is the whole point", () => {
    expect(clean('<span style="color: red">hi</span>', parse)).toBe(
      '<span style="color: red">hi</span>',
    );
  });

  it("keeps plain text untouched", () => {
    expect(clean("just words", parse)).toBe("just words");
  });

  it("keeps nested formatting and its nesting", () => {
    expect(clean('<b><span style="color: red">x</span></b>', parse)).toBe(
      '<b><span style="color: red">x</span></b>',
    );
  });

  it("keeps a line break", () => {
    expect(clean("a<br>b", parse)).toContain("<br>");
  });

  it("removes a script and does not leave its source as visible text", () => {
    const out = clean("<script>alert(1)</script>keep", parse);
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
    expect(out).toContain("keep");
  });

  it("strips an event handler from a tag it otherwise keeps", () => {
    const out = clean('<span onclick="steal()" style="color: red">x</span>', parse);
    expect(out).not.toContain("onclick");
    expect(out).toContain("color: red");
  });

  it("strips every attribute that is neither style nor an identity", () => {
    const out = clean('<span id="a" class="b" data-x="c" style="color: red">x</span>', parse);
    expect(out).not.toContain("id=");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("data-x");
    expect(out).toContain("color: red");
  });

  // The design panel tracks each text layer by this. Stripping it left the
  // panel unable to match a layer to its source after any inline style edit.
  it("keeps the attributes a text layer is tracked by", () => {
    const out = clean(
      '<span data-hf-text-key="child:1" data-hf-id="hf-abc" style="color: red">x</span>',
      parse,
    );
    expect(out).toContain('data-hf-text-key="child:1"');
    expect(out).toContain('data-hf-id="hf-abc"');
  });

  it("drops an identity attribute whose value is not a bare token", () => {
    const out = clean(`<span data-hf-text-key='a" onload="alert(1)'>x</span>`, parse);
    expect(out).not.toContain("onload");
    expect(out).not.toContain("data-hf-text-key");
  });

  // These are what the design panel writes onto those same spans. Sanitizing
  // them away did not stop a text edit changing layout, it deleted the layout
  // the user had already set: colouring one word dropped a sibling's size.
  it("keeps the typography the design panel authors on a text layer", () => {
    const out = clean(
      '<span style="font-family: Inter; font-size: 48px; letter-spacing: -1px; line-height: 1.2">x</span>',
      parse,
    );
    expect(out).toContain("font-family: Inter");
    expect(out).toContain("font-size: 48px");
    expect(out).toContain("letter-spacing: -1px");
    expect(out).toContain("line-height: 1.2");
  });

  it("still refuses a value that reaches outside the stylesheet", () => {
    const out = clean(`<span style="font-family: url(http://x/f.woff)">x</span>`, parse);
    expect(out).not.toContain("url(");
  });

  it("unwraps a tag that is not formatting, keeping its words in place", () => {
    expect(clean("before<div>middle</div>after", parse)).toBe("beforemiddleafter");
  });

  it("unwraps deeply and keeps the formatting found inside", () => {
    const out = clean('<div><p><span style="color: red">deep</span></p></div>', parse);
    expect(out).toBe('<span style="color: red">deep</span>');
  });

  it("keeps only the allowlisted style properties", () => {
    const out = clean('<span style="color: red; position: fixed; z-index: 99">x</span>', parse);
    expect(out).toContain("color: red");
    expect(out).not.toContain("position");
    expect(out).not.toContain("z-index");
  });

  it("keeps every property the allowlist names", () => {
    const style =
      "color: red; background-color: blue; font-weight: 700; font-style: italic; text-decoration-line: underline";
    const out = clean(`<span style="${style}">x</span>`, parse);
    for (const property of [
      "color",
      "background-color",
      "font-weight",
      "font-style",
      "text-decoration-line",
    ]) {
      expect(out).toContain(property);
    }
  });

  it("rejects a value that smuggles a url or a script in", () => {
    const out = clean(
      '<span style="background-color: url(javascript:alert(1)); color: red">x</span>',
      parse,
    );
    expect(out).not.toContain("javascript");
    expect(out).not.toContain("url(");
    expect(out).toContain("color: red");
  });

  it.each([
    ["an image event handler", "<img src=x onerror=alert(1)>safe", "safe"],
    ["a script URL", '<a href="javascript:alert(1)">safe</a>', "safe"],
    ["an SVG script", "<svg><script>alert(1)</script></svg>safe", "safe"],
    [
      "a legacy CSS expression",
      '<span style="color: expression(alert(1))">safe</span>',
      "<span>safe</span>",
    ],
    [
      "an entity-encoded script scheme",
      '<span style="color: &#106;avascript:alert(1)">safe</span>',
      "<span>safe</span>",
    ],
    [
      "a case-folded script scheme",
      '<span style="color: JAVASCRIPT:alert(1)">safe</span>',
      "<span>safe</span>",
    ],
  ])("rejects %s", (_case, html, expected) => {
    expect(clean(html, parse)).toBe(expected);
  });

  it("drops the style attribute entirely when nothing in it survives", () => {
    expect(clean('<span style="position: fixed">x</span>', parse)).toBe("<span>x</span>");
  });

  it("keeps a value carrying a function with its own separators", () => {
    const out = clean('<span style="color: rgb(1, 2, 3); font-style: italic">x</span>', parse);
    expect(out).toContain("rgb(1, 2, 3)");
    expect(out).toContain("font-style: italic");
  });

  it("keeps a quoted semicolon inside a style value", () => {
    const out = clean(`<span style='font-family: "Roboto Mono; a"; color: red'>x</span>`, parse);
    expect(out).toContain("Roboto Mono; a");
    expect(out).toContain("color: red");
  });

  it("removes a comment, which is neither text nor formatting", () => {
    expect(clean("a<!-- note -->b", parse)).toBe("ab");
  });

  it("leaves an empty element alone", () => {
    expect(clean("", parse)).toBe("");
  });

  it("does not produce unbalanced markup from an unclosed tag", () => {
    const out = clean('<span style="color: red">open', parse);
    expect(out).toBe('<span style="color: red">open</span>');
  });

  it("is a fixed point", () => {
    const host = parse('<div><span onclick="steal()" style="color: red">x</span></div>');
    sanitizeRichTextChildren(host);
    const once = host.innerHTML;
    sanitizeRichTextChildren(host);
    expect(host.innerHTML).toBe(once);
  });
});

it("sanitizes adversarially deep markup without recursive stack growth", () => {
  const depth = 15_000;
  const host = parseWithLinkedom(`${"<b>".repeat(depth)}x${"</b>".repeat(depth)}`);

  expect(() => sanitizeRichTextChildren(host)).not.toThrow();
});

describe("isRichTextFormattingTag", () => {
  it("names the tags an inline edit may contain", () => {
    for (const tag of ["SPAN", "B", "STRONG", "I", "EM", "U", "BR"]) {
      expect(isRichTextFormattingTag(tag)).toBe(true);
    }
  });

  it("is case-insensitive, since the two parsers disagree about case", () => {
    expect(isRichTextFormattingTag("span")).toBe(true);
  });

  it("says no to anything structural", () => {
    for (const tag of ["DIV", "P", "H1", "IMG", "SCRIPT", "A"]) {
      expect(isRichTextFormattingTag(tag)).toBe(false);
    }
  });
});
