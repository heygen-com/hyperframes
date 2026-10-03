/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import {
  chapterIndexAtTime,
  extractPlayerChapters,
  nextChapterStart,
  previousChapterStart,
} from "./chapters.js";

describe("extractPlayerChapters", () => {
  it("reads host-document chapters and skips inlined descendants", () => {
    document.body.innerHTML = `
      <div data-composition-id="main" data-duration="16">
        <section id="hook" class="clip" data-start="0" data-duration="4" data-chapter="Hook"></section>
        <div id="demo" data-composition-id="nested" data-start="4" data-duration="12" data-chapter="Walkthrough">
          <section id="inner" data-start="0" data-duration="2" data-chapter="Inner"></section>
        </div>
      </div>
    `;
    expect(extractPlayerChapters(document)).toEqual([
      { start: 0, title: "Hook", elementId: "hook" },
      { start: 4, title: "Walkthrough", elementId: "demo" },
    ]);
  });
});

describe("chapter navigation", () => {
  const chapters = [
    { start: 0, title: "Hook", elementId: "hook" },
    { start: 4, title: "Demo", elementId: "demo" },
  ];

  it("resolves the current chapter and neighbors", () => {
    expect(chapterIndexAtTime(chapters, 2)).toBe(0);
    expect(chapterIndexAtTime(chapters, 4)).toBe(1);
    expect(previousChapterStart(chapters, 4)).toBe(0);
    expect(nextChapterStart(chapters, 0)).toBe(4);
    expect(nextChapterStart(chapters, 4)).toBeNull();
  });
});
