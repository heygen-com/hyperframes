import { describe, expect, it } from "vitest";
import { hasAuthoredCode, TIMELINE_REGISTRY_SCRIPT } from "./authoredCode";

const page = (head: string, body: string) =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
const runtime = '<script data-hyperframes-preview-runtime="1" src="/api/runtime.js"></script>';
const gsap = '<script src="/api/vendor/npm/gsap@3.15.0/dist/gsap.min.js"></script>';
const still = '<div data-composition-id="card"><h1 style="animation:fade 1s">Hi</h1></div>';

describe("hasAuthoredCode", () => {
  it.each([
    ["a still or CSS-animated composition", page("<style>h1{color:red}</style>", still)],
    [
      "Studio's runtime, GSAP core and registry line",
      page(runtime + gsap, TIMELINE_REGISTRY_SCRIPT + still),
    ],
    ["an import map", page('<script type="importmap">{"imports":{}}</script>', still)],
  ])("finds none in %s", (_name, html) => {
    expect(hasAuthoredCode(html)).toBe(false);
  });

  it.each([
    ["an inline script", page("", `${still}<script>setTimeout(register, 400)</script>`)],
    ["an upper-case script tag", page("", `${still}<SCRIPT>setTimeout(register, 400)</SCRIPT>`)],
    ["a script inside an inline SVG", page("", `${still}<svg><script>register()</script></svg>`)],
    [
      "a script held until fonts load",
      page("", `${still}<script type="text/hf-after-fonts">go()</script>`),
    ],
    ["a script file of the project", page('<script src="./main.js"></script>', still)],
    [
      "a GSAP plugin file",
      page('<script src="/gsap@3/dist/ScrollTrigger.min.js"></script>', still),
    ],
    ["an inline event handler", page("", `<img src="a.png" onload="register()">${still}`)],
    ["a frame", page("", `${still}<iframe src="./inner.html"></iframe>`)],
    ["a template", page("", `<template><script>go()</script></template>${still}`)],
    [
      "a child composition loaded at run time",
      page("", '<div data-composition-src="./child.html"></div>'),
    ],
  ])("finds %s", (_name, html) => {
    expect(hasAuthoredCode(html)).toBe(true);
  });
});
