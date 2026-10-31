// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createElementPickerHoverLabel,
  elementPickerLabelPosition,
  formatElementPickerIdentifier,
} from "./elementPickerHoverLabel";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("formatElementPickerIdentifier", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };

  it.each([
    [{ tagName: "H1", id: "hero-title", className: "headline", boundingBox: box }, "h1#hero-title"],
    [{ tagName: "DIV", id: null, className: "title featured", boundingBox: box }, "div.title"],
    [{ tagName: "SPAN", id: null, className: null, boundingBox: box }, "span"],
    [
      {
        tagName: "P",
        id: null,
        className: "__hf-pick-highlight caption",
        boundingBox: box,
      },
      "p.caption",
    ],
  ])("formats %j as %s", (info, expected) => {
    expect(formatElementPickerIdentifier(info)).toBe(expected);
  });

  it("bounds long and unusual identifiers without interpreting markup", () => {
    const identifier = formatElementPickerIdentifier({
      tagName: "DIV",
      id: `<img onerror=alert(1)>${"x".repeat(100)}`,
      className: null,
      boundingBox: box,
    });
    expect(Array.from(identifier)).toHaveLength(72);
    expect(identifier).toMatch(/^div#<img onerror=alert\(1\)>/);
    expect(identifier.endsWith("…")).toBe(true);
  });
});

describe("elementPickerLabelPosition", () => {
  it("maps iframe coordinates through zoom and flips inside the visible frame", () => {
    expect(
      elementPickerLabelPosition({
        iframeRect: { left: 100, top: 50, right: 500, bottom: 250, width: 400, height: 200 },
        iframeWidth: 200,
        iframeHeight: 100,
        elementBox: { x: 180, y: 90, width: 20, height: 10 },
        labelWidth: 80,
        labelHeight: 20,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ left: 374, top: 230 });
  });

  it("clamps a partly offscreen preview to the usable viewport", () => {
    expect(
      elementPickerLabelPosition({
        iframeRect: { left: -50, top: -20, right: 150, bottom: 80, width: 200, height: 100 },
        iframeWidth: 200,
        iframeHeight: 100,
        elementBox: { x: 0, y: 0, width: 5, height: 5 },
        labelWidth: 80,
        labelHeight: 20,
        viewportWidth: 100,
        viewportHeight: 60,
      }),
    ).toEqual({ left: 0, top: 0 });
  });
});

describe("createElementPickerHoverLabel", () => {
  it("renders plain text without intercepting pointer input and removes itself", () => {
    const iframe = document.body.appendChild(document.createElement("iframe"));
    Object.defineProperties(iframe, {
      clientWidth: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 100 },
    });
    iframe.getBoundingClientRect = () => new DOMRect(20, 30, 400, 200);
    const hoverLabel = createElementPickerHoverLabel();
    hoverLabel.show(
      {
        tagName: "div",
        id: "<b>not markup</b>",
        className: null,
        boundingBox: { x: 10, y: 20, width: 30, height: 40 },
      },
      iframe,
    );

    const label = document.querySelector<HTMLElement>("[data-hf-picker-hover-label]");
    expect(label?.textContent).toBe("div#<b>not markup</b>");
    expect(label?.querySelector("b")).toBeNull();
    expect(label?.style.pointerEvents).toBe("none");
    expect(label?.style.position).toBe("fixed");

    hoverLabel.dispose();
    expect(document.querySelector("[data-hf-picker-hover-label]")).toBeNull();
  });
});
