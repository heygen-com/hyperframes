import { afterEach, describe, expect, it } from "vitest";
import { getElementScreenshotClip } from "./screenshotClip";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getElementScreenshotClip", () => {
  it("returns undefined (not throws) when the selector is CSS-invalid", () => {
    // Regression: an HTML element with `id="0"` produces the selector `#0`,
    // which is invalid per the CSS spec — `document.querySelectorAll('#0')`
    // throws SyntaxError. Puppeteer surfaces that as a page.evaluate error,
    // which used to bubble up and fail the whole thumbnail. The clip helper
    // now swallows the SyntaxError so callers fall back to a full-page shot.
    const el = document.createElement("div");
    el.id = "0";
    Object.assign(el.style, {
      width: "100px",
      height: "80px",
    });
    document.body.appendChild(el);

    expect(() => getElementScreenshotClip("#0")).not.toThrow();
    expect(getElementScreenshotClip("#0")).toBeUndefined();
  });

  it("returns undefined (not throws) for garbage selectors", () => {
    expect(() => getElementScreenshotClip("::: garbage :::")).not.toThrow();
    expect(getElementScreenshotClip("::: garbage :::")).toBeUndefined();
  });

  it("returns a clip for a well-formed selector matching a visible element", () => {
    const el = document.createElement("div");
    el.id = "hero";
    el.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 100,
        height: 80,
        right: 110,
        bottom: 100,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(el);

    const clip = getElementScreenshotClip("#hero");
    expect(clip).toBeDefined();
    expect(clip?.width).toBeGreaterThan(0);
    expect(clip?.height).toBeGreaterThan(0);
  });
});
