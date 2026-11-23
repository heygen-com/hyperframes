import { describe, expect, it } from "vitest";
import { unwrapTemplate } from "./htmlTemplate.js";
import { parseAudioElements } from "../services/audioMixer.js";
import { parseImageElements, parseVideoElements } from "../services/videoFrameExtractor.js";

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

  it.each([" ", "\t", "\n", "\r", "\f", " \n\t\r\f"])(
    "unwraps a closing template tag with HTML whitespace %j",
    (whitespace) => {
      const inner = `<div id="root">hello</div>`;
      const html = `<template>${inner}</template${whitespace}>`;
      expect(unwrapTemplate(html)).toBe(inner);
    },
  );

  it("unwraps a full document with a spaced uppercase closing template tag", () => {
    const inner = `<div id="root">hello</div>`;
    const html = `<!doctype html><html><body><template>${inner}</TEMPLATE \n></body></html>`;
    expect(unwrapTemplate(html)).toBe(inner);
  });

  it("discovers the same media inside a wrapper with a spaced closing tag", () => {
    const inner = `<div data-composition-id="scene" data-duration="3">
      <video id="v" src="clip.mp4" data-start="1" data-duration="2"></video>
      <audio id="a" src="voice.wav" data-start="1" data-end="3"></audio>
      <img id="i" src="poster.png" data-start="1" data-duration="2">
    </div>`;
    const html = `<template>${inner}</template \n>`;
    expect(parseVideoElements(html)).toEqual(parseVideoElements(inner));
    expect(parseVideoElements(html)).toHaveLength(1);
    expect(parseAudioElements(html)).toEqual(parseAudioElements(inner));
    expect(parseAudioElements(html)).toHaveLength(1);
    expect(parseImageElements(html)).toEqual(parseImageElements(inner));
    expect(parseImageElements(html)).toHaveLength(1);
  });

  it("returns the input unchanged when the closing template tag is missing", () => {
    const html = `<template><div>broken`;
    expect(unwrapTemplate(html)).toBe(html);
  });

  it.each(["</template-extra>", "</template\u00a0>", "</template \n"])(
    "leaves an input without a complete closing tag unchanged: %j",
    (close) => {
      const html = `<template><span>hello</span>${close}`;
      expect(unwrapTemplate(html)).toBe(html);
    },
  );

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
