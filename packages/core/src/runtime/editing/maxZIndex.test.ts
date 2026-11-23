import { afterEach, describe, expect, it } from "vitest";
import { maxZIndex } from "./maxZIndex";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("max-z-index", () => {
  it("answers the highest z-index on the page, a hidden clip's included", () => {
    document.body.innerHTML = `
      <div style="position: absolute; z-index: 4"></div>
      <div style="position: absolute; z-index: 12; display: none"></div>
      <section><span style="position: relative; z-index: 7"></span></section>`;
    expect(maxZIndex()).toEqual({ zIndex: 12 });
  });

  it("answers 0 for a page with no stacked element or only negative ones", () => {
    document.body.innerHTML = `<div></div><div style="position: absolute; z-index: -3"></div>`;
    expect(maxZIndex()).toEqual({ zIndex: 0 });
  });
});
