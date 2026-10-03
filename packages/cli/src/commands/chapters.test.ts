import { describe, expect, it, beforeEach } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import { parseProjectChapters } from "./chapters.js";

describe("parseProjectChapters", () => {
  beforeEach(() => {
    ensureDOMParser();
  });

  it("lists resolved chapters for the entry composition", () => {
    const html = `
<div data-composition-id="main" data-width="1920" data-height="1080" data-duration="16">
  <section id="hook" class="clip" data-start="0" data-duration="4" data-chapter="Hook"></section>
  <section id="demo" class="clip" data-start="hook" data-duration="12" data-chapter="Product walkthrough"></section>
</div>`;
    expect(parseProjectChapters(html)).toEqual([
      { index: 1, start: 0, title: "Hook", elementId: "hook" },
      { index: 2, start: 4, title: "Product walkthrough", elementId: "demo" },
    ]);
  });

  it("returns an empty list when there are no chapters", () => {
    const html = `<div data-composition-id="main" data-duration="4">
      <section id="hook" class="clip" data-start="0" data-duration="4"></section>
    </div>`;
    expect(parseProjectChapters(html)).toEqual([]);
  });
});
