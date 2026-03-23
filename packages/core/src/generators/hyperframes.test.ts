/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { generateHyperframesHtml, generateGsapTimelineScript, generateHyperframesStyles } from "./hyperframes.js";
import { GSAP_CDN } from "../templates/constants.js";
import type { TimelineTextElement, TimelineMediaElement } from "../core.types";

function makeTextElement(overrides: Partial<TimelineTextElement> = {}): TimelineTextElement {
  return {
    id: "text-1",
    type: "text",
    name: "Title",
    content: "Hello World",
    startTime: 0,
    duration: 5,
    zIndex: 1,
    ...overrides,
  };
}

function makeVideoElement(overrides: Partial<TimelineMediaElement> = {}): TimelineMediaElement {
  return {
    id: "vid-1",
    type: "video",
    name: "Background",
    src: "video.mp4",
    startTime: 0,
    duration: 10,
    zIndex: 0,
    ...overrides,
  };
}

describe("generateHyperframesHtml", () => {
  it("generates valid HTML with proper data attributes", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("data-composition-id=");
    expect(html).toContain("data-composition-duration=");
    expect(html).toContain('id="stage"');
    expect(html).toContain('id="stage-zoom-container"');
  });

  it("includes element data attributes", () => {
    const elements = [makeTextElement({ id: "my-text", startTime: 2, duration: 3 })];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain('id="my-text"');
    expect(html).toContain('data-start="2"');
    expect(html).toContain('data-end="5"');
    expect(html).toContain('data-layer="1"');
  });

  it("includes GSAP CDN script tag when includeScripts is true", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { includeScripts: true });

    expect(html).toContain(`<script src="${GSAP_CDN}"></script>`);
  });

  it("does NOT include GSAP CDN by default", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).not.toContain(GSAP_CDN);
  });

  it("includes timeline script when includeScripts is true", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { includeScripts: true });

    expect(html).toContain("gsap.timeline({ paused: true })");
  });

  it("generates GSAP timeline with visibility animations when includeScripts is true", () => {
    const elements = [makeTextElement({ id: "el-1", startTime: 1, duration: 3 })];
    const html = generateHyperframesHtml(elements, 5, { includeScripts: true });

    // Default animations include visibility bookends
    expect(html).toContain('tl.set("#el-1"');
    expect(html).toContain('visibility: "hidden"');
    expect(html).toContain('visibility: "visible"');
  });

  it("sets resolution data attribute", () => {
    const elements = [makeTextElement()];

    const landscapeHtml = generateHyperframesHtml(elements, 5, { resolution: "landscape" });
    expect(landscapeHtml).toContain('data-resolution="landscape"');

    const portraitHtml = generateHyperframesHtml(elements, 5, { resolution: "portrait" });
    expect(portraitHtml).toContain('data-resolution="portrait"');
  });

  it("generates video elements with proper tags", () => {
    const elements = [makeVideoElement()];
    const html = generateHyperframesHtml(elements, 10);

    expect(html).toContain("<video");
    expect(html).toContain('src="video.mp4"');
    expect(html).toContain("playsinline");
  });

  it("generates text elements with content wrapper div", () => {
    const elements = [makeTextElement({ content: "My Content" })];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain("<div>My Content</div>");
  });

  it("includes custom compositionId", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { compositionId: "test-comp-123" });

    expect(html).toContain('data-composition-id="test-comp-123"');
  });

  it("calculates total duration from elements if they exceed provided duration", () => {
    const elements = [makeTextElement({ startTime: 0, duration: 15 })];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain('data-composition-duration="15"');
  });

  it("includes style tags when includeStyles is true", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { includeStyles: true });

    expect(html).toContain('<style data-hf-core="true">');
  });

  it("includes custom styles when provided", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, {
      styles: ".custom { color: red; }",
      includeStyles: true,
    });

    expect(html).toContain('<style data-hf-custom="true">');
    expect(html).toContain(".custom { color: red; }");
  });

  it("serializes keyframes as data attributes", () => {
    const elements = [makeTextElement({ id: "text-kf" })];
    const keyframes = {
      "text-kf": [
        { id: "kf1", time: 0, properties: { opacity: 0 } },
        { id: "kf2", time: 1, properties: { opacity: 1 } },
      ],
    };
    const html = generateHyperframesHtml(elements, 5, { keyframes });

    expect(html).toContain("data-keyframes=");
    expect(html).toContain("kf1");
    expect(html).toContain("kf2");
  });

  it("serializes zoom keyframes on zoom container", () => {
    const elements = [makeTextElement()];
    const stageZoomKeyframes = [
      { id: "z1", time: 0, zoom: { scale: 1, focusX: 960, focusY: 540 } },
      { id: "z2", time: 5, zoom: { scale: 2, focusX: 400, focusY: 300 } },
    ];
    const html = generateHyperframesHtml(elements, 10, { stageZoomKeyframes });

    expect(html).toContain("data-zoom-keyframes=");
  });

  it("includes x, y, scale data attributes for non-default values", () => {
    const elements = [makeVideoElement({ x: 100, y: 200, scale: 1.5, opacity: 0.8 })];
    const html = generateHyperframesHtml(elements, 10);

    expect(html).toContain('data-x="100"');
    expect(html).toContain('data-y="200"');
    expect(html).toContain('data-scale="1.5"');
    expect(html).toContain('data-opacity="0.8"');
  });

  it("omits x, y, scale, opacity data attributes when at default values", () => {
    const elements = [makeVideoElement({ x: 0, y: 0, scale: 1, opacity: 1 })];
    const html = generateHyperframesHtml(elements, 10);

    expect(html).not.toContain("data-x=");
    expect(html).not.toContain("data-y=");
    expect(html).not.toContain("data-scale=");
    expect(html).not.toContain("data-opacity=");
  });
});

