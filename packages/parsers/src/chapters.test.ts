/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { COMPOSITION_ATTRIBUTES } from "./compositionContract.js";
import { listAuthoredChapters, parseChapters } from "./chapters.js";

function parse(html: string, rootDuration?: number) {
  document.body.innerHTML = html;
  return parseChapters(document, { rootDuration });
}

describe("parseChapters", () => {
  it("returns an empty list when no data-chapter attributes exist", () => {
    const chapters = parse(`
      <div data-composition-id="main" data-duration="10">
        <section id="hook" class="clip" data-start="0" data-duration="4"></section>
      </div>
    `);
    expect(chapters).toEqual([]);
  });

  it("flags empty and whitespace titles", () => {
    const chapters = parse(`
      <div data-composition-id="main" data-duration="10">
        <section id="empty" class="clip" data-start="0" data-duration="2" data-chapter=""></section>
        <section id="ws" class="clip" data-start="2" data-duration="2" data-chapter="   "></section>
      </div>
    `);
    expect(chapters.map((c) => c.title)).toEqual(["", ""]);
    expect(chapters[0]?.diagnostics.map((d) => d.code)).toContain("chapter_empty");
    expect(chapters[1]?.diagnostics.map((d) => d.code)).toContain("chapter_empty");
    expect(listAuthoredChapters(chapters)).toEqual([]);
  });

  it("resolves relative data-start through the shared timing walk", () => {
    const chapters = parse(`
      <div data-composition-id="main" data-duration="20">
        <section id="hook" class="clip" data-start="0" data-duration="4" data-chapter="Hook"></section>
        <section id="demo" class="clip" data-start="hook" data-duration="12" data-chapter="Product walkthrough"></section>
      </div>
    `);
    expect(listAuthoredChapters(chapters)).toEqual([
      { index: 1, start: 0, title: "Hook", elementId: "hook" },
      { index: 2, start: 4, title: "Product walkthrough", elementId: "demo" },
    ]);
  });

  it("flags duplicate starts within 1 ms", () => {
    const chapters = parse(`
      <div data-composition-id="main" data-duration="10">
        <section id="a" class="clip" data-start="1" data-duration="2" data-chapter="A"></section>
        <section id="b" class="clip" data-start="1.0005" data-duration="2" data-chapter="B"></section>
      </div>
    `);
    expect(
      chapters.every((c) => c.diagnostics.some((d) => d.code === "chapter_duplicate_start")),
    ).toBe(true);
  });

  it("flags out-of-range starts", () => {
    const chapters = parse(
      `
      <div data-composition-id="main" data-duration="8">
        <section id="late" class="clip" data-start="12" data-duration="2" data-chapter="Late"></section>
        <section id="neg" class="clip" data-start="-1" data-duration="2" data-chapter="Before"></section>
      </div>
    `,
      8,
    );
    expect(chapters.find((c) => c.elementId === "late")?.diagnostics.map((d) => d.code)).toContain(
      "chapter_out_of_range",
    );
    expect(chapters.find((c) => c.elementId === "neg")?.diagnostics.map((d) => d.code)).toContain(
      "chapter_out_of_range",
    );
  });

  it("includes a nested host chapter but not inlined descendants", () => {
    const chapters = parse(`
      <div data-composition-id="main" data-duration="20">
        <section id="hook" class="clip" data-start="0" data-duration="4" data-chapter="Hook"></section>
        <div id="demo" data-composition-id="nested" data-start="4" data-duration="12" data-chapter="Demo">
          <section id="inner" class="clip" data-start="0" data-duration="3" data-chapter="Inner"></section>
        </div>
      </div>
    `);
    expect(listAuthoredChapters(chapters).map((c) => c.elementId)).toEqual(["hook", "demo"]);
  });

  it("keeps a stable sort by start then document order", () => {
    const chapters = parse(`
      <div data-composition-id="main" data-duration="20">
        <section id="second" class="clip" data-start="4" data-duration="2" data-chapter="Second"></section>
        <section id="first" class="clip" data-start="0" data-duration="2" data-chapter="First"></section>
        <section id="also-first" class="clip" data-start="0" data-duration="2" data-chapter="Also first"></section>
      </div>
    `);
    expect(chapters.map((c) => c.elementId)).toEqual(["first", "also-first", "second"]);
  });

  it("treats a missing data-start as missing timing, not t=0", () => {
    const chapters = parse(`
      <div data-composition-id="main" data-duration="10">
        <section id="no-start" data-chapter="Orphan"></section>
      </div>
    `);
    expect(chapters[0]?.start).toBeNull();
    expect(chapters[0]?.diagnostics.map((d) => d.code)).toContain("chapter_missing_timing");
  });

  it("exposes data-chapter on the composition contract", () => {
    expect(COMPOSITION_ATTRIBUTES.chapter).toBe("data-chapter");
  });
});
