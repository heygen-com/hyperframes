// @vitest-environment jsdom
import { expect, it } from "vitest";
import { rebindClipboardSelector } from "./clipboardSelectors";

it.each([
  '[id="Title"]',
  '[id="title" i]',
  '[id^="Ti"]',
  '[id$="tle"]',
  '[id*="itl"]',
  '[id|="Title"]',
  '[id~="Title"]',
  '[id$="-1"]',
  ':not([id="Title"])',
])("preserves renamed ID predicate matching for %s", (selector) => {
  const ids = new Map([
    ["Title", "capture-node-1"],
    ["other", "capture-node-2"],
  ]);
  const rewritten = rebindClipboardSelector(selector, ids);
  for (const [before, after] of ids) {
    const original = document.createElement("span");
    original.id = before;
    const clone = document.createElement("span");
    clone.id = after;
    expect(clone.matches(rewritten)).toBe(original.matches(selector));
  }
});

it("uses only recorded attribute writes and preserves unrelated predicates and strings", () => {
  const selector = 'use[href="#paint"], [fill="url(#paint)"], [title="#paint"]';
  const rewritten = rebindClipboardSelector(selector, new Map([["paint", "copy-paint"]]), [
    { name: "href", before: "#paint", after: "#copy-paint" },
    { name: "fill", before: "url(#paint)", after: 'url("#copy-paint")' },
  ]);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#copy-paint");
  expect(use.matches(rewritten)).toBe(true);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("fill", 'url("#copy-paint")');
  expect(rect.matches(rewritten)).toBe(true);
  expect(rewritten).toContain('[title="#paint"]');
});

it.each(['[*|href="#paint"]', "[*|href]", "[|href]", "[href]"])(
  "preserves namespace normalization truth for %s",
  (selector) => {
    const before = document.createElementNS("http://www.w3.org/2000/svg", "use");
    before.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#paint");
    const after = document.createElementNS("http://www.w3.org/2000/svg", "use");
    after.setAttribute("href", "#copy-paint");
    const rewritten = rebindClipboardSelector(selector, new Map(), [
      { name: "xlink:href", afterName: "href", before: "#paint", after: "#copy-paint" },
    ]);
    expect(after.matches(rewritten)).toBe(selector === "[href]" ? false : before.matches(selector));
  },
);

it("moves an explicit named-namespace predicate to the accepted output attribute name", () => {
  const rewritten = rebindClipboardSelector('[xlink|href="#paint"]', new Map(), [
    { name: "xlink:href", afterName: "href", before: "#paint", after: "#copy-paint" },
  ]);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#copy-paint");
  expect(rewritten).toContain('[href="#copy-paint"]');
});

it.each(["[style]", '[style=""]', ":not([style])", ':not([style=""])'])(
  "distinguishes absent from empty before adding attributes: %s",
  (selector) => {
    for (const before of [null, ""]) {
      const original = document.createElement("div");
      if (before !== null) original.setAttribute("style", before);
      const output = document.createElement("div");
      output.id = "capture-root";
      output.setAttribute("style", "position:relative");
      const rewritten = rebindClipboardSelector(selector, new Map(), [
        {
          name: "style",
          before,
          after: "position:relative",
          target: "#capture-root",
        },
      ]);
      expect(output.matches(rewritten)).toBe(original.matches(selector));
      if (rewritten !== selector) expect(rewritten).toContain(":where(");
    }
  },
);

it.each([
  {
    namespace: "http://www.w3.org/1999/xhtml",
    tag: "button",
    name: "type",
    before: "BUTTON",
    after: "button",
    value: "but",
  },
  {
    namespace: "http://www.w3.org/1999/xhtml",
    tag: "div",
    name: "class",
    before: "UPPER",
    after: "upper",
    value: "upp",
  },
  {
    namespace: "http://www.w3.org/2000/svg",
    tag: "feFuncA",
    name: "type",
    before: "IDENTITY",
    after: "identity",
    value: "iden",
  },
])(
  "preserves default value matching in $namespace $tag $name",
  ({ namespace, tag, name, before, after, value }) => {
    const original = document.createElementNS(namespace, tag);
    original.setAttribute(name, before);
    const output = document.createElementNS(namespace, tag);
    output.setAttribute(name, after);
    output.id = "context-node";
    const selector = `[${name}^="${value}"]`;
    const rewritten = rebindClipboardSelector(selector, new Map(), [
      { name, before, after, element: output, target: "#context-node" },
    ]);
    expect(output.matches(rewritten)).toBe(original.matches(selector));
  },
);

it("retains an explicit sensitive override when native s syntax is unavailable", () => {
  const element = document.createElement("button");
  const rewritten = rebindClipboardSelector('[type^="but" s]', new Map(), [
    { name: "type", before: "BUTTON", after: "button", element, target: "#context-node" },
  ]);
  expect(rewritten).toContain(":where(:not(");
  expect(rewritten).toContain('[type="button" s]');
});
