import { describe, it, expect } from "vitest";
import { unwrapTemplate } from "./htmlTemplate.js";

describe("unwrapTemplate", () => {
  it("returns input unchanged when there is no <template>", () => {
    const html = `<div>hello</div>`;
    expect(unwrapTemplate(html)).toBe(html);
  });

  it("unwraps the contents of a top-level <template>", () => {
    const inner = `<div id="root"><audio id="a" src="a.mp3"></audio></div>`;
    const html = `<!doctype html><html><body><template>${inner}</template></body></html>`;
    expect(unwrapTemplate(html)).toBe(inner);
  });

  it("handles attributes on the <template> tag", () => {
    const inner = `<span>hi</span>`;
    const html = `<template id="t" data-x="1">${inner}</template>`;
    expect(unwrapTemplate(html)).toBe(inner);
  });

  it("returns input unchanged when <template> has no closing tag", () => {
    const html = `<template><div>broken`;
    expect(unwrapTemplate(html)).toBe(html);
  });

  it("returns empty string for an empty template", () => {
    const html = `<body><template></template></body>`;
    expect(unwrapTemplate(html)).toBe("");
  });

  // Nested templates: the greedy match intentionally captures everything
  // from the first <template> to the last </template>. A sub-composition
  // that embeds its own <template> (e.g. for cloning) keeps that inner
  // template intact after one unwrap — we only peel the outermost wrapper.
  it("only unwraps the outermost <template> when nested", () => {
    const inner = `outer-before<template>inner-content</template>outer-after`;
    const html = `<body><template>${inner}</template></body>`;
    expect(unwrapTemplate(html)).toBe(inner);
  });

  // Invariant: after one unwrap, any remaining <template> in the output is
  // user content (e.g. a cloning template inside the composition DOM), not
  // a second sub-composition wrapper. Running unwrapTemplate a second time
  // would incorrectly strip user content, so callers should unwrap once.
  it("is intended to be called once per sub-composition level", () => {
    const userTemplate = `<template id="row"><tr><td></td></tr></template>`;
    const composition = `<div>${userTemplate}</div>`;
    const wrapped = `<template>${composition}</template>`;
    expect(unwrapTemplate(wrapped)).toBe(composition);
  });

  // Known limitation: the greedy regex anchors on the LAST </template>, so
  // two sibling top-level <template>s get treated as one and the text
  // between them leaks into the captured content. Sub-composition HTML
  // authored via the documented convention always has exactly one top-level
  // wrapper, so this never happens in the render pipeline — but if a future
  // caller passes multi-template input, they need a different parser.
  it("collapses two sibling top-level <template>s (known limitation)", () => {
    const html = `<template>a</template>middle<template>b</template>`;
    expect(unwrapTemplate(html)).toBe(`a</template>middle<template>b`);
  });
});
