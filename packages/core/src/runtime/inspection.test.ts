import { afterEach, describe, expect, it } from "vitest";
import { authoredCssSelector, installInspection } from "./inspection";

describe("authoredCssSelector", () => {
  it.each([
    '[data-label="a,b"]',
    "[data-label='a  b']",
    String.raw`[data-label="a\",b"]`,
    String.raw`.a\,b`,
    String.raw`[data-label=a\,b]`,
    ':is([data-label="a,b"], .card)',
    ".card/* , * */",
  ])("preserves literal content when removing resets from %s", (selector) => {
    expect(authoredCssSelector(selector)).toBe(selector);
    expect(authoredCssSelector(`*, ${selector}, body   *`)).toBe(selector);
  });

  it("drops page resets and keeps a rule that also names the element", () => {
    expect(authoredCssSelector("*")).toBeNull();
    expect(authoredCssSelector("html, body")).toBeNull();
    expect(authoredCssSelector("html *")).toBeNull();
    expect(authoredCssSelector("rect, *")).toBe("rect");
    expect(authoredCssSelector(".Card")).toBe(".Card");
  });
});

describe("installInspection CSS matching", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as { __hfInspection?: unknown }).__hfInspection;
  });

  it.each(["a,b", "a  b"])("retains authored CSS for literal %s", (value) => {
    const target = document.createElement("div");
    target.id = "target";
    target.dataset.label = value;
    document.body.append(target);
    const selector = `[data-label="${value}"]`;
    expect(target.matches(selector)).toBe(true);
    const api = installInspection(window, "gen");
    try {
      const [result] = api.query({
        targets: [{ selector: "#target" }],
        descendants: false,
        cssRules: [
          { id: "plain", selector },
          { id: "mixed", selector: `${selector}, *` },
          { id: "unrelated", selector: '[data-label="other"], *' },
        ],
      }).results;
      expect(result?.css).toEqual(["plain", "mixed"]);
    } finally {
      api.dispose();
    }
  });

  it("does not attach a universal reset to a rect", () => {
    document.body.innerHTML = '<svg id="world-grain"><rect id="grain"></rect></svg>';
    const api = installInspection(window, "gen");
    const [result] = api.query({
      targets: [{ selector: "rect" }],
      descendants: false,
      cssRules: [
        { id: "reset", selector: "*" },
        { id: "page", selector: "html, body" },
        { id: "desc", selector: "body *" },
        { id: "own", selector: "rect" },
        { id: "shared", selector: "rect, *" },
      ],
    }).results;

    expect(result?.status).toBe("found");
    expect(result?.css).toEqual(["own", "shared"]);
    api.dispose();
  });
});
