// @vitest-environment happy-dom
import type { Page } from "puppeteer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractDesignStyles } from "./designStyleExtractor.js";

// Use the complete browser expression; happy-dom supplies CSS, and these
// fixtures supply the layout measurements that a browser normally computes.
async function shadows() {
  const evaluate: Page["evaluate"] = async (script, ..._args) => {
    if (typeof script !== "string") throw new Error("Expected a browser expression");
    return window.eval(script);
  };
  return (await extractDesignStyles({ evaluate })).shadows;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const style = getComputedStyle(this);
      return new DOMRect(0, 0, parseFloat(style.width) || 0, parseFloat(style.height) || 0);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("computed box shadow capture", () => {
  it("counts ordinary and utility-class boxes without counting semantic samples twice", async () => {
    document.head.innerHTML = `<style>
      div { width: 200px; height: 100px; box-shadow: 0 4px 12px rgba(20, 30, 40, .2); }
    </style>`;
    document.body.innerHTML = '<div></div><div class="u9"></div><div class="card"></div>';
    const value = getComputedStyle(document.body.children[0]!).boxShadow;

    expect(await shadows()).toEqual([{ value, count: 3 }]);
  });

  it("preserves small and full-viewport semantic samples after a dense structural prefix", async () => {
    document.body.innerHTML = `${'<div style="width: 1px; height: 1px"></div>'.repeat(900)}
      <button style="width: 20px; height: 20px; box-shadow: 0 1px 2px red">+</button>
      <span class="card" style="width: 20px; height: 20px; box-shadow: 0 1px 2px red">A</span>
      <header style="width: ${innerWidth}px; height: ${innerHeight}px; box-shadow: 0 2px 4px blue"></header>
      <div style="width: 200px; height: 100px; box-shadow: 0 8px 16px green"></div>`;
    const button = document.querySelector("button")!;
    const header = document.querySelector("header")!;

    expect(await shadows()).toEqual([
      { value: getComputedStyle(button).boxShadow, count: 2 },
      { value: getComputedStyle(header).boxShadow, count: 1 },
    ]);
  });

  it("excludes hidden, tiny and page-sized additions while keeping a visible card", async () => {
    document.head.innerHTML = `<style>
      div { width: 200px; height: 100px; box-shadow: 0 4px 8px purple; }
    </style>`;
    document.body.innerHTML = `
      <div style="display: none"></div>
      <div style="visibility: hidden"></div>
      <div style="opacity: 0"></div>
      <div style="width: 20px; height: 20px"></div>
      <div style="width: ${innerWidth}px; height: ${innerHeight}px"></div>
      <div id="visible"></div>`;
    const value = getComputedStyle(document.getElementById("visible")!).boxShadow;

    expect(await shadows()).toEqual([{ value, count: 1 }]);
  });
});
