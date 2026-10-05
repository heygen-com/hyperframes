// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { layerKindOf } from "./layerKind";

const el = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild!;
};

describe("layerKindOf", () => {
  it.each([
    ['<img src="a.png">', "image"],
    ['<video src="a.mp4"></video>', "video"],
    ['<audio src="a.mp3"></audio>', "audio"],
    ['<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>', "vector"],
    ['<div data-hf-group="Intro"><div></div></div>', "group"],
    ['<div data-composition-src="intro.html"></div>', "group"],
    ["<h1>Title</h1>", "text"],
    ["<div>Plain words</div>", "text"],
    ["<p>Rich <b>bold</b> and <em>soft</em> words</p>", "text"],
    ['<div style="background:red"></div>', "shape"],
    ["<div><img></div>", "shape"],
    ["<div>   </div>", "shape"],
    ["<canvas></canvas>", "shape"],
  ])("%s is %s", (html, kind) => {
    expect(layerKindOf(el(html))).toBe(kind);
  });
});
