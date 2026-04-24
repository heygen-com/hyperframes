import { describe, expect, it } from "vitest";
import { unwrapTemplate } from "./htmlTemplate.js";

describe("unwrapTemplate", () => {
  it("returns the input unchanged when there is no template wrapper", () => {
    const html = `<div>hello</div>`;
    expect(unwrapTemplate(html)).toBe(html);
  });

  it("unwraps a bare top-level template fragment", () => {
    const inner = `<span>hi</span>`;
    const html = `<template id="t" data-x="1">${inner}</template>`;
    expect(unwrapTemplate(html)).toBe(inner);
  });

  it("unwraps a full document whose body only contains a template", () => {
    const inner = `<div id="root"><audio id="a" src="a.mp3"></audio></div>`;
    const html = `<!doctype html><html><body><template>${inner}</template></body></html>`;
    expect(unwrapTemplate(html)).toBe(inner);
  });

  it("returns the input unchanged when the closing template tag is missing", () => {
    const html = `<template><div>broken`;
    expect(unwrapTemplate(html)).toBe(html);
  });

  it("returns an empty string for an empty template", () => {
    const html = `<body><template></template></body>`;
    expect(unwrapTemplate(html)).toBe("");
  });

  it("preserves nested templates inside the outer wrapper", () => {
    const inner = `outer-before<template>inner-content</template>outer-after`;
    const html = `<template>${inner}</template>`;
    expect(unwrapTemplate(html)).toBe(inner);
  });

  it("leaves multiple sibling templates unchanged", () => {
    const html = `<template>a</template>middle<template>b</template>`;
    expect(unwrapTemplate(html)).toBe(html);
  });
});
