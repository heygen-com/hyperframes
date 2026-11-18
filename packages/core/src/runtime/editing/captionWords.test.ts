import { afterEach, expect, it } from "vitest";
import { captionWords } from "./captionWords";
import { captionTransform } from "./captionTransform";

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "gsap");
});

it("splits a plain-text group into word spans and boxes only visible groups' words", () => {
  document.body.innerHTML = `<div class="caption-group">Hello big world</div>
    <div class="caption-group" style="opacity: 0"><span>hidden</span></div>
    <div class="caption-group"><span>one</span><span>two</span></div>`;
  const { boxes } = captionWords({ words: [2, 1, 5] });
  expect(boxes.map(({ group, word }) => [group, word])).toEqual([
    [0, 0],
    [0, 1],
    [2, 0],
    [2, 1],
  ]);
  const [first, , third] = document.querySelectorAll(".caption-group");
  expect([...first!.children].map((s) => s.textContent)).toEqual(["Hello ", "big ", "world "]);
  expect(third!.innerHTML).toBe("<span>one</span><span>two</span>");
});

it("moves a word on a wrapper with a CSS transform, keeping the parts it was not given", () => {
  document.body.innerHTML = `<div class="caption-group"><span>a</span><span>b</span></div>`;
  const moved = captionTransform({ entries: [{ group: 0, word: 1, set: { x: 3, rotation: 9 } }] });
  expect(moved.words[0]!.transform).toEqual({ x: 3, y: 0, scale: 1, rotation: 9 });
  const b = document.querySelectorAll("span:not([data-caption-wrapper])")[1]!;
  expect((b.parentElement as HTMLElement).style.transform).toBe(
    "translate(3.0px, 0.0px) rotate(9.0deg) scale(1.000)",
  );
  const again = captionTransform({ entries: [{ group: 0, word: 1, set: { y: 4 } }] });
  expect(again.words[0]!.transform).toEqual({ x: 3, y: 4, scale: 1, rotation: 9 });
  expect(document.querySelectorAll("[data-caption-wrapper]")).toHaveLength(1);
  expect(
    captionTransform({
      entries: [
        { group: 0, word: 2 },
        { group: 1, word: 0 },
      ],
    }).words,
  ).toEqual([null, null]);
});

it("moves a word through the page's GSAP when it has one", () => {
  const props = new WeakMap<Element, Record<string, number>>();
  Reflect.set(window, "gsap", {
    getProperty: (el: Element, prop: string) => props.get(el)?.[prop] ?? 0,
    set: (el: Element, values: Record<string, number>) => props.set(el, values),
  });
  document.body.innerHTML = `<div class="caption-group"><span>a</span></div>`;
  const { words } = captionTransform({ entries: [{ group: 0, word: 0, set: { scale: 2 } }] });
  expect(words[0]!.transform).toEqual({ x: 0, y: 0, scale: 2, rotation: 0 });
  const wrapper = document.querySelector<HTMLElement>("[data-caption-wrapper]")!;
  expect(props.get(wrapper)).toEqual({ x: 0, y: 0, scale: 2, rotation: 0 });
  expect(wrapper.style.transform).toBe("");
});