describe("generateGsapTimelineScript", () => {
  it("generates a timeline script with visibility animations", () => {
    const elements = [makeTextElement({ id: "el1", startTime: 1, duration: 4 })];
    const script = generateGsapTimelineScript(elements, 5);

    expect(script).toContain("const tl = gsap.timeline({ paused: true });");
    expect(script).toContain('tl.set("#el1"');
    expect(script).toContain('visibility: "hidden"');
    expect(script).toContain('visibility: "visible"');
  });

  it("generates empty timeline for no elements", () => {
    const script = generateGsapTimelineScript([], 5);

    expect(script).toContain("const tl = gsap.timeline({ paused: true });");
    expect(script).toContain("duration: 5");
  });

  it("includes media sync for video elements", () => {
    const elements = [makeVideoElement()];
    const script = generateGsapTimelineScript(elements, 10);

    expect(script).toContain("Sync media playback");
    expect(script).toContain("media.currentTime");
  });

  it("generates initial position sets for elements with x/y offsets", () => {
    const elements = [makeVideoElement({ id: "vid-pos", x: 100, y: 200 })];
    const script = generateGsapTimelineScript(elements, 10);

    expect(script).toContain('tl.set("#vid-pos", { x: 100, y: 200 }');
  });

  it("generates animations from keyframes", () => {
    const elements = [makeTextElement({ id: "el-kf", startTime: 0, duration: 5 })];
    const keyframes = {
      "el-kf": [
        { id: "kf1", time: 0, properties: { opacity: 0 } },
        { id: "kf2", time: 1, properties: { opacity: 1 } },
      ],
    };
    const script = generateGsapTimelineScript(elements, 5, { keyframes });

    // Should contain keyframe-based animations
    expect(script).toContain("el-kf");
  });
});

describe("generateHyperframesStyles", () => {
  it("generates core CSS with stage dimensions for landscape", () => {
    const elements = [makeTextElement()];
    const { coreCss } = generateHyperframesStyles(elements, "landscape");

    expect(coreCss).toContain("width: 1920px");
    expect(coreCss).toContain("height: 1080px");
    expect(coreCss).toContain("#stage");
  });

  it("generates core CSS with stage dimensions for portrait", () => {
    const elements = [makeTextElement()];
    const { coreCss } = generateHyperframesStyles(elements, "portrait");

    expect(coreCss).toContain("width: 1080px");
    expect(coreCss).toContain("height: 1920px");
  });

  it("generates element-specific styles for text", () => {
    const elements = [makeTextElement({ id: "styled-text", fontSize: 72, color: "red" })];
    const { coreCss } = generateHyperframesStyles(elements, "landscape");

    expect(coreCss).toContain("#styled-text");
    expect(coreCss).toContain("position: absolute");
  });

  it("generates element-specific styles for video", () => {
    const elements = [makeVideoElement({ id: "vid-styled" })];
    const { coreCss } = generateHyperframesStyles(elements, "landscape");

    expect(coreCss).toContain("#vid-styled");
    expect(coreCss).toContain("object-fit: contain");
  });

  it("includes custom CSS when provided", () => {
    const elements = [makeTextElement()];
    const { customCss } = generateHyperframesStyles(elements, "landscape", ".custom { color: blue; }");

    expect(customCss).toContain(".custom { color: blue; }");
  });

  it("generates Google Fonts link for Inter (always included)", () => {
    const elements = [makeTextElement()];
    const { googleFontsLink } = generateHyperframesStyles(elements, "landscape");

    expect(googleFontsLink).toContain("fonts.googleapis.com");
    expect(googleFontsLink).toContain("Inter");
  });

  it("includes additional font families from text elements", () => {
    const elements = [makeTextElement({ fontFamily: "Montserrat" })];
    const { googleFontsLink } = generateHyperframesStyles(elements, "landscape");

    expect(googleFontsLink).toContain("Montserrat");
  });
});
