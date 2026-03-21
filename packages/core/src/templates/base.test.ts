import { describe, it, expect } from "vitest";
import { generateBaseHtml, getStageStyles } from "./base.js";
import {
  GSAP_CDN,
  BASE_STYLES,
  ELEMENT_BASE_STYLES,
  MEDIA_STYLES,
  TEXT_STYLES,
  ZOOM_CONTAINER_STYLES,
} from "./constants.js";

describe("generateBaseHtml", () => {
  it("generates valid HTML structure with DOCTYPE", () => {
    const html = generateBaseHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
  });

  it("includes #stage element", () => {
    const html = generateBaseHtml();
    expect(html).toContain('id="stage"');
  });

  it("includes #stage-zoom-container element", () => {
    const html = generateBaseHtml();
    expect(html).toContain('id="stage-zoom-container"');
  });

  it("defaults to portrait resolution", () => {
    const html = generateBaseHtml();
    expect(html).toContain('data-resolution="portrait"');
  });

  it("accepts landscape resolution", () => {
    const html = generateBaseHtml("landscape");
    expect(html).toContain('data-resolution="landscape"');
  });

  it("accepts portrait resolution explicitly", () => {
    const html = generateBaseHtml("portrait");
    expect(html).toContain('data-resolution="portrait"');
  });

  it("includes meta charset and viewport", () => {
    const html = generateBaseHtml();
    expect(html).toContain('charset="UTF-8"');
    expect(html).toContain('name="viewport"');
  });
});

describe("getStageStyles", () => {
  it("returns landscape stage styles (1920x1080)", () => {
    const styles = getStageStyles("landscape");
    expect(styles).toContain("width: 1920px");
    expect(styles).toContain("height: 1080px");
    expect(styles).toContain("position: relative");
    expect(styles).toContain("overflow: hidden");
  });

  it("returns portrait stage styles (1080x1920)", () => {
    const styles = getStageStyles("portrait");
    expect(styles).toContain("width: 1080px");
    expect(styles).toContain("height: 1920px");
  });

  it("defaults to portrait", () => {
    const styles = getStageStyles();
    expect(styles).toContain("width: 1080px");
    expect(styles).toContain("height: 1920px");
  });
});

describe("constants", () => {
  it("GSAP_CDN is a valid URL", () => {
    expect(GSAP_CDN).toMatch(/^https:\/\//);
    expect(GSAP_CDN).toContain("gsap");
    expect(GSAP_CDN).toContain(".min.js");
  });

  it("BASE_STYLES contains reset styles", () => {
    expect(BASE_STYLES).toContain("margin: 0");
    expect(BASE_STYLES).toContain("padding: 0");
    expect(BASE_STYLES).toContain("box-sizing: border-box");
  });

  it("ELEMENT_BASE_STYLES includes position and visibility", () => {
    expect(ELEMENT_BASE_STYLES).toContain("position: absolute");
    expect(ELEMENT_BASE_STYLES).toContain("visibility: hidden");
  });

  it("MEDIA_STYLES includes object-fit", () => {
    expect(MEDIA_STYLES).toContain("object-fit: contain");
    expect(MEDIA_STYLES).toContain("width: 100%");
    expect(MEDIA_STYLES).toContain("height: 100%");
  });

  it("TEXT_STYLES includes font and alignment", () => {
    expect(TEXT_STYLES).toContain("font-size: 48px");
    expect(TEXT_STYLES).toContain("font-weight: bold");
    expect(TEXT_STYLES).toContain("color: white");
    expect(TEXT_STYLES).toContain("display: flex");
  });

  it("ZOOM_CONTAINER_STYLES includes transform-origin", () => {
    expect(ZOOM_CONTAINER_STYLES).toContain("transform-origin: 0 0");
    expect(ZOOM_CONTAINER_STYLES).toContain("position: absolute");
    expect(ZOOM_CONTAINER_STYLES).toContain("inset: 0");
  });
});
