import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const COMPONENTS = ["caption-highlight", "caption-clip-wipe", "caption-particle-burst"];
const DEMO_GROUP_SIZES = [4, 4, 1, 4, 3, 1, 3, 3, 2, 3];
const KOREAN = [
  ...["오늘은", "정말", "특별한", "날이에요.", "우리가", "함께", "만든", "영상을"],
  ...["처음으로", "세상에", "공개합니다.", "끝까지", "봐", "주세요.", "감사합니다."],
];

function source(name: string): string {
  const url = new URL(`../../../../registry/components/${name}/${name}.html`, import.meta.url);
  return readFileSync(url, "utf8");
}

function withWords(html: string, words: string[]): string {
  const list = words.map(
    (text, i) => `{ text: "${text}", start: ${i * 0.5}, end: ${i * 0.5 + 0.45} }`,
  );
  return html.replace(/var WORDS = \[[\s\S]*?\];/, `var WORDS = [${list.join(",")}];`);
}

function fakeTimeline(): Record<string, () => unknown> {
  const tl: Record<string, () => unknown> = {};
  for (const method of ["set", "to", "from", "fromTo", "seek", "add", "call"])
    tl[method] = () => tl;
  return tl;
}

/** Runs the component's inline script and returns how many words each caption group shows. */
function groupSizes(html: string): number[] {
  const window = new Window();
  window.document.write(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
  const canvasContext = { font: "", measureText: () => ({ width: 0 }) };
  window.HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].at(-1)![1]!;
  const gsap = { timeline: fakeTimeline, set: () => undefined, to: () => undefined };
  vm.runInNewContext(script, { window, document: window.document, gsap, console });
  const container = window.document.querySelector('[id$="-container"]')!;
  return [...container.children]
    .filter((child) => child.className.endsWith("-group"))
    .map((group) => group.querySelectorAll('[class$="-word"]').length);
}

describe("caption components with hand-tuned word groups", () => {
  it.each(COMPONENTS)("%s keeps the demo transcript's groups", (name) => {
    expect(groupSizes(source(name))).toEqual(DEMO_GROUP_SIZES);
  });

  it.each(COMPONENTS)("%s groups a replaced 15-word transcript instead of crashing", (name) => {
    const sizes = groupSizes(withWords(source(name), KOREAN));
    expect(sizes.reduce((sum, n) => sum + n, 0)).toBe(KOREAN.length);
  });
});
