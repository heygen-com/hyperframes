// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { respaceAddedFields, separatorFor } from "./textFieldSpacing";

describe("separatorFor", () => {
  it.each([
    ["two words", "First", "New text", " "],
    ["after an opening parenthesis", "(", "Again", ""],
    ["before a comma", "Hello", ", again", ""],
    ["before a closing parenthesis", "Again", ")", ""],
    ["after text ending in a space", "Hello ", "again", ""],
    ["with nothing before it", "", "again", ""],
    ["after Chinese", "你好", "New", ""],
    ["before Chinese", "Hello", "世界", ""],
    ["after Hiragana", "ひらがな", "New", ""],
    ["before Katakana", "Hello", "カタカナ", ""],
    ["between Korean words", "안녕", "하세요", " "],
  ])("%s", (_, before, after, separator) => {
    expect(separatorFor(before, after)).toBe(separator);
  });
});

const added = (edges: string, text = "New text") =>
  `<span data-hf-text-key="child:new:1" data-hf-space="${edges}">${text}</span>`;

describe("respaceAddedFields", () => {
  it("leaves markup with no added layer exactly as it was", () => {
    const html = "<span>First</span><span>Second</span>";
    expect(respaceAddedFields(html)).toBe(html);
  });

  it("writes the separator on each edge Studio owns", () => {
    expect(respaceAddedFields(`<span>First</span>${added("both")}<span>Second</span>`)).toBe(
      `<span>First</span> ${added("both")} <span>Second</span>`,
    );
  });

  it("drops an owned separator the text no longer wants, and keeps owning that edge", () => {
    expect(respaceAddedFields(`<span>Hello</span> ${added("before", ", again")}`)).toBe(
      `<span>Hello</span>${added("before", ", again")}`,
    );
  });

  it("never touches whitespace on an edge Studio does not own", () => {
    const html = `<span>First</span>${added("before")}\n  <span>, Second</span>`;
    expect(respaceAddedFields(html)).toBe(
      `<span>First</span> ${added("before")}\n  <span>, Second</span>`,
    );
  });

  it("reads a plain-text run's own trailing space as the separator", () => {
    expect(respaceAddedFields(`First ${added("before")}`)).toBe(`First ${added("before")}`);
  });

  // A separator the person deleted on the canvas is theirs: Studio stops writing that edge.
  it("gives up an edge whose separator the person deleted", () => {
    const before = `<span>First</span> ${added("both")} <span>Second</span>`;
    const typed = `<span>First</span>${added("both")} <span>Second</span>`;
    const saved = respaceAddedFields(typed, before);
    expect(saved).toBe(`<span>First</span>${added("after")} <span>Second</span>`);
    expect(respaceAddedFields(saved)).toBe(saved);
  });
});
