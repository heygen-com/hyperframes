import { describe, it, expect } from "vitest";
import { queryByAttr } from "./cssSelector";

function makeDoc(html: string) {
  const { parseHTML } = require("linkedom");
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  return document;
}

describe("queryByAttr", () => {
  it("finds element by exact attribute match", () => {
    const doc = makeDoc('<div data-id="abc"></div>');
    const el = queryByAttr(doc, "data-id", "abc");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-id")).toBe("abc");
  });

  it("returns null when no match", () => {
    const doc = makeDoc('<div data-id="abc"></div>');
    expect(queryByAttr(doc, "data-id", "xyz")).toBeNull();
  });

  it("handles values with double quotes", () => {
    const doc = makeDoc("<div></div>");
    const el = doc.querySelector("div")!;
    el.setAttribute("data-id", 'has"quote');
    expect(queryByAttr(doc, "data-id", 'has"quote')).toBe(el);
  });

  it("handles values with backslashes", () => {
    const doc = makeDoc("<div></div>");
    const el = doc.querySelector("div")!;
    el.setAttribute("data-id", "has\\backslash");
    expect(queryByAttr(doc, "data-id", "has\\backslash")).toBe(el);
  });

  it("handles values with closing bracket", () => {
    const doc = makeDoc("<div></div>");
    const el = doc.querySelector("div")!;
    el.setAttribute("data-id", "has]bracket");
    expect(queryByAttr(doc, "data-id", "has]bracket")).toBe(el);
  });

  it("handles injection attempt", () => {
    const doc = makeDoc('<div data-id="safe"></div>');
    const el = doc.querySelector("div")!;
    el.setAttribute("data-id", '"][data-evil]');
    expect(queryByAttr(doc, "data-id", '"][data-evil]')).toBe(el);
    expect(queryByAttr(doc, "data-id", "safe")).toBeNull();
  });

  it("filters by tag when provided", () => {
    const doc = makeDoc('<div data-src="a.js"></div><script data-src="a.js"></script>');
    const el = queryByAttr(doc, "data-src", "a.js", "script");
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe("script");
  });

  it("returns null when tag filter excludes match", () => {
    const doc = makeDoc('<div data-src="a.js"></div>');
    expect(queryByAttr(doc, "data-src", "a.js", "script")).toBeNull();
  });

  it("handles values with newlines", () => {
    const doc = makeDoc("<div></div>");
    const el = doc.querySelector("div")!;
    el.setAttribute("data-id", "line1\nline2");
    expect(queryByAttr(doc, "data-id", "line1\nline2")).toBe(el);
  });

  it("handles values with leading digits", () => {
    const doc = makeDoc("<div></div>");
    const el = doc.querySelector("div")!;
    el.setAttribute("data-id", "123abc");
    expect(queryByAttr(doc, "data-id", "123abc")).toBe(el);
  });
});
